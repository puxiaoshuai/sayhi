const { request } = require('./request');

/**
 * 语音输入（ASR）封装（见技术方案 6.5）。
 *
 * 原实现依赖「微信同声传译」插件，但本小程序为个人主体，平台不允许添加该插件。
 * 现改为：内置 wx.getRecorderManager() 录音（不需要插件）→ 上传后端 → 后端调百炼识别。
 * 识别为非实时：松手结束，整段返回，没有中间结果回填。
 */

/**
 * 录音参数：兼顾识别准确率与 base64 上传体积。
 * 注意 sampleRate=16000 时 encodeBitRate 的合法区间是 24000~96000，配错 start() 会直接失败。
 * 按此参数，60 秒录音约 360KB，base64 后约 480KB，远低于后端 10MB 上限。
 */
const RECORD_OPTIONS = {
  duration: 60000, // 上限 60 秒，到点自动触发 onStop
  sampleRate: 16000, // 语音识别标准采样率
  numberOfChannels: 1, // 单声道，体积减半
  encodeBitRate: 48000,
  format: 'mp3',
};

/** 与首页 textarea 的 maxlength 对齐，超出部分截断 */
const MAX_INPUT_LEN = 100;

/** 短于此时长视为误触，不上传 */
const MIN_DURATION = 300;

let recorder = null;
let page = null; // 当前页面实例，回调闭包通过它回填数据
let bound = false;
let authCached = false; // 授权通过后置位：长按要即时起录，不能再让异步 getSetting 卡在开头
let cancelled = false; // 本次录音是否被上滑取消（onStop 里据此决定丢弃还是上传）

function getRecorder() {
  if (!recorder) recorder = wx.getRecorderManager();
  return recorder;
}

/**
 * 麦克风授权三态处理：
 * - true      已授权，直接放行
 * - false     曾被拒绝 → 引导去设置页打开
 * - undefined 首次 → wx.authorize 弹窗
 * 失败时 reject；弹窗/引导已由本函数负责，调用方可静默返回。
 *
 * 授权一旦通过就缓存在 authCached：长按是「按下即录」，首次用 getSetting
 * 的异步往返会让起录明显迟滞，缓存后除首次外都同步放行。
 */
function ensureRecordAuth() {
  if (authCached) return Promise.resolve();

  return new Promise((resolve, reject) => {
    wx.getSetting({
      success: ({ authSetting }) => {
        const state = authSetting['scope.record'];
        if (state === true) {
          authCached = true;
          return resolve();
        }

        if (state === false) {
          wx.showModal({
            title: '需要麦克风权限',
            content: '请在设置中允许使用麦克风，才能把语音转成文字',
            confirmText: '去设置',
            success: (m) => {
              if (!m.confirm) return reject(new Error('auth-denied'));
              wx.openSetting({
                success: (s) => {
                  if (!s.authSetting['scope.record']) {
                    return reject(new Error('auth-denied'));
                  }
                  authCached = true;
                  resolve();
                },
                fail: () => reject(new Error('auth-denied')),
              });
            },
            fail: () => reject(new Error('auth-denied')),
          });
          return;
        }

        wx.authorize({
          scope: 'scope.record',
          success: () => {
            authCached = true;
            resolve();
          },
          fail: () => reject(new Error('auth-denied')),
        });
      },
      fail: () => reject(new Error('auth-check-failed')),
    });
  });
}

/** 本地录音临时文件 → base64 字符串（微信返回的不带 data: 前缀、无换行） */
function fileToBase64(filePath) {
  return new Promise((resolve, reject) => {
    // 用异步 readFile；同步版本会卡住 UI。
    // 该 API 不支持 position/length 分段读，只能整块读入内存——体积靠 RECORD_OPTIONS 控制。
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (res) => resolve(res.data),
      fail: reject,
    });
  });
}

/** 录音文件 → 上传后端 → 识别文本 */
async function recognize(filePath, format = RECORD_OPTIONS.format) {
  const audio = await fileToBase64(filePath);
  const res = await request({
    url: '/asr/transcribe',
    method: 'POST',
    auth: true, // 复用登录态，见 utils/request.js 里的 token 等待逻辑
    silent: true, // 错误文案由调用方统一决定
    data: { audio, format },
  });
  return (res && res.text) || '';
}

/**
 * 绑定录音回调。RecorderManager 是全局单例、回调可叠加，
 * 重复绑定会导致一次录音触发多次上传，故用 bound 保证只绑一次；
 * page 引用每次调用都刷新（回调闭包读的是模块级的它）。
 */
function bind(pageInstance) {
  page = pageInstance;
  if (bound) return;
  bound = true;

  const r = getRecorder();

  r.onStop(async (res) => {
    if (!page) return;
    page.setData({ listening: false });

    const wasCancelled = cancelled; // 先取再复位，避免下一次录音读到脏值
    cancelled = false;

    if (wasCancelled) return; // 上滑取消：不上传、不消耗额度

    const { tempFilePath, duration } = res || {};
    if (!tempFilePath) return;
    if ((duration || 0) < MIN_DURATION) {
      wx.showToast({ title: '说话时间太短', icon: 'none' }); // 误触，不消耗额度
      return;
    }

    page.setData({ asrLoading: true });
    wx.showLoading({ title: '识别中...', mask: true });

    let toast = '';
    try {
      const text = await recognize(tempFilePath);
      if (!text) {
        toast = '没听清，请再说一次';
      } else {
        page.setData({ inputText: text.slice(0, MAX_INPUT_LEN) });
      }
    } catch (e) {
      toast = (e && e.message) || '语音识别失败，请重试';
    } finally {
      wx.hideLoading(); // 必须先关 loading，否则随后的 toast 会被它盖住
      page.setData({ asrLoading: false });
      if (toast) wx.showToast({ title: toast, icon: 'none' });
    }
  });

  r.onError(() => {
    cancelled = false;
    wx.hideLoading();
    if (page) page.setData({ listening: false, asrLoading: false });
    wx.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none' });
  });
}

function start() {
  cancelled = false;
  getRecorder().start(RECORD_OPTIONS);
}

/** 松手结束并上传识别 */
function stop() {
  getRecorder().stop();
}

/** 上滑取消：照样停录音，但 onStop 里按 cancelled 丢弃，不上传 */
function cancel() {
  cancelled = true;
  getRecorder().stop();
}

module.exports = { bind, start, stop, cancel, ensureRecordAuth, RECORD_OPTIONS };
