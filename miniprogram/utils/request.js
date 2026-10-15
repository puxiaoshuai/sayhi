const { BASE_URL } = require('./config');

/**
 * 请求封装：业务失败自动 toast；
 * auth=true 时自动携带静默登录获得的用户态 token（见技术方案 6.3）。
 */
function send(options) {
  const { url, method = 'GET', data = {}, auth = false, silent = false } = options;
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/api${url}`,
      method,
      data,
      timeout: 60000,
      header: auth
        ? { Authorization: `Bearer ${wx.getStorageSync('token') || ''}` }
        : {},
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        const msg = (res.data && res.data.message) || '请求失败';
        if (!silent) wx.showToast({ title: msg, icon: 'none' });
        reject(new Error(msg));
      },
      fail: (e) => {
        if (!silent) wx.showToast({ title: '网络异常，请检查后端服务', icon: 'none' });
        reject(e);
      },
    });
  });
}

/**
 * 带登录态的请求要等静默登录就绪再发：app.js 的 onLaunch 是异步的，
 * 用户很快进到首页时 token 可能还没落盘，直接发会拿到 401。
 * 已有 token 走原路径不发等待，行为不变。
 */
function request(options) {
  if (!options.auth) return send(options);
  if (wx.getStorageSync('token')) return send(options);

  const app = typeof getApp === 'function' ? getApp() : null;
  const ready = app && app.globalData && app.globalData.loginReady;
  // login() 自身是 auth=false，不会递归进这里
  return (ready || Promise.resolve()).then(() => send(options));
}

/** 静默登录：wx.login 的 code 换用户态 token 并持久化 */
function login(code) {
  return request({
    url: '/auth/login',
    method: 'POST',
    data: { code },
    silent: true,
  }).then((res) => {
    wx.setStorageSync('token', res.token);
    return res;
  });
}

module.exports = { request, login };
