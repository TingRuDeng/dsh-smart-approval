# DSH 智能审批插件

## 目标

开发一个可独立开源、通过 DSH bundle 安装的智能审批插件。用户显式切换到 `smart-approval` 后，插件复用当前会话模型审核低风险的一次性权限申请；危险、不确定、无法解析或审核异常的请求继续交给现有人工审批渠道，且切换无需重启 DSH。

## 范围

- 单独的 `dsh-smart-approval` npm/GitHub 仓库，不修改 DSH 核心源码。
- 使用现有 `approval/request` waterfall，不替换人工审批实现。
- 新增与 `workspace-write + ask` 绑定的 `smart-approval` 权限预设。
- 默认复用当前会话 provider/model；可选配置独立审核模型。
- 只读取真实 `tool/call` 参数和直接用户消息，不把 Assistant、工具结果或审批理由当作授权。
- 明显破坏性、凭据相关、系统级、安装/外发类请求在调用审核模型前转人工。
- 审核超时、异常、取消、输出不合法或上下文不完整时转人工。

## 不在范围内

- 目录选择器、多工作区管理或 DSH 沙箱的多目录写入扩展。
- 永久授权、全局白名单或自动切换到 `danger-full-access`。
- 拦截本来不经过 DSH 审批通道的操作。
- 修改 DSH 会话事件格式或记录模型思维过程。

## 验收标准

- [x] 非 `smart-approval` 模式完全委托现有审批链。
- [x] 模型仅在严格结构化输出为低风险 `allow` 时返回 `allowed-once`。
- [x] 危险、不确定、敏感、缺少上下文和审核失败路径全部转人工。
- [x] `/permission smart-approval`、`/permission workspace-write` 可在同一会话即时切换。
- [x] 不配置独立模型时使用当前会话路由；独立模型配置必须 provider/model 成对出现。
- [x] bundle 可从本地 checkout 安装，`--dump-config` 能看到插件行和新增预设。
- [x] 单元测试、类型检查、构建和打包检查通过。

## 实施步骤

- [x] 核对 DSH bundle、权限预设、审批 waterfall 和 LLM 接口。
- [x] 创建独立仓库骨架与任务文件。
- [x] 先以失败测试固定结构化裁决和硬风险前检规则。
- [x] 先以失败测试固定会话上下文抽取和人工回退规则。
- [x] 实现 LLM 审核器、审批监听器和运行时配置。
- [x] 增加 bundle patch、安装说明、安全说明和发布配置。
- [x] 执行测试、类型检查、构建、打包与真实 DSH 组合验证。
- [x] 复核文件范围、安全边界和剩余限制。

## 验证方式

- `pnpm test`
- `pnpm run typecheck`
- `pnpm run build`
- `pnpm pack --dry-run`
- 使用临时 `DSH_HOME` 执行 `dsh plugin --profile <name> add <local-checkout>` 与 `dsh --profile <name> --dump-config`

## 回滚

- 会话内切换回 `/permission workspace-write` 或 `/permission read-only`，下一次审批立即不再由插件处理。
- 从 profile 删除 bundle：`dsh plugin --profile <name> remove dsh-smart-approval`。

## Review

- 结论：有条件通过。既定功能与失败关闭边界已实现，没有发现阻止本地试用的问题。
- 自动验证：`pnpm run check` 通过，4 个测试文件共 59 个测试通过；TypeScript 类型检查与 tsdown 构建通过。
- 发布验证：`pnpm pack --dry-run` 通过，包内仅含 bundle patch、构建产物、许可证、manifest 与 README；`pnpm audit --prod` 未发现已知漏洞。
- 组合验证：插件已通过本地 checkout 安装到隔离 profile，`--dump-config` 显示 `smart-approval` 预设和插件行；真实 DSH Loader 启动 5 秒无加载错误后人工中断。
- 未验证项：未使用真实 API Key 跑端到端模型裁决，也未在 Web UI 完成人工回退点击验收；GitHub Actions 要等仓库创建并推送后才有远端证据。
- 固有限制：当前 DSH 仍是单工作区沙箱；bundle patch 会整行替换 `permission.config`，已有自定义 presets 的用户必须按 README 合并。

---

## 2026-08-15 深度审查修复

### 目标

修复深度只读审查中已复现的安全边界缺陷，使所有上下文不完整、协议歧义、权限状态漂移和本地预检异常都可靠回退到人工审批。

### 范围

- 修复流式审核输出的 block 类型混淆和重复 JSON 键绕过。
- 拒绝截断直接用户消息、非文本直接用户内容和不受支持的工具上下文。
- 只向审核模型传递 shell 审批所需的最小参数，剔除模型自述与未知字段。
- 将工作区根目录和有效工作目录纳入敏感路径预检，并补齐常见危险命令别名。
- 消除深层参数递归崩溃，并在审核完成后重新确认权限预设仍然有效。
- 同步实际兼容基线与安全边界文档。

### 不在范围内

- 改变 DSH 的单工作区沙箱模型或新增多目录授权。
- 自动允许 `danger-full-access`，或替用户决定独立审核模型的部署拓扑。
- 创建远端仓库、提交、推送、发布或运行需要真实凭据的端到端审批。

### 验收标准

