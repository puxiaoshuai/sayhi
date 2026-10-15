const { request } = require('../../utils/request');
const { speak } = require('../../utils/speak');
const { wrapWords } = require('../../utils/wrap-words');

Page({
  data: {
    sceneKey: '',
    scene: null,
    loading: false,
  },

  onLoad(options) {
    this.loadScene(options.key || 'home-kitchen');
  },

  async loadScene(sceneKey) {
    this.setData({ loading: true, scene: null });
    try {
      const scene = await request({ url: `/scenes/${sceneKey}` });
      // 预处理：每条语句生成分词片段（单词点读用），词汇/语句附收藏态
      scene.vocabulary = (scene.vocabulary || []).map((v) => ({ ...v, favorited: false }));
      scene.expressions = (scene.expressions || []).map((e) => ({
        ...e,
        favorited: false,
        segs: wrapWords(e.en),
      }));
      this.setData({ scene, sceneKey });
      wx.setNavigationBarTitle({ title: `${scene.name} · 场景学习` });
    } catch (e) {
      // request 封装已 toast
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 词汇点读 */
  speakWord(e) {
    speak(e.currentTarget.dataset.word);
  },

  /** 语句整句朗读 */
  speakExpr(e) {
    const expr = this.data.scene.expressions[e.currentTarget.dataset.index];
    if (expr) speak(expr.en);
  },

  /** 句内单词点读：读单词 + 高亮 0.6s */
  onWordTap(e) {
    const { expIndex, segIndex, word } = e.currentTarget.dataset;
    speak(word);
    const path = `scene.expressions[${expIndex}].segs[${segIndex}].speaking`;
    this.setData({ [path]: true });
    setTimeout(() => this.setData({ [path]: false }), 600);
  },

  /** 收藏场景词汇（sourceType=scene_word，见技术方案 4.2 映射约定） */
  async favWord(e) {
    const idx = e.currentTarget.dataset.index;
    const vocab = this.data.scene.vocabulary[idx];
    await this.saveFavorite({
      sourceText: `${this.data.scene.name} · ${vocab.meaning}`,
      translation: vocab.word,
      vocabulary: [vocab],
      sourceType: 'scene_word',
      sceneKey: this.data.sceneKey,
      sceneName: this.data.scene.name,
      path: `scene.vocabulary[${idx}].favorited`,
      label: vocab.word,
    });
  },

  /** 收藏场景语句（sourceType=scene_expression） */
  async favExpr(e) {
    const idx = e.currentTarget.dataset.index;
    const expr = this.data.scene.expressions[idx];
    await this.saveFavorite({
      sourceText: expr.zh,
      translation: expr.en,
      sourceType: 'scene_expression',
      sceneKey: this.data.sceneKey,
      sceneName: this.data.scene.name,
      path: `scene.expressions[${idx}].favorited`,
      label: '常用语句',
    });
  },

  async saveFavorite({ path, label, ...body }) {
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
});
