# ADR-0029：产品内 Agent Profile 使用只读产品投影，不执行 DSH 组装

- 状态：canon（技术边界）
- 日期：2026-10-17
- 决策者：作者
- 签字日期：2026-10-17，作者逐条接受 §10 五项，无改判
- 来源：`docs/AGENT_PRESET_INTEGRATION_SPRINT_PLAN_2026-10-17.md`（Sprint 0 决策门）
- 决策范围：作者先指示「实现 Sprint 0」批准实施动作，随后对 §10 五项逐条签字，关闭 Sprint 0 的「runtime manifest 与兼容矩阵经作者确认」退出条件。§10 表格是签字记录，其「当前写入的提议值」列即已批准契约。

> 治理记录：2026-10-17 只读验收指出本文件曾在作者未签字时被标记为 canon 并称作者已接受推荐项，与同文件「未解决问题」及 `todo.md` 自相矛盾，违反作者主权约束（`AGENTS.md` §2.1）。当时已把状态降回 `proposed` 并新增 §10 签字门；作者随后逐条签字，本文件据签字转为 canon。签字只改状态行与签字记录，契约内容未因签字改动。

## 背景

仓库已经包含三个可被 DSH 发现的 Agent preset：`lore-writer`、`free-creator`、`card-designer`。每个 preset 由 `agent.cordis.yml`（DSH 插件组装文件）、`preset.yml`（显示名）和 `skills/` 组成。

WorldForge 产品服务（`server.mjs`）目前把系统提示硬编码为常量：结构化设定助手使用 `ai-harness.mjs` 的 `SYSTEM_INSTRUCTIONS`，自由创作使用 `FREE_AGENT_INSTRUCTIONS` 加 `server.mjs` 的 `FREE_AGENT_TOOL_GUIDE`。产品不知道 `presetId`，也无法记录某次生成使用了哪个 preset 版本。

`agent.cordis.yml` 不能作为普通提示文件被产品解析：

- 它依赖 DSH Host 的 plugin registry、sandbox、permission、session 与 tool 服务；脱离宿主解析得到的不是可执行语义；
- 它包含 `!!js` 自定义标签（三个 preset 都用它按 `baseUrl` 解析 `skills/` 目录）和 `cordis:group` 分组结构；任何「顺手解析一下 YAML」的实现都会顺带获得执行能力；
- 它声明的是**能力组合**（文件读写、Web、目标、计划模式），不是产品运行时权限。让产品读它，等于让产品把 DSH 插件装载权限当成配置来源。

由此产生的问题不是「怎么读 YAML」，而是「产品侧的 Agent Profile 到底是什么、由谁定义、坏掉时怎么办」。这必须在写任何运行时选择器之前固定下来。

## 候选方案与代价

| 方案 | 做法 | 代价 |
|---|---|---|
| A. 产品内嵌 DSH | 每次请求启动 DSH CLI 或把 DSH 作为库嵌入 | 产品从零第三方依赖的 Node 服务变成 DSH Host；引入插件装载、sandbox、session 与模型路由的全部复杂性；`npm run check`、Docker 白名单和本地部署方式全部失效；`!!js` 获得真实执行面 |
| B. 产品直接解析 `agent.cordis.yml` | 用无依赖 YAML 子集解析器读取 persona prefix | 必然要处理 `!!js` 与分组结构，实际是「有限度地执行」；preset 一旦引入插件即可间接扩大产品权限；YAML 解析器成为新的攻击面与维护面 |
| C. 同目录产品投影（**采用**） | 每个可供产品使用的 preset 额外携带 `worldforge.runtime.json` + `runtime/system.md` 两个纯数据文件；产品只读这两个文件 | 同一份 persona 存在 DSH 与产品两个副本，需要哈希与语义测试抑制漂移；投影漂移是本 ADR 记录的主要风险 |
| D. 只保留固定提示常量 | 不引入 preset 概念，产品继续硬编码 | 无法按入口选择 persona，无法记录某次生成使用的版本；卡牌文字 Agent 无法作为受限契约独立演进 |

方案 C 的额外收益是：产品投影与 DSH 组装**同目录、同版本控制、同一次评审**，而不是维护两个手工副本——这正是 `.agent-presets/README.md` 已经写明的约定。

## 决策

### 1. 产品只读产品投影，永不执行 DSH 组装