- [x] 同一流索引不能在 text/reasoning 类型间复用；类型冲突转人工。
- [x] 重复键、额外字段、非法结构的审核输出转人工。
- [x] 直接用户消息超限或含非文本内容时不截断、不送审，直接转人工。
- [x] 审核载荷不包含 `description`、`justification` 或未知工具参数；不支持的工具转人工。
- [x] 工作区根目录、相对/绝对工作目录和危险命令别名在模型调用前完成失败关闭预检。
- [x] 深层参数不会使审批处理器抛出；预检异常转人工。
- [x] 审核期间权限预设变化时不得自动放行。
- [x] 回归测试、类型检查、构建和打包检查通过。

### 实施步骤

- [x] 以失败测试固定审核协议、上下文和审批竞态的回归行为。
- [x] 实现流协议、上下文最小化和本地预检修复。
- [x] 实现处理器异常隔离与权限预设二次确认。
- [x] 同步 manifest、锁文件和 README。
- [x] 执行完整验证并完成独立复核。

### 验证方式

- `node node_modules/vitest/vitest.mjs run`
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/tsdown/bin/tsdown.mjs`
- 使用现有包管理器 CLI 进行 `pack --dry-run`；若环境不可用则报告为未验证。

### 回滚

- 仅回退本节对应的源码、测试、README 与 manifest 范围；不触碰用户其他文件。
- 运行时可切换回 `/permission workspace-write` 或 `/permission read-only`，由原审批链处理后续请求。

### Review

- 结论：有条件通过。已确认的协议绕过、上下文截断/泄漏、路径漏检、递归崩溃和权限预设竞态均有回归测试覆盖，没有发现新的阻止交付问题。
- TDD 证据：首轮新增测试在旧实现上出现 20 个预期失败；危险命令别名和宽/深结构又分别复现 2 个失败；修复后全量 4 个测试文件共 86 个测试通过。
- 静态与构建：Node 24.18.1 下 TypeScript `--noEmit` 退出 0；tsdown 构建成功并生成 4 个产物。
- 打包：`npm pack --dry-run --ignore-scripts` 退出 0，包内 8 个文件；package JSON、两个 YAML 文件和 lockfile importer 对应关系均已解析校验。
- 供应链：CI 三个第三方 Action 已固定到对应 v4 release 的完整 commit SHA；peer compatibility 与本地实际验证统一为 DSH rc.6。
- 未验证项：本机没有 Node 22 和 `dsh` 命令，未重跑 Node 22 CI、真实 DSH profile、真实模型或 Web/ACP 人工回退；受限网络使 pnpm 的供应链策略校验无法完成 registry 查询，远端 CI 仍待仓库推送后验证。
- 剩余风险：shell/PowerShell 字符串前检只能覆盖已知高风险模式；默认复用当前会话模型不构成独立复核；`danger-full-access` 仍是 DSH 的宽权限单次调用。README 已明确这些边界。

---

## 2026-08-15 三模式审批

### 目标

在 Workspace Write 权限范围内提供人工审批、智能审批和无人值守三种明确模式，并将智能审批设为推荐默认值。

### 决策矩阵

| 模式 | 安全请求 | 高风险或不确定 | 明确恶意 |
|---|---|---|---|
| 人工审批 | 转人工 | 转人工 | 转人工 |
| 智能审批 | 自动通过 | 转人工 | 直接拒绝 |
| 无人值守 | 自动通过 | 直接拒绝 | 直接拒绝 |

### 范围

- 扩展审核协议为 `allow | human | reject`，并为明确恶意拒绝定义封闭原因码。
- 让审批处理器按当前 preset 执行三模式矩阵，且审核期间切换 preset 继续失败关闭。
- 保留 DSH `approval: ask`，确保智能和无人值守模式的安全请求仍能进入插件审核。
- 在当前单一 permission preset 选择器限制下，将三个 Workspace Write 模式显示为相邻选项。
- 更新默认 preset、配置、测试和 README。

### 不在范围内

- 修改 DSH 核心前端以增加第二个独立选择器。
- 将普通高风险操作一律判定为恶意。
- 让无人值守模式自动通过高风险、未知或审核失败请求。

### 验收标准

- [x] 人工审批模式完全不调用审核器，所有申请委托现有人工链。
- [x] 智能审批仅自动通过 `allow`，`human` 转人工，`reject` 直接拒绝。
- [x] 无人值守仅自动通过 `allow`，其他结果、上下文失败、前检风险和审核异常均直接拒绝。
- [x] 三模式切换不需要重建处理器；审核期间模式变化不得沿用旧决定。
- [x] `reject` 输出只接受严格 JSON 和封闭的恶意原因码。
- [x] 三个 Workspace Write 模式均保持 `approval: ask`，智能审批为默认 preset。
- [x] 全量测试、类型检查、构建和打包检查通过。

### 实施步骤

- [x] 先以失败测试固定三模式决策矩阵和 `reject` 协议。
- [x] 实现模式感知审批处理器与三态审核协议。
- [x] 更新 bundle presets、运行时配置和使用文档。
- [x] 执行完整验证并完成交付前复核。

### 验证方式

- `node node_modules/vitest/vitest.mjs run`
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/tsdown/dist/run.mjs`
- `npm pack --dry-run --ignore-scripts`（使用 `/private/tmp` 缓存）

### 回滚

