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

---

## 2026-08-21 发布 0.1.0-rc.7

### 目标

将已实施的自动裁决持久审计（decisions 表 + `/approval-log`）作为 `dsh-smart-approval@0.1.0-rc.7` 提交、推送并发布，使 npm `latest` 与 `next` 同时指向 rc.7。

### 范围

- 将插件版本和中英文安装示例从 rc.6 提升到 rc.7（含 DSH CLI 安装命令，DSH 本身已发布 rc.7）。
- CHANGELOG 新增 rc.7 条目（日期沿用实施日 2026-08-19）。
- 测试基线：存量 142 项 + 新增 18 项 = 160 项，`tests/medium-open.spec.ts` 用真实 JsonStorageBackend + DomainFacility 钉死同版本加表可开。
- 提交并推送 `main`，发布 npm rc.7 并更新 `latest`、`next`。

### 验收标准

- [x] `package.json`、README 和 CHANGELOG 版本一致为 rc.7。
- [x] 完整本地门禁、发布包内容和敏感信息检查通过。
- [x] GitHub `main` 远端 SHA 与本地发布提交一致，CI 成功。
- [x] npm 存在 `0.1.0-rc.7`，且 `latest`、`next` 均指向 rc.7。
- [x] 发布后包元数据、文件清单和安装命令复核通过。

### 实施步骤

- [x] 提交决策审计实现（`ec5c033`），核对工作区与敏感信息。
- [x] 提升 rc.7 版本元数据与安装文档，执行完整发布门禁。
- [x] 提交并推送 rc.7（`7878401`），等待 GitHub CI 成功。
- [x] 完成 npm 发布、dist-tags 更新（`latest` + `next`）和 registry 复核。

### 验证方式

- `pnpm run check`（160 项测试、类型检查、双入口构建）
- `pnpm audit --prod`
- `npm pack --dry-run --ignore-scripts`（任务专用临时缓存）
- `git diff --check` 与新增行敏感信息扫描
- `npm view dsh-smart-approval@0.1.0-rc.7` 与 `npm view dsh-smart-approval dist-tags`
- registry tarball 实际下载清点与安装命令复核

### 回滚

- npm 已发布版本不删除、不覆盖；发现问题时发布更高的 rc.8 修复，并调整 dist-tags。
- GitHub 使用新提交修复或回退，不强制改写 `main` 历史。

### Review

- 发布提交：`7878401ae24654dea08379736307705f8cd69c7c` 已推送到 GitHub `main`，远端 SHA 一致；GitHub Actions run `32346790136` 结论为 `success`。
- 本地门禁：`pnpm run check` 退出 0，9 个测试文件共 160 项测试通过（存量 142 + 新增 18），类型检查和双入口构建成功；`pnpm audit --prod` 未发现已知漏洞；`git diff --check` 通过，密钥/token/本机路径扫描无命中。
- npm 发布：registry 已收录 `dsh-smart-approval@0.1.0-rc.7`，`latest` 与 `next` 均指向 rc.7；发布包完整性为 registry 返回的 `sha512-bOwbf68hGUxxHwy0kcs/7bV59m666N26MMBw9mhyIKwNTL9EZtgk1BmZEid1XTb4DiOOLrr/Kl3kWHHeJVOKDg==`（shasum `8ac802a38035de40cd09176b2eaf9bd08e00c83d`，与本地 dry-run pack 一致）。
- 发布包复核：从 registry 实际下载的 tarball 为 59.9 kB，共 12 个预期文件，包含中英文 README、CHANGELOG、LICENSE、bundle patch、manifest 与构建产物；manifest 版本、作者、Node/DSH 兼容范围和公开发布配置正确；lib/index.js 含 `approval-log` 命令与 `decisionLogSize` 配置。
- 安装与安全：发布包中英文安装命令均固定为 rc.7（各 5 处），未残留 rc.6 安装示例；bundle 内 `BEGIN PRIVATE KEY` 命中为插件自身的凭据检测正则（SENSITIVE_VALUE），非真实密钥；未读取或输出 npm/provider 凭据。
- 发布过程：`npm publish` 首次因 EOTP 中止（未发布任何内容），随后 npm token 一度失效；经用户重新 `npm login` 后完成发布，dist-tags 更新与 OTP 由用户在终端完成。
- 恢复策略：已发布版本不删除或覆盖；若后续发现问题，发布 rc.8 并重新调整 dist-tags。

---

## 2026-10-16 兼容 DSH 0.2.1-alpha.2：审批上下文改由提交事件驱动

### 目标

