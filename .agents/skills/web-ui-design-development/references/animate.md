# `animate` 集成事项

仅在 `animate` 实际参与当前任务时读取。本文件只维护编排层需要知道的发现、缺失安装、项目文件边界和本次约束；动效的判定、实现与自检规则始终以当前加载的 `animate` Skill 及其直接引用为准。

## 区分两种可用状态

- **Agent 可用**：当前可用 Skill 列表中存在准确名称 `animate`，并且能够完整读取其 `SKILL.md`。满足此条件即可让 `animate` 参与动效任务。
- **项目已安装**：目标项目中存在 `animate` 的 Skill 目录；只在需要随项目共享或固定版本时才要求此状态。

用 `npx skills ls`（目标项目）与 `npx skills ls -g`（用户级）可以看到已安装的 Skill、路径和装入的宿主。它们只反映安装记录，不能替代当前 Agent 的 Skill 发现检查；项目中存在同名目录、npm 包或安装记录，也不代表当前 Agent 能加载 Skill。不要混用这两个结论。

## 安装与更新

`animate` 是 `emilkowalski/skills` 仓库中的一个 Skill，该仓库是一个多 Skill 仓库（当前 13 个）。官方 README 的 Install 一节给出的命令是：

```sh
npx skills@latest add emilkowalski/skills
```

该命令装的是整仓的 Skill，与本流程只接入 `animate` 的要求不符，因此安装时用 `--skill` 限定到这一个：

```sh
npx skills add emilkowalski/skills --skill animate [-g]
```

只接入 `animate` 的依据来自它的官方说明本身：它把「审查已有动效」指向 `review-animations`、把「审计整个代码库」指向 `improve-animations`，说明同仓库其余 Skill 是各自独立的职责，不随 `animate` 一起启用。

**安装 scope 必须显式决定，不能交给当前目录。** 实测：在 `/tmp` 下不带 `-g` 执行，装出来的是 `/tmp/.agents/skills/animate`，也就是写进执行时所在的那个项目；加 `-g` 才装到 `~/.agents/skills/animate`。因此装到用户级就带 `-g`，装进目标项目就不带、并在交付里说明该项目新增了 Skill 目录与 `skills-lock.json`。`-g` 安装时 CLI 会附带一行 `Failed to install 1 → PromptScript: PromptScript does not support global skill installation`，那是宿主支持范围的差异，Codex 的副本照常落地、退出码为 0。

限定安装只把 `animate` 自身的文件复制到宿主的 Skill 目录，不写宿主 hooks，也不改目标项目的生产源码。参与条件命中且 `animate` 缺失时直接安装，不需要逐次请求授权；安装后在交付里汇报 scope、写入路径与结果。

官方 README 没有规定安装 scope，也没有给出更新方式。已安装版本用 `npx skills update animate` 更新，只处理这一个 Skill；不带 Skill 名执行 `npx skills update` 会遍历全部已安装的 Skill，scope 用 `-g` / `-p` / `-y` 显式指定。注意 `npx skills check` 与 `update` 是同一个命令，不是只读检查。本文件不预设级别、不固化写入路径。

安装或更新后重新加载宿主，并再次确认准确名称 `animate` 可发现。当前会话若不能刷新 Skill 列表，报告重载方式并停止 `animate` 阶段。

## 项目集成注意事项

`animate` 不写宿主 hooks、运行时状态或生成目录，也不需要 Agent 专用状态文件。安装会在宿主 Skill 目录新增文件，安装到目标项目时还会写入该项目的 Skill 目录与 `skills-lock.json`；这些文件按当前 Skill 和安装器输出判断属于共享成果还是本地运行时状态，并在必要时检查现有 ignore 来源，不要作为 Agent 生成缓存统一忽略。

它在实施阶段改动的是页面与业务文件，按普通源码审查。实施中若需要新增依赖或文件，按现行授权边界处理，并在交付说明里记录新增了什么以及为什么。

`animate` 与 `review-animations`、`improve-animations`、`find-animation-opportunities` 属于同一仓库的独立 Skill。本流程只接入 `animate`；不要因为安装了它，就顺带启用其余几个，也不要根据仓库存在推断它们已被采用。

## 动效边界

**写入范围**

- 动效的落点只允许页面与业务代码，包括样式、`className` 和状态逻辑。Untitled UI 组件源码与既有调用不得改动；该规则以 `untitled-ui` 为准，本文件不重复定义。
- 由页面或业务数据驱动的出现、更新、离开，写在页面自有的内容层上。
- 页面自有元素上的交互反馈（hover / focus / pressed）可以写在页面代码里，按 `animate` 的频率档位处理：高频交互只做极轻的反馈。
- Untitled UI 组件自身的交互状态不做——那需要改组件源码，按上一条交回基础层。
- 方案若要求改组件源码、用原生或第三方组件替换库组件、或另行新建一个与库组件职责重叠的组件来取代它，不做，交回基础层；在页面自有层新增包装或组合组件不在此列。

**实现手段**

- 默认走 Tailwind：Tailwind 内置动画与过渡工具，以及项目主题层已有的 token。
- CSS 在当前实现下表达不了、或成本明显更高时（退出、弹簧、可中断、布局变化、手势等），允许用 JS 实现。用哪种方式、是否引入依赖，由具体工程决定，不预设上限。
- 交付里记录：为什么 CSS 不够用、减弱动效下如何退化、是否新增依赖。（本条是本流程的记录要求，不是 `animate` 自身的规定。）

**设计系统边界**

- 不得修改或覆盖 Tailwind 内置 theme 变量（`--animate-*`、`--ease-*` 等）。需要更强曲线或自定义动画时，使用任意值 `animate-[...]`、`ease-[cubic-bezier(...)]`。
- 默认不新增主题层 token。同一条曲线或动画在任务中反复出现、或用户要求建立动效体系时，提出需求并请求授权，由基础层或用户决定后再写入。

**责任**

- 动效方案与实现由本参与者负责，并按自身规则完成交付前自检；动效质量不交由基础层复核。
