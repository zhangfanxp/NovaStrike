# Space Strike / 星际突击

一个基于 `Phaser 3 + Node.js + JSON` 的浏览器飞行射击小游戏。

## 功能特性

- 游客可直接开始游戏（无需登录）
- 注册/登录后可保存成绩
- 服务端本地 `JSON` 存储用户与排行榜
- 支持排行榜、我的战绩、设置弹窗

## 技术栈

- 前端：`HTML + CSS + JavaScript + Phaser 3`
- 后端：`Node.js (http 原生服务)`
- 存储：`server/data/*.json`

## 项目结构

```text
Game01/
├─ public/
│  ├─ index.html
│  └─ game/
│     └─ main.js
├─ server/
│  ├─ app.js
│  └─ data/
│     ├─ config.json
│     ├─ users.json
│     ├─ scores.json
│     └─ sessions.json
├─ package.json
└─ README.md
```

## 环境要求

- Node.js `>= 18`（推荐 `20+`）
- npm `>= 9`

## 本地运行

```bash
cd /Users/luomanlin/env/Game01
npm start
```

默认访问：

- [http://127.0.0.1:3000](http://127.0.0.1:3000)

如果你要避免端口冲突（例如使用 `3003`）：

```bash
HOST=0.0.0.0 PORT=3003 npm start
```

访问地址：

- [http://127.0.0.1:3003](http://127.0.0.1:3003)

## 局域网访问（Mac）

1. 启动服务（建议监听 `0.0.0.0`）：

```bash
HOST=0.0.0.0 PORT=3003 npm start
```

2. 查询 Mac 局域网 IP：

```bash
ipconfig getifaddr en0
```

3. 其他局域网设备访问：

```text
http://<你的Mac局域网IP>:3003
```

示例：

```text
http://192.168.1.23:3003
```

## API 简表

- `GET /api/health` 健康检查
- `POST /api/register` 注册并登录
- `POST /api/login` 登录
- `POST /api/logout` 退出登录
- `GET /api/me` 获取当前用户
- `POST /api/scores` 保存成绩（需登录）
- `GET /api/leaderboard` 获取排行榜
- `GET /api/my-scores` 获取我的历史成绩（需登录）
- `GET /api/config` 获取游戏配置

## 数据说明

- `users.json` 用户信息（密码哈希）
- `scores.json` 历史成绩
- `sessions.json` 登录会话
- `config.json` 游戏参数

## 发布到 GitHub（最短步骤）

```bash
cd /Users/luomanlin/env/Game01
git init
git add .
git commit -m "feat: initial space strike game"
git branch -M main
git remote add origin <你的仓库地址>
git push -u origin main
```

## 注意事项

- Phaser 目前通过 CDN 加载：`https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js`
- 若网络环境受限，可改为本地 Phaser 文件引用
