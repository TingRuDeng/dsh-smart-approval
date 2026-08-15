# dsh-smart-approval

`dsh-smart-approval` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的三模式审批插件。在相同的 Workspace Write 沙箱范围内，它提供人工审批、智能审批和无人值守三个档位；智能审批是推荐默认值。

默认复用当前会话正在使用的 provider/model，不需要单独配置模型。切换审批模式不需要重启 DSH。

| 模式 | 安全请求 | 高风险或不确定 | 明确恶意 |
|---|---|---|---|
| Workspace Write · Manual | 转人工 | 转人工 | 转人工 |
| Workspace Write · Smart（推荐默认） | 自动通过一次 | 转人工 | 直接拒绝 |
| Workspace Write · Unattended | 自动通过一次 | 直接拒绝 | 直接拒绝 |

三个模式的 DSH 配置均为 `sandbox: workspace-write` 与 `approval: ask`。`ask` 是让授权申请进入审批 waterfall 的必要条件；最终是转人工还是直接拒绝，由插件根据当前模式决定。人工审批模式下插件只解析当前 preset 后立即旁路，不读取工具或用户授权上下文，也不调用审核模型。

## 工作方式

插件作为 `approval/request` waterfall 的前置 answerer：

1. 从会话日志按 `callId` 读取真实 `tool/call` 参数；目前只自动审核 DSH 的 `bash` 和 `pwsh`，其他工具按当前模式转人工或拒绝。
2. 只提取当前工具调用所属 turn 中 `source.kind === "user"` 的直接用户纯文本作为授权上下文；旧轮次消息、Assistant 消息、工具输出和申请理由不构成授权。消息数量或字符数超限、含图片或其他非文本块时不截断上下文，按当前模式转人工或拒绝。
3. 审核载荷只保留实际影响 shell 执行的 `command`、`timeoutMs`、`workdir`、`run_in_background` 和 `sandbox_permissions`；模型生成的 `description`、`justification` 不发送，未知参数按当前模式转人工或拒绝。
4. 工作区根目录、有效工作目录、凭据、明显破坏性命令、系统变更、后台运行、依赖安装、发布、远程写入或数据上传会在调用审核模型前被识别为非安全请求；智能模式转人工，无人值守模式直接拒绝。
5. 审核模型只能返回严格的双字段 JSON：`allow` 表示安全，`human` 表示高风险或不确定，`reject` 只表示凭据外传、绕过安全控制、明确违反用户边界或未授权远程写入等明确恶意行为。
6. 只有合法 `allow` 会映射为 `allowed-once`。智能模式下 `human`、超时、异常或非法输出调用 `next()`；无人值守模式下这些情况全部直接拒绝。智能和无人值守模式下的 `reject` 都直接拒绝；人工模式不会调用审核模型。

插件不修改会话的永久权限，也不会自动把会话切换到 `danger-full-access`。

## 本地安装

先安装 DSH，然后在本仓库目录执行：

```sh
dsh plugin --profile web add .
dsh --profile web --dump-config
dsh --profile web
```

使用 DSH 源码 checkout 时，在 DSH 仓库根目录运行等价命令：

```sh
pnpm dsh plugin --profile web add /absolute/path/to/dsh-smart-approval
pnpm dsh --profile web --dump-config
pnpm dsh --profile web
```

从 GitHub 安装时应固定 commit：

```sh
dsh plugin --profile web add github:TingRuDeng/dsh-smart-approval#<commit-sha>
```

Git 依赖会运行本包的 `prepare` 构建脚本。pnpm 10 及以上默认阻止该脚本，首次安装时应按 DSH 输出的提示，把精确包名加入对应 profile 的 `pnpm-workspace.yaml` `allowBuilds`，审核源码后再重试安装。

### 权限预设合并注意

DSH 当前的 bundle patch 会替换目标行的整个 `config`，不能只追加一个 preset。因此本插件会完整重述 `permission` 行中的 `read-only`、`workspace-write`、`smart-approval`、`unattended` 和 `danger-full-access`，并把 `smart-approval` 设为默认值。如果你的 profile 已自定义权限预设或默认预设，请在安装后通过 profile 自己的 `cordis.patch.yml` 重述并合并这些配置；该用户层优先于 bundle。启动前用 `dsh --profile <name> --dump-config` 核对最终结果。

## 使用与热切换

