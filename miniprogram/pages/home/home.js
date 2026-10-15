const { request } = require('../../utils/request');
const { speak } = require('../../utils/speak');
const { wrapWords } = require('../../utils/wrap-words');
const asr = require('../../utils/asr');

/** 上滑取消判定阈值（px）：手指相对按下位置上移超过该距离即进入取消区 */
const CANCEL_DISTANCE = 60;

Page({
  data: {
    inputText: '',
    loading: false,
    listening: false, // 录音中（驱动按钮红底脉冲 + 录音浮层）
    recordCancel: false, // 手指已上滑到取消区（松手即作废）
    recordSeconds: 0, // 录音计时，仅用于浮层展示
    asrLoading: false, // 录音已结束、上传识别中
    result: null, // { translation, vocabulary, patterns }
    translationSegments: [], // 翻译结果的分词片段（单词点读用）
    favorited: false,
  },

  onLoad() {
    asr.bind(this); // 录音回调是全局单例，只绑一次，闭包负责回填本页数据
    this._startY = 0; // 本次长按的起始纵坐标（算上滑距离用）
    this._seq = 0; // 长按序号：授权是异步的，用它作废「已松手才 resolve」的那一次
    this._finishing = false; // 按钮与浮层都挂了 touchend，防止同一手势被收尾两次
    this._timer = null;
  },

  onHide() {
    // 切 tab / 退到后台时收尾，避免录音悬挂（收尾逻辑统一在 asr 的 onStop 里）
    if (this.data.listening) asr.stop();
    this._clearTimer();
  },

  onUnload() {
    this._clearTimer();
  },

  _clearTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  onTextInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  /**
   * 长按开始录音（同微信：按下即录）。
   * 授权是异步的，首次会弹权限框；期间用户可能已经松手，
   * 故用 _seq 给每次按下编号，回调回来时序号对不上就说明这一轮已作废。
   */
  onMicStart(e) {
    if (this.data.listening || this.data.asrLoading || this.data.loading) return;
    this._finishing = false;

    const touch = (e.touches && e.touches[0]) || {};
    this._startY = touch.clientY || 0;
    const seq = (this._seq = this._seq + 1);

    asr.ensureRecordAuth()
      .then(() => {
        if (seq !== this._seq) return; // 已松手或又按了一次，本轮作废
        asr.start();
        this.setData({ listening: true, recordCancel: false, recordSeconds: 0 });
        this._clearTimer();
        this._timer = setInterval(() => {
          this.setData({ recordSeconds: this.data.recordSeconds + 1 });
        }, 1000);
      })
      .catch(() => {}); // 弹窗/设置页引导已由 asr.ensureRecordAuth 负责
  },

  /** 上滑经过阈值即进入取消区，视觉上给反馈 */
  onMicMove(e) {
    if (!this.data.listening) return;
    const touch = (e.touches && e.touches[0]) || {};
    const cancel = this._startY - (touch.clientY || 0) > CANCEL_DISTANCE;
    if (cancel !== this.data.recordCancel) this.setData({ recordCancel: cancel });
  },

  /**
   * 松手：正常则结束并识别，落在取消区则作废。
   * 这里不置 listening=false —— recorder.stop() 到 onStop 回调之间有几十毫秒空窗，
   * 提前清掉会让用户极快地再次按下时，上一轮的 onStop 反过来把新录音的浮层关掉。
   * 由 asr 的 onStop 统一收尾，浮层多留这几十毫秒肉眼无感。
   */
  onMicEnd() {
    this._seq = this._seq + 1; // 作废尚未 resolve 的授权回调
    this._clearTimer();
    if (!this.data.listening || this._finishing) return;
    this._finishing = true;

    if (this.data.recordCancel) {
      asr.cancel();
    } else {
      asr.stop(); // 上传与回填统一在 asr 的 onStop 回调里做
    }
  },

  /** 手势被系统打断（来电、通知栏下拉等）一律按取消处理 */
  onMicCancel() {
    this._seq = this._seq + 1;
    this._clearTimer();
    if (!this.data.listening || this._finishing) return;
    this._finishing = true;
    asr.cancel();
  },

  async translate() {
    const text = (this.data.inputText || '').trim();
    if (!text) {
      wx.showToast({ title: '请先输入或说出中文', icon: 'none' });
      return;
    }
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const result = await request({
        url: '/translation/analyze',
        method: 'POST',
        data: { text },
      });
      this.setData({
        result,
        translationSegments: wrapWords(result.translation),
        favorited: false,
      });
    } catch (e) {
      // request 封装已 toast
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 整句朗读 */
  speakTranslation() {
    if (this.data.result) speak(this.data.result.translation);
  },

  /** 句内单词点读：读单词 + 高亮 0.6s */
  onWordTap(e) {
    const { word, index } = e.currentTarget.dataset;
    speak(word);
    this.setData({ [`translationSegments[${index}].speaking`]: true });
    setTimeout(() => {
      this.setData({ [`translationSegments[${index}].speaking`]: false });
    }, 600);
  },

  /** 词汇/例句点击朗读 */
  onVocabTap(e) {
    speak(e.currentTarget.dataset.word);
  },

  /** 收藏本次翻译结果（sourceType=translation，见技术方案 4.2） */
  async toggleFavorite() {
    if (!this.data.result) return;
    if (this.data.favorited) {
      wx.showToast({ title: '已取消收藏', icon: 'none' });
      this.setData({ favorited: false });
      return;
    }
    try {
      await request({
        url: '/favorites',
        method: 'POST',
        auth: true,
        data: {
          sourceText: this.data.inputText,
          translation: this.data.result.translation,
          vocabulary: this.data.result.vocabulary,
          patterns: this.data.result.patterns,
          sourceType: 'translation',
        },
      });
      this.setData({ favorited: true });
      wx.showToast({ title: '已加入生词本', icon: 'success' });
    } catch (e) {
      // request 封装已 toast
    }
  },
});
