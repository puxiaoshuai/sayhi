# 智能英语学习助手（sayhi）

个人使用的微信小程序：中文（文字/语音）→ 地道英文翻译 + 词汇句型拆解；场景化学习（内置「在家·厨房/客厅/卧室/卫生间」，也可输入任意场景名由大模型现生成）；云端生词本；点读发音。技术方案见 [技术方案.md](./技术方案.md)，UI 原型见 [ui效果图.html](./ui效果图.html)。

```
├── 技术方案.md          # 架构设计文档
├── ui效果图.html        # 高保真交互原型（浏览器直接打开）
├── server/             # Nest.js 后端
│   ├── src/
│   │   ├── auth/       # 密码门（30 分钟门禁 JWT）+ 静默登录
│   │   ├── translation/# 翻译拆解（DeepSeek）
│   │   ├── scenes/     # 场景学习（LLM 生成一次入库复用）
│   │   ├── asr/        # 语音识别（百炼，前端录音上传）
│   │   ├── tts/        # 朗读合成（百炼，落盘缓存 + 体积上限）
│   │   ├── favorites/  # 收藏 CRUD（多来源）
│   │   ├── schemas/    # Mongoose 模型
│   │   └── common/     # LLM 封装 + JSON 清洗
│   └── scripts/seed-scenes.ts  # 场景内容预热
└── miniprogram/        # 微信小程序
    ├── pages/lock/     # 密码门（启动第一道）
    ├── pages/home/     # 翻译页（语音输入 + 单词点读）
    ├── pages/scenes/   # 场景列表（内置分组 + 自定义场景 + 输入框生成）
    ├── pages/scene-detail/ # 场景详情
    ├── pages/favorites/# 生词本
    └── utils/          # request / speak / asr / 分词
```

## 一、启动步骤

### 1. 数据库（本地 MongoDB，Docker 一键启动）

```bash
# 项目根目录执行（需已安装 Docker Desktop）
docker compose up -d

# 查看状态 / 停止（数据在 named volume 中，stop 不丢数据）
docker compose ps
docker compose stop
```

仅绑定 `127.0.0.1` 不暴露局域网。宿主端口为 **27018**（27017 已被本机其他项目占用），`.env` 里的 `MONGODB_URI=mongodb://localhost:27018/sayhi` 直接可用。

同一 compose 里还带一个 **mongo-express**（MongoDB 网页版管理界面，镜像 `mongo-express:1.0.2-20-alpine3.19`）：

- 地址 <http://localhost:8082>，直接打开即用，无登录弹窗（宿主 8081 已被占用，故用 8082，同样只绑定 `127.0.0.1`）
- 镜像默认开启了 HTTP Basic Auth，compose 里已用 `ME_CONFIG_BASICAUTH: "false"` 显式关闭；如需重新开启，见 `docker-compose.yml` 中该行的注释
- 看 `sayhi` 库里的 `users` / `favorites` / `scenes` 三张表用，改测试数据比敲 mongosh 方便
- 不需要时单独停：`docker compose stop mongo-express`（`mongo` 和 `sayhi-mongo-data` 卷不受影响）

### 2. 后端

```bash
cd server
npm install

# 配置环境变量
cp .env.example .env   # Windows: copy .env.example .env
# 编辑 .env，填写下表的 5 项

# （可选但推荐）预热场景内容，4 个房间各生成一次入库
npm run seed:scenes

# 启动开发服务（默认 3000 端口）
npm run start:dev
```

### 3. 小程序

1. 微信开发者工具 → 导入项目 → 目录选 `miniprogram/`
2. 把 `project.config.json` 里的 `appid` 换成你自己的
3. 不需要添加任何插件。语音识别用小程序内置录音（`wx.getRecorderManager`），朗读发音经后端代理百炼——原「同声传译」插件个人主体不可用，已自建（见技术方案 6.5），确保 `.env` 里 `DASHSCOPE_API_KEY` 已填即可
4. 开发者工具右上角「详情 → 本地设置」确认勾选**不校验合法域名**（`project.config.json` 已默认关闭 urlCheck）

