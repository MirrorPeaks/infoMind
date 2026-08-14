# InfoMind

InfoMind 是一个个人知识管理系统，用来把分散在网页、视频、社交平台和公众号里的内容收录、解析、分类，并以书架、时间线和洞察图表的方式回看。

核心目标不是保存链接本身，而是把碎片化阅读内容整理成可检索、可复盘、可被 Agent 使用的个人知识库。

## 功能概览

- **链接收录**：支持通过 Web UI、CLI、OpenClaw/Hermes Skill 和 Webhook 保存链接。
- **多平台解析**：覆盖 Bilibili、YouTube、Twitter/X、抖音、小红书、知乎、小宇宙、微信公众号、微博和通用网页；公开接口与本机浏览器采集协同工作。
- **封面缓存**：解析封面图并下载到本地 `data/covers/`，降低远程图片失效和防盗链影响。
- **AI 分类**：接入 OpenAI-compatible LLM 进行 25 个一级知识分类；LLM 不可用时使用关键词兜底。
- **真实内容解读**：支持后台生成文章思维导图；视频优先使用字幕，无字幕时用本地 whisper.cpp 转写后再分析，长内容按段提炼以控制 token。
- **浏览器登录态采集**：抖音、小红书、知乎、微博等动态页面正文不足时进入采集任务，由已配对的 InfoMind Clipper 读取当前页面 DOM，不把平台 Cookie 保存到 InfoMind。
- **作者聚合书架**：同作者、同平台内容自动聚合为一本“书”，书架页显示最新收录标题和封面。
- **时间线视图**：按时间查看所有收录内容，支持分类筛选。
- **洞察页**：提供收录趋势折线图和分类/平台/作者嵌套 Treemap，用于复盘注意力分布。
- **全文搜索**：支持按标题、摘要、作者、标签和备注搜索。
- **配置管理**：Web UI 和 CLI 均可配置 LLM 参数；敏感 API Key 会加密保存。
- **macOS 桌面端**：通过 Electron 打包为本地桌面应用，内嵌同一套 Web UI 与 API 服务。
- **部署支持**：提供 Dockerfile、Docker Compose、生产环境变量模板和云服务器部署手册。

## 快速开始

### 环境要求

- Node.js >= 20
- npm
- SQLite 由 `better-sqlite3` 内嵌使用，无需单独部署数据库

### 安装与启动

```bash
npm install
npm start
```

默认服务地址：

```text
http://localhost:3456
```

可通过环境变量修改端口：

```bash
INFOMIND_PORT=3457 npm start
```

健康检查：

```bash
curl -s http://127.0.0.1:3456/api/health
```

### macOS 桌面端

开发模式运行桌面应用：

```bash
npm run desktop
```

生成 macOS 安装包：

```bash
npm run dist:mac
```

构建产物位于：

```text
dist/mac-arm64/InfoMind.app
dist/InfoMind-1.0.0-arm64.dmg
dist/InfoMind-1.0.0-arm64.zip
```

桌面端会在本机启动同一套 InfoMind API 服务，并加载同一套 Web UI。首次启动时会把打包时附带的 seed data 复制到 macOS 应用数据目录；也可以用 `INFOMIND_DATA_DIR` 指定数据目录。

注意：Electron 和普通 Node 使用不同的 native module ABI。打包后如果要继续在源码目录运行 `npm start` 或 CLI，请执行：

```bash
npm run native:node
```

如果再次构建桌面端，`npm run desktop`、`npm run pack:mac` 和 `npm run dist:mac` 会自动先执行 `native:electron`，确保 SQLite native 模块匹配 Electron。

## LLM 配置

InfoMind 支持 OpenAI-compatible 接口。配置项保存在 SQLite `config` 表中。

### Web UI 配置

打开右上角设置：

```text
Settings -> LLM Parameters -> Test Connection -> Save Configuration
```

### CLI 配置

```bash
node cli/index.js config set llm.base_url https://api.openai.com/v1
node cli/index.js config set llm.api_key sk-your-key-here
node cli/index.js config set llm.model gpt-4o-mini
```

生产环境迁移时，如果已经使用过自定义 `INFOMIND_SECRET`，需要在新环境保持一致，否则已加密保存的配置可能无法解密。

## 使用方式

### Web UI

打开 `http://localhost:3456` 后可以：

- 粘贴链接收录内容；
- 在书架页按作者聚合浏览；
- 在时间线页按日期回看；
- 在洞察页查看趋势图和注意力 Treemap；
- 搜索标题、摘要、作者、标签和备注；
- 配置并测试 LLM。

### CLI

```bash
# 启动服务
node cli/index.js serve

# 添加链接
node cli/index.js add "https://www.bilibili.com/video/BVxxx"
node cli/index.js add "https://www.youtube.com/watch?v=xxx" --note "值得深读"

# 查看列表
node cli/index.js list
node cli/index.js list --category "人工智能" --limit 10

# 搜索
node cli/index.js search "RAG"

# 统计
node cli/index.js stats

# 诊断
node cli/index.js doctor
```

### Agent / Webhook 接入

OpenClaw Skill 位于：