- 切回 `workspace-write` 即恢复纯人工审批；移除 `unattended` preset 后不影响现有 read-only/full-access。
- 仅回退本节涉及的处理器、协议、配置、测试和 README，不触碰其他项目内容。

### Review

- 结论：有条件通过。三模式决策矩阵、严格 `reject` 协议、热切换竞态和默认预设均已实现，没有发现阻止本地交付的问题。
- TDD 证据：旧实现上先复现 8 个三模式行为失败，随后复现 2 个审核边界失败和 2 个模式旁路/竞态失败；修复后全量 4 个测试文件共 100 个测试通过。
- 静态与构建：Node 24.18.1 下 TypeScript `--noEmit` 退出 0；tsdown 生成 4 个构建产物。
- 配置与打包：YAML 解析断言确认三个 Workspace Write preset 均为 `approval: ask`、默认值为 `smart-approval`；`npm pack --dry-run --ignore-scripts` 退出 0，包内 8 个文件。
- DSH 集成：在 `deepseek-harness` commit `47f943859bef60e4160492346772ded9b24f765a`（rc.5）上使用隔离 profile 安装本地 bundle；`--dump-config`、真实 Loader、HTTP 首页和 Permissions 菜单均通过。菜单按 Read Only、Manual、Smart、Unattended、Full access 展示，Smart 默认选中，三模式切换均写入对应 `permission/preset` 会话事件。
- 未验证项：隔离 profile 未配置真实 API Key，因此没有触发真实模型裁决、工具授权请求和 Web/ACP 人工审批点击。
- 剩余风险：当前 DSH 仍把沙箱和审批策略合并为一个平铺 preset 选择器；明确恶意依赖受限上下文与审核模型分类，模型误判可能造成拒绝或人工回退，但不会扩大授权。当时插件声明的 peer 基线仍是 rc.6；后续预发布任务已根据 rc.5 Loader/UI 与 rc.6 npm 双重证据调整兼容范围。

---

## 2026-08-15 首个预发布版本

### 目标

将当前实现整理为可追溯、仅支持 Node.js 24+ 的 `0.1.0-rc.1` 预发布版本，并把 GitHub 最新 rc.5 源码与 npm rc.6 发布包纳入明确兼容范围。

### 范围

- 补齐 GitHub 仓库元数据和固定提交安装地址。
- 将包版本调整为 `0.1.0-rc.1`，默认发布到 npm `next` 标签。
- 将 DSH peer 范围调整为 `>=0.1.0-rc.5 <0.2.0`，开发依赖继续固定 rc.6。
- 运行时与 CI 仅声明并验证 Node.js 24+。
- 增加发布前完整检查门禁。

### 验收标准

- [x] manifest、README 和 CI 不再声明 Node.js 22 支持。
- [x] npm 发布默认使用 `next`，发布前自动执行完整检查。
- [x] GitHub 安装地址和包元数据不再包含 owner 占位符。
- [x] peer 兼容范围同时覆盖已验证的 rc.5 源码和 rc.6 npm 包。
- [x] 测试、类型检查、构建、生产依赖审计和打包检查通过。
- [x] Git 工作区无意外生成物，发布 diff 仅包含计划内文件。

### 验证方式

- Node.js 24 下运行 Vitest、TypeScript 和 tsdown。
- `pnpm audit --prod`。
- `npm pack --dry-run --ignore-scripts`。
- 解析 manifest、CI、README 和 lockfile，核对版本、兼容范围及发布清单。

### 回滚

- 发布前可直接回退本节涉及的 manifest、README、CI 和任务记录。
- npm 预发布后不覆盖或删除既有版本；发现问题时发布更高 rc 修复，并将 `next` 指向修复版本。

### Review

- 结论：本地发布准备通过，远端发布待认证。版本已调整为 `0.1.0-rc.1`，npm 默认标签为 `next`，运行时和 CI 仅声明 Node.js 24+。
- 兼容性：peer 范围为 `>=0.1.0-rc.5 <0.2.0`；SemVer 实测接受 rc.5、rc.6 和稳定 0.1.x，不接受 rc.4 或 0.2.0。开发依赖固定 rc.6，Node 类型基线同步为 24.13.3。
- 验证：`pnpm run check` 退出 0，4 个测试文件共 100 个测试通过；类型检查与 tsdown 构建通过；`pnpm audit --prod` 未发现已知漏洞；`pnpm pack --dry-run` 通过且包内仅 8 个预期文件。
- 远端状态（本地准备完成时）：计划使用 `TingRuDeng/dsh-smart-approval`；当时 GitHub 仓库尚未创建且 npm 未登录，因此该阶段未执行推送或发布。
- GitHub 跟进：公开仓库创建后首次 CI 全部通过，但 v4 Action 触发 Node 20 运行时弃用警告；已将 checkout、setup-node 和 pnpm/action-setup 更新为官方 Node 24 release 的固定提交 SHA，需以更新提交的远端 CI 终态为准。

---

## 2026-08-15 独立自动审查选择框

### 目标

修复把自动审查模式错误建模为三个 Workspace Write 权限预设的问题，在输入框中把访问权限与自动审查拆成两个独立选择框，并保持智能审批为默认值。

### 范围