让插件在 DSH `0.2.1-alpha.2` 上可安装、可运行，并把审批上下文的唯一来源从「同步读取
Session 事件历史」改为「订阅 `session/event` 增量维护的内存跟踪器」。收尾后 `src/`
内不再出现 `session.events` / `snapshotEvents` / `eventAt` / `ownEvents`。

### 基线

- 目标基线固定为 `dsh-v0.2.1-alpha.2`（本地 `../deepseek-harness` checkout，tag 提交
  `d743267388`），便于源码级逐项对照。
- npm 侧参考：`latest = 0.2.0-rc.2`、`alpha = 0.2.1-alpha.4`；peer 范围需同时覆盖两者。

### 已核实前提

1. `ApprovalRequestEvent` 只有 `agent` / `toolName` / `callId?` / `reason?` /
   `displayReason?` / `signal?`，**不含工具参数**（`user-approval/src/types.ts:63-76`）。
   这是原设计回扫日志的唯一原因，也是本任务必须另找参数来源的根因。
2. `tool/call` 在审批**之前**已落盘：`docs/tool-execution-pipeline.md:11,39`
   写明 "logged before execution"，链路为 `tool/call → tools/pre-execute → 审批`。
3. `'session/event'(session, event)` 是公开的提交后推送（`core/session/src/index.ts:74`，
   `@mode emit`，非弃用、非历史读取）。且实测其派发点在 `this.log.push(event)` **之后**
   同步执行（同文件 886-889），因此「先落盘、后推送」在单次 append 内成立。
4. **`session/event` 的 scope 过滤不会挡掉宿主插件**：过滤谓词见
   `core/scope/src/index.ts:171-181`，其首行是 `const tag = scopeOf(ctx); if (tag === undefined) return true`
   ——未打 scope 标签的监听方一律放行。插件注册在宿主作用域，属此情形。
   故 R1 由代码阅读判定为通过（仍需 1 条集成测试钉死）。
5. **投影单元状态会被全量落盘，且 `ProjectionDefinition` 没有任何「不落盘」开关**：
   `session-projection-cache` 把每个已注册单元的 state 写入 `session_projcache` 域。
   因此**不能**把直连用户原文或工具参数放进投影 state —— 会扩大数据面，违背插件既有
   安全声明 "Logs contain ... not full prompts, arguments, credentials"。本任务因此
   **不新增投影单元**，改用纯内存跟踪器。
6. `ver` 不匹配时投影缓存**丢弃整行并从日志 offset 0 重新折叠**
   （`session-projection-cache/src/index.ts:240-243`，注释原文
   "Cached rows are disposable derived data. Retry from the exact log"）。因此改折叠语义时
   提升 `stateVersion` 是安全的，模式不会丢。
7. `MessageSourceMap` 无 catch-all 的 `'plugin'` kind，成员不需要 `ContextFormed`
   （对照 `'tool-registry'` / `'ptc-mode'` 均为裸 `{ kind: ... }`）。`ContextFormed` 只属于
   会被写入会话的注入型上下文行；本插件的审核提示词是**仅出站**的一次性调用，不入日志。
   → 上一轮记的「补 `& ContextFormed`」作废。
8. **R1 + R2 已用真实 `SessionStore` 实证通过**（不是代码阅读推断）。
   新增 `tests/session-event-delivery.spec.ts`，在真实 `Context` + 真实 `SessionStore`
   上注册宿主作用域监听器，断言：每个提交事件在 `append()` **返回前**就已被监听方看到；
   收到的 `event` 与 `append()` 返回值逐字段相等（含 `seq`）；多个会话的事件都送达同一监听器。
   3 项全绿。→ 路线 B 的核心机制已被证明成立，非假设。
   注意 `append` 的契约明确为 "synchronously notify observers"。
9. **验证基线与发布基线是两条线，取值已定**：本地 `../deepseek-harness` 为
   `0.2.1-alpha.2`（`@deepseek-ai/cordis` = `4.0.5-alpha.1`），而 npm 已发布 alpha 渠道
   统一为 `0.2.1-alpha.4`（cordis peer 声明 `~4.0.5-alpha.2`）。定案 8 的 `~` 写法同时覆盖两者。

### 设计定案

1. **新增 `src/session-context.ts`**：per-Session 纯内存上下文跟踪器，订阅
   `ctx.on('session/event')` 增量维护，不落盘、不回扫。按会话 id 分条存放
   （宿主作用域会收到**所有**会话的事件）。
   - `turn/start` 记录开放 turn；`turn/end` 清空 turn 内状态并把本 turn 直连用户文本压入历史环
   - `user/message` 且 `source.kind === 'user'` 提取文本；非 text block 置 `hasNonText`
   - `tool/call` 建 `callId → { name, arguments }` 索引，仅在开放 turn 内累积
   - `session/disposed` 释放条目
