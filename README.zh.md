# dsh-smart-approval

[English](README.md) | 中文

`dsh-smart-approval` 是
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的失败关闭审批插件。
它在相同的 `workspace-write` 沙箱上提供人工审批、智能审批和无人值守三种模式，智能审批是推荐默认值。

默认情况下，插件复用当前会话的 provider 和 model；也可以配置独立审核路由。切换模式会从下一次授权申请起生效，不需要重启 DSH。

> [!WARNING]
> 本项目和 DSH 均处于开发者预览阶段。请阅读下方安全边界，并在要求可复现的环境中固定精确版本。

## 审批模式

| 模式 | 安全请求 | 高风险或不确定 | 明确恶意 |
|---|---|---|---|
| Workspace Write · Manual | 转人工 | 转人工 | 转人工 |
| Workspace Write · Smart（推荐） | 自动通过一次 | 转人工 | 拒绝 |
| Workspace Write · Unattended | 自动通过一次 | 拒绝 | 拒绝 |

三个模式都使用 `sandbox: workspace-write` 和 `approval: ask`。`ask` 会让授权申请进入 DSH 的
`approval/request` waterfall；插件再决定自动通过一次、委托给下一个人工 answerer，或直接拒绝。
人工模式会立即旁路审核器，不读取工具参数或用户授权上下文。

## 安装

### 环境要求

- Node.js 24 或更高版本。
- DeepSeek Harness `>=0.1.0-rc.5 <0.2.0`。
- `PATH` 中存在 `pnpm`；DSH 会把插件管理操作转发给 pnpm。

当前已经发布的插件版本是 `0.1.0-rc.1`。已经安装 DSH CLI 时执行：

```sh
npm install --global @deepseek-ai/dsh@0.1.0-rc.6
dsh plugin --profile web add dsh-smart-approval@0.1.0-rc.1
dsh --profile web --dump-config
dsh web
```

如需一次性运行 DSH，使用上游 README 中的 `npx` 形式：

```sh
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add dsh-smart-approval@0.1.0-rc.1
npx @deepseek-ai/dsh@0.1.0-rc.6 --profile web --dump-config
npx @deepseek-ai/dsh@0.1.0-rc.6 web
```

`npm dsh ...` 不是合法的 npm 命令。全局安装后使用 `dsh ...`，一次性运行使用
`npx @deepseek-ai/dsh ...`，从 DeepSeek Harness 源码 checkout 运行时使用 `pnpm dsh ...`。

DSH 插件命令支持精确的 npm 包版本。因此，版本 `0.1.0` 发布后，
`dsh plugin --profile web add dsh-smart-approval@0.1.0` 无需修改代码即可使用；当前不能安装，
是因为 npm Registry 中还没有该版本。

### 从本地或 GitHub 安装

在本仓库中执行：

```sh
dsh plugin --profile web add .
```

从 DeepSeek Harness 源码 checkout 运行：

```sh
pnpm dsh plugin --profile web add /absolute/path/to/dsh-smart-approval
pnpm dsh --profile web --dump-config
pnpm dsh --profile web
```

从 GitHub 安装时，应固定已经审查的 commit：

```sh
dsh plugin --profile web add github:TingRuDeng/dsh-smart-approval#<commit-sha>
```

Git 依赖会运行本包的 `prepare` 构建。pnpm 10 及以上默认阻止依赖构建脚本。首次从 Git 安装时，
请按 DSH 提示把精确包名加入该 profile 的 `pnpm-workspace.yaml` `allowBuilds`，审核源码后再重试。
Registry 包已经包含构建产物，不需要这项 Git 构建许可。

### 验证或卸载

配置转储中应出现 `dsh-smart-approval` bundle、`smart-approval` 插件行，以及三个
Workspace Write 预设：

```sh
dsh --profile web --dump-config
```

卸载插件：

```sh
dsh plugin --profile web remove dsh-smart-approval
```

## 使用与切换模式

DSH 当前只提供一个平铺的 Permissions 选择器，因此三个 Workspace Write 模式使用相同前缀并相邻显示。
可以在 Web UI 中选择，也可以在当前会话执行对应命令：

- 人工审批：`/permission workspace-write`
- 智能审批：`/permission smart-approval`
- 无人值守：`/permission unattended`

插件会为每次授权申请读取当前 preset，因此切换会从下一次申请起立即生效。

## 工作原理

插件是 DSH `approval/request` waterfall 中的前置 answerer：

1. 根据 `callId` 定位真实的 `tool/call` 事件。目前只有 DSH `bash` 和 `pwsh` 具备自动审核契约；
   其他工具会按当前模式转人工或拒绝。
2. 仅使用当前 turn 中直接、纯文本的用户消息作为授权上下文。历史轮次、Assistant 消息、工具输出和模型生成的授权理由均不构成授权。
3. 只传递影响 shell 执行的字段：`command`、`timeoutMs`、`workdir`、`run_in_background` 和
   `sandbox_permissions`。未知字段、图片、非文本内容或超限上下文不会被截断，而是失败关闭。
4. 在调用模型前执行确定性检查。凭据访问、破坏性命令、系统变更、后台任务、依赖安装、发布、远程写入、
   数据上传，以及敏感的 workspace/workdir 条件都不会被归类为可自动放行。
5. 审核器必须返回严格的双字段 JSON。`allow` 表示安全，`human` 表示高风险或不确定；`reject`
   只用于凭据外传、绕过安全控制、未授权远程写入等明确恶意行为。
