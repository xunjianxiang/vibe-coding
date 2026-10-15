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
