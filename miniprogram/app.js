const { login } = require('./utils/request');

App({
  globalData: {
    // 静默登录完成的信号，供 utils/request.js 在带登录态的请求前等待（见技术方案 6.3）
    loginReady: null,
  },

  onLaunch() {
    this.silentLogin();
  },

  /**
   * 静默登录（见技术方案 6.3）：wx.login 的 code 交后端换 openid，
   * 成功后 token 持久化，收藏/语音识别等用户态接口自动携带。
   *
   * 包成 promise 存进 globalData：赋值是同步的，而页面 onLoad 一定在 onLaunch 之后，
   * 所以页面里取得到它。成功失败都 resolve —— 登录失败不该阻塞后续请求，
   * 由请求本身去拿 401（与修复前的表现一致，不会更糟）。
   *
   * 退出登录清掉 token 后会再调一次（见 pages/favorites 的 logout）。
   */
  silentLogin() {
    const ready = new Promise((resolve) => {
      wx.login({
        success: ({ code }) => {
          login(code)
            .then(() => {
              console.log('[app] 静默登录成功');
              resolve();
            })
            .catch((e) => {
              console.warn('[app] 静默登录失败：', e.message);
              resolve();
            });
        },
        fail: () => {
          console.warn('[app] wx.login 调用失败');
          resolve();
        },
      });
    });

    // 重登也要覆盖 loginReady：request.js 在本地无 token 时会等这个 promise，
    // 覆盖后重登期间发出的用户态请求不会漏带登录态。
    this.globalData.loginReady = ready;
    return ready;
  },
});
