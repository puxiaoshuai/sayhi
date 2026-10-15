const { request } = require('../../utils/request');

/** 门禁过期时间在本地存储的 key，与 pages/lock/lock.js 保持一致 */
const PASS_EXPIRES_KEY = 'passExpiresAt';

Page({
  data: {
    groups: [], // 内置场景分组（当前为「在家」+ 四个房间）
    customScenes: [], // 用户输入生成的自定义场景
    inputValue: '',
    generating: false,
  },

  onShow() {
    this.loadList();
  },

  async loadList() {
    try {
      const res = await request({ url: '/scenes' });
      this.setData({
        groups: (res && res.groups) || [],
        customScenes: (res && res.custom) || [],
      });
    } catch (e) {
      // request 封装已 toast
    }
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value });
  },

  /**
   * 输入场景名 → 后端生成（首次约 3~5 秒）→ 直接进该场景详情页。
   *
   * 生成期间用带 mask 的 loading 挡住重复提交，done 后先 hideLoading 再提示错误：
   * loading 与 toast 共用同一个 UI 槽位，顺序反了会把 toast 一起关掉。
   * 所以这里传 silent 自己接管报错文案，而不是让 request 封装先 toast。
   */
  async onGenerate() {
    const name = (this.data.inputValue || '').trim();
    if (!name) {
      wx.showToast({ title: '请输入场景名称', icon: 'none' });
      return;
    }
    if (this.data.generating) return;

    this.setData({ generating: true });
    wx.showLoading({ title: '正在生成场景…', mask: true });
    try {
      const scene = await request({
        url: '/scenes',
        method: 'POST',
        data: { name },
        silent: true,
      });
      wx.hideLoading();
      this.setData({ inputValue: '' });
      // 先把新场景刷进列表，用户从详情页返回时「我的场景」已经是最新的
      this.loadList();
      wx.navigateTo({ url: `/pages/scene-detail/scene-detail?key=${scene.sceneKey}` });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '生成失败，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ generating: false });
    }
  },

  openScene(e) {
    const key = e.currentTarget.dataset.key;
    wx.navigateTo({ url: `/pages/scene-detail/scene-detail?key=${key}` });
  },

  /** 长按自定义场景删除；内置场景由后端种子配置承载，接口也会拒绝删除 */
  onCustomLongPress(e) {
    const { key, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除场景',
      content: `确定删除「${name}」吗？已收藏的词句仍会留在生词本里。`,
      confirmText: '删除',
      confirmColor: '#ef4444',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await request({ url: `/scenes/${key}`, method: 'DELETE' });
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadList();
        } catch (err) {
          // request 封装已 toast
        }
      },
    });
  },

  comingSoon() {
    wx.showToast({ title: '拍照识物为二期功能，敬请期待', icon: 'none' });
  },

  /**
   * 退出登录：清掉门禁记录与微信登录态，回到密码页（见技术方案 6.6）。
   *
   * token 一并清除后必须重跑一次静默登录（app.silentLogin）：wx.login 只在
   * onLaunch 执行一次，不重登的话本次会话里收藏、语音识别这些带登录态的接口
   * 会一路 401，得冷启动才恢复。
   */
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需重新输入访问密码',
      confirmText: '退出',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return;
        wx.removeStorageSync(PASS_EXPIRES_KEY);
        wx.removeStorageSync('token');

        const app = getApp();
        if (app && app.silentLogin) app.silentLogin();

        wx.reLaunch({ url: '/pages/lock/lock' });
      },
    });
  },
});
