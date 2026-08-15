# dsh-smart-approval

[English](README.md) | 中文

`dsh-smart-approval` 是
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的失败关闭审批插件。
它把“访问权限”和“自动审查”拆成两个互不耦合的会话设置：DSH 继续管理
Read Only、Workspace Write、Full access，插件在 `Workspace Write` 旁边增加独立的自动审查选择框。

新会话默认使用智能审批。切换自动审查模式不会改变沙箱权限，切换权限也不会改变自动审查模式；
两者都从下一次授权申请起生效，无需重启 DSH。

> [!WARNING]
> 本项目和 DSH 均处于开发者预览阶段。请阅读下方安全边界，并在要求可复现的环境中固定精确版本。

## 两个独立选择器

Web 输入框底部应显示两个控件：

```text
[ Workspace Write ▾ ] [ 智能审批 ▾ ]
```

- 访问权限：Read Only、Workspace Write、Full access，由 DSH 原生权限选择器管理。
- 自动审查：人工审批、智能审批、无人值守，由本插件独立管理。

| 自动审查模式 | 安全请求 | 高风险或不确定 | 明确恶意 |
|---|---|---|---|
| 人工审批 | 转人工 | 转人工 | 转人工 |
| 智能审批（推荐默认） | 自动通过一次 | 转人工 | 拒绝 |
| 无人值守 | 自动通过一次 | 拒绝 | 拒绝 |

自动审查只处理已经进入 DSH `approval/request` waterfall 的请求。它不会扩大当前访问权限，
也不会把会话切换到 Full access。

## 安装

### 环境要求

- Node.js 24 或更高版本。
- DeepSeek Harness `>=0.1.0-rc.5 <0.2.0`。
- `PATH` 中存在 `pnpm`；DSH 会把插件管理操作转发给 pnpm。

全局安装 DSH 后：

```sh
npm install --global @deepseek-ai/dsh@0.1.0-rc.6
dsh plugin --profile web add dsh-smart-approval@0.1.0-rc.3
dsh --profile web --dump-config
dsh web
```

一次性运行：

```sh
npx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add dsh-smart-approval@0.1.0-rc.3
npx @deepseek-ai/dsh@0.1.0-rc.6 --profile web --dump-config
npx @deepseek-ai/dsh@0.1.0-rc.6 web
```

`npm dsh ...` 不是合法的 npm 命令。全局安装后使用 `dsh ...`，一次性运行使用
`npx @deepseek-ai/dsh ...`，从 DeepSeek Harness 源码 checkout 运行时使用 `pnpm dsh ...`。

DSH 插件命令支持精确版本。因此稳定版发布后可直接执行：

```sh
dsh plugin --profile web add dsh-smart-approval@0.1.0
```

### 从本地或 GitHub 安装

从本仓库安装：

```sh
dsh plugin --profile web add .
```

从 DeepSeek Harness 源码 checkout 运行：

```sh
pnpm dsh plugin --profile web add /absolute/path/to/dsh-smart-approval
pnpm dsh --profile web --dump-config
pnpm dsh --profile web
```

从 GitHub 安装时固定已审查的 commit：

```sh
dsh plugin --profile web add github:TingRuDeng/dsh-smart-approval#<commit-sha>
```

Git 依赖会运行本包的 `prepare` 构建。pnpm 10 及以上默认阻止依赖构建脚本；首次从 Git
安装时，请按 DSH 提示把精确包名加入该 profile 的 `pnpm-workspace.yaml` `allowBuilds`，
审核源码后再重试。Registry 包已包含构建产物，不需要这项许可。

### 验证或卸载

```sh
dsh --profile web --dump-config
```

配置中应出现 `dsh-smart-approval` bundle 和 `smart-approval` 插件行；permission 配置仍应只有
DSH 原生的 Read Only、Workspace Write、Full access。启动 Web 后，自动审查选择框应独立显示在
权限选择器旁边。

卸载：

```sh
dsh plugin --profile web remove dsh-smart-approval
```

## 使用与切换模式

优先使用 Web UI 中的独立自动审查选择框，也可以在当前会话执行：

```text
/approval-mode manual
/approval-mode smart
/approval-mode unattended
```

不带参数的 `/approval-mode` 返回当前模式。访问权限仍使用 DSH 原生 `/permission` 命令，两套命令
不会互相改写状态。

新会话使用配置的 `defaultMode`，默认是 `smart`。从早期预览版升级时，尚无独立模式事件的旧会话
会迁移一次：`smart-approval` 映射为 `smart`，`unattended` 映射为 `unattended`，其他旧权限预设映射为
更保守的 `manual`。迁移不会修改原权限事件。

## 工作原理

插件是 DSH `approval/request` waterfall 中的前置 answerer：

1. 根据 `callId` 定位真实的 `tool/call` 事件。目前只有 DSH `bash` 和 `pwsh` 具备自动审核契约；
   其他工具会按当前模式转人工或拒绝。