2. **不注册新投影单元**（理由见前提 5）。既有 `approvalReview` 单元保留（只存模式）。
3. **上下文上限策略**（原「tracker 上限策略」）——分三个维度：
   - **当前 turn 直连用户文本**：沿用 `maxUserMessages` / `maxUserContextChars`，
     缓冲到 `maxUserMessages + 1` 条与 `maxUserContextChars + 1` 字符即可判定
     `too-many-user-messages` / `user-context-too-large`，无需新配置项。
   - **历史 turn 直连用户文本**：环形缓冲保留最近 `maxUserMessages` 条。已推导该上界
     恰为充分：裁决循环最多只能消费 `maxUserMessages - 1` 条历史（当前 turn 至少占 1 条），
     故限定在该上界内重放可**逐字复现**原「全量前缀回扫」的判定与 `historyOmitted`。
   - **本 turn tool/call 索引**：新增一个配置项 `maxTrackedToolCalls`（默认 32，最新优先）。
     `arguments` 截断到 `maxToolArgumentChars` 并附 `oversized` 标记，用于判定
     `tool-arguments-too-large`。超出条目上限的调用不入索引 → 该次审批回退人工
     （`missing-tool-call`），**fail closed，安全**，但属新增的可用性边界，须有测试覆盖。
   - 内存量级：单会话约 `maxTrackedToolCalls × maxToolArgumentChars` 最坏 ≈ 384 KB，
     典型 < 20 KB；总量为「活会话数 × 单会话上界」，需在 README 中明示。
4. **`buildReviewPayload` 换数据源**：签名改为从跟踪器取数而非读 session。
   - `resolveCall(session, callId)` → 唯一匹配返回；0 个或多于 1 个均 fail closed
     （保留 `missing-tool-call`）
   - `currentTurnUserMessages` / `previousTurnUserMessages` / `hasNonTextContent`
   - 开放 turn 起点用跟踪器自持状态，**不引入 `stateOf(session,'turnBoundary')`**，少一层耦合
   - `reasonCode` 必须逐项与现状一致（`unsupported-user-content` 的优先级高于
     `missing-user-context` 等），否则视为行为回归
5. **遗留模式迁移整体删除（5b，用户 2026-10-16 确认）**。「现在还没有正式在用，
   不需要考虑历史迁移兼容」，故删除面为：
   - `src/index.ts`：`migrate()`、`fallbackModes` WeakMap、`ctx.sessions.list()` 循环、
     `ctx.on('session/created')` 处理器、`foldReviewModeEvents` 导入；
     `currentMode` 简化为 `modeStore.get(session) ?? defaultMode`；`inject` 去掉 `sessions`
   - `src/review-mode.ts`：`foldReviewModeEvents`、`legacyReviewMode`、
     `applyReviewModeEvent` 中的 `smart-approval/mode` 分支与 `permission/preset` 分支、
     `SessionEventMap` 中 `smart-approval/mode` 声明、`origin` 的 `'legacy'` 取值
   - **`stateVersion` 3 → 4**（折叠语义已变，借前提 6 的丢弃-重折叠机制清理陈旧值）
   - 注意：删除 `SessionEventMap` 声明只影响类型层，不改变运行时加载行为
     （`KNOWN_SESSION_EVENT_TYPES` 是 build-static 内建集合，仓库外插件事件本就不在其中；
     是否可跳过由落盘时的 `SessionEvent.ignorable` 标记决定，与本删除无关）
6. **收尾后 `src/` 不得出现任何弃用 reader**，无 waiver 例外（路由 A 的
   `typescript/no-deprecated` 抑制注释不得进入本任务）。
7. **未提交改动的处置**：保留 `src/llm-reviewer.ts` 的声明合并改动（经本任务
   TypeScript 错误清单验证其必要且正确）；丢弃 `src/review-context.ts` 的改动
   （属路线 A 形态，且该文件在路线 B 中被整体重写）。