```text
openclaw/SKILL.md
```

Webhook 地址：

```text
POST /api/webhook/openclaw
```

请求体可传：

```json
{
  "message": "帮我收藏这篇 https://example.com/article",
  "urls": ["https://example.com/article"]
}
```

如果配置了 `webhook.secret`，服务会校验 `x-openclaw-signature` 或 `x-signature` 的 HMAC 签名。

## 支持平台

| 平台 | 平台标识 | 内容获取路径 | 视频/音频解读 |
| --- | --- | --- | --- |
| Bilibili | `bilibili` | 官方公开 API 获取标题、作者、封面；优先官方字幕 | 无字幕时本地转写 |
| YouTube | `youtube` | oEmbed 获取元数据；优先官方/自动字幕 | 无字幕时受管 yt-dlp + 本地转写 |
| Twitter/X | `twitter` | FxTwitter 开源接口获取完整正文、图片和公开视频直链；oEmbed 兜底 | 附视频时直链本地转写 |
| 抖音 | `douyin` | 分享信息仅用于识别；真实正文、图文和媒体由浏览器采集 | 视频直链本地转写 |
| 小红书 | `xiaohongshu` | 公开元数据可用时直取；受限页面由浏览器采集正文与图片 | 视频可使用字幕/本地转写 |
| 知乎 | `zhihu` | 分享文本/公开页面直取；403 或登录页转浏览器采集 | 不适用 |
| 小宇宙 | `xiaoyuzhou` | 单集标题、节目名、封面、shownotes 与音频直链 | 无文稿时本地转写 |
| 微信公众号 | `wechat` | Open Graph 元数据 + `#js_content` 正文抽取 | 不适用 |
| 微博 | `weibo` | 公开页面可用时直取；登录页转浏览器采集 | 视频可使用字幕/本地转写 |
| 通用网页 | `web` | Open Graph / HTML meta + 可读正文抽取 | 不适用 |

受限平台不会把登录页、错误页或只有 URL 的空壳写入书架，而是创建 `capture_job` 等待浏览器补全。浏览器插件位于 `extensions/web-extension/`，应用设置页提供配对码与安装说明。

## 洞察页数据模型

洞察页使用真实数据库数据渲染，不使用模拟数据。

接口：

```text
GET /api/stats/advanced?range=1m
GET /api/stats/advanced?range=1m&category=人工智能
GET /api/stats/advanced?range=1m&platform=wechat
```

支持时间范围：

- `1w`：近 1 周
- `1m`：近 30 天
- `3m`：近 3 月
- `1y`：近 1 年

返回内容包括：

- `summary`：总收录数、上一周期对比、活跃天数、最高分类；
- `trend`：按天聚合的收录趋势；
- `heatmap`：分类 -> 平台/作者 -> 最近标题的嵌套 Treemap 数据；
- `platforms`：平台分布。

Treemap 面积按收藏频次计算：

```text
一级区块 = 知识类别
二级图块 = 平台 + 作者
图块面积 = 当前筛选条件下的收录频次
```

## API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `POST` | `/api/entries` | 新增收录 |
| `GET` | `/api/entries` | 列出收录，支持 `category`、`platform`、`page`、`limit` |
| `GET` | `/api/entries/search?q=...` | 搜索收录 |
| `GET` | `/api/entries/:id` | 获取单条收录 |
| `PUT` | `/api/entries/:id` | 更新收录 |
| `DELETE` | `/api/entries/:id` | 删除收录 |
| `GET` | `/api/entries/:id/analysis` | 获取当前条目的结构化解读结果 |
| `POST` | `/api/entries/:id/analyze` | 基于真实正文/转录生成并缓存思维导图 |
| `POST` | `/api/entries/:id/transcribe` | 触发视频字幕/本地语音转写后生成解读 |
| `PUT` | `/api/entries/:id/content` | Agent/Hermes 回写正文、字幕或转录文本 |
| `GET` | `/api/books` | 列出作者聚合书籍 |
| `GET` | `/api/books/:id` | 获取书籍及其条目 |
| `GET` | `/api/categories` | 获取 25 个分类及统计 |
| `GET` | `/api/stats` | 基础统计 |
| `GET` | `/api/stats/advanced` | 洞察页趋势与 Treemap 数据 |
| `GET` | `/api/config` | 获取配置，敏感值脱敏 |
| `PUT` | `/api/config` | 保存配置 |
| `POST` | `/api/config/test-llm` | 测试 LLM 连接 |
| `POST` | `/api/webhook/openclaw` | Agent/Webhook 链接收录 |

## 项目结构

