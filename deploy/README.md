# sayhi 部署手册

目标环境：**OpenCloudOS 9.6 x86_64 / 2 核 2G / 宝塔面板 / 域名 `sayhi.puxiaoshuai.top`**

架构：小程序（不部署到服务器）→ Nginx:443 → NestJS:8121（PM2）→ MongoDB:27017（Docker，仅回环）

---

## 0. 先纠正一个前提

前端是**微信小程序**，不存在"传到服务器上"这回事。它的发布路径是固定的：
开发者工具上传 → 小程序后台提交审核 → 发布。

宝塔上真正要部署的只有**后端 + 数据库 + Nginx/HTTPS**。服务器对小程序的全部意义，
就是提供一个**已备案的 HTTPS 接口域名**（微信硬性要求）。

所以这份手册里，"前端"部分只有两行：改 `config.js` 的 `BASE_URL`，配好合法域名，重新上传。

---

## 1. 阶段零：域名准备

### 1.1 备案 ✅ 已确认

主域 `puxiaoshuai.top` 已备案通过，子域 `sayhi.puxiaoshuai.top` 继承主域备案、
无需单独备案。微信「服务器域名」校验和国内机房的 80/443 拦截这两关都已通过。

### 1.2 DNS 解析

添加 A 记录：`sayhi` → 服务器公网 IP。

验证（在本地机器执行，不是在服务器上）：

```bash
nslookup sayhi.puxiaoshuai.top
# 或
ping sayhi.puxiaoshuai.top
```

---

## 2. 阶段一：服务器基础

### 2.1 加 2G swap —— 2G 内存机器必做

`nest build`（tsc）峰值内存可能过 1G，加上常驻的 MongoDB + Node，不挂 swap 很容易
被 OOM Killer 杀掉，表现是"构建到一半进程没了"且没有明显报错。

```bash
# 检查现状
free -h

# 没有 swap 就加 2G
dd if=/dev/zero of=/swapfile bs=1M count=2048
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile swap swap defaults 0 0' >> /etc/fstab

free -h   # 确认 Swap 一行有 2.0Gi
```

（宝塔面板：系统设置 → 交换分区，也能加，等价。）

### 2.2 关掉 SELinux 和 firewalld

OpenCloudOS 9 属 **RHEL 9 系**，默认开 SELinux。它开着时 Nginx 反代到 127.0.0.1:8121
会被策略拦掉，表现是 **502 Bad Gateway，且 Nginx 错误日志只写 `Permission denied`**。
宝塔安装脚本一般已经处理过，但仍需确认：

```bash
getenforce
# 期望 Disabled 或 Permissive。是 Enforcing 就关：
setenforce 0
sed -i 's/^SELINUX=enforcing/SELINUX=disabled/' /etc/selinux/config

systemctl is-active firewalld
# 宝塔用自己的防火墙，firewalld 与其冲突就停掉：
systemctl stop firewalld && systemctl disable firewalld
```

### 2.3 云厂商安全组

只放行 **22 / 80 / 443**。

**8121 和 27017 绝对不要放行** —— 后端和数据库端口暴露到公网，几小时内就会被扫到并勒索删库。
后面 MongoDB 会绑回环、Node 会被 Nginx 挡在前面，安全组是第三道保险。

### 2.4 宝塔软件商店装四样

| 软件 | 用途 |
| --- | --- |
| Nginx | 反代 + HTTPS（一般装宝塔时自带） |
| Node.js 版本管理器 | 装 **Node 20 LTS** 并设为默认（18 已 EOL，别用） |
| PM2 管理器 | 守护后端进程、开机自启 |
| Docker 管理器 | 跑 MongoDB 容器 |

---

## 3. 阶段二：MongoDB

用 Docker 而非 yum 装 mongodb-org：OpenCloudOS 的 `$releasever` 和 MongoDB 官方
RHEL 仓库的路径规则不一定对得上，装起来容易卡在仓库解析上；而且 Docker 版
和你本地 `docker-compose.yml` 行为完全一致，可预测。