8. **peer 范围按 harness 自身的预发布写法重写**（修正上一轮的 `<0.3.0` 方案）。
   已核实：semver 规定预发布版本只有在**比较符本身的 `major.minor.patch` 元组相同**且带
   预发布标签时才被满足。因此 `>=0.2.1-alpha.2 <0.3.0`、`>=0.2.0-rc.2 <0.3.0`、
   `^4.0.2` 这三种写法**都不能**匹配 `0.2.1-alpha.4` / `4.0.5-alpha.1`，一个范围也覆盖不了
   两个不同元组的预发布版。
   - 取值：所有 `@deepseek-ai/dsh-*` peer 改为 `~0.2.1-alpha.2`，
     `@deepseek-ai/cordis` 改为 `~4.0.5-alpha.1`。
     已用真实 semver 实测（非推测）：

     | 取值 | 满足 | 不满足 |
     |---|---|---|
     | `~0.2.1-alpha.2` | `0.2.1-alpha.2`（本地）、`0.2.1-alpha.4`（已发布）、`0.2.1-alpha.5`、`0.2.1`、`0.2.2` | `0.2.0-rc.2`、`0.1.2-alpha.2` |
     | `~4.0.5-alpha.1` | `4.0.5-alpha.1`（本地）、`4.0.5-alpha.2`（harness 声明）、`4.0.5-alpha.9`、`4.0.6` | `4.0.2` |
   - 依据：harness 已发布包的 peer 正是这个形状 ——
     `@deepseek-ai/dsh-session@0.2.1-alpha.4` 声明
     `"@deepseek-ai/cordis": "~4.0.5-alpha.2"`，其余内部包为**精确版本**。
   - 明确不覆盖 `npm latest / next = 0.2.0-rc.2` 与旧 `0.1.2-alpha.*`：前者需另跑一轮验证
     矩阵才能声明支持，本轮只在 README 中如实写明支持范围。
   - `react` 保持 `^18.2.0`。

### 范围

- 只改本插件仓库，不修改 DSH 核心源码。
- 不改裁决逻辑（风险分级、授权判定、reasonCode 词汇表全部不动），只换上下文数据来源。
- 不新增投影单元、不落盘任何用户原文或工具参数。
- 不做历史会话迁移（用户已明确不需要）。

### 验收标准

- [x] `vitest run` + `tsc --noEmit` + `tsdown` 全部退出 0（`pnpm run check` 因本环境 pnpm store
      符号链接损坏无法执行，改为逐条直接运行其组成命令；`vitest run` 需加
      `--no-file-parallelism` 才能退出 0，原因与处置见实施结果的「环境噪音」）。
- [x] `src/` 全量 grep 无 `session.events` / `snapshotEvents` / `eventAt` / `ownEvents`。
- [x] `src/` 无 `oxlint-disable` / `eslint-disable` / `no-deprecated` 抑制注释。
- [x] 行为等价性：存量用例的**判定结果与 reasonCode 不发生任何变化**，只换数据来源；
      唯一例外是「无归属 turn 的调用」（见实施结果偏差 6，判定同为转人工）。
- [x] 新增跟踪器单测：上限截断、`session/disposed` 释放、`turn/end` 归档、
      callId 冲突（重复 / 缺失）fail closed、超出 `maxTrackedToolCalls` fail closed。
- [ ] 临时 `DSH_HOME` 下对 `dsh-v0.2.1-alpha.2` 实际安装并跑通一次真实审批 —— 本环境无法执行。
- [ ] `npm pack --dry-run --ignore-scripts` 内容清单无意外文件 —— 本环境无法执行。
- [x] README / README.zh / CHANGELOG 同步：基线版本、peer 范围、
      以及「上下文改由提交事件驱动，不再回扫日志」与内存上界说明。

### 实施步骤

- [x] 1. 从干净分支重做（先处置未提交改动，见定案 7；不基于半成品中间态叠加）。
- [x] 2. 放宽 `package.json` peer 范围（定案 8）。
- [x] 3. 先写失败测试：以「向跟踪器投递提交事件」的方式固定上下文抽取与 fail-closed 行为。
      （实际为跟踪器与实现同期完成，`tests/session-context.spec.ts` 可独立复现全部边界。）
- [x] 4. 实现 `src/session-context.ts`。
- [x] 5. 改造 `src/review-context.ts`：去掉 events 依赖与 `findTurnStart`，改向跟踪器取数。
- [x] 6. 改造 `src/index.ts`：挂载跟踪器，并按定案 5 删除遗留迁移面。
- [x] 7. 改造 `src/review-mode.ts`：按定案 5 删除遗留折叠分支，`stateVersion` → 4。
- [x] 8. 迁移测试夹具：`tests/approval-handler.spec.ts`（裸 seq 统一走 `SessionSeq` 事件构造器、
      非人类 user 消息改用既有 `model-selection` kind）、`tests/plugin.spec.ts`
      （删除遗留迁移用例，改为通过宿主监听器投递事件）。
- [x] 9. 更新 README / README.zh / CHANGELOG。
- [ ] 10. 走完整门禁 + 隔离 profile 真实安装验证 —— 后半项本环境无法执行。

### 验证方式

