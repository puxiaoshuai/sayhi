const { request } = require('../../utils/request');
const { speak, prefetch } = require('../../utils/speak');
const { wrapWords } = require('../../utils/wrap-words');

/** 星期缩写：getUTCDay() 0=周日。日期统一按 UTC 解析（见 shiftDate）， weekday 也取 UTC */
const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 日期加减 n 天。
 * 必须显式按 UTC 解析与运算：new Date('2026-11-02') 在本地时区（东八区）
 * 会被当成 UTC 0 点 = 本地 8 点，但 setUTCDate 后再 toISOString 取前 10 位是安全的；
 * 真正的坑是反过来用本地 getter（getDate 等）会在西半球时区把日期偏移成前一天。
 */
function shiftDate(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** '2026-11-02' → '2026年11月02日 · 周一' */
function formatDateCN(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${d.getUTCFullYear()}年${String(d.getUTCMonth() + 1).padStart(2, '0')}月${String(d.getUTCDate()).padStart(2, '0')}日 · 周${WEEK_LABELS[d.getUTCDay()]}`;
}

Page({
  data: {
    article: null, // 预处理后的文章（段落含 segs/favorited/speaking，词条含 favorited）
    today: '', // 服务器口径的今天（'今天'徽标与右翻禁用的唯一依据，前端不自算）
    dateLabel: '',
    isToday: false,
    canNext: false, // 还有更新的日期可右翻（当天时为 false）
    loading: false,
    loadFailed: false,
  },

  onLoad() {
    // 当前展示的日期，'' 表示今天（由服务器计算）；翻页后固化为具体日期
    this.currentDate = '';
  },

  onShow() {
    // 切回 tab / 跨 0 点后重拉：刷新 today 缓存，右翻按钮才能解禁
    this.loadDate(this.currentDate);
  },

  /** 拉某天的文章；date 为 '' 时由服务器按北京时区取今天 */
  async loadDate(date) {
    this.setData({ loading: true, loadFailed: false, article: null });
    try {
      const article = await request({
        url: '/daily-article',
        ...(date ? { data: { date } } : {}),
      });
      // 预处理：段落生成分词片段（句内点读用），段落/词条附收藏态（见技术方案 4.2）
      article.paragraphs = (article.paragraphs || []).map((p) => ({
        ...p,
        favorited: false,
        speaking: false,
        segs: wrapWords(p.en),
      }));
      article.words = (article.words || []).map((w) => ({ ...w, favorited: false }));
      this.currentDate = article.date;
      this.setData({
        article,
        today: article.today,
        isToday: article.date === article.today,
        // ISO 日期字符串比较等价于日期比较
        canNext: article.date < article.today,
        dateLabel: formatDateCN(article.date),
        loading: false,
      });
      // 静默预取重点单词音频，点词即响
      prefetch(article.words.map((w) => w.word));
    } catch (e) {
      // request 封装已 toast
      this.setData({ loadFailed: true, loading: false });
    }
  },

  onPrev() {
    this.loadDate(shiftDate(this.currentDate, -1));
  },

  onNext() {
    if (!this.data.canNext) return;
    this.loadDate(shiftDate(this.currentDate, 1));
  },

  /** 生成失败后的手动重试 */
  retry() {
    this.loadDate(this.currentDate);
  },

  /** 重点单词点读（词汇卡整块可点） */
  speakWord(e) {
    speak(e.currentTarget.dataset.word);
  },

  /** 标题朗读 */
  speakTitle() {
    if (this.data.article) speak(this.data.article.title);
  },

  /** 段内单词点读：读单词 + 高亮 0.6s */
  onWordTap(e) {
    const { paraIndex, segIndex, word } = e.currentTarget.dataset;
    speak(word);
    const path = `article.paragraphs[${paraIndex}].segs[${segIndex}].speaking`;
    this.setData({ [path]: true });
    setTimeout(() => this.setData({ [path]: false }), 600);
  },

  /** 整段朗读：onStart/onEnd 驱动喇叭高亮，播完自然熄灭（不用定时器估时长） */
  speakPara(e) {
    const idx = e.currentTarget.dataset.index;
    const para = this.data.article.paragraphs[idx];
    if (!para) return;
    const path = `article.paragraphs[${idx}].speaking`;
    speak(para.en, {
      onStart: () => this.setData({ [path]: true }),
      onEnd: () => this.setData({ [path]: false }),
    });
  },

  /** 收藏重点单词（sourceType=daily_word，见技术方案 4.2 映射约定） */
  async favWord(e) {
    const idx = e.currentTarget.dataset.index;
    const word = this.data.article.words[idx];
    await this.saveFavorite({
      sourceText: `${this.data.article.titleZh} · ${word.meaning}`,
      translation: word.word,
      vocabulary: [word],
      sourceType: 'daily_word',
      sceneKey: this.data.article.date,
      sceneName: '每日一文',
      path: `article.words[${idx}].favorited`,
      label: word.word,
    });
  },

  /** 收藏段落（sourceType=daily_sentence） */
  async favPara(e) {
    const idx = e.currentTarget.dataset.index;
    const para = this.data.article.paragraphs[idx];
    await this.saveFavorite({
      sourceText: para.zh,
      translation: para.en,
      sourceType: 'daily_sentence',
      sceneKey: this.data.article.date,
      sceneName: '每日一文',
      path: `article.paragraphs[${idx}].favorited`,
      label: '美文段落',
    });
  },

  async saveFavorite({ path, label, ...body }) {
    // 已点亮就不再重复提交，防手抖双击产生重复记录（收藏态是会话内本地标记，与 scene-detail 一致）
    if (this.getByPath(path)) {
      wx.showToast({ title: '已在生词本中', icon: 'none' });
      return;
    }
    try {
      await request({
        url: '/favorites',
        method: 'POST',
        auth: true,
        data: body,
      });
      this.setData({ [path]: true });
      wx.showToast({ title: `已收藏：${label}`, icon: 'success' });
    } catch (e) {
      // request 封装已 toast
    }
  },

  /** 按 'a.b[0].c' 形式的路径取当前值，用于收藏前的已收藏判断 */
  getByPath(path) {
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let cur = this.data;
    for (const k of keys) {
      if (cur == null) return undefined;
      cur = cur[k];
    }
    return cur;
  },
});
