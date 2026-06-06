# Space Strike / 星际突击

一个基于 `Phaser 3` 的浏览器飞行射击小游戏，当前版本已迁移为 `Cloudflare Workers + D1 + KV/JWT` 架构，支持游客游玩、注册登录、成绩保存、排行榜和自定义域名部署。

## 项目简介

- 前端：`HTML + CSS + JavaScript + Phaser 3`
- 后端：`Cloudflare Workers`
- 用户与成绩存储：`Cloudflare D1`
- 登录会话：`JWT + Cloudflare KV + HttpOnly Cookie`
- 静态资源托管：`Workers Static Assets`

当前游戏已经适合部署到 Cloudflare，不再依赖本地 Node 服务写 `JSON` 文件。

## 核心功能

- 游客可直接开始游戏
- 用户可注册、登录、退出
- 登录后自动保存成绩
- 支持平台排行榜和个人历史战绩
- 背景音乐随静态资源一同部署

## 目录结构

```text
Game01/
├─ public/
│  ├─ index.html
│  ├─ assets/
│  │  └─ audio/
│  │     └─ hundouluo.mp3
│  └─ game/
│     └─ main.js
├─ src/
│  └─ worker.js
├─ migrations/
│  └─ 0001_init.sql
├─ server/
│  └─ app.js                # 旧版本地 Node 服务，仅保留作参考
├─ wrangler.toml
├─ .dev.vars.example
├─ package.json
└─ README.md
```

## Cloudflare 架构说明

当前项目部署到 Cloudflare 后，职责分工如下：

- `public/`：提供游戏页面、前端脚本、音频等静态资源
- `src/worker.js`：处理 `/api/*` 请求
- `D1`：保存用户和分数数据
- `KV`：保存会话状态
- `JWT_SECRET`：用于签发与校验登录令牌

## 环境要求

- Node.js `>= 18`
- npm `>= 9`
- 已拥有 Cloudflare 账号

## 本地开发

### 1. 安装依赖

```bash
cd /Users/luomanlin/env/Game01
npm install
```

### 2. 登录 Cloudflare

```bash
npx wrangler login
```

### 3. 创建 D1 数据库

```bash
npx wrangler d1 create space-strike-db
```

执行后会得到类似输出：

```text
database_name = "space-strike-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把 `database_id` 写入 [wrangler.toml](/Users/luomanlin/env/Game01/wrangler.toml) 的 `[[d1_databases]]` 配置。

### 4. 创建 KV Namespace

```bash
npx wrangler kv namespace create SESSION_KV
npx wrangler kv namespace create SESSION_KV --preview
```

把命令输出里的：

- 正式环境 `id`
- 预览环境 `preview_id`

写入 [wrangler.toml](/Users/luomanlin/env/Game01/wrangler.toml) 的 `[[kv_namespaces]]` 配置。

### 5. 配置本地开发密钥

```bash
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`：

```text
JWT_SECRET=replace-with-a-long-random-secret
```

建议使用足够长、足够随机的值。

### 6. 初始化本地或预览数据库表结构

```bash
npx wrangler d1 execute space-strike-db --file=./migrations/0001_init.sql
```

### 7. 启动本地开发服务

```bash
npm run dev
```

Wrangler 启动后通常会提供一个本地地址，例如：

- `http://127.0.0.1:8787`

本地调试入口：

- 游戏首页：`http://127.0.0.1:8787`
- 健康检查：`http://127.0.0.1:8787/api/health`

## 部署到 Cloudflare Workers

### 1. 配置线上密钥

```bash
npx wrangler secret put JWT_SECRET
```

输入你线上要使用的真实密钥。

### 2. 初始化远程 D1 表结构

```bash
npx wrangler d1 execute space-strike-db --remote --file=./migrations/0001_init.sql
```

### 3. 正式部署

```bash
npm run deploy
```

部署完成后，Wrangler 会输出一个 Workers 地址，通常类似：

- `https://space-strike.<your-subdomain>.workers.dev`

## 绑定自定义域名

如果你要把项目绑定到自己的域名，例如当前使用的：

- `https://game01.frank2000.uk`

请按下面步骤操作：

1. 打开 Cloudflare Dashboard
2. 进入 `Workers & Pages`
3. 进入 `space-strike` 这个 Worker
4. 打开 `Domains & Routes`
5. 绑定你要使用的域名或子域名

绑定成功后，就可以通过该域名访问游戏和 API。

## 部署完成后的检查

建议部署后依次检查：

1. 静态页面是否能打开  
示例：`https://game01.frank2000.uk`

2. 健康检查是否正常  
示例：`https://game01.frank2000.uk/api/health`

3. 注册是否成功

4. 登录是否成功

5. 完成一局游戏后，成绩是否能写入排行榜

## 常用命令

安装依赖：

```bash
npm install
```

本地开发：

```bash
npm run dev
```

正式部署：

```bash
npm run deploy
```

查看实时日志：

```bash
npx wrangler tail --format=pretty
```

重新执行远程数据库初始化：

```bash
npx wrangler d1 execute space-strike-db --remote --file=./migrations/0001_init.sql
```

## API 简表

- `GET /api/health`：健康检查
- `GET /api/config`：读取游戏配置
- `POST /api/register`：注册并登录
- `POST /api/login`：登录
- `POST /api/logout`：退出登录
- `GET /api/me`：获取当前登录用户
- `POST /api/scores`：保存成绩
- `GET /api/leaderboard`：获取排行榜
- `GET /api/my-scores`：获取当前用户历史成绩

## 重要文件

- Worker 入口：[src/worker.js](/Users/luomanlin/env/Game01/src/worker.js)
- 前端主逻辑：[public/game/main.js](/Users/luomanlin/env/Game01/public/game/main.js)
- 前端页面：[public/index.html](/Users/luomanlin/env/Game01/public/index.html)
- Cloudflare 配置：[wrangler.toml](/Users/luomanlin/env/Game01/wrangler.toml)
- 数据库初始化 SQL：[migrations/0001_init.sql](/Users/luomanlin/env/Game01/migrations/0001_init.sql)
- 本地开发变量示例：[.dev.vars.example](/Users/luomanlin/env/Game01/.dev.vars.example)

## 常见问题

### 1. 访问页面正常，但注册时报“服务内部错误”

优先检查这 3 项：

- `JWT_SECRET` 是否已经通过 `wrangler secret put JWT_SECRET` 配置
- `wrangler.toml` 中的 `database_id`、`id`、`preview_id` 是否正确
- 远程 D1 是否已经执行过 [migrations/0001_init.sql](/Users/luomanlin/env/Game01/migrations/0001_init.sql)

然后运行：

```bash
npx wrangler tail --format=pretty
```

查看线上实时日志。

### 2. 登录成功后仍显示游客

优先检查：

- 自定义域名是否正确指向当前 Worker
- 浏览器是否阻止了 Cookie
- 线上是否使用 `HTTPS`

### 3. 修改代码后页面没有变化

请确认：

- 是否重新执行了 `npm run deploy`
- 浏览器是否做了强缓存，必要时强制刷新

## 兼容说明

- [server/app.js](/Users/luomanlin/env/Game01/server/app.js) 是旧版本地 Node 服务，不再是推荐部署入口。
- 线上部署请以 `src/worker.js + wrangler.toml` 为准。