2. 仅使用当前 turn 中直接、纯文本的用户消息作为授权上下文。历史轮次、Assistant 消息、工具输出和
   模型生成的授权理由均不构成授权。
3. 只传递影响 shell 执行的字段：`command`、`timeoutMs`、`workdir`、`run_in_background` 和
   `sandbox_permissions`。未知字段、图片、非文本内容或超限上下文不会被截断，而是失败关闭。
4. 模型调用前执行确定性检查。凭据访问、破坏性命令、系统变更、后台任务、依赖安装、发布、远程写入、
   数据上传，以及敏感的 workspace/workdir 条件都不会被归类为可自动放行。
5. 审核器必须返回严格的双字段 JSON。`allow` 表示安全，`human` 表示高风险或不确定；`reject`
   只用于凭据外传、绕过安全控制、未授权远程写入等明确恶意行为。
6. 只有合法 `allow` 会映射为 `allowed-once`。超时、异常、非法输出、上下文不完整，或审核期间模式
   发生变化时，都会按当前模式失败关闭。

## 配置

默认复用当前会话路由。需要独立审核路由时，在 profile 的 `cordis.patch.yml` 中覆盖插件行：

```yaml
- id: smart-approval
  config:
    defaultMode: smart
    reviewerProvider: your-provider-route
    reviewerModel: your-model-id
    timeoutMs: 15000
    maxTokens: 128
```

`reviewerProvider` 和 `reviewerModel` 必须成对配置。

| 字段 | 默认值 | 作用 |
|---|---:|---|
| `defaultMode` | `smart` | 新会话的自动审查模式：`manual`、`smart` 或 `unattended` |
| `reviewerProvider` / `reviewerModel` | 当前会话路由 | 可选独立审核路由；必须成对配置 |
| `timeoutMs` | `15000` | 整个审核调用的强制期限 |
| `maxTokens` | `128` | 审核输出上限 |
| `maxToolArgumentChars` | `12000` | 工具参数上限；超限时不截断并失败关闭 |
| `maxUserMessages` | `4` | 当前 turn 的直接用户消息数量上限 |
| `maxUserContextChars` | `8000` | 用户上下文上限；超限时不截断并失败关闭 |

本插件的 bundle 不覆盖 `permission` 行，因此不会替换 profile 已有的权限预设。

## 模型、数据与安全边界

- 人工审批不调用审核模型。智能审批和无人值守会把 workspace 根目录、最小化 shell 字段及当前 turn
  的直接用户纯文本发送给审核 provider。
- 复用当前会话模型便于部署，但不构成独立安全复核；敏感环境应配置独立、受控的 provider 路由。
- 只有已经进入 DSH 审批通道的请求才能被审核；不触发审批的网络或远程操作不在本插件控制范围内。
- 模型分类不是安全证明。未知工具、未知参数、后台执行、非文本或不完整上下文均失败关闭：智能审批转人工，
  无人值守拒绝。
- 每次自动授权只对当前调用有效，不保存目录白名单或永久授权。
- 日志只记录工具名、结果和短原因码，不记录完整提示、参数、凭据或模型推理。
- 智能审批的人工回退和人工审批需要其他 Web、ACP 或自定义人工 answerer；如果不存在，DSH 保持失败关闭。
- DSH 当前只有一个 `workspace-write` 根目录。一次性 Full access 仍拥有宽泛文件系统权限，本插件不会把它
  变成多根目录沙箱。

## 面向维护者与 AI 的仓库地图

| 路径 | 职责 |
|---|---|
| `src/index.ts` | 服务注入、旧会话迁移、投影、命令和生命周期 |
| `src/review-mode.ts` | 独立模式事件、折叠、迁移映射和浏览器投影 |
| `src/client/` | Web 端独立自动审查选择框和客户端插件注册 |
| `src/approval-handler.ts` | 三模式路由、waterfall 决策和审核后模式复核 |
| `src/review-context.ts` | 当前调用与当前 turn 上下文提取和最小化 |
| `src/review-policy.ts` | 确定性的失败关闭前检 |
| `src/llm-reviewer.ts` | 审核提示、流式解析、严格裁决协议和超时 |
| `cordis.patch.yml` | 仅挂载主机插件，不覆盖权限预设 |
| `tests/` | 主机、策略、协议、迁移、投影和浏览器回归契约 |

必须保持的不变量：权限与自动审查状态互不改写；缺失或含糊的证据不能自动放行；只有同一 turn
的直接用户文本可以建立授权；只有严格合法的 `allow` 可以返回 `allowed-once`；人工审批不能检查申请
内容或调用模型；审核期间切换模式必须使原自动放行结果失效。

## 开发

```sh
pnpm install
pnpm test
pnpm run typecheck
pnpm run build
pnpm pack --dry-run
```

支持的 DSH 范围是 `>=0.1.0-rc.5 <0.2.0`。真实 provider 的端到端审核和人工回退交互仍依赖部署凭据
与具体环境验收。

## License

[MIT](LICENSE)