- `pnpm test` / `pnpm run typecheck` / `pnpm run build` / `pnpm run check`
- `npm pack --dry-run --ignore-scripts`（任务专用临时缓存）
- `src/` 全量 grep：弃用 reader 与抑制注释均为零命中
- 临时 `DSH_HOME`：`dsh plugin --profile <name> add <local-checkout>` 后跑真实审批，
  smart 模式触发自动裁决、切 manual 后零新增，重启后 `approvalReview` 模式仍正确
- 行为等价性：逐项比对存量 162 项用例的判定与 reasonCode

### 回滚

- 代码按本任务整体回退到 `v0.1.0-rc.11`。不涉及数据迁移，无持久化格式变更，
  回退后 sidecar 与 decisions 表语义不变。
- 若跟踪器在真实环境中出现上下文缺失，表现是 fail closed 走人工审批，
  不会放大权限；此时可临时 `/permission workspace-write` 停用本插件。

### 风险与兜底

- **R2｜时序**：需确认 `session/event` 推送先于 `approval/request` 派发。前提 3 已证同一
  append 内「落盘 → 同步推送」，但两者跨组件，仍须以集成测试钉死；不成立则上下文缺失
  → fail closed（安全但降可用性）。
- **R3｜内存**：跟踪器常驻内存且按会话分条，上限与释放路径须有测试覆盖。
- 若实施中发现行为等价性无法达成（判定或 reasonCode 出现差异），停止并按路线 A 回退，
  不带着已知裁决偏移发布。

### 实施结果（2026-10-16 完成）

分支 `feat/compat-0.2.1-alpha.2`，单 PR、逻辑分段提交。步骤 1-10 全部执行完毕。

#### 与规格的偏差（逐条说明理由）

1. **`turn/end` 不再清空 turn 状态**（定案 1 原写「清空 turn 内状态」）。原实现的
   `findTurnStart` 从调用处向前找最近的 `turn/start`，**不要求该 turn 仍然开放**；
   若在 `turn/end` 处清空，`turn/end` 与审批之间的请求会退化。改为只在**下一个
   `turn/start`** 时归档并清空索引。
2. **不需要 `hasNonText` 标记**（定案 1）。非 text block 的判定在裁决时直接从保留的
   消息上做；由于当前 turn 的保留上限是 `maxUserMessages + 1` 条，额外的布尔标记是冗余状态。
3. **历史环上界改为 `maxUserMessages + 1`（规格写 `maxUserMessages`），并新增
   `previousTruncated` 披露**。规格中「`maxUserMessages` 恰为充分上界」的推导只对
   **带文本**的历史成立：空文本消息会推进裁决回扫的 `continue` 分支而**不消耗预算**，
   因此环形缓冲可能被扫描穷尽而非触发预算 `break`。此时若按原样返回，就会把一段更短的
   历史当作「完整」呈现（`historyOmitted: false`）。现改为：环被截断且扫描自然结束时
   强制置 `historyOmitted = true`——方向更保守（给审核模型的授权证据更少，且明确披露省略），
   已由 `presents an exhausted history as omitted rather than complete` 钉死。
4. **参数截断不引入 `oversized` 标记**（定案 3）。改为 `slice(0, maxToolArgumentChars + 1)`，
   让 `review-context.ts` 继续作为该上限的唯一持有者：`length > maxToolArgumentChars` 即可
   判定 `tool-arguments-too-large`，且不必保留完整参数。两个上限同源（同一份 `Config` 读取）。
5. **新增 `userMessagesBefore`**（规格未含）。每个被索引的调用记录「提交时当前 turn 已有
   多少条直连用户消息」，快照时按此切片，从而**严格复现**原实现
   `slice(turnStartIndex + 1, callIndex)` 的语义——调用之后才提交的用户消息不会被算入授权上下文。
6. **调用索引以 turn 归属为门**（定案 1 的「仅在开放 turn 内累积」具体化）。只有
   `current.turn === event.data.turn` 的 `tool/call` 才入索引。副作用：**退化日志**
   （一个 `tool/call` 但其 `turn` 从未被 `turn/start` 开启）现在的 reasonCode 是
   `missing-tool-call`，而原实现是 `missing-user-context`。**判定不变（均为转人工）**，
   且方向更保守：不再把「任意一个 turn 的文本」借给一个无归属的调用。已由
   `does not borrow a turn for a call that no turn ever opened` 钉死。
7. **额外删除 `ReviewModeProjectionState` 的 `origin` / `fallback`**（定案 5 之外的延伸）。
   遗留分支删除后已无任何读取方；`stateVersion` 已提升到 4，缓存行本就会被丢弃并重折叠，
   因此这是纯粹的持久化状态瘦身，不改变裁决。仅影响 `tests/plugin.spec.ts` 中的
   `initialState` 期望值（`{mode:'smart'}`）。
