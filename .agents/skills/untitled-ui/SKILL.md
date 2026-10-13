---
name: untitled-ui
description: 以 Untitled UI 为基础层创建、接入、实现和验收受支持的 React Web 项目；负责框架选择、兼容性、CLI、设计系统契约、页面资源推荐、资源实施与扩展边界。适用于采用或评估 Untitled UI 的项目，不替代调用 Agent 决定页面设计，也不负责协调其他设计 Skill。
---

# Untitled UI

接管采用 Untitled UI 项目的基础层与实现工作。无论独立调用还是由上游流程调用，本 Skill 都负责从项目判断、设计系统契约和资源推荐到最终实现与验证，并以 Untitled UI components、foundations、Tailwind theme、templates 和 examples 作为技术依据。页面方案由调用 Agent 决定，本 Skill 不代替其完成产品体验或页面设计。

## 职责

- 为新项目选择受支持的工程形态，明确前后端、认证与部署边界。
- 评估现有项目兼容性，确定直接集成、有限修复或仅参考模式。
- 从实际资源提取可执行的 Untitled UI + Tailwind 设计系统契约。
- 面向页面设计搜索并推荐适用的 templates、examples、components、variants、tokens 与 icons，同时说明组合方式和能力缺口。
- 根据调用 Agent 确认的页面方案，在契约内选择、安装、组合并实现 Untitled UI 资源。
- 对任务范围内每项用户可见或可交互的 UI 能力执行组件覆盖审计，确保实现前已经优先检查并搜索 Untitled UI 资源。
- 管理能力缺口、自定义扩展、文件覆盖、依赖冲突和最终验证。

产品目标、信息架构、页面布局和业务约束由调用 Agent 根据用户、产品文档或上游设计流程决定。本 Skill 只为这些决策提供 Untitled UI 资源建议和设计系统边界；采用 Untitled UI 后，视觉语言、基础组件和运行时样式以本 Skill 确认的设计系统契约为准。本 Skill 不依赖 Impeccable 或其他特定设计 Skill。

采用 Untitled UI 时实行 **Untitled UI-first**：任务范围内新增或修改的页面、区块、交互、展示、反馈、图标和视觉能力，在形成方案和编码前先复用已安装资源，再集中搜索可安装的 templates、examples、components、variants、tokens 与 icons，然后考虑用现有 primitives 组合。只有这些路径均不能满足明确需求时，才进入项目既有非 Untitled UI 实现、第三方组件或隔离自定义实现；开发便利、浏览器原生能力和工期不能改变此顺序。局部任务只检查本次变更范围，不借此迁移历史 UI。

业务代码中不得直接使用原生 HTML 交互元素（如 `<button>`、`<input>`、`<select>`、`<textarea>`、`<dialog>`、`<table>` 等）作为面向用户的 UI。所有用户可见的交互和展示能力，必须先通过 `untitled-cli search` 搜索对应的 Untitled UI 组件，安装后使用。遇到组件导出名不匹配或 API 不兼容时，先读组件源码（`grep "^export"` 或直接读文件）确认正确的导出名和 props，不得因此退回原生元素。

## 按需读取

- 创建新项目、选择 Next.js 或 React + Vite，或确定前后端与部署边界时，读取 [references/project-setup.md](references/project-setup.md)。
- 选择或运行 `init`、`search`、`add`、`example` 时，读取 [references/cli.md](references/cli.md)；运行 `init` 前按需读取 [references/brand-color.md](references/brand-color.md) 确定品牌色。
- 对现有项目执行任何写命令前，读取 [references/compatibility-matrix.md](references/compatibility-matrix.md)。
- 选择集成模式、规划基础 UI 接管边界或组合资源时，读取 [references/integration-strategy.md](references/integration-strategy.md)。
- 任何设计、实现、改造或评审任务都读取 [references/design-system-contract.md](references/design-system-contract.md)。

只读取当前任务需要的参考文件。CLI 参数和支持范围始终以本机 `untitled-cli <command> --help` 为准；参考文件负责决策边界，不替代当前 CLI 帮助。

## 工作流程

### 1. 确认项目与接管边界

定位实际应用或 monorepo package，保留用户修改。检查项目结构、框架、包管理器、Node.js、TypeScript、Tailwind、样式入口、主题、`components.json`、组件目录、路由、数据、认证和部署事实。

创建新项目时，先按 [brand-color.md](references/brand-color.md) 解析用户提示词里的颜色意图：没有提到颜色就使用默认品牌色，提到明确颜色词就传 `-c`，提到但无法对应也保持默认并在交付说明中写明。颜色属于设计系统 token 层决议，不自行扩展色板，也不把颜色词换算成十六进制。

新项目按项目创建规则确定框架与工程边界。现有项目按兼容矩阵给出且只给出一种模式：

- **直接集成**：在目标项目原地使用 Untitled UI。
- **有限修复后集成**：补齐当前任务所需的受支持配置或依赖后原地集成，不改变主要架构和部署基线。
- **仅参考**：保留现有技术栈，不在目标项目执行 Untitled UI 写命令。

### 2. 建立设计系统契约

从目标项目和已确认资源提取 components、variants、semantic tokens、type/spacing scales、layout、breakpoints、theme、状态和交互模式。为任务范围内每项用户可见或可交互的 UI 能力建立组件映射，记录复用的已安装资源、需要安装的 Untitled UI 资源或尚待确认的缺口；不得因浏览器已有原生元素而跳过映射与检索。新项目先完成受支持初始化；仅参考模式明确区分参考能力与目标项目已经存在的实现。