```text
infoMind/
├── server/
│   ├── db/                 # SQLite schema、初始化、查询封装
│   ├── routes/             # REST API：entries、books、stats、config、webhook
│   ├── services/
│   │   ├── parser/         # 各平台解析器
│   │   ├── bookmaker.js    # 作者聚合成书
│   │   ├── classifier.js   # LLM 分类 + 关键词兜底
│   │   └── llm.js          # OpenAI-compatible LLM 调用
│   └── utils/              # 日志、加密、路径工具
├── electron/               # macOS 桌面端入口
├── public/
│   ├── index.html          # Web UI 主页面
│   ├── setup.html          # 配置/初始化辅助页面
│   ├── js/                 # 前端模块：API、书架、弹窗、洞察页、设置
│   └── css/                # 旧版/补充样式
├── cli/                    # 命令行入口和子命令
├── build/                  # 桌面端图标等构建资源
├── openclaw/               # OpenClaw Skill
├── deploy/
│   ├── README.md           # 云服务器部署手册
│   └── hermes/             # Hermes Skill 安装脚本和 Skill 定义
├── data/                   # 运行时数据，默认不提交
├── Dockerfile
├── docker-compose.yml
├── .env.production.example
├── prd.md
└── ui_design.md
```

## 数据与存储

默认数据库路径：

```text
data/infomind.db
```

SQLite 开启 WAL 模式，运行时可能同时存在：

```text
data/infomind.db
data/infomind.db-wal
data/infomind.db-shm
data/covers/
```

这些都是运行时数据，默认不进入 Git。

核心表：

- `entries`：单条收录内容；
- `books`：同作者、同平台聚合后的书；
- `categories`：预置 25 个一级分类；
- `config`：系统配置和加密后的敏感配置。

## Docker 部署

本仓库提供 Docker Compose 配置：

```bash
cp .env.production.example .env.production
docker compose up -d --build
docker compose logs -f infomind
curl -s http://127.0.0.1:3456/api/health
```

默认只暴露到服务器本机：

```text
127.0.0.1:3456:3456
```

公网访问建议通过 Nginx 或 Caddy 做 HTTPS 反向代理。

视频无字幕时，Docker 镜像内置 `yt-dlp`、`ffmpeg` 和 `whisper.cpp`。桌面端会优先复用可用工具；yt-dlp 缺失或版本过期时，从官方 GitHub Release 下载适配系统的单文件版本到 `data/tools/`，校验 SHA-256 后使用。Whisper 模型文件不进入 Git，需要放到挂载数据目录：

```bash
mkdir -p data/models
# 将 ggml-base.bin 放到 data/models/ggml-base.bin
```

本地 macOS 开发环境可运行：

```bash
npm run setup:stt
```

安装完成后重启 InfoMind，再在详情页点击“重新查找字幕/转写”。

完整云服务器部署、首次 SQLite 数据迁移、Hermes Agent 接入、飞书/Lark 通道和备份策略见：

```text
deploy/README.md
```

## 验证与测试

运行自动化测试：

```bash
node --test tests/*.test.js
```

基础运行验证：

```bash
node --check server/index.js
node --check server/routes/stats.js
node --check electron/main.js
node --check public/js/app.js
node --check public/js/api.js
npm run pack:mac
npm start
curl -s http://127.0.0.1:3456/api/health
curl -s 'http://127.0.0.1:3456/api/stats/advanced?range=1m'
```

如果修改 UI，建议同时在浏览器里验证：

- 书架页是否能加载；
- 时间线页是否能加载；
- 洞察页折线图与 Treemap 是否按真实数据渲染；
- 设置页是否能保存并测试 LLM 配置。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `INFOMIND_PORT` | `3456` | HTTP 服务端口 |
| `INFOMIND_DATA_DIR` | `data` | 运行时数据目录；桌面端默认使用 macOS 应用数据目录 |
| `INFOMIND_DB_PATH` | `data/infomind.db` | SQLite 数据库路径 |
| `INFOMIND_SECRET` | 内置默认值 | 配置加密密钥，生产环境应显式设置并保持稳定 |
| `INFOMIND_PUBLIC_URL` | 空 | 可选，部署文档和 Agent 集成使用 |
| `INFOMIND_STT_MODEL_PATH` | `data/models/ggml-base.bin` | whisper.cpp 模型路径，Docker 中通常为 `/app/data/models/ggml-base.bin` |
| `INFOMIND_STT_LANGUAGE` | `auto` | 本地转写语言，默认自动识别 |
| `INFOMIND_STT_MAX_DURATION` | `7200` | 自动转写最长视频秒数，超过后不静默消耗资源 |
| `INFOMIND_YTDLP_PATH` | 空 | 可选，指定自定义 yt-dlp 可执行文件 |
| `INFOMIND_YTDLP_AUTO_DOWNLOAD` | `1` | 设为 `0` 可关闭官方受管 yt-dlp 自动下载 |
| `INFOMIND_YTDLP_JS_RUNTIME` | 当前 Node/Electron | 可选，显式指定 yt-dlp 的 JavaScript runtime，例如 `deno:/opt/homebrew/bin/deno` |

## 注意事项

- 数据库、WAL 文件、封面缓存和备份文件不应提交到 Git。
- 迁移生产环境时应同步整个 `data/` 目录，而不是只复制 `.db` 文件。
- 抖音、小红书、知乎、微博等平台页面结构和访问策略变化较快；公开解析不足时应保持 Chrome/Edge/Arc 中的 InfoMind Clipper 已配对，由浏览器登录态页面完成采集。
- `INFOMIND_SECRET` 变更会影响已加密配置的解密。

## License

MIT