## 二、需要你填的 6 项配置（server/.env）

| 配置 | 去哪拿 |
| ---- | ---- |
| `DEEPSEEK_API_KEY` | [platform.deepseek.com](https://platform.deepseek.com) 注册充值后创建 |
| `DASHSCOPE_API_KEY` | [bailian.console.aliyun.com](https://bailian.console.aliyun.com) → API-KEY 管理。**朗读与语音识别都靠它**，不填则这两项功能不可用 |
| `MONGODB_URI` | 本地 `mongodb://localhost:27018/sayhi`（端口见上方 docker compose），或 [Atlas](https://www.mongodb.com/atlas) 免费集群连接串 |
| `WX_APPID` / `WX_SECRET` | 小程序后台「开发管理 → 开发设置」 |
| `ACCESS_PASSWORD_HASH` | 见下方生成命令 |
| `JWT_SECRET` | 任意随机长字符串，生成命令见 .env.example |

**访问密码哈希生成**（在 `server/` 目录下，npm install 之后执行）：

```bash
node -e "require('bcryptjs').hash('你的密码',10).then(console.log)"
```

把输出的 `$2a$10$...` 整串填进 `ACCESS_PASSWORD_HASH`。以后改密码：重新生成、替换、重启后端即可。

## 三、每日使用流程

1. 打开小程序 → 密码门输入访问密码（**30 分钟内免重输**）
2. 翻译页：打字，或**按住** 🎤 说话（松手后整段识别上屏，上滑可取消）→ 翻译拆解 → 点句中单词单独听、点 🔊 听整句 → ⭐ 收藏
3. 场景页：选内置房间，或在顶部输入框输入任意场景名（如「坐飞机」）生成专属场景 → 学物品词汇和常用语句 → 逐条收藏；自定义场景长按可删除
4. 生词本：搜索、点读、长按句子朗读、左滑移除（点击「移除」+ 确认）

## 四、常见问题

| 问题 | 处理 |
| ---- | ---- |
| 真机预览请求失败 | 开发期在开发者工具勾选「不校验合法域名」仅对工具生效；真机需在「详情 → 本地设置」同样勾选，或配置已备案 HTTPS 域名 |
| 朗读/语音识别无反应 | 检查 `.env` 的 `DASHSCOPE_API_KEY` 是否有效、后端日志有无报错；真机首次使用会弹麦克风授权。TTS 仅华北2（北京）地域可用，Key 地域错配会 401/403 |
| 换过发音音色后还是旧声音 | 音色进了缓存 key，改 `TTS_VOICE` 重启即自动失效重合成，但旧音频仍在盘上占位——想立刻清掉就删 `server/tts-cache/`，平时交给 `TTS_CACHE_MAX_MB` 自动淘汰 |
| 场景详情首次打开很慢 | 正常：该场景首次被访问时后端实时生成（约 3~5 秒）；跑过 `npm run seed:scenes` 后即秒开 |
| 改了访问密码 | 重新生成哈希 → 替换 `.env` 的 `ACCESS_PASSWORD_HASH` → 重启后端 |
| 新增场景 | 直接在场景页输入框输入场景名即可（如「坐飞机」），后端生成一次后永久复用；同一个名字不会重复生成。要加**内置**场景仍是 `server/src/scenes/scene.seeds.ts` 加一条 → `npm run seed:scenes` |

## 五、上线 checklist（正式发布前）

- [ ] 后端部署到服务器，绑定**已备案域名**并配置 HTTPS 证书
- [ ] 给 `TTS_CACHE_DIR` 挂 volume（缓存即费用：不挂则容器每次重建都要重新合成一遍）
- [ ] 小程序后台「开发管理 → 开发设置 → 服务器域名」把 `https://你的域名` 加入 request 合法域名
- [ ] `miniprogram/utils/config.js` 的 `BASE_URL` 改为正式域名
- [ ] `project.config.json` 关闭 urlCheck（上线不受影响，仅工具行为）
- [ ] 生产环境 `JWT_SECRET` 足够随机
