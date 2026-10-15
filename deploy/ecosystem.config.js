/**
 * PM2 生产配置。
 *
 * 启动：pm2 start /www/wwwroot/sayhi/deploy/ecosystem.config.js
 * 重启：pm2 reload sayhi-api        （fork 模式下等同 restart）
 * 日志：pm2 logs sayhi-api
 *
 * cwd 必须是 server/，不能省：后端用 ConfigModule 从 process.cwd() 读 .env，
 * TTS_CACHE_DIR=./tts-cache 也是相对它解析的。cwd 指错这两个都会静默失效
 * （连不上库 / 缓存每次重建，重新烧百炼的钱）。
 */
module.exports = {
  apps: [
    {
      name: 'sayhi-api',
      // 相对 cwd 解析，即 /www/wwwroot/sayhi/server/dist/main.js
      script: 'dist/main.js',
      cwd: '/www/wwwroot/sayhi/server',
      // 2G 内存机器跑单实例；要开多实例得先换 cluster 模式并确认 Mongo 连接池够用
      instances: 1,
      exec_mode: 'fork',
      // 超过 400M 自动重启，兜住内存泄漏，避免把 2G 机器拖进 OOM
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: '8121',
      },
      out_file: '/www/wwwlogs/sayhi-api.out.log',
      error_file: '/www/wwwlogs/sayhi-api.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