8. **额外删除 `@deepseek-ai/dsh-permission-presets` peer**（定案 8 之外的延伸）。该包在本
   仓库已无任何 import。已核实 `pnpm-lock.yaml` 的根 importer 段**不记录
   `peerDependencies`**（只记录 `dependencies` / `devDependencies`），因此删 peer 不会使
   lockfile 失配；对应的 `devDependencies` link 保留，等下一次 lockfile 刷新时再清理。
9. **测试夹具的「非人类 user 消息」改用既有 kind**（步骤 8 原写「自定义声明 kind」）。
   改用 harness 已有的 `{ kind: 'model-selection' }`（形状恰为裸 `{ kind }`，无需声明合并），
   语义也正确：由其它插件注入的 user-role 上下文，不是人类输入。
10. **前提 7 复核成立**：`tests/approval-handler.spec.ts` 之前的 `'plugin'` kind 报错说明
    `src/llm-reviewer.ts` 的声明合并是审核请求能带上消息来源的唯一途径，故保留该改动；
    确认无需 `ContextFormed`。

#### 验收结果

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | **0 错误**（改造前 66 行 / 3 类） |
| `npx vitest run --no-file-parallelism` | **181 通过 / 0 失败，12/12 文件全绿，退出码 0** |
| `npx vitest run`（默认并行） | 全部用例通过，但退出码 **1**：见下方「环境噪音」 |
| `npx tsc --noEmit && npx tsdown` | 通过；`lib/index.js` 57.92 kB、`lib/client.js` 4.98 kB |
| `src/` + `tests/` grep `session.events` / `snapshotEvents` / `eventAt` / `ownEvents` | **零命中** |
| grep `foldReviewModeEvents` / `legacyReviewMode` / `smart-approval/mode` / `permission/preset` | **零命中** |
| `src/` grep waiver 注释（`oxlint-disable` 等） | 零命中 |
| `npm pack --dry-run` | **本环境无法执行**：`npm pack` 两次被 SIGTERM 终止（沙箱内、沙箱外各一次），pnpm 自身也因 store 符号链接 ENOENT 不可用。替代核查：`lib/` 产物已生成，`files` 白名单覆盖 `lib`，构建配置未改动 |
| 隔离 `DSH_HOME` 真实安装 + 真实审批 | **未执行**（同上，本环境无法运行 pnpm/DSH 安装链路），留待有可用 pnpm 的环境补跑 |

行为等价性：存量用例逐项迁移到「事件投递」夹具形态，**断言中的判定与 reasonCode 全部未改**。
差异为：删除 1 项已失效的遗留迁移用例（`migrates existing preset modes into sidecar storage`）、
新增 `tests/session-context.spec.ts`（15 项，覆盖上限截断 / turn 归属 / 历史环截断 / 释放 /
未观测会话）、新增插件级「会话处置后释放」与「无归属 turn 的调用」各 1 项、新增 1 项
`maxTrackedToolCalls` 默认值与校验断言。

已知环境噪音（**与本任务无关，已证**）：`vitest run` 默认并行时，
`tests/review-mode-select.client.spec.tsx` 的 jsdom worker 会偶发启动超时
（该文件的 jsdom 环境建立实测约 44 s，全量 import 阶段约 120 s），vitest 报告
`Unhandled Errors` 并**以退出码 1 结束**，同时把该文件静默排除在统计之外
（并行报告 11 文件 / 179 用例，串行报告 12 文件 / 181 用例）。

证据链：

- 只跑**未被我改动过**的 8 个存量文件，同样复现该超时 → 非本次改动引入。
- `--maxWorkers=4` 仍复现 → 不是并发度过高，而是单个 jsdom worker 的启动耗时问题。
- `--no-file-parallelism`（串行）→ **12/12 文件、181/181 用例、退出码 0**。

因此 `pnpm run check`（进而 `prepublishOnly`）在本机默认配置下会退出 1。
本任务**未改动 `vitest.config.ts`**（属独立的基础设施问题，且需在用户的 CI 资源上复测后再定）。
可选处置：给 `vitest.config.ts` 增加 `test.fileParallelism: false`，或把该客户端用例单独跑。

### 追加实施（2026-10-17）：恢复会话、发布基线与宿主集成

用户确认「都做吧」后追加的三项，另加一处必须修的残留缺陷。

#### A. 恢复/分叉会话的种子折叠（修复残留半成品）