```bash
mkdir -p /www/wwwroot/sayhi
# 把仓库里的 deploy/docker-compose.prod.yml 传到 /www/wwwroot/sayhi/deploy/
cd /www/wwwroot/sayhi/deploy

# 设数据库密码：纯字母数字，刻意避开 @ : / # + 这类字符
# （它们写进 MongoDB 连接串会被当成分隔符，症状是"密码明明对却连不上库"，见 §4.2）
# 这条命令会在 deploy/ 下生成 .env，含明文密码，注意权限
echo "MONGO_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)" > .env
chmod 600 .env
cat .env   # 把这串密码抄下来，下一步 .env 要用

docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps    # 期望 mongo 处于 healthy
```

验证（密码换成上面那串）：

```bash
docker exec sayhi-mongo mongosh -u sayhi -p '你的密码' --authenticationDatabase admin \
  --quiet --eval "db.adminCommand('ping')"
# 期望 { ok: 1 }
```

> **为什么 compose 里没有 `--bind_ip 127.0.0.1`**：docker 的端口发布是 DNAT 到容器网卡 IP，
> 不是 127.0.0.1。mongod 只监听回环的话，宿主根本连不进去。对外隔离靠
> `ports: "127.0.0.1:27017:27017"` 就够了 —— 这个细节踩过一次就会记住。

---

## 4. 阶段三：后端

### 4.1 拉代码

```bash
cd /www/wwwroot
git clone https://github.com/puxiaoshuai/sayhi.git
# 私有仓库就把服务器公钥加到 GitHub Deploy Key，或改用带 token 的地址
```

（`deploy/` 里那几份文件已经在仓库中，clone 下来就有。）

### 4.2 写生产 .env

```bash
cd /www/wwwroot/sayhi/server
cp .env.example .env
chmod 600 .env
```

生产必须改的项（其余照 `.env.example` 的注释填）：

| 配置 | 值 |
| --- | --- |
| `MONGODB_URI` | `mongodb://sayhi:刚才那串密码@127.0.0.1:27017/sayhi?authSource=admin` |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 重新生成 |
| `ACCESS_PASSWORD_HASH` | 重新生成，**不要复用开发期那个密码** |
| `TTS_CACHE_DIR` | 保持 `./tts-cache`（相对 CWD，所以启动时工作目录必须是 server/） |
| `DEEPSEEK_API_KEY` / `DASHSCOPE_API_KEY` | 建议单独申请生产 Key，和开发隔离，便于分别看账单 |
| `WX_APPID` / `WX_SECRET` | 小程序后台 → 开发管理 → 开发设置 |

生成密码哈希（要在 `server/` 目录下、`npm install` 之后执行）：

```bash
node -e "require('bcryptjs').hash('你的新密码',10).then(console.log)"
```

> 上面那条命令用 `tr -dc 'A-Za-z0-9'` 生成，是**纯字母数字**密码，刻意避开了
> `@` `:` `/` `#` `+` 这些字符 —— 它们写进 `MONGODB_URI` 会被当成分隔符，
> 症状是"密码明明是对的却连不上库"，很难排查。要手动换密码也请保持纯字母数字。

### 4.3 装依赖 + 构建

```bash
cd /www/wwwroot/sayhi/server
npm ci
NODE_OPTIONS=--max-old-space-size=1024 npm run build
ls -l dist/main.js    # 确认产物存在
```

> 用完整 `npm ci` 而不是 `--omit=dev`：`scripts/seed-scenes.ts` 靠 `ts-node` 跑，
> 而 tsconfig 的 `exclude` 把 `scripts/` 排除了，`nest build` **不产出** seed 脚本。
> devDeps 只占磁盘几十 MB，2G 的瓶颈是构建内存不是依赖体积。

如果这台机器再小、构建还是被 OOM 杀掉：改成**本地构建、只上传 `dist/`**，
服务器上 `npm ci --omit=dev` 即可（但 seed 脚本仍然需要 devDeps，见 4.4）。

### 4.4 预热场景内容

```bash
cd /www/wwwroot/sayhi/server
npx ts-node scripts/seed-scenes.ts
```

不跑的后果：第一个打开某个房间的用户要等 3~5 秒实时生成。跑过之后所有用户秒开，
且内容稳定、可持续人工修正。

（将来加了内置场景，在 `scene.seeds.ts` 加一条后重新跑这个命令即可；
自定义场景不用管，用户在场景页输入名字后后端生成一次永久复用。）

