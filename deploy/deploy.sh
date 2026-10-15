#!/usr/bin/env bash
#
# 更新部署：拉代码 → 装依赖 → 构建 → 重启
#
# 放在服务器上执行：bash /www/wwwroot/sayhi/deploy/deploy.sh
# 首次部署请先按 deploy/README.md 走完一遍，再回来用这个脚本做后续更新。
#
# 刻意不做的事：
#   - 不用 git clean（会删掉 server/.env 和 server/tts-cache/，后者是钱）
#   - 不删 tts-cache（缓存命中就不调百炼；删了等于把已花的钱再花一遍）
#   - reset --hard 只动已跟踪文件，未跟踪的 .env / tts-cache / dist 都不受影响

set -euo pipefail

APP_DIR=/www/wwwroot/sayhi
BRANCH=main
PM2_APP=sayhi-api

cd "$APP_DIR"

echo "==> [1/4] 拉取代码 ($BRANCH)"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
git --no-pager log -1 --oneline

cd "$APP_DIR/server"

echo "==> [2/4] 安装依赖"
# 用完整安装而非 --omit=dev：scripts/seed-scenes.ts 靠 ts-node 跑，
# 而 tsconfig 的 exclude 把 scripts/ 排除了，nest build 不产出 seed 脚本。
# 依赖只在磁盘上占几十 MB，2G 内存的瓶颈是构建不是依赖体积。
npm ci

echo "==> [3/4] 构建"
# 2G 机器单跑 nest build 峰值可能过 1G，配合 2G swap 才稳；
# 这里再压一道 V8 堆上限，宁可慢一点也不要被 OOM Killer 干掉。
NODE_OPTIONS=--max-old-space-size=1024 npm run build

echo "==> [4/4] 重启后端"
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 reload "$PM2_APP" --update-env
else
  pm2 start "$APP_DIR/deploy/ecosystem.config.js"
fi
pm2 save

echo "==> 完成。看日志：pm2 logs $PM2_APP"
