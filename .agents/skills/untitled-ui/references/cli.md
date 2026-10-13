# Untitled UI CLI

仅在任务需要选择或运行 CLI 命令时读取。参数和支持范围以本机 `untitled-cli <command> --help` 为准。

## 环境与安装

当前 CLI 基线要求 Node.js 20 或更高版本、npm 和 Git。先检查：

```sh
node --version
npm --version
git --version
npm list --global --depth=0 untitled-cli
untitled-cli --version
```

如果全局包不存在、版本命令失败，或包缺少 `package.json`/`dist/cli.js`，则 CLI 未正确安装。如果已安装但版本低于 `0.3.0`，则需要更新。用户已经授权全局安装或修复时，从指定仓库执行：

```sh
npm install --global --install-links=true "git+ssh://git@github.com:duszlm/untitled-cli.git"
```

必须保留 `--install-links=true`，避免 npm 的 Git 安装指向随后被清理的缓存目录。该来源要求 GitHub SSH 权限；认证或仓库权限失败时报告原始错误，不擅自改用 registry、HTTPS、fork 或其他来源。安装后重新验证包和版本命令。

## 核心命令

创建受支持项目：

```sh
untitled-cli init <directory> --nextjs
untitled-cli init <directory> --vite
```

配置当前受支持项目时，在实际项目根目录运行：

```sh
untitled-cli init
```

## 品牌色

`-c, --color <name>` 指定品牌色。用户提示词没有提到颜色时不要传该参数，项目会使用内嵌的默认品牌色 `#0BA5EC`。

```sh
untitled-cli init my-app --nextjs -c blue
untitled-cli init my-app --vite -c 藏青
```

支持的色族名、常见颜色词映射和回退规则见 [brand-color.md](brand-color.md)。CLI 收到无法识别的色名时保留默认品牌色，并在标准错误中输出警告，不会中断创建流程。

搜索资源：

```sh
untitled-cli search "响应式价格方案区域"
untitled-cli search "设置页面" --type templates
untitled-cli search "箭头图标" --type icons --limit 10
```

安装组件：

```sh
untitled-cli add
untitled-cli add button --type base
untitled-cli add hero-header --type marketing
untitled-cli add button --type base --dir <project-directory> --path components/ui
```

已知组件类型为 `base`、`marketing`、`shared-assets`、`application` 和 `foundations`。实际有效值仍以当前帮助为准。`--all --type <type>` 会安装整个分类，执行前确认范围。

安装页面示例：

```sh
untitled-cli example
untitled-cli example dashboard-01
untitled-cli example landing-page-01 --example-path app/landing
```

`example` 会写入页面、组件和依赖。仅参考模式不得在目标项目运行；如需检查完整源码，在任务专用的临时受支持项目中安装，避免与目标项目共享 lockfile、配置、依赖或样式。

组件库当前默认版本为 `8`。仅在现有 `components.json` 或用户要求时显式选择 `--lib-version 7` 或 `--lib-version 8`，不借资源安装完成主版本迁移。

## 覆盖与目录

`add` 和 `example` 的 `--yes` 可能接受文件覆盖，`--overwrite` 会覆盖冲突文件。使用前核对命令帮助、目标路径和冲突列表，并确认用户接受实际范围。

除 `add --dir <directory>` 外，修改项目的命令应从实际项目根目录运行。执行前后检查工作区状态和 diff；在 monorepo 中不要误写仓库根目录或相邻 package。