DSH 当前只提供一个平铺的 Permissions 选择器，因此三个 Workspace Write 模式使用统一前缀相邻展示。可以在 Web 中选择对应项，也可以在当前会话输入对应命令：

- 人工审批：`/permission workspace-write`
- 智能审批：`/permission smart-approval`
- 无人值守：`/permission unattended`

插件每次申请都从当前会话日志读取预设，因此下一次权限申请立即使用新模式，不要求重启 DSH。若未来 DSH 支持把沙箱范围和审批策略拆成两个控件，可在不改变本插件决策矩阵的前提下调整展示方式。

## 可选独立审核模型

不配置时复用当前会话模型。若希望使用单独模型，在 profile 的 `cordis.patch.yml` 中覆盖插件行；provider/model 必须成对配置：

```yaml
- id: smart-approval
  config:
    reviewerProvider: your-provider-route
    reviewerModel: your-model-id
    timeoutMs: 15000
    maxTokens: 128
```

可用配置：

| 字段 | 默认值 | 作用 |
|---|---:|---|
| `preset` | `smart-approval` | 激活智能审批的权限预设名 |
| `unattendedPreset` | `unattended` | 激活无人值守审批的权限预设名；不能与 `preset` 相同 |
| `reviewerProvider` / `reviewerModel` | 当前会话路由 | 可选独立审核模型，必须同时提供 |
| `timeoutMs` | `15000` | 整个审核调用的强制期限 |
| `maxTokens` | `128` | 审核输出上限 |
| `maxToolArgumentChars` | `12000` | 工具参数上限；超出后按模式转人工或拒绝，不截断 |
| `maxUserMessages` | `4` | 当前 turn 直接用户消息数上限；超出后按模式转人工或拒绝，不截断 |
| `maxUserContextChars` | `8000` | 用户上下文上限；超出后按模式转人工或拒绝，不截断 |

如果配置独立审核模型，session 的工作区根目录、最小化后的 shell 执行参数和当前 turn 的直接用户纯文本会发送给该 provider。请按数据敏感级别选择可信服务。默认复用当前会话模型只是部署便利，不构成独立安全复核；对 `danger-full-access` 等高权限场景，建议配置独立、受控的审核路由。

## 跨目录场景

当前 DSH 的 `workspace-write` 沙箱只有一个工作区根目录。访问另一个项目时，工具通常会为该次调用申请 `danger-full-access`。插件可以在用户消息明确授权另一个项目、且具体命令只是读取、构建、测试或边界清晰的开发写入时批准这一次调用；删除、安装、系统操作、远程写入等在智能模式转人工、无人值守模式拒绝。

这不是多目录沙箱：一次 `danger-full-access` 调用在执行期间仍拥有宽文件权限。插件降低重复点击，但不能提供官方多工作区或多个可写根目录相同的强隔离。需要严格目录隔离时，应继续人工审批，或等待 DSH 提供多工作区接口。

## 安全边界

- 只有经过 DSH 审批通道的请求会被审核；本来不触发审批的网络和远程操作不由本插件拦截。
- 模型判断不是安全证明。固定前检会扫描 shell 执行参数、工作区和当前 turn 的用户上下文，但命令匹配无法穷尽所有 shell/PowerShell 表达方式；未知或有歧义的请求在智能模式必须转人工、无人值守模式必须拒绝。
- 当前仅为 `bash`/`pwsh` 建立了明确参数契约；未知工具、未知参数、后台命令和非纯文本授权上下文在智能模式转人工、无人值守模式直接拒绝。
- 自动授权仅对当前调用有效；插件不保存目录白名单或永久授权。
- 日志只记录工具名、结果和短原因码，不记录完整提示、参数、凭据或模型推理。
- 智能模式的人工回退和人工审批模式需要 profile 中存在 Web、ACP 或其他 approval answerer；没有人工渠道时 DSH 保持 fail-closed。无人值守模式不打开人工提示。

## 开发

开发和运行需要 Node.js 24 或更高版本。

```sh
pnpm install
pnpm test
pnpm run typecheck
pnpm run build
pnpm pack --dry-run
```

当前兼容范围为 DSH `>=0.1.0-rc.5 <0.2.0`：已在 GitHub `master` 的 rc.5 源码上完成 Loader/UI 组合验证，并使用 npm rc.6 依赖完成测试、类型检查和构建。DSH 尚处于预发布阶段，升级后应重新运行真实 profile 组合验证。

## License

MIT