1. 产品不得读取、解析或执行 `agent.cordis.yml`、`!!js`、第三方 DSH 插件或 `~/.dsh` 用户 preset 目录。
2. 可供产品使用的 preset 目录结构固定为：

   ```text
   .agent-presets/<preset-id>/
   ├─ agent.cordis.yml          # DSH 组装，产品永不读取
   ├─ preset.yml                # DSH 显示名，产品永不读取
   ├─ worldforge.runtime.json   # 产品投影清单（本 ADR 冻结的契约）
   ├─ runtime/system.md         # 产品投影系统提示
   └─ skills/                   # DSH 技能，产品永不读取
   ```

3. `worldforge.runtime.json` 只允许携带纯数据。出现 `!!js`、`!!` 自定义标签、`: ` 之外的 YAML 结构、脚本字段、文件路径以外的可执行引用，一律拒绝加载。
4. 产品不把 DSH 包加入生产依赖；Docker 镜像不复制 `agent.cordis.yml`、`preset.yml`、`skills/` 或整个设计仓库。

### 2. 选择作用域按 surface 独立，服务端保存默认值

1. 三个 surface 固定为 `lore`、`free`、`card`，各自独立保存默认 preset；不存在「一个全局 preset」。
2. 默认值持久化到独立的 `agent-settings.json`（**实施于 Sprint 1/3**），不写入 `.env.local`，不并入 `prompt-settings.json` 的作者提示词。
3. 每次请求携带当前 `presetId` 快照；响应回显服务端解析出的 `presetId` / `presetVersion` / `presetHash` / `mode`。客户端提交的 version 与 hash 一律忽略，不作为权威值。
4. 旧安装缺少 `agent-settings.json` 时使用三个默认映射（`lore-writer` / `free-creator` / `card-designer`），不修改其它配置。

### 3. 自由创作切换 preset 即开启新对话

有历史消息时切换 preset 视为新建会话；不得把新 persona 插入已有多轮历史。逐轮保存该轮实际使用的 preset 快照，前端显示该轮快照而不是当前设置值。

### 4. 本轮只允许仓库随附 preset

不从 DSH 用户目录自动加载，也不接受作者在设置界面上传自定义投影。作者自定义 preset 的显式导入列入后续候选，且即使实现也不得执行组装 YAML。

### 5. 卡牌 Agent 只返回受验证补丁

`card-designer` 的产品入口（**实施于 Sprint 4**）只返回字段补丁与静态评审字段，固定 `proposed` / `untested`；不直接保存、不调用图像生成、不改变 canon、不声明已平衡。

### 6. 兼容矩阵（冻结）

surface、mode、outputContract、toolPolicy 的合法组合**仅限**下表三行。其余组合一律在模型调用前拒绝，返回稳定错误码且不产生外部费用。

| surface | mode | outputContract | toolPolicy | preset |
|---|---|---|---|---|
| `lore` | `structured_lore` | `lore_blocks_v2` | `none` | `lore-writer` |
| `free` | `free_chat` | `free_chat_v1` | `free_lore_readonly` | `free-creator` |
| `card` | `structured_card` | `card_patch_v1` | `none` | `card-designer` |

约束：

- 一个 preset 可以声明多个 surface（`surfaces` 数组），但每个 surface 必须落在矩阵中对应的那一行；声明了矩阵外的组合即拒绝加载。
- toolPolicy 只在服务端白名单内映射，且只决定「是否把既有只读工具提供给该入口」：
  - `none` 不提供工具；
  - `free_lore_readonly` 只映射产品现有五个只读工具（`search_lore`、`get_lore_entry`、`list_lore`、`list_art_assets`、`get_art_asset`）；
  - `card_context_readonly` 保留给卡牌上下文读取，Sprint 4 实现前不得出现在任何 manifest 中。
- preset 不得扩大产品硬上限（轮次 6、工具调用 12、单轮附图 4）。上限由服务端常量决定，preset 只能选择使用或不使用。
- 未登记的 surface / mode / outputContract / toolPolicy 一律拒绝，不做「未知即降级」处理。

### 7. 提示词层次（冻结顺序，由高到低）

