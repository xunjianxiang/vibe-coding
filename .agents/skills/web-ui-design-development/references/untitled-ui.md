# Untitled UI 集成事项

仅在 `untitled-ui` 实际参与当前任务时读取。本文件只维护编排层需要知道的发现、安装和项目文件边界；框架、兼容性、CLI、设计系统与资源实施规则全部以 `untitled-ui` Skill 为准。

## 检测

当前可用 Skill 列表中必须存在准确名称 `untitled-ui`，并且能够完整读取其 `SKILL.md`。项目中存在 `components.json`、Untitled UI 组件源码或 `untitled-cli` 不代表当前 Agent 已加载该 Skill。

Skill 可用后，由它自己检查 `untitled-cli`、Node.js、npm、Git、目标项目兼容性和资源权限。编排层不重复执行或解释这些检查。

## 安装

缺少 Skill 时，使用本仓库分发的独立 Skill：

```sh
npx skills add duszlm/web-ui-design-development --skill untitled-ui -g
```

去掉 `-g` 表示项目级安装。执行前确认用户希望的 scope；安装会下载第三方内容并写入 Skill 目录，必须取得相应授权。安装后重新加载宿主并再次确认准确名称 `untitled-ui` 可发现；当前会话无法刷新时，报告恢复方式并停止依赖它的阶段。

`untitled-ui` Skill 与 `untitled-cli` 是两个不同依赖。Skill 已加载但 CLI 缺失时，按其 [CLI 参考](../../untitled-ui/references/cli.md) 处理；不要通过重复安装 Skill 修复 CLI，也不要根据全局 CLI 的存在推断 Skill 已安装。

## 项目文件与 Git

Untitled UI CLI 写入的是目标应用的生产源码与配置。经确认采用后，components、templates、examples、foundations、icons、`components.json`、包清单、lockfile、Tailwind theme 和相关样式入口应按普通项目文件审查并纳入版本控制，不能作为 Agent 生成缓存统一忽略。

安装前后都检查 Git 状态和 diff，明确新增、覆盖、跳过和冲突文件。PRO 认证、许可证或本机凭据不得写入源码、客户端 bundle 或提交记录；具体认证失败与资源限制按 `untitled-ui` Skill 处理。