6. 只有合法的 `allow` 会映射为 `allowed-once`。超时、异常、非法输出、上下文不完整，或审核期间 preset
   发生变化时，都会按当前模式失败关闭。

插件不会授予永久权限，也不会把会话切换到 `danger-full-access`。

## 配置

默认由当前会话路由执行审核。如需使用独立路由，在 profile 的 `cordis.patch.yml` 中覆盖插件行：

```yaml
- id: smart-approval
  config:
    reviewerProvider: your-provider-route
    reviewerModel: your-model-id
    timeoutMs: 15000
    maxTokens: 128
```

`reviewerProvider` 和 `reviewerModel` 必须成对配置。

| 字段 | 默认值 | 作用 |
|---|---:|---|
| `preset` | `smart-approval` | 启用智能审核的权限预设 |
| `unattendedPreset` | `unattended` | 启用无人值守审核的权限预设；不能与 `preset` 相同 |
| `reviewerProvider` / `reviewerModel` | 当前会话路由 | 可选独立审核路由；必须成对配置 |
| `timeoutMs` | `15000` | 整个审核调用的强制期限 |
| `maxTokens` | `128` | 审核输出上限 |
| `maxToolArgumentChars` | `12000` | 工具参数上限；超限时不截断并失败关闭 |
| `maxUserMessages` | `4` | 当前 turn 的直接用户消息数量上限 |
| `maxUserContextChars` | `8000` | 用户上下文上限；超限时不截断并失败关闭 |

### 权限预设合并注意

DSH bundle patch 会替换目标行的整个 `config`，不会深度合并单个字段。因此本 bundle 会完整重述
`permission` 行，并把 `smart-approval` 设为默认值。如果 profile 已自定义权限预设或默认预设，
请在优先级更高的 profile `cordis.patch.yml` 中重新声明并合并。启动前始终使用
`dsh --profile <name> --dump-config` 检查最终配置树。

## 模型与数据边界

人工模式不会调用审核模型。智能和无人值守模式下，审核 provider 会收到 workspace 根目录、最小化的
shell 执行字段，以及当前 turn 的直接用户纯文本。它不会收到 Assistant 消息、工具结果、审批描述、
justification、未知工具字段或已经存储的模型推理。

复用当前会话模型便于部署，但不构成独立安全复核。敏感部署应配置独立、受控的 provider 路由，并评估其数据处理策略。

## 跨目录请求

DSH 当前只为 `workspace-write` 提供一个工作区根目录。访问另一个项目通常会触发一次性
`danger-full-access` 申请。如果当前用户消息明确授权另一个项目，而且命令仅限读取、构建、测试或边界清晰的
开发写入，插件可以允许该次调用。删除、依赖安装、系统变更、发布、远程写入等操作在智能模式转人工，在无人值守模式拒绝。

这不是多根目录沙箱：获准的 `danger-full-access` 进程在该次调用期间仍然拥有宽泛的文件系统权限。
需要严格目录隔离时，应使用人工审批。

## 安全边界

- 只有已经进入 DSH 审批通道的请求才能被审核；不触发审批的网络或远程操作不受本插件控制。
- 模型分类不是安全证明。确定性检查覆盖已知高风险形式，但任何 shell 或 PowerShell 模式匹配都不可能完备。
- 未知工具、未知参数、后台执行、非文本上下文和不完整上下文均失败关闭：智能模式转人工，无人值守模式拒绝。
- 自动授权只对当前调用有效；插件不保存目录白名单或永久授权。
- 日志只记录工具名、结果和短原因码，不记录完整提示、参数、凭据或模型推理。
- 智能模式的人工回退和人工模式需要其他 Web、ACP 或自定义人工 approval answerer；如果不存在，DSH
  会保持失败关闭。无人值守模式不会打开人工提示。
- DSH 当前只有一个 `workspace-write` 根目录。一次性 `danger-full-access` 仍然拥有宽泛文件系统权限；
  本插件不会把它变成多根目录沙箱。

## 面向维护者与 AI 的仓库地图

| 路径 | 职责 |
|---|---|
| `src/index.ts` | 插件配置、服务注入和生命周期 |
| `src/approval-handler.ts` | preset 路由、waterfall 决策和审核后 preset 复核 |
| `src/review-context.ts` | 当前调用与当前 turn 上下文的提取和最小化 |
| `src/review-policy.ts` | 确定性的失败关闭前检 |
| `src/llm-reviewer.ts` | 审核提示、流式解析、严格裁决协议和超时 |
| `cordis.patch.yml` | DSH bundle 层、插件行和权限预设 |
| `tests/*.spec.ts` | 审批、上下文、策略、协议和 bundle 回归契约 |

必须保持的行为不变量：

- 缺失或含糊的证据不能变成自动放行。
- 只有同一 turn 的直接用户文本可以建立授权。
- 只有严格合法的 `allow` 可以返回 `allowed-once`。
- 人工模式不能检查申请内容，也不能调用模型。
- 审核进行中切换 preset 后，原审核结果不能自动放行。

## 开发

```sh
pnpm install
pnpm test
pnpm run typecheck
pnpm run build
pnpm pack --dry-run
```

支持的 DSH 范围是 `>=0.1.0-rc.5 <0.2.0`。已使用真实 DSH 隔离 profile 安装发布包，组合配置中包含
bundle、插件行和三个 preset。真实 provider 的端到端审核，以及 Web/ACP 人工回退交互仍依赖部署凭据和具体环境验收。

## License

[MIT](LICENSE)
