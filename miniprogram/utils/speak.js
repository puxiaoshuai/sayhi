/**
 * 语音朗读封装（见技术方案 6.5）。
 * 单词点读、整句朗读统一走这一个入口；连点切换时先停上一段。
 *
 * 链路：后端 /api/tts 用百炼合成 → 本地落盘 → innerAudioContext 播放。
 * 原实现依赖「微信同声传译」插件 WechatSI，但本小程序为个人主体，
 * 平台不允许个人主体添加该插件，故改为自建 TTS（与 ASR 同一条路线）。
 *
 * 两级缓存，缺一不可：
 *   本地文件命中 → 直接出声。点词是高频操作，这是「点下去就有声」的关键；
 *   服务端落盘   → 同一段文本一辈子只真正合成一次，控制成本。
 */
const { request } = require('./request');

/** 缓存目录。必须用 USER_DATA_PATH：temp 目录会被系统清理，缓存会莫名失效。 */
const CACHE_DIR = `${wx.env.USER_DATA_PATH}/tts`;

/**
 * 本地缓存条数上限，超出按最久未用淘汰。
 * 平台对 USER_DATA_PATH 的总量限制是 200MB，而单词约 8KB、整句约 60KB，
 * 400 条约几 MB，既够用又离上限很远。
 */
const MAX_FILES = 400;

/** LRU 顺序表（末尾最新）存本地：拿文件 mtime 排序代价太高，自己记更省事 */
const ORDER_KEY = 'tts_cache_order';

let config = null; // { voice, rate, format } 来自后端，参与本地缓存 key
let readyPromise = null;
let audioCtx = null;
let currentOpts = null; // 当前这一段的回调，用于打断/结束时收尾
let seq = 0; // 每次 speak 自增，异步返回后据此丢弃过期结果
const cached = new Set(); // 本地已存在的文件名
let order = [];
const inflight = new Map(); // 文件名 → Promise<path>，同一次点击与预取只下一个请求
let persistTimer = null;

/**
 * FileSystemManager 的回调式接口转 Promise。
 * 刻意不用 Promise 风格调用，避开「基础库版本够不够」的差异。
 */
function fsCall(method, options) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager()[method]({ ...options, success: resolve, fail: reject });
  });
}

/**
 * 32 位 djb2。小程序没有 crypto，缓存文件名用这个就够——
 * 几百个条目的碰撞概率约 1e-5，真撞了也只是听错一次，可接受。
 */
function hashCode(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** 文件名里必须带上音色与语速：否则改了服务端 TTS_VOICE，本地还会命中旧音色 */
function fileName(text) {
  const c = config || {};
  const raw = `${c.voice || ''}|${c.rate || ''}|${text}`;
  return `${hashCode(raw)}${raw.length.toString(36)}.${c.format || 'mp3'}`;
}

function persistOrder() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      wx.setStorageSync(ORDER_KEY, order);
    } catch (e) {
      // 存储写失败只影响下次启动时的淘汰顺序，不影响朗读
    }
  }, 1000);
}

/** 命中即提到末尾，让「最久未用」真的是最久未用 */
function touch(name) {
  const i = order.indexOf(name);
  if (i === -1 || i === order.length - 1) return;
  order.splice(i, 1);
  order.push(name);
}

function evict() {
  let dropped = false;
  while (order.length > MAX_FILES) {
    const name = order.shift();
    cached.delete(name);
    fsCall('unlink', { filePath: `${CACHE_DIR}/${name}` }).catch(() => {});
    dropped = true;
  }
  if (dropped) persistOrder();
}

async function loadIndex() {
  let files = [];
  try {
    // 注意 readdir 的 success 回调给的是 { files, errMsg }，不是文件名数组本身
    // （同步版 readdirSync 才直接返回数组）。这里当成数组用，会在 new Set 时直接抛错。
    const res = await fsCall('readdir', { dirPath: CACHE_DIR });
    files = (res && res.files) || [];
  } catch (e) {
    files = []; // 首次运行目录还没建
  }
  const exist = new Set(files);
  const saved = wx.getStorageSync(ORDER_KEY) || [];
  // 顺序表里筛掉已被删掉的，再把磁盘上多出来的补到末尾（外部清理 / 首次运行）
  order = saved.filter((n) => exist.has(n));
  files.forEach((n) => {
    if (order.indexOf(n) === -1) order.push(n);
  });
  cached.clear();
  order.forEach((n) => cached.add(n));
}