设计系统契约必须在页面或组件方案形成前确定。它既约束视觉设计，也约束组件选择、交互行为和运行时样式。

### 3. 提供 Untitled UI 资源推荐

根据产品目标和页面需求，先从 templates 和 examples 中寻找最接近的页面或流程，再把界面中的每项用户可见或可交互能力匹配到可用的 components、variants、tokens 与 icons。输出组件映射、候选资源、适用场景、可组合能力、约束和明确缺口；不替调用 Agent 决定信息架构、内容层级、页面布局、响应式策略或最终视觉方案。

资源推荐是页面设计的输入，不是既定设计。调用 Agent 完成页面决策后，本 Skill 检查方案是否符合设计系统契约，并返回可实施资源、组合路径和仍需处理的缺口。新页面与 redesign 仍受已确认的 Untitled UI 视觉语言约束，不另建字体、色板、尺度、圆角、阴影、图标、基础组件或状态体系。

### 4. 搜索、安装与实现

使用需求语义和正确资源类型搜索，不猜测标识符。对组件映射中的每一项先检查已安装的 Untitled UI 资产；没有可复用项时必须通过 CLI 搜索 Untitled UI，再确认最小缺失集合及其版本、权限、依赖、目标路径和冲突文件。未完成这两步，不得直接采用原生控件、第三方组件或自建基础组件。

实现顺序以设计系统复用为原则：

1. 复用已安装的 Untitled UI 资源及 variants。
2. 安装项目缺少但 Untitled UI 已提供的资源。
3. 组合现有 primitives、语义 token 和组件 API 构建业务能力。
4. 只有上述路径均无法满足明确需求时，才提出隔离的最小自定义扩展。

保持 Untitled UI 与 React Aria 的语义、状态、键盘操作和焦点管理。只要 Untitled UI 存在对应资源或可组合路径，面向用户的呈现与交互就必须由其组件承载。原生元素只能作为 Untitled UI 或经批准自定义组件内部的语义实现细节，或用于用户明确要求的平台原生体验；不能因为实现更快、浏览器已经提供基础行为或暂未安装对应组件而直接作为产品 UI。第三方组件和自建基础组件遵循同一例外门槛。

不得直接修改已经安装的 Untitled UI 组件。若明确需求必须改变组件内部实现，且现有 API、variant、wrapper 与组合均无法满足，在取得扩展授权后，将所需实现复制到独立的自定义组件目录，使用不同的名称、导出路径和维护边界再进行修改；原组件及其现有调用保持不变。记录复制来源、组件库版本、偏离原因和验证范围，避免后续 CLI 更新覆盖自定义实现或让其他调用方误用。

### 5. 验证与交付

检查 diff，运行适用的格式化、类型检查、测试或构建，并按任务验证桌面与移动布局、明暗主题、必要状态、键盘焦点和基本可访问性。审计任务范围内直接使用的原生交互元素、第三方 UI、手写交互组件和重复 primitives，将每一项回查到组件映射与检索证据；没有已批准依据的实现必须改用 Untitled UI。确认实现继续使用设计系统资源和语义 token，没有形成平行基础组件层或独立视觉体系。

最终说明项目与集成模式、设计系统契约、CLI 和组件库版本、复用与新增资源、配置和依赖变化、冲突处理、验证结果、经批准的扩展和剩余限制。由上游流程调用时，将这些内容作为结构化交接结果返回。

## 权威与扩展边界

- Untitled UI 源码与 React Aria 是组件 API、状态、语义、键盘交互、焦点管理和可访问性行为的权威。
- Untitled UI foundations、目标项目的 Tailwind theme、CSS variables 和既有 semantic tokens 是视觉设计与运行时值的权威。
- Templates 和 examples 是页面结构与组件组合的首选起点，不是可绕过设计系统的静态素材。
- Templates、examples 和 components 只作为页面设计的资源建议；最终页面方案由调用 Agent 决定。
- 设计提案、预览、`DESIGN.md` 或派生数据不能反向覆盖未经确认的运行时主题与组件行为。
- 能力缺口不自动授权扩展设计系统。先确认现有资源和组合方式确实不能满足需求，再说明最小扩展及影响并取得用户同意。
- 经批准的自定义组件必须与已安装的 Untitled UI 组件隔离，不能覆盖原文件、复用原导出路径或改变现有调用方行为。

## 安全边界

- 搜索与查看帮助是只读操作。`init`、`add` 和 `example` 会写文件，执行前后检查 Git 状态和 diff。
- 不把 `--yes` 视为无风险选项；使用 `--yes`、`--overwrite` 或分类级 `--all` 前确认实际覆盖范围。
- 不为接入 Untitled UI 擅自迁移框架、升级组件库主版本、改写路由、认证、数据或部署边界，也不使用强制安装掩盖依赖冲突。
- PRO 资源需要有效权限。认证、权限或许可证失败时直接报告，不尝试绕过。
- 写命令失败后先检查输出、文件和 diff，再继续未完成部分。网络超时、连接中断、HTTP 429 或 5xx 最多自动重试 5 次；认证、权限、参数、资源限制和兼容性错误不重试。