### 4.5 PM2 启动

```bash
pm2 start /www/wwwroot/sayhi/deploy/ecosystem.config.js
pm2 save
pm2 startup    # 按提示复制执行它输出的那条命令，实现开机自启
```

验证：

```bash
curl -i http://127.0.0.1:8121/api/hi
# 期望 200 + 正文 hello world —— 服务活着且路由正常
pm2 logs sayhi-api --lines 30
```

> `/api/hi` 是专门留的探活接口（见 `server/src/app.controller.ts`），不带鉴权、不碰数据库，
> 浏览器里直接打开也行。应用能起来本身就说明 Mongo 连接没问题 —— 连不上库时
> `MongooseModule.forRoot` 会挂在启动阶段，根本到不了监听端口这一步。

> `ecosystem.config.js` 里 `cwd` 写的是绝对路径 `/www/wwwroot/sayhi/server`，不能省。
> 后端用 `ConfigModule` 从 `process.cwd()` 读 `.env`，`TTS_CACHE_DIR=./tts-cache`
> 也是相对它解析。cwd 指错会导致"连不上库"或"缓存每次重建、重复烧百炼的钱"。

---

## 5. 阶段四：Nginx + HTTPS

### 5.1 建站点

宝塔 → 网站 → 添加站点，域名填 `sayhi.puxiaoshuai.top`，**不建数据库、不建 FTP**
（数据库已经跑在 Docker 里了）。PHP 版本选"纯静态"。

### 5.2 申请证书

该站点 → 设置 → SSL → **Let's Encrypt** → 申请 → 打开「强制 HTTPS」。

Let's Encrypt 走 80 端口做域名校验，所以 1.2 的 DNS 解析必须先生效。

### 5.3 配反代

设置 → 配置文件，在 `server { }` 内用
[`nginx-location.conf`](./nginx-location.conf) 里的 `location /` 段替换掉宝塔默认的静态 location。

**不要只用宝塔的「反向代理」按钮** —— 它生成的配置里没有 `client_max_body_size`，
语音识别会被 Nginx 以 413 拦在 Nest 之前，而后端日志干干净净，极易误判成后端 bug。

改完重载：

```bash
nginx -t && nginx -s reload
# 或宝塔面板点「重载配置」
```

### 5.4 全链路验证

```bash
curl -i https://sayhi.puxiaoshuai.top/api/hi
# 期望 200 + 正文 hello world + 有效证书链（没有 -k 也不报证书错误）

curl -I https://sayhi.puxiaoshuai.top/api/hi | grep -i "server\|strict-transport"
```

再确认一下 TLS 版本达标（微信要求 ≥ 1.2）：

```bash
openssl s_client -connect sayhi.puxiaoshuai.top:443 -tls1_1 </dev/null 2>&1 | grep -i "handshake failure"
# 期望握手失败，说明 1.1 已关掉
```

---

## 6. 阶段五：小程序（唯一的"前端"动作）

### 6.1 改接口地址

`miniprogram/utils/config.js`：

```js
BASE_URL: 'https://sayhi.puxiaoshuai.top',   // 不带 /api，不带结尾斜杠
```

`request.js` 里拼的是 `` `${BASE_URL}/api${url}` ``，所以 `BASE_URL` **不能**带 `/api`，
否则会变成 `/api/api/xxx`。

### 6.2 配合法域名

小程序后台 → 开发管理 → 开发设置 → 服务器域名 → **request 合法域名**加
`https://sayhi.puxiaoshuai.top`。

**只需要配 request 一项。** ASR 和 TTS 都是走 `wx.request` 传 base64 JSON
（见 `utils/asr.js` 和 `utils/speak.js`），**没有用 `wx.uploadFile`**，
所以 uploadFile 域名不用配。

### 6.3 上传发布

开发者工具 → 上传 → 小程序后台提交审核 → 发布。

---

## 7. 阶段六：日常运维

### 7.1 更新部署

```bash
bash /www/wwwroot/sayhi/deploy/deploy.sh
```

脚本做四件事：`git fetch` + `reset --hard` → `npm ci` → `npm run build` → `pm2 reload`。