function ensureReady() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    await fsCall('mkdir', { dirPath: CACHE_DIR, recursive: true }).catch(() => {});
    // 配置拿不到不该让朗读整个挂掉：用兜底值继续跑，
    // 代价只是换过音色后本地缓存要多下一次网络
    config = await request({ url: '/tts/config', auth: true, silent: true }).catch(
      () => ({ voice: 'unknown', rate: 1, format: 'mp3' }),
    );
    await loadIndex();
  })();
  return readyPromise;
}

async function download(text, name) {
  const res = await request({
    url: '/tts',
    method: 'POST',
    auth: true,
    silent: true, // 错误文案统一由 speak() 决定
    data: { text },
  });
  if (!res || !res.audio) throw new Error('朗读暂不可用');

  const path = `${CACHE_DIR}/${name}`;
  await fsCall('writeFile', {
    filePath: path,
    data: wx.base64ToArrayBuffer(res.audio),
  });
  cached.add(name);
  order.push(name);
  persistOrder();
  evict();
  return path;
}

/** 取本地文件路径：命中直接用，否则拉一次并落盘 */
function getAudio(text) {
  const name = fileName(text);
  if (cached.has(name)) {
    touch(name);
    return Promise.resolve(`${CACHE_DIR}/${name}`);
  }
  if (inflight.has(name)) return inflight.get(name);

  const task = download(text, name).finally(() => inflight.delete(name));
  inflight.set(name, task);
  return task;
}

function getCtx() {
  if (audioCtx) return audioCtx;

  audioCtx = wx.createInnerAudioContext({ useWebAudioImplement: true });

  // 学习场景常常是手机静音着外放跟读。默认会跟随系统静音开关，
  // 静音键一开就彻底没声音，很容易被当成 bug。这里关掉跟随。
  wx.setInnerAudioOption({ obeyMuteSwitch: false });

  // 只处理「自然播完 / 播放出错」。打断旧的一段走 play() 里的主动收尾——
  // stop() 触发的是 onStop 而非 onEnded，绑 onStop 会在换 src 时误伤新的一段。
  const finish = () => {
    const opts = currentOpts;
    currentOpts = null;
    if (opts && opts.onEnd) opts.onEnd();
  };
  audioCtx.onEnded(finish);
  audioCtx.onError(finish);
  audioCtx.onPlay(() => {
    if (currentOpts && currentOpts.onStart) currentOpts.onStart();
  });

  return audioCtx;
}

function play(path, opts) {
  const ctx = getCtx();

  // 先让上一段的调用方收尾（熄灭高亮），再换 src
  const prev = currentOpts;
  currentOpts = null;
  if (prev && prev.onEnd) prev.onEnd();

  ctx.stop();
  currentOpts = opts || null;
  ctx.src = path;
  ctx.play();
}

/**
 * 朗读一段文本。签名与旧实现保持一致，现有 6 个调用点无需改动。
 * @param {string} text 英文单词或句子
 * @param {{onStart?: Function, onEnd?: Function}} [opts] 播放开始/结束回调（可选）
 * @returns {Promise<void>}
 */
function speak(text, opts) {
  const value = String(text == null ? '' : text).trim();
  if (!value) return Promise.resolve();

  const my = ++seq;
  return ensureReady()
    .then(() => getAudio(value))
    .then((path) => {
      // 等待期间用户又点了别的词：这次结果作废，
      // 否则连点 A、B 时后到的 A 会把 B 顶掉
      if (my !== seq) return;
      play(path, opts);
    })
    .catch((e) => {
      if (my !== seq) return;
      wx.showToast({ title: (e && e.message) || '朗读暂不可用', icon: 'none' });
    });
}

/**
 * 后台预取：不播放、不打扰，失败静默。
 * 首页拿到翻译结果后调用，用户真正点词时文件已在本地，点下去就出声。
 * @param {string[]} list 待预取的文本
 */
function prefetch(list) {
  const items = (list || [])
    .map((t) => String(t == null ? '' : t).trim())
    .filter(Boolean);
  if (!items.length) return Promise.resolve();

  return ensureReady().then(() => {
    let i = 0;
    // 限并发 2：太多会把首屏其他请求（翻译、收藏）挤掉
    const worker = () => {
      if (i >= items.length) return Promise.resolve();
      const text = items[i++];
      return getAudio(text).then(worker, worker); // 失败也继续下一个
    };
    return Promise.all([worker(), worker()]);
  });
}

module.exports = { speak, prefetch };