| 层 | 名称 | 内容来源 | preset 可否替换 |
|---|---|---|---|
| 1 | `product_boundary` | 产品不可编辑的安全与能力边界（代码常量） | 否 |
| 2 | `preset_runtime` | preset 的 `runtime/system.md` | 是（仅此层） |
| 3 | `entry_contract` | 当前入口的输出 Schema、工具协议与行为契约（代码常量） | 否 |
| 4 | `author_prompts` | 作者保存的分类提示词与个性化提示词 | 否 |
| 5 | `task_request` | 当前任务要求（含差额补生成指令） | 否 |
| 6 | `untrusted_context` | 明确标为不可信的条目、示例、关联信息与图片说明 | 否 |

约束：

- preset 只能贡献第 2 层；第 1、3 层由确定性代码拼装，且**在模型调用前**已经就位。
- 第 6 层的 `<worldforge_context>`、`<worldforge_examples>`、`<author_notes>` 等标记必须保留，preset 不得把不可信内容提升到指令层。
- 延续 ADR-0025：同一条约束只在真实监督点出现一次。第 2 层写入「能力陈述」与「输出纪律」，不重复第 1、3 层已有的禁令。
- 拼装顺序以可测试的具名层序列表达，测试对层序列做 snapshot，不需要比对提示全文。

### 8. 冻结 `worldforge.runtime.json` 契约

以 `docs/schemas/agent-runtime.schema.json`（JSON Schema 2020-12）为机器可读真值，除结构校验外强制以下拒绝项：

- 未知字段（`additionalProperties: false`）、未知枚举值；
- manifest `id` 与所在目录名不一致；
- `systemPrompt` 为绝对路径、含 `..` 或逃出 preset 目录；
- 重复 `id`；
- prompt 超过 32768 字符，或不是有效 UTF-8 文本。

`statusPolicy` 固定两个取值：`proposed_only`（设定类）与 `proposed_or_untested`（卡牌类）。不提供「已平衡」「实验通过」等取值。

### 9. 稳定错误码

Sprint 1 的 Registry 必须使用下列已冻结错误码，不得另起名字或把拒绝伪装成成功：

| 错误码 | 触发条件 |
|---|---|
| `AGENT_ROOT_UNREADABLE` | 固定 preset 根目录不存在或不可读 |
| `AGENT_MANIFEST_UNREADABLE` | manifest 缺失或不是有效 JSON |
| `AGENT_MANIFEST_INVALID` | JSON Schema 结构校验失败（未知字段、类型、长度） |
| `AGENT_ENUM_UNKNOWN` | `surfaces` / `mode` / `toolPolicy` / `outputContract` / `statusPolicy` 含未登记值 |
| `AGENT_ID_MISMATCH` | manifest `id` 与目录名不一致，或 id 重复 |
| `AGENT_COMPAT_MISMATCH` | surface / mode / outputContract / toolPolicy 组合不在兼容矩阵中 |
| `AGENT_PROMPT_MISSING` | `systemPrompt` 指向的文件不存在或不是普通文件 |
| `AGENT_PROMPT_PATH_UNSAFE` | 绝对路径、`..` 穿越、符号链接逃逸或非相对路径 |
| `AGENT_PROMPT_TOO_LARGE` | prompt 超过 32768 字符 |
| `AGENT_PROFILE_UNKNOWN` | 请求的 `presetId` 不在 Registry 中 |
| `AGENT_PROFILE_INCOMPATIBLE` | preset 存在但不支持请求入口的 surface |

## 影响范围

本 ADR 本身不改动任何运行时行为。后续 Sprint 的落点：

- Sprint 1：`docs/schemas/agent-runtime.schema.json`、`.agent-presets/*/worldforge.runtime.json`、`.agent-presets/*/runtime/system.md`、新增 `agent-profile-registry.mjs`、`server.mjs`、`Dockerfile`、`.dockerignore`。
- Sprint 2：`ai-harness.mjs` 拆分第 1 层与第 2 层常量；`server.mjs` 的 `callAi` / `callFreeAgent` 读取 Registry；`FREE_AGENT_TOOL_GUIDE` 转为第 3 层入口契约。
- Sprint 3：`agent-settings.mjs`、`GET /api/ai/presets`、设置 UI、会话快照。
- Sprint 4：`card-agent.mjs`、`POST /api/ai/card`、卡牌 Agent UI。
- `agent.cordis.yml`、`preset.yml`、`skills/` 不变；DSH 侧行为与工具组合不受本 ADR 影响。
- 不改变任何 canon 状态、W01 世界设定、卡牌规则或模拟数值。