**刻意不做的事**：不用 `git clean`。`server/.env`、`server/tts-cache/` 都是未跟踪文件，
`reset --hard` 不会碰它们；一旦顺手加了 `git clean`，`.env` 没了要重配，
`tts-cache` 没了下次点读全部重新调用百炼 —— **缓存即费用**。

### 7.2 数据备份

宝塔 → 计划任务 → 新增 Shell 脚本任务，每天凌晨执行：

```bash
docker exec sayhi-mongo mongodump \
  -u sayhi -p '你的密码' --authenticationDatabase admin \
  --db sayhi --archive=/www/backup/sayhi-$(date +\%F).archive --gzip
```

保留最近 7 份（宝塔任务里可以配保留份数，或脚本里加 `find -mtime +7 -delete`）。

### 7.3 看日志

```bash
pm2 logs sayhi-api            # 应用日志
tail -f /www/wwwlogs/sayhi-api.err.log
docker logs sayhi-mongo --tail 50
tail -f /www/wwwlogs/nginx_error.log    # 反代问题看这个
```

### 7.4 改访问密码

```bash
cd /www/wwwroot/sayhi/server
node -e "require('bcryptjs').hash('新密码',10).then(console.log)"
# 替换 .env 里的 ACCESS_PASSWORD_HASH
pm2 reload sayhi-api --update-env
```

---

## 8. 排错对照表

| 现象 | 最可能的原因 | 处理 |
| --- | --- | --- |
| **502 Bad Gateway** | SELinux 拦了 Nginx 回环连接 | `getenforce` 确认是 Disabled/Permissive；看 `nginx_error.log` 有无 `Permission denied` |
| **502** | 后端没起来 | `pm2 status` / `pm2 logs sayhi-api`；常见是 `.env` 的 Mongo 连接串密码没 URL 编码 |
| 小程序「不在 request 合法域名列表中」 | 域名没备案 / 证书无效或自签 / TLS 低于 1.2 / `BASE_URL` 带路径 | 逐项对照 §1.1、§5.2、§5.4、§6.1 |
| **语音识别 413** | Nginx `client_max_body_size` 没加 | §5.3，确认改的是站点主配置不是被覆盖的临时文件 |
| **翻译/生成 504** | 反代超时太短 | `proxy_read_timeout 120s` |
| 启动即崩 | PM2 `cwd` 不对，读不到 `.env` | `pm2 describe sayhi-api` 看 cwd |
| 点读又变慢 / 百炼账单涨 | `tts-cache` 被清掉了 | 检查部署脚本没用 `git clean` / `rm -rf` |
| 构建到一半进程消失 | OOM | 加 swap（§2.1）、压 `--max-old-space-size`、或改本地构建 |
| 服务器整体卡死 | Mongo 吃满内存 | 确认容器带了 `--wiredTigerCacheSizeGB 0.25` |
| 能 ping 通但网页打不开 | 域名未备案（国内机房）或安全组没放 80/443 | §1.1、§2.3 |

---

## 9. 上线检查清单

- [ ] 主域 `puxiaoshuai.top` 已备案 ✅
- [ ] A 记录 `sayhi` 已指向服务器公网 IP
- [ ] 2G swap 已挂载
- [ ] SELinux 已关、firewalld 已停
- [ ] 安全组只放行 22/80/443
- [ ] MongoDB 带鉴权、只绑 127.0.0.1、`wiredTigerCacheSizeGB=0.25`
- [ ] 生产 `.env` 重设了 `JWT_SECRET` / `ACCESS_PASSWORD_HASH` / Mongo 密码，权限 600
- [ ] `npm run build` 产出 `dist/main.js`
- [ ] 跑过 `npx ts-node scripts/seed-scenes.ts`
- [ ] PM2 已启动、`pm2 save`、`pm2 startup`
- [ ] Nginx 证书已申请、强制 HTTPS 已开、`client_max_body_size 16m` 已加
- [ ] `curl https://sayhi.puxiaoshuai.top/api/hi` 返回 200 hello world（服务活着）
- [ ] `config.js` 的 `BASE_URL` 已改并重新上传小程序
- [ ] 小程序后台 request 合法域名已添加
- [ ] 宝塔计划任务已配每日 mongodump 备份
