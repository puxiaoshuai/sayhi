const { request } = require('../../utils/request');
const { speak } = require('../../utils/speak');
const { wrapWords } = require('../../utils/wrap-words');
const { sceneName } = require('../../utils/scene-name');

/** 每页条数，与后端 DEFAULT_LIMIT 保持一致 */
const PAGE_SIZE = 20;

/** 搜索防抖：输入停下后再发请求，避免每敲一个字打一次接口 */
const SEARCH_DEBOUNCE_MS = 300;

const SOURCE_LABELS = {
  translation: { label: '翻译收藏', cls: 'tag-blue' },
  scene_word: { label: '场景词汇', cls: 'tag-green' },
  scene_expression: { label: '场景语句', cls: 'tag-green' },
};

Page({
  data: {
    keyword: '',
    list: [], // 已加载的收藏（含渲染预处理字段），跨页累加
    hasMore: false,
    loading: false, // 首屏 / 搜索重载中
    loadingMore: false, // 触底加载中
  },

  onLoad() {
    // 下一页游标只用于发请求、不参与渲染，存实例上省掉一次 setData
    this.nextCursor = null;
    this.reqSeq = 0; // 请求序号，用于丢弃乱序返回的旧响应
  },

  onShow() {
    this.reload();
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh());
  },

  /** 触底加载下一页 */
  onReachBottom() {
    if (!this.data.hasMore || this.data.loading || this.data.loadingMore) return;
    this.fetchPage(this.nextCursor, true);
  },

  /** 重新拉第一页：进入页面 / 下拉刷新 / 搜索词变化都走这里 */
  reload() {
    this.nextCursor = null;
    return this.fetchPage(null, false);
  },

  /**
   * 拉一页收藏。
   * @param {string|null} cursor 上一页最后一条的游标，null 表示第一页
   * @param {boolean} append true 追加到列表尾部，false 整体替换
   */
  async fetchPage(cursor, append) {
    const seq = ++this.reqSeq;
    this.setData(append ? { loadingMore: true } : { loading: true });

    const keyword = (this.data.keyword || '').trim();
    try {
      const page = await request({
        url: '/favorites',
        data: {
          limit: PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
          ...(keyword ? { keyword } : {}),
        },
        auth: true,
      });

      // 防抖期间可能连发多次，慢的旧响应回来时会覆盖新结果，这里直接丢弃
      if (seq !== this.reqSeq) return;

      const items = (page.items || []).map((f) => this.decorate(f));
      this.nextCursor = page.nextCursor;
      this.setData({
        list: append ? this.data.list.concat(items) : items,
        hasMore: !!page.hasMore,
        loading: false,
        loadingMore: false,
      });
    } catch (e) {
      // request 封装已 toast
      if (seq !== this.reqSeq) return;
      this.setData({ loading: false, loadingMore: false });
    }
  },

  /** 渲染预处理：来源标签、场景名、分词（句子型）、时间 */
  decorate(f) {
    const src = SOURCE_LABELS[f.sourceType] || SOURCE_LABELS.translation;
    const isSentence =
      f.sourceType !== 'scene_word' && /\s/.test(String(f.translation).trim());
    return {
      ...f,
      sourceTypeLabel: src.label,
      sourceTypeClass: src.cls,
      // 优先用收藏时存下的场景名快照：自定义场景的 sceneKey 是无意义哈希，
      // 静态映射表兜不住；这里保留 sceneName 兜底是为了兼容加字段前的老收藏
      sceneLabel: f.sceneName || (f.sceneKey ? sceneName(f.sceneKey) : ''),
      segs: isSentence ? wrapWords(f.translation) : null,
      timeLabel: f.createdAt ? f.createdAt.slice(0, 16).replace('T', ' ') : '',
    };
  },

  /**
   * 搜索改为服务端过滤：分页后前端手里只有已加载的那几页，
   * 再在本地 filter 会漏掉没加载的收藏，用户会以为数据丢了。
   */
  onSearch(e) {
    this.setData({ keyword: e.detail.value });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.reload(), SEARCH_DEBOUNCE_MS);
  },

  /** 句内单词点读：读单词 + 高亮 0.6s */
  onWordTap(e) {
    const { favIndex, segIndex, word } = e.currentTarget.dataset;
    speak(word);
    const path = `list[${favIndex}].segs[${segIndex}].speaking`;
    this.setData({ [path]: true });
    setTimeout(() => this.setData({ [path]: false }), 600);
  },

  /**
   * 整句/整词朗读：喇叭点亮到这一段播完。
   * 用 onStart/onEnd 而不是像点词那样定时熄灭 —— 句子长短差别大，
   * 固定时长不是早灭就是残留；播完由 speak 内部回调，被下一段打断时也会走到 onEnd。
   */
  speakWhole(e) {
    const { favIndex, en } = e.currentTarget.dataset;
    const path = `list[${favIndex}].speaking`;
    speak(en, {
      onStart: () => this.setData({ [path]: true }),
      onEnd: () => this.setData({ [path]: false }),
    });
  },

  /** 删除收藏 */
  removeFav(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '移除收藏',
      content: '确定从生词本移除这条内容吗？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await request({ url: `/favorites/${id}`, method: 'DELETE', auth: true });
          wx.showToast({ title: '已移除', icon: 'success' });
          // 本地剔除即可，不整页重拉 —— 重拉会把用户已经翻出来的页数丢回第一页
          this.setData({ list: this.data.list.filter((f) => f._id !== id) });
        } catch (e2) {
          // request 封装已 toast
        }
      },
    });
  },
});