- 恢复 Read Only、Workspace Write、Full access 三个原生权限预设。
- 新增按会话持久化的人工审批、智能审批、无人值守状态及切换命令。
- 新增浏览器端插件，通过 `conversation.input.left` 在访问权限旁边显示独立自动审查选择框。
- 让审批处理器只读取独立审查状态，不再把 permission preset 当作审查模式。
- 为旧版 `smart-approval`、`unattended` preset 会话保留一次迁移语义。
- 同步中英文文档、包清单和发布说明。

### 不在范围内

- 修改 DeepSeek Harness 核心源码。
- 改变既有三模式安全决策矩阵。
- 扩展非 `approval/request` 操作的拦截范围。

### 验收标准

- [x] Permissions 菜单只显示 Read Only、Workspace Write、Full access。
- [x] 输入框中独立显示人工审批、智能审批、无人值守选择框，默认智能审批。
- [x] 切换权限不改变自动审查模式，切换自动审查模式不改变权限。
- [x] 三模式行为和审核期间切换的失败关闭语义保持不变。
- [x] 旧版 preset 会话可映射到对应独立审查模式。
- [x] 单元测试、客户端组件测试、类型检查、构建、打包和真实 DSH Web 组合验证通过。

### 实施步骤

- [x] 先以失败测试固定独立模式折叠、切换、迁移和审批路由行为。
- [x] 实现主机端会话事件、投影、命令和审批模式读取。
- [x] 先以失败测试固定独立选择框渲染与切换行为，再实现浏览器端插件。
- [x] 恢复权限 preset 配置并更新构建、依赖和发布清单。
- [x] 更新中英文 README，执行完整验证和交付前复核。

### 验证方式

- `pnpm test`
- `pnpm run typecheck`
- `pnpm run build`
- `npm pack --dry-run --ignore-scripts`
- 安装本地包到隔离 DSH profile，验证配置、插件图、HTTP 页面和浏览器双选择框。

### 回滚

- 回退本节涉及的会话状态、客户端入口、bundle patch、依赖、测试和文档。
- 运行时可移除插件，原生权限预设及审批链继续工作；不迁移或删除既有会话事件。

### Review

- 根因修复：bundle 不再覆盖 `permission` 行；自动审查改由独立的
  `smart-approval/mode` 会话事件、`approvalReview` 投影和 `/approval-mode` 命令管理。
- 浏览器集成：`conversation.input.left` 新增独立选择框；发布包新增 `dsh.client` 入口和
  `lib/client.js`，版本提升至 `0.1.0-rc.3`。
- 自动化验证：Vitest 6 个测试文件共 105 项通过；`tsc --noEmit`、主机/浏览器双入口
  tsdown 构建、`npm pack --dry-run --ignore-scripts` 均退出 0；干跑包共 11 个预期文件。
- DSH 组合验证：在干净的 DSH `47f943859bef60e4160492346772ded9b24f765a`
  （CLI `0.1.0-rc.5`）隔离 profile 中安装本地包。配置只含三项原生权限，启动页加载
  `dsh-smart-approval/client.js`；无头 Chrome 确认智能审批默认值、两个选择器双向互不改写，
  权限菜单仅为 Read Only、Workspace Write、Full access，控制台无错误。
- 安全复核：当前树与完整 Git 历史的私钥、常见云凭据、GitHub/npm token 和 Bearer token
  特征扫描无匹配；生产依赖审计未发现已知漏洞。未把隔离环境、截图或本机绝对路径打入发布包。
- 剩余风险：未使用真实 reviewer provider 验证模型调用，也未验收实际人工 answerer 的交互；
  这两项依赖部署凭据和具体运行环境，不阻止本次 UI/状态解耦修复。

---

## 2026-08-15 会话事件兼容性修复

### 目标

停止把自动审查模式写入 DSH 会话事件日志，改用 `storage-domain` 会话伴随存储；修复
`smart-approval/mode` 未标记为 ignorable 导致历史会话拒绝加载的问题，并安全恢复已受影响会话。

### 范围

- 将审批模式的权威状态迁移到独立的 storage-domain sidecar，按 Session 生命周期隔离。
- 保留对既有 `smart-approval/mode` 事件和旧权限 preset 的只读迁移能力，不再追加该事件。
- 使用 DSH 已知的 `command/run`/`command/done` 生命周期更新浏览器投影，失败命令不得改变投影。
- 增加回归测试并同步中英文文档、依赖、版本和锁文件。
- 发布修复版本、显式安装到本机 `web` profile，再备份并精确修复目标压缩日志中的 `seq 19216`。

### 不在范围内

- 修改 DeepSeek Harness 核心已知事件表或会话格式。
- 删除、重排或改写目标会话中的其他事件。
- 扫描或批量修改其他会话日志。

### 验收标准

- [x] 新建会话和 `/approval-mode` 切换都不再追加 `smart-approval/mode`。
- [x] sidecar 持久化并恢复 `manual | smart | unattended`，且 Session id 复用时不会继承旧生命周期状态。
- [x] 成功命令更新 `approvalReview` 投影；失败或无效命令不更新。
- [x] 既有 ignorable `smart-approval/mode` 与旧 `smart-approval`/`unattended` preset 可迁移到 sidecar。
- [x] 单元测试、类型检查、构建、打包、隔离 DSH profile 和真实 Web Loader 验证通过。
- [x] 修复版本提交、推送并发布，npm `latest`/`next` 均指向修复版本，本机 profile 安装该明确版本。
- [x] 原始日志有权限为 `0600` 的逐文件备份，备份 SHA-256 等于修复前文件。
- [x] 修复后日志仅在 `seq 19216` 增加 `ignorable: true`，zstd 与 JSONL 校验通过，Web 能加载历史。
- [x] 恢复后审批模式仍为 `smart`，且再次切换不会产生新的未知事件。