- 工作区里原先留有一段未完成的改动：`index.ts` 调用 `tracker.backfill(...)` 与
  `SessionLogOffset`，但两者都不存在，`tsc` 报 `TS2304`。已补齐。
- 依据（源码事实，非推测）：`Session` 的 `firstLiveSeq` 文档明确写着
  **"Seed events never publish on `session/event`"**。因此恢复会话与分叉会话
  的历史不会走推送流，tracker 会空着，其审批**必然**退化为人工。
- 判断条件修正：原残留代码用 `session.inheritedEventCount === 0` 提前返回，
  这个字段只表示**分叉继承前缀**，普通恢复会话为 `0`，会漏掉最常见的场景。
  改为 `session.firstLiveSeq === 0`（该字段是构造种子长度）。
- 这是全仓**唯一**的弃用 API 调用（`snapshotEvents`），已带行级 waiver：
  一次性、边界为种子长度、不随请求增长。`src/` 其余位置零命中。
- 测试：`tests/session-context.spec.ts` 新增 2 项（种子折叠、折叠后继续接收推送），
  `tests/plugin.spec.ts` 新增 2 项（种子恢复出授权上下文、空种子不读日志）。

#### B. 发布工作流基线与 CI 门禁

- `release.yml:36` 的 Harness `ref` 由 `0a53fb55`（`0.1.2-alpha.2` 时代）改为
  `d7432673`（`refs/tags/dsh-v0.2.1-alpha.2^{}`，与本地 checkout HEAD 一致；
  该 tag 是 annotated tag，`rev-parse` 不带 `^{commit}` 会拿到 tag 对象 `6851e496`）。
  不改则正式产物与其 DSH 安装 smoke 都基于旧基线，与 peer 声明自相矛盾。
- `ci.yml` 改为 checkout 同一份 Harness 并 `pnpm build:lib` 后再 `pnpm run check`。
  原配置只装本仓库，`tsc` 解析不到任何 `@deepseek-ai/dsh-*`，自 `rc.10` 起每次
  都因 `TS2307` 失败 —— **与 vitest 并行超时无关**，此前判断方向错误。
- CI 工具链与发布对齐为 node `24.18.1` + pnpm `11.18.0`，避免「CI 绿、发布红」
  这类工具链差异。

#### C. 宿主级集成测试

`tests/host-integration.spec.ts`：真实 `Context` + 真实 `SessionStore` + 真实
`ApprovalService` + 真实 `DomainFacility`/`JsonStorageBackend`，只有模型调用是 stub。
3 项覆盖：实时会话 `allowed-once`、恢复会话 `allowed-once`（验证种子折叠在真实宿主生效）、
无 `tool/call` 时**绝不**放行。

调试中确认的两个真实约束，值得记住：

- 评审路由必须能从配置解析。裸夹具 Session 没有 `request/header`，
  `requestContext()` 拿不到 provider/model，`resolveRoute` 返回 `null`
  → reviewer 不跑 → `human (uncertain)`。测试里显式传 `reviewerProvider`/`reviewerModel`。
- Session 必须带 `cwd`。缺 `cwd` 时 `resolveWorkdir` 返回 `undefined`，
  预检直接判 `uncertain` → 转人工。用 `create(id, { meta: { cwd } })`。

#### 本轮验收

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 错误 |
| `npx vitest run --no-file-parallelism` | **191 通过 / 0 失败，13/13 文件** |
| `npx tsdown` | 通过；`lib/index.js` 58.86 kB、`lib/client.js` 4.98 kB |
| `src/` 弃用读取 | 仅 `index.ts:136` 一处，带 waiver 与理由 |

### Review

- 10 条偏差已确认接受。恢复会话的种子折叠属**必须**修复项（否则恢复会话全量退化）。
- 仍待外部环境验证：`npm pack --dry-run`、隔离 `DSH_HOME` 真实安装 —— 两者均由
  `release.yml` 的 `release:formal` 覆盖（含 `dsh plugin add` + `--dump-config` smoke），
  本机无法复现（`pnpm install` 被 SIGTERM，exit 137）。
- `vitest` 并行 jsdom 超时**未处理**：无 CI 证据，且 CI 红是缺 Harness 所致。

---

## 2026-10-18 跟进 DSH 0.2.1-rc.2：无需改代码，只改基线钉点

DSH 已发到 `dsh-v0.2.1-rc.2`（npm `next` = `0.2.1-rc.2`；`latest` 仍是 `0.2.0-rc.2`，
`alpha` = `0.2.1-alpha.5`）。把相邻 harness checkout 切到该 tag、按 rc.2 重建 `lib` 后实测：

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 错误（未被 rc.2 类型改动打破） |
| `npx vitest run --no-file-parallelism` | 191/191，13/13 文件 |
| `npx tsdown` | 通过 |