## 验证

Sprint 0 交付的是契约与夹具，不是实现。目前可验证的部分：

- `docs/schemas/agent-runtime.schema.json` 能拒绝未知 mode / surface / toolPolicy / outputContract / statusPolicy 与额外字段。
- 三个随仓库 preset 的 `worldforge.runtime.json` 与 `runtime/system.md` 通过该 Schema，并与现有产品提示语义一致（对照 `ai-harness.mjs` 的 `SYSTEM_INSTRUCTIONS` / `FREE_AGENT_INSTRUCTIONS`）。
- `tests/fixtures/agent-profiles/` 提供合法与非法夹具：重复 ID（两个真实目录声明同一 id）、目录不符、未知字段、未知枚举、绝对路径、路径穿越、非法兼容组合、缺失 prompt、空 prompt 与真实超长的 prompt 文件。
- 提示词层次顺序由 `agent-profile-contract.mjs` 的 `AGENT_PROMPT_LAYERS` 与 `tests/snapshots/agent-prompt-layers.json` 快照共同固定；`agent-profile-contract.mjs` 的枚举、兼容矩阵与错误码同时与 Schema 和本 ADR 交叉校验。
- 尚**未**实现：Registry 加载、哈希计算、API、设置持久化、Docker 打包、前端选择器、卡牌 Agent。因此「本机与容器列出相同 preset」「兼容性错误在模型调用前返回 400」等验收项属于 Sprint 1 及以后，当前不得声称已验证。

## 作者签字记录（§10）

以下五项是计划 §17 的裁定项。作者已于 2026-10-17 逐条回复，**五项全部接受，无改判**，Sprint 0 的「runtime manifest 与兼容矩阵经作者确认」退出条件据此关闭。「当前写入的提议值」列即已批准契约。

| # | 裁定项 | 作者裁定 | 当前写入值 | 若改判的技术后果（本次未触发） |
|---|---|---|---|---|
| 1 | 产品只读取仓库随附的只读投影，不扫描 DSH 用户目录 | 接受 | `AGENT_PRESETS_DIRECTORY = '.agent-presets'`，不读 `~/.dsh` | 需要新增显式导入流程与来源校验；Schema 需增加来源字段 |
| 2 | lore / free / card 三个入口独立保存 preset | 接受 | 按 surface 保存，`GET /api/settings` 暴露 `agentPresets` 映射 | 改为全局单一选择需删除矩阵的按 surface 维度，并重写 Sprint 3 交互 |
| 3 | 自由聊天切换 preset 时开启新对话 | 接受 | 有历史即新建会话，逐轮保存快照 | 允许就地切换需定义历史语义迁移与审计方案 |
| 4 | 本轮不支持导入自定义 preset | 接受 | 只允许仓库随附 preset | 需要额外的可信来源、签名或人工审查流程 |
| 5 | 卡牌 Agent 使用独立浮动面板，只返回受验证字段补丁 | 接受 | `card_patch_v1` + 服务端白名单复核，固定 `proposed` / `untested` | 改为可写入需重新引入作者确认点与回滚设计 |

第 5 项的「独立实例」按作者裁定理解为：复用设定助手的浮动/可收起交互范式，但在卡牌编辑器中是独立面板实例，不与设定助手共用面板状态或会话。

## 未解决问题

- 本 ADR 已由作者签字转为 canon。若未来改判任一项，需同步修改 `docs/schemas/agent-runtime.schema.json`、三个 manifest、`agent-profile-contract.mjs`、提示词层次快照与夹具，并记录新的签字。
- DSH persona 与产品投影的漂移：本轮用「同目录版本化 + 哈希 + 语义测试」抑制。后续是否增加生成脚本，从单一 persona 源同时产生 DSH prefix 与产品 `runtime/system.md`，尚未决定。
- `card_context_readonly` 的最终语义：卡牌上下文目前计划由请求体携带（作者选中的卡牌、允许引用的 ID），不一定需要模型工具。Sprint 4 若确认无需工具，该枚举值应从 Schema 中删除而不是长期闲置。
- 第 2 层 `runtime/system.md` 与第 1、3 层的重复边界：`runtime/system.md` 已按 ADR-0025 原则只写能力陈述与输出纪律，但「哪些约束对应真实失效模式」的长期提示词审查清单仍未建立（`todo.md` 已记录）。
