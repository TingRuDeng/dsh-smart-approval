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
- [ ] 修复版本提交、推送并发布，npm `latest`/`next` 均指向修复版本，本机 profile 安装该明确版本。
- [ ] 原始日志有权限为 `0600` 的逐文件备份，备份 SHA-256 等于修复前文件。
- [ ] 修复后日志仅在 `seq 19216` 增加 `ignorable: true`，zstd 与 JSONL 校验通过，Web 能加载历史。
- [ ] 恢复后审批模式仍为 `smart`，且再次切换不会产生新的未知事件。

### 实施步骤

- [x] 先以失败测试固定 sidecar、命令投影和“零自定义事件写入”行为。
- [x] 实现 storage-domain 模式存储、启动迁移、异步命令写入和审批读取。
- [x] 调整投影折叠、客户端交互、依赖、版本及中英文文档。
- [x] 执行完整本地与隔离 DSH 验证，并做敏感信息和发布包复核。
- [ ] 提交、推送、等待 GitHub CI 成功，发布 npm 修复版本并更新 dist-tags。
- [ ] 将本机 web profile 更新到明确修复版本并停止 DSH 写入进程。
- [ ] 备份、精确修复目标日志，完成结构差异、校验和与 Web 历史验收。

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
