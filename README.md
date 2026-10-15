# Vibe Coding

基于 Dev Container 的内部在线开发环境管理平台。Web 应用负责登录、Workspace 详情、服务日志和 Codex Terminal；独立 Runner 负责项目扫描、容器生命周期、日志采集和终端网关。

## 项目接入

- [项目服务日志接入约定](docs/project-service-logging.md)：项目在哪里声明服务、日志写到哪里、平台如何采集，以及页面如何通过 SSE 获取。
- [Dev Container Workspace 架构](docs/devcontainer-workspace-architecture.md)：平台整体设计、安全边界和生命周期。

## 本地启动

启动 Web 服务：

```bash
npm run dev
```

另开一个终端启动 Runner：

```bash
npm run runner:start
```

浏览器访问 [http://localhost:3000](http://localhost:3000)。运行配置见 `.env.example`。

## PM2 生产启动

先安装依赖、完成数据库迁移并构建 Web：

```bash
npm ci --include=dev
npm run db:deploy
npm run build
```

分别启动 Web 和 Runner：

```bash
npm run pm2:start:web
npm run pm2:start:runner
```

也可以一次启动两个进程：

```bash
npm run pm2:start
```

常用管理命令：

```bash
npx pm2 status
npx pm2 logs
npm run pm2:restart
npm run pm2:restart:web
npm run pm2:restart:runner
npm run pm2:stop
```

`npm run build` 会生成 Next.js 的 `.next` 生产构建。PM2 中的进程名分别为 `vibe-coding-web` 和 `vibe-coding-runner`；Web 自定义服务器以生产模式加载 `.next`，Runner 作为独立进程运行。

两个进程都会从项目根目录读取 `.env`；修改 `.env` 后使用 `npm run pm2:restart` 让它们加载新环境变量。
