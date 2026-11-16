const { request } = require('../../utils/request');
const { speak } = require('../../utils/speak');
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

/** '2026-11-16' → '2026年11月16日 · 周一' */
function formatDateCN(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${d.getUTCFullYear()}年${String(d.getUTCMonth() + 1).padStart(2, '0')}月${String(d.getUTCDate()).padStart(2, '0')}日 · 周${WEEK_LABELS[d.getUTCDay()]}`;
}

Page({
  data: {
    daily: null, // 预处理后的当日口语（句子含 segs/favorited/speaking）
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

  /** 拉某天的口语；date 为 '' 时由服务器按北京时区取今天 */
  async loadDate(date) {
    this.setData({ loading: true, loadFailed: false, daily: null });
    try {
      const daily = await request({
        url: '/daily-sentences',
        ...(date ? { data: { date } } : {}),
      });
      // 预处理：句子生成分词片段（句内点读用）并附收藏态（见技术方案 4.2）。
      // 不做整句 TTS 预取：服务端落盘缓存已保证每天每句全局只合成一次，
      // prefetch 只省点击后 1~2 秒却会挤占本地 400 条 LRU（scene-detail 同为按需）
      daily.sentences = (daily.sentences || []).map((s) => ({
        ...s,
        favorited: false,
        speaking: false,
        segs: wrapWords(s.en),
      }));
      this.currentDate = daily.date;
      this.setData({
        daily,
        today: daily.today,
        isToday: daily.date === daily.today,
        // ISO 日期字符串比较等价于日期比较
        canNext: daily.date < daily.today,
        dateLabel: formatDateCN(daily.date),
        loading: false,
      });
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

  /** 句内单词点读：读单词 + 高亮 0.6s */
  onWordTap(e) {
    const { sentIndex, segIndex, word } = e.currentTarget.dataset;
    speak(word);
    const path = `daily.sentences[${sentIndex}].segs[${segIndex}].speaking`;
    this.setData({ [path]: true });
    setTimeout(() => this.setData({ [path]: false }), 600);
  },

  /** 整句朗读：onStart/onEnd 驱动喇叭高亮，播完自然熄灭（不用定时器估时长） */
  speakSentence(e) {
    const idx = e.currentTarget.dataset.index;
    const sent = this.data.daily.sentences[idx];
    if (!sent) return;
    const path = `daily.sentences[${idx}].speaking`;
    speak(sent.en, {
      onStart: () => this.setData({ [path]: true }),
      onEnd: () => this.setData({ [path]: false }),
    });
  },

  /** 收藏句子（sourceType=daily_sentence，与旧每日一文的段落收藏共用枚举，
   *  靠 sceneName 快照'每日口语'在生词本里区分新旧来源） */
  async favSentence(e) {
    const idx = e.currentTarget.dataset.index;
    const s = this.data.daily.sentences[idx];
    await this.saveFavorite({
      // 场景名前缀让生词本回看时知道这句来自哪个场景
      sourceText: `${this.data.daily.sceneName} · ${s.zh}`,
      translation: s.en,
      sourceType: 'daily_sentence',
      sceneKey: this.data.daily.date,
      sceneName: '每日口语',
      path: `daily.sentences[${idx}].favorited`,
      label: '口语句子',
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
