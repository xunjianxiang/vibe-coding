# `impeccable` 集成事项

仅在 `impeccable` 实际参与当前任务时读取。本文件只维护编排层需要知道的发现、缺失安装和项目文件边界；设计能力、命令行为、hooks 和生成物规则始终以当前安装的 `impeccable` Skill 及其直接引用为准。

## 区分两种可用状态

- **Agent 可用**：当前可用 Skill 列表中存在准确名称 `impeccable`，并且能够完整读取其 `SKILL.md`。满足此条件即可让 `impeccable` 参与设计流程。
- **项目已安装**：目标项目包含对应宿主的 `impeccable` Skill payload；需要项目级 hooks、团队共享安装或项目内版本管理时才要求此状态。

全局可用的 Skill 不代表目标项目已经安装 hooks；项目中存在 `npx impeccable` CLI 也不代表当前 Agent 能加载 Skill。不要混用这两个结论。

在目标项目根目录运行 `npx impeccable check` 可以检查项目级安装与更新状态。该命令的结论不能替代当前 Agent 的 Skill 发现检查。

## 安装与更新

官方推荐从目标项目根目录运行：

```sh
npx impeccable install
```

安装器检测宿主、选择 project/global scope，并在用户同意时安装对应 hook manifest。仅需要 Skill、不希望本次写入 hooks 时使用安装器提供的 `--no-hooks`。已安装版本使用 `npx impeccable check` 检查，使用 `npx impeccable update` 更新；不要用重新安装代替普通更新。

安装或更新会下载第三方内容并写入 Skill、宿主配置和可能的 hook manifest。执行前说明目标 scope、宿主、预期路径和 hooks 选择，并取得相应授权。不要把用户要求完成 Web UI 任务自动解释为授权安装或更新第三方 Skill。

安装完成后重新加载宿主并再次检查准确名称 `impeccable` 是否可发现。当前会话若不能刷新 Skill 列表，报告重载方式并停止 `impeccable` 阶段。项目级安装和 hook manifest 需要作为一个整体检查；共享 manifest 不应指向只有单个开发者才拥有的项目外路径。

`impeccable` 官方仓库与安装说明为 `https://github.com/pbakaus/impeccable`。参数可能随版本变化，执行时以当前 `npx impeccable --help`、安装器输出和已加载 Skill 为准；不要在本文件固化下游命令细节。

## 项目集成注意事项

项目级 hooks 不是使用 `impeccable` 的前提。安装或更新可能写入宿主 hook manifest；是否安装、批准、信任或共享由用户和目标项目决定，编排层不手工修改 hook scripts 或复制各宿主的管理规则。

不要把缺少 `PRODUCT.md`、`DESIGN.md` 或 `.impeccable/` 目录当作 Skill 未安装的证据。这些属于项目上下文或生成物状态，由 `impeccable` 自己判断和管理。

每次产生新文件后，按当前 Skill 和安装器输出判断它属于共享成果还是本地运行时状态，并检查现有 ignore 来源。仅对确认不应提交的实际文件补充规则：优先复用安装器维护的本地 ignore；确需团队共享时，才向仓库 `.gitignore` 增加能覆盖这些文件的最少、最窄规则。不要预先罗列可能出现的文件，也不要忽略整个 `.impeccable/`。最终汇报新增文件、忽略依据、提交策略以及仍需用户批准或信任的项目集成。

## 视觉边界

`impeccable` 在 Untitled UI 设计系统契约内工作，负责产品流程、信息架构、内容层级、布局组合、响应式策略和体验打磨。以下内容不属于 `impeccable` 的决策范围：

- 品牌色及其色阶。品牌色由用户提示词或项目默认值确定，`impeccable` 不得替换、调整或重新生成，也不得引入平行色板或近似色。
- foundations 中的字体、色板、type scale、spacing scale、圆角、阴影、图标语言和组件 primitives。

`impeccable` 认为基础层选择不适配时，按编排层的冲突规则提出建议并交回基础层拥有者或用户确认，不直接改色，也不另建平行视觉体系。
