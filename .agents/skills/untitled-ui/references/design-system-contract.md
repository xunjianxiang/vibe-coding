# Untitled UI + Tailwind 设计契约

任何采用 Untitled UI 的设计、实现、改造或评审任务都读取本文件。先形成设计契约和资源推荐，再由调用 Agent 开展页面设计；由上游流程调用时，同时把契约作为交接输入。该契约是硬约束，不是灵感参考。

## 提取权威来源

从实际目标项目读取，不猜测默认值：

- `components.json` 中的库版本、目录、aliases 和配置。
- Untitled UI foundations、已安装 primitives、组件 variants、templates 和 examples。
- Tailwind theme、全局样式入口、CSS variables、typography 与颜色定义。
- 已有页面中稳定使用的 container、grid、breakpoint、spacing、radius、border、shadow、icon 和 motion 模式。
- light/dark theme 中语义角色的实际映射。

新项目应先完成受支持的初始化，再从生成结果提取。仅参考模式从隔离环境或搜索结果获取 Untitled UI 约束，但不得声称目标项目已经实现这些 token 或组件。

## 交付设计契约

形成一个紧凑、可执行的契约；由上游流程调用时将其原样返回。契约至少包含：

- 可用的页面模板、区块、primitives 和 variants；同时列出任务范围内每项用户可见或可交互 UI 能力对应的 Untitled UI 资源、已安装/待安装状态和检索证据，或明确缺口。
- semantic colors、typography scale、spacing/sizing scale、radius、border 和 shadow。
- container、grid、breakpoints 和响应式组合方式。
- 状态、表单、导航、overlay、反馈、icon 和 motion 模式。
- light/dark theme 的语义对应关系。
- 当前任务可直接满足的需求与明确能力缺口。

每项都引用实际源码、theme 或已发现资源。不存在的值标记为缺口，不补造近似值。

## 对设计流程的硬约束

采用 Untitled UI 时，所有参与页面与组件设计的流程都必须把本契约作为 pinned brief 和 incumbent visual truth：

- 可以改善用户流程、信息架构、内容层级、文案、页面布局和现有资源组合。
- 可以在已有 variants、semantic tokens、spacing/type scales、breakpoints 和交互模式内做取舍与打磨。
- 不得创建替代视觉世界，或引入新的字体、色板、渐变体系、type scale、spacing scale、圆角、阴影、图标语言、组件 primitives 和状态模式。
- 不得要求用任意 Tailwind values、硬编码颜色、页面级 CSS、CSS Modules 或 CSS-in-JS 绕过 foundations。
- 品牌色由用户提示词或项目默认值确定，属于契约固定内容：不得替换、调整或重新生成品牌色，也不得引入平行色板或近似色；页面色彩只能使用该品牌色阶与既有 semantic token。
- 不得以原生元素、第三方 UI 或自建基础组件替代尚未检索的 Untitled UI 能力；浏览器原生支持和实现便利不构成例外依据。
- 任何视觉增强、排版、布局、色彩或动效调整都只能使用契约已有能力；设计动作本身不构成扩展设计系统的授权。
- 缺少 `DESIGN.md` 不代表可以从零创建视觉世界；Untitled UI foundations 与运行时代码本身就是视觉权威证据。

即使任务是新页面或 redesign，也默认复用该视觉语言。只有用户明确批准偏离或扩展 Untitled UI 设计系统时，才可以进入新视觉能力设计。

## 能力缺口

先检查项目已安装的 Untitled UI 资源，再使用 CLI 搜索 Untitled UI 的 components、templates、examples 和 icons；确认 variants、props、组合与 wrapper 都无法满足后，才记录能力缺口。缺口报告应说明：

- 无法满足的产品需求。
- 已检查的现有资源与组合方式。
- 缺失的是功能能力还是纯视觉偏好。
- 不扩展设计系统时的可用替代方案。
- 最小扩展范围及对 Tailwind foundations、主题和组件 API 的影响。

功能缺口本身不自动授权新增设计。没有用户批准时，选择最接近的现有模式或报告限制，不建立平行视觉体系。

经批准且必须改变组件内部实现时，不修改已经安装的 Untitled UI 组件。将所需实现复制为名称、路径和导出入口均独立的自定义组件，保留原组件及现有调用不变，并记录来源版本与偏离原因。

## 实现检查

实现后核对：

- 新增 class 使用已定义的 Tailwind utilities 与 semantic tokens；必要的任意值必须来自明确的产品数据或布局计算，而不是视觉调参。
- 未新增平行的颜色、字体、spacing、radius、shadow 或组件 token。
- 组件保持 Untitled UI/React Aria 的状态、语义、键盘和焦点行为。
- 组件映射覆盖任务范围内全部用户可见或可交互 UI 能力，而非只覆盖常用控件；每项均有已安装资源、CLI 搜索结果或明确缺口作为证据。
- 已反向审计直接原生交互元素、第三方 UI、手写交互组件和重复 primitives；未采用 Untitled UI 的部分均具有经批准的能力缺口或用户明确的平台原生要求，且没有形成重复的基础组件层。
- 已安装的 Untitled UI 组件没有被直接修改；经批准的自定义副本具有独立名称、路径、导出入口和维护边界。
- 新页面在 light/dark、目标 breakpoints 和所有必要状态下仍属于同一设计语言。

在任务结果中显式记录任何偏离、缺口或经批准的扩展；由上游流程调用时一并返回。