### 实施步骤

- [x] 先以失败测试固定 sidecar、命令投影和“零自定义事件写入”行为。
- [x] 实现 storage-domain 模式存储、启动迁移、异步命令写入和审批读取。
- [x] 调整投影折叠、客户端交互、依赖、版本及中英文文档。
- [x] 执行完整本地与隔离 DSH 验证，并做敏感信息和发布包复核。
- [x] 提交、推送、等待 GitHub CI 成功，发布 npm 修复版本并更新 dist-tags。
- [x] 将本机 web profile 更新到明确修复版本并停止 DSH 写入进程。
- [x] 备份、精确修复目标日志，完成结构差异、校验和与 Web 历史验收。

### 验证方式

- `node node_modules/vitest/vitest.mjs run`
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/tsdown/dist/run.mjs`
- `npm pack --dry-run --ignore-scripts`
- 隔离 `DSH_HOME` 安装打包产物并启动 Web Loader，确认 sidecar 与客户端入口加载。
- 对修复前后解压记录做结构化逐事件比较，断言唯一差异为目标事件的 `ignorable` 字段。
- 用真实 `web` profile 加载目标 Session，并检查 sidecar 模式与新增事件类型。

### 回滚

- 源码和发布前改动可按本任务提交整体回退；已发布 npm 版本不删除，改发更高修复版本。
- 本机 profile 可显式重装上一个版本，但在旧版本下不得切换审批模式。
- 会话修复可在 DSH 停止状态下用校验和一致的 `.bak` 文件原子恢复；sidecar 数据与原会话日志分离。

### Review

- 发布：`0.1.0-rc.4` 已推送并发布；GitHub Actions 完整检查通过，npm `latest` 与 `next` 均指向该版本，本机 `web` profile 已显式安装该版本。
- 自动验证：`pnpm run check` 通过，7 个测试文件共 108 项测试通过；类型检查、主机/浏览器双入口构建、打包检查和生产依赖审计通过。
- 会话修复：原始压缩日志以 `0600` 权限逐文件备份且 SHA-256 保持一致；结构化比较确认 2468 条原事件中只有目标事件增加 `ignorable: true`。修复文件保留独立首帧头记录并通过 DSH 自身的 Zstandard 扫描和解压校验。
- 实际验收：真实 Web 页面可完整加载历史，旧模式迁移到 sidecar 后显示智能审批；执行“智能→人工→智能”并重启后仍恢复为智能审批。
- 兼容性：两次模式切换只新增两组 DSH 已知的 `command/run`/`command/done`，重启只新增已知的 `session/end-seed`；没有新增 `smart-approval/*` 事件。
- 安全复核：发布树、完整 Git 历史和打包清单的凭据特征扫描无匹配；仓库记录未写入本机绝对路径、目标会话标识或其他本地敏感数据。

---

## 2026-08-15 基于用户意图的逐请求审批

### 目标

将自动审查从仅支持 Shell 的二元动作判断，重构为面向 `bash`、`pwsh`、`write`、`edit` 的逐请求意图审查。每次权限申请都由独立模型调用结合近期直接用户消息、当前精确动作和只读目标证据重新判断；不把之前的人工或自动决定升级为目录白名单或永久授权。

### 范围

- 为 Shell、完整文件写入和文字替换建立封闭的动作类型与严格参数适配器。
- 从当前消息及有界的近期直接用户历史提取可信授权上下文，并显式标记更早历史是否被省略。
- 使用 DSH 文件系统服务只读解析写入目标、目标类型、符号链接和工作区关系。
- 将模型输出改为风险、授权和意图分类，由本地代码执行人工、智能、无人值守三模式矩阵。
- 保留凭据、系统位置、危险命令、未知工具、超限输入、取消、超时和模式竞态的失败关闭语义。
- 同步测试、配置、依赖和中英文文档；不修改 DSH 核心，不发布 npm。

### 不在范围内

- 不保存目录白名单、动作缓存或跨请求持久授权。
- 不自动审查 `bash`、`pwsh`、`write`、`edit` 之外的未知工具。
- 不新增自定义 Session 事件，不改变双选择框或模式伴随存储。
- 不让模型绕过 DSH 沙箱、文件观察策略或一次性授权语义。

### 验收标准

- [x] 明确授权的普通跨目录 `write`/`edit` 可进入模型审查并返回 `allowed-once`。
- [x] 同一任务中的连续安全写入逐次独立审查，不依赖第一次人工授权，且都可自动通过。
- [x] 当前消息可结合近期直接用户历史理解“继续”“按上面处理”，新约束覆盖旧授权。
- [x] 模型生成的理由、Assistant 内容、工具输出和此前审批结果不能建立用户授权。
- [x] 凭据内容、敏感路径、系统位置、符号链接、未知字段、超限或无法解析的证据不会送审或自动放行。
- [x] 审核器只接受严格的风险、授权、意图和原因码 JSON；本地代码执行三模式决策矩阵。
- [x] 审查期间取消或切换模式时不沿用旧结果；失败路径保持智能转人工、无人值守拒绝。
- [x] 单元测试、类型检查、构建、打包、隔离 DSH 组合测试和真实连续写入验收通过。
- [x] 最终 diff、日志和包内容无调试残留或敏感信息。

### 实施步骤

- [x] 先以失败测试固定 `write`/`edit` 参数、跨轮意图、连续写入和严格分类协议。
- [x] 实现封闭动作适配器与有界可信用户上下文。
- [x] 实现 DSH 文件系统只读目标检查和文件安全前检。
- [x] 实现模型分类协议、本地模式映射和异步竞态复核。
- [x] 更新配置、依赖、中英文 README 和维护者说明。
- [x] 执行完整验证、真实 DSH 验收及交付前复核。

### 验证方式

- `pnpm test`
- `pnpm run typecheck`
- `pnpm run build`
- `npm pack --dry-run --ignore-scripts`
- 在隔离 DSH profile 中验证连续普通写入、敏感目标回退、模式切换和会话历史兼容性。

### 回滚

- 运行时切换为人工审批或移除插件，后续请求立即回到原人工审批链。
- 代码按本任务提交整体回退；由于不新增 Session 事件或持久授权，无需数据迁移。

### Review

- `pnpm run check`：发布前聚合检查退出码 0；8 个测试文件、142 个测试全部通过，类型检查和双入口构建通过。
- `npm pack --dry-run --ignore-scripts`：`0.1.0-rc.5` 包含预期 11 个文件，包大小 54.7 kB。
- 隔离 DSH 组合验收连续发起两次 `write`：会话事件 `21/22` 与 `33/34` 分别记录两次独立的 `approval/asked` 和 `allowed-once`，两份目标文件内容核对通过。
- `pnpm audit --prod`：未发现已知漏洞；当前源码、Git 历史、构建产物及本机路径扫描均为 0 命中。
- `review-gate` 结论：通过。未发现阻止交付的问题；真实 provider 的语义稳定性仍需在实际模型配置中持续观察，任何异常输出都会按模式失败关闭。

---

## 2026-08-16 安全边界文档、变更日志与真实环境验收

### 目标

准确披露文件审批的 TOCTOU 残余风险，提供面向用户的版本历史，并在不读取或输出凭据的前提下验证真实审核 provider 与 Web/ACP 人工回退。

### 范围

- 更新中英文 README 的路径竞态、`workspace-write`、`danger-full-access` 和近期历史分类边界。
- 新增 `CHANGELOG.md` 并将其纳入 npm 发布包。
- 使用现有 Web profile 做真实 provider 安全请求与不确定请求验收。
- 保持两处 `isRecord()` 不变；不提交、不推送、不发布。

### 验收标准

- [x] 中英文 README 准确说明 TOCTOU 窗口和不同权限模式的边界。
- [x] README 准确说明近期历史由模型分类、本地前检与封闭映射共同约束。
- [x] `CHANGELOG.md` 只记录可由 Git 历史核实的用户可见变化，并包含在 npm 包中。
- [x] 真实 provider 对明确安全请求完成逐请求裁决。
- [x] 含历史冲突信号的请求进入 Web 人工回退，且不被插件自动放行。
- [x] 差异、打包、必要代码检查和敏感信息复核通过。

### 实施步骤

- [x] 核对实现、DSH 核心边界、Git 历史和当前 profile 状态。
- [x] 更新中英文 README、`CHANGELOG.md` 和 npm 文件清单。
- [x] 执行文档、打包和代码质量验证。
- [x] 启动真实 Web profile，验证模型裁决和人工回退。
- [x] 完成交付前独立复核并记录 Review。

### 验证方式

- `git diff --check`
- `npm pack --dry-run --ignore-scripts`
- `pnpm run check`
- 使用临时普通文本目标触发真实 provider 自动允许；使用不确定但无破坏性的申请验证人工回退。

### 回滚

- 文档和包清单可按本轮差异整体回退；运行时验收只使用一次性授权和临时普通文本目标，不改变永久权限或 provider 凭据。

### Review

- 文档与打包：中英文 README 已披露 TOCTOU、`workspace-write` 与 `danger-full-access` 的不同边界，并澄清近期历史参与模型分类但不构成持久授权；`CHANGELOG.md` 已加入 npm 文件清单。
- 自动验证：`git diff --check` 退出码 0；`pnpm run check` 通过，8 个测试文件共 142 项测试通过，类型检查和双入口构建通过；使用独立临时 npm 缓存执行 dry-run 打包成功，12 个文件中包含 `CHANGELOG.md`。
- 真实模型：本机 Web profile 使用已配置的独立 reviewer 路由。干净新会话中的明确跨工作区普通文本写入产生 `approval/asked`，随后由插件记录 `allowed-once` 并成功执行，全程未显示人工审批卡。
- 人工回退：含近期历史冲突信号的同类请求未被自动放行，Web 显示“等待审批”及“拒绝/允许一次”；最终取消后事件记录 `cancelled`，未写入目标文件。ACP 没有独立活动 profile，本轮未重复验证 ACP 展示层。
- 环境说明：默认 npm 缓存因历史 root-owned 文件返回 `EPERM`，未修改其权限；改用 `/private/tmp` 下任务专用缓存后打包通过。
- 清理：两次验收的目标文件均不存在，未留下测试产物；未读取或输出 provider 凭据。
- 发布边界：本轮变更记录在 `Unreleased`，当前版本仍是已发布的 `0.1.0-rc.5`；后续发布前必须先提升版本，不能复用 rc.5。
- `review-gate` 结论：有条件通过。未发现阻止本轮交付的问题；ACP 展示层未单独验证，TOCTOU 仍需由未来 DSH 核心原子路径能力进一步收敛。

---

## 2026-08-16 发布 0.1.0-rc.6

### 目标

将已经完成验证的安全边界文档、CHANGELOG 和真实环境验收结果作为 `dsh-smart-approval@0.1.0-rc.6` 提交、推送并发布，使 npm `latest` 与 `next` 同时指向 rc.6。

### 范围

- 将插件版本和中英文安装示例提升到 `0.1.0-rc.6`，保持 DSH peer 范围不变。
- 将 CHANGELOG 的 `Unreleased` 固化为 rc.6 发布记录。
- 完成测试、构建、打包、敏感信息复核、GitHub CI 和 npm registry 验证。
- 提交并推送 `main`，发布 npm rc.6 并更新 `latest`、`next`。

### 验收标准

- [x] `package.json`、README 和 CHANGELOG 版本一致为 rc.6。
- [x] 完整本地门禁、发布包内容和敏感信息检查通过。
- [x] GitHub `main` 远端 SHA 与本地发布提交一致，CI 成功。
- [x] npm 存在 `0.1.0-rc.6`，且 `latest`、`next` 均指向 rc.6。
- [x] 发布后包元数据、文件清单和安装命令复核通过。

### 实施步骤

- [x] 核对 GitHub、npm、作者信息、现有版本和发布恢复策略。
- [x] 更新 rc.6 版本元数据、安装文档和 CHANGELOG。
- [x] 执行完整发布门禁并复核最终 diff。
- [x] 提交、推送并等待 GitHub CI 成功。
- [x] 完成 npm 登录、发布、dist-tags 更新和 registry 复核。

### 验证方式

- `pnpm run check`
- `pnpm audit --prod`
- `npm pack --dry-run --ignore-scripts`
- `git diff --check` 与本轮新增行敏感信息扫描
- `git ls-remote origin refs/heads/main`
- GitHub Actions run 状态与日志
- `npm view dsh-smart-approval@0.1.0-rc.6` 和 `npm view dsh-smart-approval dist-tags`

### 回滚

- npm 已发布版本不删除、不覆盖；发现问题时发布更高的 rc.7 修复，并调整 dist-tags。
- GitHub 使用新提交修复或回退，不强制改写 `main` 历史。

### Review

- 发布提交：`f0ce0ea84ce0bf1bb7df1d0fd7474c96c173a7b4` 已推送到 GitHub `main`，远端 SHA 一致；GitHub Actions run `31936363554` 结论为 `success`。
- 本地门禁：`pnpm run check` 退出 0，8 个测试文件共 142 项测试通过，类型检查和双入口构建成功；`pnpm audit --prod` 未发现已知漏洞；`git diff --check` 通过。
- npm 发布：registry 已收录 `dsh-smart-approval@0.1.0-rc.6`，`latest` 与 `next` 均指向 rc.6；发布包完整性为 registry 返回的 `sha512-WpsDgavBCWbra...Ro9KbR5tJOb2A==`。
- 发布包复核：从 registry 实际下载的 tarball 为 56.1 kB，共 12 个预期文件，包含中英文 README、CHANGELOG、LICENSE、bundle patch、manifest 与构建产物；manifest 版本、作者、Node/DSH 兼容范围和公开发布配置正确。
- 安装与安全：发布包中英文安装命令均固定为 rc.6，未残留 rc.1-rc.5 安装示例；本机绝对路径、私钥头和常见 Token 特征扫描无命中，未读取或输出 npm/provider 凭据。
- 恢复策略：已发布版本不删除或覆盖；若后续发现问题，发布 rc.7 并重新调整 dist-tags。

---

## 2026-08-19 自动裁决持久审计（decision log）方案

状态：已实施（2026-08-19），完整门禁通过。背景：运维排查时只能靠模式侧车加会话事件时间线交叉推断哪些 `allowed-once` 由插件放行——`ctx.logger` 的结果行不落盘，DSH 会话事件 `approval/decided` 不记录裁决者与 reasonCode。对自动审批插件而言"机器自主放行了什么"应当可查。

实施记录与偏差：① 唯一未知数（同版本旧介质加表可开）已用两层测试钉死——真实 `JsonStorageBackend` 介质测试（tests/medium-open.spec.ts）+ 真实 `DomainFacility` 全链路测试（cordis Context → Storage hub → json backend → facility.open 新 spec → 旧 mode 行可读 → decisions 追加 → 重开仍在），退路方案未启用。② `SmartApprovalLogRecord` 除 mode/callId 外增加 `session` 字段：决策行以 Session 生命周期为键，log 回调是唯一咽喉点，session 必须随记录传递。③ 条目 `mode` 为可选字段：mode 解析器自身抛错（mode-error 路径）时无 mode 可记，此时命令输出省略 `[mode]` 段；正常路径 mode 始终在。④ 隔离 profile 冒烟仅完成到"树合成 + 存储行挂载"：无 provider 凭据且无头 CLI 无可见输出，未能驱动真实会话裁决；该验证项由真实 backend/facility 测试替代覆盖，留待有凭据环境复核。

### 目标

让插件的每次自动裁决成为可查的持久记录，会话内一条命令即可审计；保持"不落敏感内容"的日志红线不变。

### 范围

- 在现有 `smart_approval` storage-domain 中新增 `decisions` 表（独立于 mode 行：mode 行是每次审批的热路径读，保持最小；新旧插件版本混跑互不干扰；zod 校验边界互不影响）。
- 行结构：`{ session: { createdAt, cwd? }, entries: [{ time, toolName, outcome, reasonCode, mode, callId? }] }`，环形缓冲上限 N（默认 50）。生命周期指纹与 mode 行同规则，不匹配即整行覆盖重建。
- 域 `version` 保持 0 不变：`DomainSpec.version` 语义是"介质版本不同直接拒开"，提版本会让现有 `smart_approval.json` 拒开；同版本加表在旧介质中只是无数据，实施时用测试钉死可开。
- 写入挂钩唯一咽喉点 `index.ts` 的 `log` 回调（`approval-handler.ts` 全路径经 `safeLog`）：`SmartApprovalLogRecord` 增加 `mode`（handler 已持有 `selectedMode`）与 `callId?`（`ApprovalRequest.callId`，纯 ID 无敏感性）；写入 fire-and-forget（`void store.append(...).catch(() => {})`），审计失败绝不影响审批结局——审计是旁路不是门禁。
- 追加用 `KvTable.update()`（同域写链原子）；`update()` 对缺失键 reject，故首条 `put`、后续 `update` 两段式。
- manual 模式在 handler 首行 `return next()`，天然不进 `safeLog`：decisions 表只含插件参与的裁决；表中 `human` 行意为"插件转人工"，人工终局仍以会话事件为准，`callId` 为两边对账连接键。
- 新增 `/approval-log` 命令（与 `/approval-mode` 同一 `ctx.inject(['commands'])` 作用域并列注册）：无参数默认最近 10 条，`/approval-log 30` 最近 30 条；输出仅 `时间 工具 结局 (reasonCode) [mode]`，无参数无路径正文；空表输出 `no automatic decisions in this session`。
- `Config` 增加 `decisionLogSize`（step 1、min 0、默认 50；0 = 完全关闭：不写表、命令返回 disabled）。
- 中英文 README 安全边界节补充：审计仅含 outcome/reasonCode/toolName/callId，不含参数与模型输出，`decisionLogSize: 0` 可关；CHANGELOG 新条目，随 rc.7 基线的下一版本发布。

### 不在范围内

- 不新增 Session 事件类型（rc.4 的既定架构决策）。
- 不写独立日志文件，不绕过 DSH 存储约定。
- 不记录参数、提示词、模型推理；不做跨会话聚合报表。
- 不改变 `ctx.logger.info` 现有输出（运维实时可见性保留）。

### 验收标准

- [x] smart/unattended 每次裁决后 `/approval-log` 立即可见对应行。
- [x] manual 模式全程零写入。
- [x] 注入审计写入故障时审批结局不变。
- [x] 旧 `smart_approval.json`（version 0、仅 sessions 表）升级后正常打开，mode 行原样可读。
- [x] 环形上限生效（第 N+1 条挤掉第 1 条）；`decisionLogSize: 0` 关闭行为正确。
- [x] 存量 142 项测试与新增测试全绿，`pnpm run check` 通过。

### 实施步骤

- [x] 先以失败测试钉死：同版本旧介质加新表可开、有界追加、生命周期重建、首条 put/后续 update。
- [x] 扩展 `review-mode-storage.ts`（decisions 表 + append/list）与 `SmartApprovalLogRecord`。
- [x] `index.ts` 挂钩 log 回调、注册 `/approval-log`、新增 `decisionLogSize` 配置。
- [x] 扩展 approval-handler/plugin 测试：mode/callId 传递、manual 零写入、故障不影响结局、命令输出。
- [x] 更新中英文 README 与 CHANGELOG，执行完整门禁。

### 验证方式

- `pnpm test`
- `pnpm run typecheck`
- `pnpm run build`
- 隔离 DSH profile：smart 模式触发若干自动裁决后 `/approval-log` 核对；切 manual 再触发审批核对零新增；重启 DSH 后记录仍在。

### 回滚

- 特性由 `decisionLogSize: 0` 运行时关闭；代码按本任务提交整体回退。
- decisions 表数据为旁路审计，删除或忽略均不影响审批与模式功能，无迁移义务。

### 风险与兜底

- 同版本加表的打开语义为唯一可能改变方案形态的未知数，实施第一步先验证；若实测拒开，退路是把 entries 挂到 mode 行的可选字段（次优但可行）。
- 写放大：每次自动裁决一次 KV put、50 条环形上限，可忽略。
- 隐私：字段白名单在 zod schema 层硬编码，结构上放不进敏感内容。
