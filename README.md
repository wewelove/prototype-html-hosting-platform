# axhub 原型托管平台

企业内网使用的 HTML 原型托管平台：集中保存产品经理、设计师通过 AI 工具或 Axure 产出的原型文件，提供在线访问、分享、权限与统计能力。

## 功能概览

| 领域 | 能力 |
| --- | --- |
| 原型接入 | 单 HTML、ZIP、RAR、项目文件夹；识别根目录的 `index.html` 或 `preview.html` |
| 在线访问 | 原型文件及其相对资源同域访问，自动生成 WebP 首页截图 |
| 资产管理 | 分组、业务分类、搜索、卡片 / 列表视图、替换更新、下载与删除 |
| 分享控制 | 独立分享链接、开关、截止时间、访问密码、分享信息一键复制 |
| 团队协作 | 我的原型、部门原型、公开广场、部门范围管理 |
| 权限模型 | 超级管理员、管理员、普通用户三级角色 |
| 平台治理 | 邀请码注册、部门人员、账号状态、强制改密、存储配额 |
| 数据统计 | PV、UV、上传 / 更新次数、原型排行、登录日志、磁盘用量 |

## 技术方案

| 组件 | 职责 |
| --- | --- |
| Next.js 16 + React 19 + TypeScript | 管理端、原型访问页与服务端 API |
| SQLite（Node.js 内置 `node:sqlite`） | 账号、部门、权限、原型元数据、访问量与日志 |
| 本地持久化磁盘 | SQLite 数据库文件、原型文件、关联静态资源与 WebP 截图 |
| Docker / Docker Compose | 一次构建、单容器启动，无需额外数据库 |
| puppeteer-core + Chromium | 生成原型首页 WebP 截图 |
| Vitest | 单元测试 |

数据边界：HTML 原型内容**不写入数据库**。SQLite 只保存账号、权限、原型名称、业务信息、访问统计与文件路径；原型文件与截图存放在数据目录（默认 `/data`），随数据卷持久化。

## 目录结构

| 路径 | 用途 |
| --- | --- |
| `src/app/` | 页面与服务端 API（Next.js App Router） |
| `src/components/` | 前端交互组件 |
| `src/lib/` | 数据库、认证、上传、存储、权限等核心逻辑 |
| `database/migrations/` | SQLite 迁移脚本 |
| `scripts/` | 迁移、超级管理员初始化、环境校验脚本 |
| `docker/` | 容器入口脚本 |
| `config/` | ESLint 与 Vitest 配置 |
| `tests/fixtures/` | 单元测试使用的样本文件 |

## 本地开发

环境要求：Node.js 24（使用内置 `node:sqlite`）、npm。

```bash
npm ci
cp .env.example .env   # 修改 DATABASE_FILE、密钥等
npm run migrate        # 初始化数据库
npm run bootstrap      # 创建首位超级管理员
npm run dev
```

打开 `http://localhost:3000/manage/login`，使用上一步初始化的管理员账号登录。

## 内网部署（Docker）

环境要求：内网 Linux 服务器、Docker Engine、Docker Compose 插件。

1. 复制并编辑环境变量：

```bash
cp .env.example .env
```

2. 至少修改以下三项：`NEXT_PUBLIC_BASE_URL`（填内网实际地址，如 `http://192.168.1.100:3000`）、`SESSION_SIGNING_SECRET`、`SHARE_PASSWORD_ENCRYPTION_KEY`（各 32 位以上随机字符，且互不相同），以及 `BOOTSTRAP_SUPER_ADMIN_PASSWORD`。

3. 构建并启动：

```bash
docker build -t axhub:latest .
docker compose up -d
```

4. 检查状态：

```bash
docker compose ps
curl --fail http://localhost:3000/manage/api/health
```

默认站点前缀为 `/manage`，端口 `3000`：

- 管理端：`http://服务器IP:3000/manage`
- 公开原型：`http://服务器IP:3000/manage/project/{code}`
- 分享原型：`http://服务器IP:3000/manage/share/{code}`

> `NEXT_PUBLIC_BASE_PATH` 由构建参数决定，构建后运行期无法修改；`NEXT_PUBLIC_BASE_URL` 为运行期读取，可随时调整内网地址。内网 HTTP 访问需保持 `COOKIE_SECURE=false`，否则浏览器不会保存会话 Cookie。

详细步骤见 [部署说明](docs/部署说明.md)、开发说明见 [开发文档](docs/开发文档.md)。

## 常用命令

```bash
npm run dev         # 开发服务器
npm run build       # 生产构建
npm run start       # 运行生产产物
npm run lint        # 代码规范
npm run typecheck   # 类型检查
npm test            # 单元测试
npm run migrate     # 数据库迁移
npm run bootstrap   # 超级管理员初始化
```

## 数据与安全

- 数据目录（默认 `/data`）包含 SQLite 数据库、原型文件与截图，是唯一的数据落地点。
- 分享密码采用加密字段保存，登录密码采用不可逆哈希保存。
- 不要提交 `.env`、数据库文件或任何真实密钥；生产环境使用独立随机密钥。
- 本方案面向内网，默认不包含 HTTPS。如需公网访问，请自行在前端反向代理（Nginx / Caddy 等）启用 HTTPS。

## 许可

[MIT License](LICENSE)。
