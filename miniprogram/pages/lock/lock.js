const { request } = require('../../utils/request');

/** 门禁过期时间在本地存储的 key（毫秒时间戳，以服务端返回为准） */
const PASS_EXPIRES_KEY = 'passExpiresAt';

/**
 * 开发开关：为 true 时任意输入（含空）直接进入主页，跳过 /auth/verify-password 校验。
 * 现已关闭，走真实校验 —— 密码比对由后端 ACCESS_PASSWORD_HASH（bcrypt）完成。
 * 调试想免输时改回 true，但别带进线上。
 */
const DEV_UNLOCK = false;

Page({
  data: {
    password: '',
    loading: false,
    focused: false,
  },

  onLoad() {
    // 30 分钟时效内（含冷启动）直接跳过密码页（见技术方案 6.6）
    const expiresAt = Number(wx.getStorageSync(PASS_EXPIRES_KEY) || 0);
    if (expiresAt > Date.now()) {
      this.enterApp();
    }
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  onFocus() {
    this.setData({ focused: true });
  },

  onBlur() {
    this.setData({ focused: false });
  },

  async onUnlock() {
    if (this.data.loading) return;
    if (DEV_UNLOCK) {
      // 开发阶段：任意输入放行，本地记 30 分钟时效，冷启动不重复拦截
      wx.setStorageSync(PASS_EXPIRES_KEY, String(Date.now() + 30 * 60 * 1000));
      this.enterApp();
      return;
    }
    if (!this.data.password) {
      wx.showToast({ title: '请输入访问密码', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      const res = await request({
        url: '/auth/verify-password',
        method: 'POST',
        data: { password: this.data.password },
        silent: true,
      });
      wx.setStorageSync(PASS_EXPIRES_KEY, String(res.expiresAt));
      this.enterApp();
    } catch (e) {
      // 401 密码错误 / 其他异常，均提示但不暴露细节
      wx.showToast({ title: e.message || '密码错误，请重试', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  enterApp() {
    wx.switchTab({ url: '/pages/home/home' });
  },
});