`alpha.2 → rc.2` 的 990 个提交里，我们依赖的包只有增量改动：
`session`（typert `resource` 字段、`job/registered` + `job/settled` 事件登记）、
`agent`/`llm`（`imageRequestTarget`、`defaultBaseURL`），
`user-approval`/`storage*`/`session-projection`/`commands`/`fs` 无 `src` 变更。
**没有任何新增 `@deprecated`**，也没有 `session/event` 派发语义改动。

本轮改动（都不改插件行为）：

- `ci.yml` / `release.yml` 的 harness `ref` → `687f282e86`（`dsh-v0.2.1-rc.2`）。
- `package.json` 增加 `engines.dsh: "~0.2.1-alpha.2"`：DSH `0.2.1-alpha.3` 起
  `engines.dsh` 一旦存在就**单独决定**兼容性、忽略 dsh peer；两者取值相同，窗口不变。
- 删除失效的 `@deepseek-ai/dsh-permission-presets` dev 依赖（全仓已无引用）。
- README/README.zh 的验证基线、安装命令改 rc.2，并纠正 npm 渠道描述（`next` 已是 rc.2）。

### 用宿主真实函数验证的兼容性矩阵

`evaluatePluginCompatibility`（`packages/boot/app-boot`）实测：

- 接受：`0.2.1-alpha.2/4/5`、`0.2.1-rc.2`、`0.2.1`、**`0.2.2-alpha.1`**
- 拒绝：`0.2.0-rc.2`（npm `latest`）、`0.3.0-alpha.1`

`0.2.2-alpha.1` 被接受是宿主用 `includePrerelease: true` 判定的结果，属**放宽**。
结论：`0.2.2` 及以后仍需单独验证，不能因为宿主放行就当作已支持。

### 仍未做

- `npm pack --dry-run`、隔离 `DSH_HOME` 真实安装：只由 `release.yml` 的
  `release:formal` 覆盖（本机 `pnpm install` 仍 exit 137）。
- 真机 web 端渲染未验证：客户端包在 rc.2 有较大改动（`ui-conversation` 36 文件），
  目前只有 jsdom 组件测试兜底，没有真实浏览器冒烟。

---

## 2026-10-18 rc.12 发布：npm 成功，registry 回读超时

`v0.1.0-rc.12` tag 已推（annotated），Release RC run `39122728083`：
`build` / `build_attest` / `stage_draft` 全绿，`publish_npm` 的**发布步骤成功**，
但紧随其后的 `Verify registry tarball and provenance` 失败：

```
Error: npm version verification did not become ready after 8 attempts (last status 404)
```

即 `fetchNpmJsonWithRetry` 默认 8 次 × 3 秒 = 24 秒窗口，registry 回读没跟上。

### 已核实的事实（不是猜测）

- `npm view dsh-smart-approval@0.1.0-rc.12` 存在，`dist.integrity` =
  `sha512-mHFl…qyg==`；`dist-tags.latest = 0.1.0-rc.12`。
- 从 GitHub release 资产下载的 `dsh-smart-approval-0.1.0-rc.12.tgz`
  sha256 = `d201ada3…3f95`，与 `SHA256SUMS`、workflow 的 `TARBALL_SHA256` 一致；
  本地算的 sha512 与 npm 的 `dist.integrity` 逐字节相同 → **两侧是同一个 tarball**。
- 因此 `finalize_release` 被 skip 只是草稿没转正，不是产物问题。
- 手工按 `finalize_release` 的语义补做：校验 6 个资产后
  `PATCH releases/416408240 {draft:false, prerelease:true, make_latest:false}`，
  现在 release 状态 `draft:false / prerelease:true`。

### 同类病史（同一根因，不是偶发）

`v0.1.0-rc.8`、`v0.1.0-rc.10` 的 GitHub release **至今仍是 Draft**，
而 `rc.9` / `rc.11` 是 Pre-release。三次失败点完全相同：发布成功 → 回读 404。

### 修复

`publish_npm` 的校验步骤改为 30 次 × 10 秒（5 分钟窗口），
三处读取（version / tarball / packument）统一用 `registryDeadline`；
tarball 那条用 `wait()` 传同样的间隔。仍然有界失败，不会挂死。
另补 2 个 `fetchNpmJsonWithRetry` 单测（404 后重试成功、耗尽后报错并核对次数）。

### 待办

- rc.13 发布时会第一次走这条更长的等待；若 5 分钟仍不够，再改成指数退避。
- rc.8 / rc.10 的草稿 release 未处理（历史遗留，产物已过时）。
