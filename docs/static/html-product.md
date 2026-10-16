# HTML 产品静态文档

## 2026-10-17 Sprint 0 只读验收修正归档

本次响应 Sprint 0 只读验收结论：工程实现通过，但存在 1 个治理阻断项与 2 个测试偏差。修正**不涉及任何运行时**（`server.mjs`、`ai-harness.mjs`、API、SQLite、Dockerfile、前端与 canon 均未改动）。

### 治理修正：ADR-0029 降回 `proposed`

- 原状态行写「canon（技术边界）／决策者：作者」并推论「作者指示实现 Sprint 0 即视为接受推荐项」，与同文件「未解决问题」及 `todo.md` 的「作者尚未逐条确认」自相矛盾，违反 `AGENTS.md` §2.1 作者主权。
- 现在状态为 `proposed`，决策者为「作者（待签字）」，并新增决策范围声明：作者指示只批准实施动作，不构成对推荐项的裁定；签字前兼容矩阵、提示词层次与错误码是**提议契约**，不得引用为已批准 canon。
- 新增 §10「作者签字门」：逐条列出计划 §17 的五项、当前写入的提议值与改判的技术后果（自定义 preset 导入需来源校验、取消按 surface 保存需重写 Sprint 3、允许就地切换需定义历史语义迁移、卡牌可写入需重新引入作者确认点、不扫描用户目录需新增显式导入流程）。
- §未解决问题首条改为「作者尚未对 §10 五项签字」；签字后只改状态行，不改契约内容。
- `docs/adr/README.md` 索引与 `README.md`、`todo.md`、Sprint 计划 §7.6/§7.7 同步标注「`proposed`、正式验收未通过」。

### 测试偏差一：重复 ID 与超长 prompt 改为真实磁盘夹具

- 新增 `tests/fixtures/agent-profiles/reject/duplicate-id/fixture-a/`、`fixture-b/`：两个真实 preset 目录声明同一个 `id: duplicate-id`，各自带 `runtime/system.md`。测试按 Registry 语义逐个加载，断言「单独加载任一目录成功、同一批加载第二个抛重复 ID」，从而区分「重复」与「其他原因失败」。
- 新增 `tests/fixtures/agent-profiles/reject/oversized-prompt/`：`runtime/system.md` 是真实磁盘文件，895 行 / 34017 字符，文件头四行自述用途，明确要求「不要为了美观截短它」。测试读取真实文件并用契约常量 `AGENT_PROMPT_MAX_CHARS` 判定。
- 拒绝夹具总数由 8 增至 10（原 8 个 + 重复 ID 批量 + 超长 prompt）。夹具目录既可以是单个 preset 目录，也可以是一批目录；`manifestDirectories()` 统一解析，`FIXTURE_DIRECTORY_COUNT` 固定每类目录数，避免新增夹具时静默漏检。
- 测试内的超长字符串拼接与内存夹具逻辑已删除；真实 preset 的 prompt 长度仍被断言在限制内，防止修夹具时把上限调歪。

### 测试偏差二：提示词顺序改为真正的 snapshot 回归保护

- 新增 `agent-profile-contract.mjs`：代码侧契约真值模块，导出 `AGENT_RUNTIME_SCHEMA_VERSION`、`AGENT_RUNTIME_MANIFEST`、`AGENT_PRESETS_DIRECTORY`、`AGENT_PROMPT_MAX_CHARS`、`AGENT_SURFACES`、`AGENT_MODES`、`AGENT_TOOL_POLICIES`、`AGENT_OUTPUT_CONTRACTS`、`AGENT_STATUS_POLICIES`、`AGENT_SURFACE_COMPATIBILITY`、`AGENT_PROFILE_ERROR_CODES`、`AGENT_PROMPT_LAYERS`（含 `priority`、`source`、`replaceableByPreset`）与 `AGENT_PRESET_REPLACEABLE_LAYER`。全部冻结，无文件系统或网络访问，也不读取 `agent.cordis.yml`。Sprint 1 的 Registry 应直接 import 这些常量，而不是把枚举重写一遍。
- 新增 `tests/snapshots/agent-prompt-layers.json`：六层顺序快照。测试对 `AGENT_PROMPT_LAYERS` 做 `deepEqual`，任何重排都会失败并提示同步 ADR-0029 §7 与快照；同时断言优先级恰为 1–6、只有 `preset_runtime` 的 `replaceableByPreset` 为 `true`、第 1 与第 3 层不可替换、ADR 按同序记录层名。
- 新增「代码侧契约常量与 Schema、ADR 一致」测试：枚举逐项与 `docs/schemas/agent-runtime.schema.json` 比对；兼容矩阵每项必须落在 Schema 枚举内；错误码用 ADR 表格行的反引号标识符收敛比对，既保证行数一致也保证集合一致（此断言在不加限定时曾因正文提到 `AGENT_PRESETS_DIRECTORY` 等常量名而失败，故限定为表格行）。
- `package.json` 的 `check` 加入 `node --check agent-profile-contract.mjs`。

### 验证

- `npm run check` 全通过：157 项测试（上次 156 项；契约测试由 11 项增至 12 项）。
- 未验证项不变：Registry 加载与哈希、`GET /api/ai/presets`、`agent-settings.json`、Docker 打包一致性、设置 UI、`POST /api/ai/card`、真实模型端到端。
- 仍未关闭：ADR-0029 §10 五项签字。这是 Sprint 0 正式验收的唯一剩余条件。

## 2026-10-17 Agent Profile 契约与 Sprint 0 归档

本次实现 `docs/AGENT_PRESET_INTEGRATION_SPRINT_PLAN_2026-10-17.md` 的 Sprint 0：固化产品侧 Agent Profile 的契约、兼容矩阵、提示词层次与测试夹具。**不修改任何产品运行时**：`server.mjs`、`ai-harness.mjs`、`ai-agent.mjs`、`ai-tools.mjs`、API 路由、SQLite、Dockerfile、前端与 canon 全部未改动，`server.mjs` 仍使用 `SYSTEM_INSTRUCTIONS` / `FREE_AGENT_INSTRUCTIONS` 固定常量。Sprint 1–5 未开始。

### `docs/adr/ADR-0029-agent-profile-runtime-projection.md`

- 状态 `canon（技术边界）`，记录四个候选方案（内嵌 DSH / 直接解析 `agent.cordis.yml` / 同目录产品投影 / 保留固定常量）与代价，采用「同目录产品投影」。
- 拒绝执行 DSH 组装的三个理由：`agent.cordis.yml` 依赖宿主 registry/sandbox/permission/session/tool 服务；三个 preset 都用 `!!js` 按 `baseUrl` 解析 `skills/`；它声明的是能力组合而非产品运行时权限。
- §1：产品只读 `worldforge.runtime.json` 与 `runtime/system.md`，永不读取 `agent.cordis.yml`、`preset.yml`、`skills/`，不引入 DSH 生产依赖，镜像不复制设计仓库。
- §2–§5：按 surface 独立保存服务端默认值并持久化到 `agent-settings.json`（Sprint 1/3 实施）；请求携带 `presetId` 快照、响应回显权威解析值；自由聊天切换 preset 即新对话并逐轮保存快照；本轮只允许仓库随附 preset；卡牌 Agent 只返回受验证补丁。
- §6 兼容矩阵（冻结）：`lore/structured_lore/lore_blocks_v2/none`、`free/free_chat/free_chat_v1/free_lore_readonly`、`card/structured_card/card_patch_v1/none` 三行合法；`card_context_readonly` 保留给 Sprint 4，不得提前出现在 manifest 中。
- §7 提示词六层顺序（冻结）：`product_boundary` 与 `entry_contract` 由代码拼装且 preset 不可替换，`preset_runtime` 是 preset 唯一可贡献的层，`author_prompts`、`task_request`、`untrusted_context` 依次降低；延续 ADR-0025，第 2 层只写能力陈述与输出纪律，不重复第 1、3 层已有禁令。
- §9 冻结 11 个稳定错误码：`AGENT_ROOT_UNREADABLE`、`AGENT_MANIFEST_UNREADABLE`、`AGENT_MANIFEST_INVALID`、`AGENT_ENUM_UNKNOWN`、`AGENT_ID_MISMATCH`、`AGENT_COMPAT_MISMATCH`、`AGENT_PROMPT_MISSING`、`AGENT_PROMPT_PATH_UNSAFE`、`AGENT_PROMPT_TOO_LARGE`、`AGENT_PROFILE_UNKNOWN`、`AGENT_PROFILE_INCOMPATIBLE`。
- §未解决问题：DSH persona 与产品投影的漂移（后续可考虑从单一来源生成）、`card_context_readonly` 的最终语义、提示词审查清单、五个裁定项待作者逐条确认。

### `docs/schemas/agent-runtime.schema.json`

- JSON Schema 2020-12，`additionalProperties: false`，11 个必填字段：`schemaVersion`(`const 1`)、`id`、`version`、`displayName`、`description`、`surfaces`、`mode`、`systemPrompt`、`toolPolicy`、`outputContract`、`statusPolicy`。
- 枚举冻结：surface `lore|free|card`；mode `structured_lore|free_chat|structured_card`；toolPolicy `none|free_lore_readonly|card_context_readonly`；outputContract `lore_blocks_v2|free_chat_v1|card_patch_v1`；statusPolicy `proposed_only|proposed_or_untested`。
- `id` 必须是 kebab-case 且与目录名一致；`version` 必须是语义化版本；`systemPrompt` 的 `not.anyOf` 拒绝根路径、Windows 与 UNC 绝对路径以及 `..` 穿越；`surfaces` 至少 1 项、最多 3 项且不重复。
- `allOf` 三条 `if/then` 分支把 §6 兼容矩阵编码进 Schema：任何声明了 `lore`/`free`/`card` 的 manifest 都被强制到该行对应的 mode、outputContract、toolPolicy 与 statusPolicy。
- 本文件是产品侧机器可读真值；Sprint 1 的 Registry 必须直接依据它校验，不得另立规则。

### 三个 preset 的产品投影

- `.agent-presets/lore-writer/worldforge.runtime.json`：`["lore"]` / `structured_lore` / `runtime/system.md` / `none` / `lore_blocks_v2` / `proposed_only`。
- `.agent-presets/free-creator/worldforge.runtime.json`：`["free"]` / `free_chat` / `runtime/system.md` / `free_lore_readonly` / `free_chat_v1` / `proposed_only`。
- `.agent-presets/card-designer/worldforge.runtime.json`：`["card"]` / `structured_card` / `runtime/system.md` / `none` / `card_patch_v1` / `proposed_or_untested`。
- 三个 `runtime/system.md` 只承载第 2 层：`lore-writer` 保留事实层次、`proposed` 候选、原创性与「本候选」元话语禁令；`free-creator` 保留「不要强制 JSON」、`status`/`truthScope` 表述纪律与检索停止规则；`card-designer` 保留「作者拥有 canon 决定权」、`proposed`/`untested`、ID 白名单、字段互斥、目标/时机/顺序/持续/反制/边界六项与平衡措辞禁令。
- 三份 prompt 均不含 `@deepseek-ai/`、`agent.cordis.yml`、`dsh-tool-`、机器绝对路径或代码围栏，因此产品投影不会泄露 DSH 内部实现。
- `ai-harness.mjs` 的 `SYSTEM_INSTRUCTIONS` / `FREE_AGENT_INSTRUCTIONS` 本次**未删除**；它们将在 Sprint 2 拆分为第 1 层与第 3 层常量，本轮先建立可对照的语义基线。

### `tests/agent-profile-contract.test.mjs`

- 内含只实现本 Schema 实际使用关键字的最小校验器（`type`/`const`/`enum`/`pattern`/`minLength`/`maxLength`/`minItems`/`maxItems`/`uniqueItems`/`items`/`required`/`properties`/`additionalProperties`/`allOf`/`if`-`then`/`contains`/`not`/`anyOf`），避免为 Sprint 0 引入 ajv 生产依赖。
- 11 项测试：Schema 枚举与必填字段自检；三个随仓库投影通过校验且 `id` 与目录名一致；三个投影落在兼容矩阵对应行；9×3×3×3 组合全量枚举且恰好 3 行合法；未登记 surface 被拒绝；同一 preset 跨 surface 复用被拒绝；合法/拒绝夹具按预期原因失败；重复 ID 与超长 prompt 被拒绝；prompt 路径留在 preset 根目录内且为有效 UTF-8；六层顺序在 ADR 中按序出现；三份 prompt 不泄露 DSH 内部且不重复第 1、3 层禁令。
- `PROMPT_LIMIT = 32768` 与 ADR §8 的长度上限一致；超长夹具用内存拼接而非提交 32 KB 以上的仓库文件。

### `tests/fixtures/agent-profiles/`

- `legal/fixture-lore`、`legal/fixture-card`：最小合法投影，用于验证路径解析、UTF-8 与 `proposed_or_untested` 状态策略。
- `reject/` 8 个目录：`unknown-field`（额外 `plugins` 字段）、`unknown-enum`（`agentic_shell` / `full_access`）、`absolute-path`（`C:\...`）、`traversal`（`../../agent.cordis.yml`）、`directory-mismatch`（`id` 与目录名不符）、`incompatible-combination`（`free` surface 配 `structured_lore` 与 `lore_blocks_v2`）、`missing-prompt`（`runtime/absent.md`）、`empty-prompt`（空串触发 `minLength`）。

### 文档与索引

- `.agent-presets/README.md` 新增目录结构与「产品投影」小节，说明改产品侧 persona 时必须同时改 `agent.cordis.yml` 与产品投影，以及投影漂移由契约测试暴露。
- `README.md` 说明 preset 携带只读投影与 ADR-0029 边界，并把计划标注为「Sprint 0 已完成、运行时选择器未实现」。
- `docs/adr/README.md` 登记 ADR-0029，后续编号改为从 `ADR-0030` 开始。
- `docs/AGENT_PRESET_INTEGRATION_SPRINT_PLAN_2026-10-17.md` 增加「执行进度」行与 §7.6 Sprint 0 执行记录表。
- `todo.md` 标记 Sprint 0 完成，保留「实现 Sprint 1–5」与「作者逐条确认 ADR-0029 五个选项」两项未完成。

### 验证与未验证

- `npm run check` 全通过：156 项测试，其中本次新增 11 项；节点版本 v22.23.2。
- 手工核对：三个投影与 `ai-harness.mjs` 现有两段系统提示的语义一致性；夹具拒绝原因逐目录核对。
- **未验证**：Registry 加载与确定性哈希、`GET /api/ai/presets`、`agent-settings.json` 迁移、Docker 镜像与本机 preset 一致性、设置页选择器、`POST /api/ai/card`、真实模型端到端。这些属于 Sprint 1–5，本轮不得声称已验证。
- 运行环境说明：Node 内置测试运行器需要为每个测试文件 spawn 子进程，在受限沙箱下会以 `spawn EPERM` 失败，因此 `npm run check` 需要完整文件访问权限。

## 2026-10-17 Agent preset 产品接入 Sprint 计划归档

本次只新增 proposed 开发计划，不修改产品运行时、API、数据库、Docker 镜像或任何 canon。计划文件为 `docs/AGENT_PRESET_INTEGRATION_SPRINT_PLAN_2026-10-17.md`。

计划以当前事实为基线：仓库级 `lore-writer`、`free-creator`、`card-designer` 可供 DSH 选择，但 WorldForge 产品内 AI 入口尚不能选择 preset。建议通过受限的 `worldforge.runtime.json + runtime/system.md` 产品投影接入，产品不得解析或执行包含 `!!js` 的 `agent.cordis.yml`。

计划拆分为 6 个 Sprint、约 27 人日：契约/ADR、Registry 与 Docker 闭包、现有设定和自由入口接入、设置 UI 与会话快照、卡牌文字 Agent、安全加固与发布验收。每个 Sprint 都包含任务、测试、退出条件和作者决策门；运行时实现尚未开始，TODO 保持未完成。

## 2026-10-17 设定写作与自由创作 DSH preset 归档

本次把产品已有的两类创作提示契约抽离为独立、可版本化的 DSH Agent preset，不修改 `ai-harness.mjs`、自由聊天 API、数据库、canon 或任何产品运行时行为。

### `lore-writer`

- persona 对应结构化设定助手的 `SYSTEM_INSTRUCTIONS`：区分状态与事实层次，不静默补完 canon，使用原创表达，遵守成本、限制与因果，并直接输出可回填正文。
- `worldforge-lore-writing` 技能固化读取顺序、内容块工作流、类型质量标准和交付检查。
- `reference/content-blocks.md` 从 `ai-content-specs.mjs` 提炼 13 类条目的当前内容块与专项重点；实现文件仍是真值，字段变化时需要同步。

### `free-creator`

- persona 对应 `FREE_AGENT_INSTRUCTIONS` 与 `FREE_AGENT_TOOL_GUIDE`：允许讨论、构思、比较、续写、改写或分析，不强制 JSON，并要求读取具体条目后再引用细节。
- `worldforge-free-creation` 技能记录按需检索、视觉判断和停止检索规则，保持默认只读，不宣称已写入资料库。
- DSH 的 `tool-fs` 同时发布读取、写入和编辑工具；Agent preset 不能修改宿主 permission preset。因此行为层只读由 persona 约束，权限层强制只读必须搭配 DSH 的只读权限模式。
- 产品内自由聊天读取请求携带的资料库/美术资产快照并可按资产 ID 附图；DSH preset 只能读取当前工作区可见文件，不会自动获得 SQLite 草稿、素材库索引、密钥或产品会话附件。

### 验证边界

- 三个 preset 都必须包含 `agent.cordis.yml`、`preset.yml` 和入口 `SKILL.md`，不得绑定机器绝对路径或引入 Shell、后台任务、子代理与工作流。
- DSH `scanRoot` 用实际 Profile 解析基址检查全部 preset；项目测试另外检查 persona、技能挂载与各模式特有边界。

## 2026-10-17 DSH 卡牌设计 Agent preset 归档

本次改动不修改 HTML 产品运行时、任何 canon、卡牌语义或模拟规则。它把 DSH 创造模式产出的 WorldForge 卡牌设计 persona 重构为仓库内可版本化、可审查、可迁移的 Agent preset。

### 文件与职责

- `.agent-presets/card-designer/agent.cordis.yml`：定义卡牌设计 persona 与最小能力组合；提供文件读写、搜索、技能、计划、目标、待办、Web 参考和结果展示，不提供 Shell、后台任务、子代理或工作流。
- `.agent-presets/card-designer/preset.yml`：提供 DSH 选择器显示名与单句说明，不承载运行时权限。
- `.agent-presets/card-designer/skills/worldforge-card-design/SKILL.md`：集中卡牌/关键词/机制的读取顺序、作者主权、状态分层、字段检查、边界案例与交付要求。
- `reference/card-fields.md` 与 `reference/keyword-fields.md`：提供便于审查的字段速查；真实写入仍以仓库当前 Schema 和模板为准。
- `.agent-presets/README.md`：说明仓库内 preset root 的使用方式、相对路径约定和 DSH 代际更新限制。

### 可移植性与边界

- persona 的工作目录通过 DSH `{{cwd}}` 注入；技能不再绑定 `D:\\桌面\\sisi_apps\\WorldForge` 等机器绝对路径。
- preset 的专属技能目录以 `baseUrl` 相对解析，整个 preset 目录可以整体复制或配置为 DSH preset root。
- Agent 只能产出或编辑候选设计；未获作者明确批准时保持 `proposed / experimental / untested`，不把 W97/W98/W99 实验参数当成正式规则或 W01 正史。
- 本 preset 面向内容设计，不取代仓库中的运行时自由创作 Agent，也不改变其模型提示、工具协议或数据库行为。

### 验证

- `tests/agent-presets.test.mjs` 检查完整目录结构、persona 与相对技能挂载，并拒绝意外加入 Shell、Job、子代理、工作流或机器绝对路径。
- 项目 `npm run check` 会自动执行该测试；本机 DSH 的 `scanRoot` 已以 headless Profile 的解析基址确认该 preset 可发现且无 `broken` 原因。尚未新建真实会话人工核对最终工具列表；运行中的旧会话不会热切换到新 preset 代际。

## 2026-10-16 W97 实验卡牌对战与受控关键词归档

本次新增一个可玩但非正式的卡牌对战纵切。W97 测试套牌、全部对战参数与四个关键词均为 `experimental / untested`；不修改 W01 正史，也不把现有自由文本卡牌草案当成可执行规则。

### 纯规则引擎

- 新增 `dist/battle.js`，以可在 Node 测试和浏览器中共用的纯数据状态实现。
- `createGame(options)`：按固定 seed 确定性洗牌，创建双方 20 生命、3 张起手与玩家先手的内存对局。
- `normalizeCard(card)` / `normalizeEffect(effect)`：只保留随从、法术、已注册关键词和 `deal_damage / heal / draw_card` 白名单效果；数值限制在有界范围，未知操作落为 `null`。
- `playCard(state, playerId, handIndex)`：验证回合、手牌、资源和栏位；随从进场，法术经统一效果入口结算。
- `canAttack(...)` / `legalAttackTargets(...)` / `attack(...)`：分离攻击权限、目标集和伤害执行；随从交战同时交换伤害，护持在目标列表阶段生效。
- `endTurn(...)` / `runRuleOpponent(state)`：补满递增资源、抽牌并切换回合；规则对手按手牌与场面稳定顺序完成有界出牌和攻击。
- `cleanupDeaths(state)`：移除死亡随从、按稳定玩家/场位顺序触发余响，单次链上限 32 步。

### 关键词运行时

- `KEY-001` 疾启是攻击权限修改器；`KEY-002` 护持是合法目标约束；`KEY-003` 隔绝是一次性伤害替换；`KEY-004` 余响是死亡后触发器。
- `keywordUsages[].detail` 继续只服务卡面展示。运行时只读取关键词 ID 和经白名单校验的 `params`，不解析规则文本或执行自定义 JavaScript。

### 对战界面

- 新增 `dist/battle-ui.js`：`WorldforgeBattleUI.refresh()` 首次进入时创建对局；玩家可出牌、选中己方随从、在当前合法目标中攻击并结束回合。
- 页面显示双方英雄、场面、玩家手牌、资源、牌库、四个关键词说明和最新在前的战斗日志。「重新开始」恢复相同的确定性初始局。
- 对局不读取、修改或保存 SQLite 内容，不与 W98/W99 世界模拟共用状态。

### 验证与未实现

- `tests/card-battle.test.mjs` 覆盖同 seed 初态一致、出牌费用、登场限制、疾启、护持、隔绝、余响、规则对手回合和未知行为默认拒绝。
- 暂未实现玩家组牌、作者卡牌导入、武器、手动法术目标、持续效果、对局存档/回放和正式平衡验证。

## 2026-10-15 AI 助手浮动化与素材解绑增量

- AI 设定助手由资料工作区第三列改为浮动子窗口（`#aiPanel`），工作区回到两列。三态由 `setAiPanel(state)` / `applyAiPanel()` 管理：`open`、`min`（46px 竖条，点击任意处展开）、`closed`（隐藏，由右侧 `#openAiPanel` 竖按钮重开）；状态保存在本地键 `worldforge-ui-state-v1`，不进入导出与 SQLite。窄屏改为底部抽屉。
- 候选数量新增「1 份」。服务端 `expectedCount`、`createLoreResponseSchema` 与 `completeAiVariants` 早已按 1–5 处理，因此只改界面选项。
- 非故事模式下每张候选新增「覆盖当前条目」（`overwriteWithAiVariant(index)`）：确认后调用 `applyAiVariant()` 覆盖已勾选内容块并立即 `saveLore()`，仍走完整字段校验；仅在已保存条目上出现。
- 卡牌编辑器新增「不使用原画」（`clearCardArt()`），把 `selectedArtAssetId` 置空并重绘卡面。
- 设定视觉原型新增「解除绑定」：`unbindArtAsset(asset)` 调用 `POST /api/art-assets/:id/unbind`，成功后本地标记 `unbound` 并重绘视觉原型、附件托盘与原画集。
- `storage.mjs` 新增 `setArtAssetTarget(id, target)` 与 `unbound` 语义：解除时不删除文件与记录，只清空 `targetType` / `targetId` / `cardId`；`normalizeArtAsset()` 在未绑定时保留空目标，`prepareArtAssets()` 不再把未知 `targetType` 兜底成 `card`。
- 缓存版本更新为 `app.js?v=42`、`styles.css?v=34`。全量 Node 回归测试为 132 项，全部通过。
- 另以最小 DOM 桩运行真实 `app.js` 验证：窗口三态切换与持久化、非法状态回退、竖条点击展开、候选两按钮与"覆盖不新建"（条目数不变、正文已换、名称保留）、卡牌原画取消、视觉原型解除绑定调用正确的 URL 与请求标记、本地标记与列表移除、另一张画作不受影响；存储层另测解除与重新绑定的往返。

## 2026-10-15 正史约束位置调整增量

- `FREE_AGENT_INSTRUCTIONS` 删去「不要擅自把候选晋升为 canon」，改写为输出纪律：引用资料时按其 `status` 与 `truthScope` 表述，`proposed` 是草案、`unknown` 是留白，不要写成已定论，也不要补全资料本身没写的内容。理由是 Agent 的五个工具全部只读，这条禁令禁止的是一件不可能发生的事。
- `FREE_AGENT_TOOL_GUIDE` 删去「每条资料都带 status 与 truthScope……都不能当作已批准正史」这一条：工具结果本身就带这两个字段，系统提示里已有一次表述，无需重复。「工具是只读的；你无法写入、删除」保留，因为它是能力陈述而非禁令，用于阻止模型承诺做不到的修改。
- 界面从四处重复收敛为一处并改为说明作者该做什么：AI 助手面板的「草案边界」改为「AI 只返回 proposed 建议；勾选并保存才会进入资料库，何时晋升 canon 由你在世界观界面决定」。卡牌设定来源说明改为「只预填草案，需要你保存才生效」，自由对话页脚改为「自由 Agent 的对话不会写入资料库」，设置的数据管理段改为「不会自动写入仓库」。`dist/index.html` 中「正史」一词由 4 处降为 1 处。
- 模块助手的 `SYSTEM_INSTRUCTIONS` 保留「不得修改、否定或悄悄补完 canon」：其重点是不要为填补已批准设定的空白而编造内容，属于内容质量约束。
- 用真实模型验证删减没有丢约束：仅提供一条 `status: proposed` / `truthScope: unknown` 的条目追问具体数字，模型调用 3 次工具读到正文，答出该数字并主动标注 `proposed` 与 `unknown`，区分「条目写的」与「条目自己标注为未确定的」，最后给出两个设计方向交作者选择。全量 Node 回归测试为 130 项，全部通过。

## 2026-10-15 自由对话上下文预览与图片附件增量

- 自由对话的每条用户消息在发送时快照当时的参考资料：`freeContextSnapshot(picked, wholeLibrary, total, artCount)` 产出 `{ references, mode, total, artCount }` 或 `null`（完全无授权时）。快照只在本地的消息对象上，不随请求发回服务端，后续修改参考资料选择不会改写历史消息。
- `freeContextPreview(message)` 在用户气泡下方渲染预览行：「参考资料」标签 + 条目 chip（超过 6 条折叠为 `+N`）或「整个资料库 · N 条」，再加「原画 N 张」chip；`message.assets` 非空时另起一行显示缩略图，点击调用 `openImageViewer()` 查看大图。
- 新增素材库图片附件：`renderFreeAttachments()` 渲染可搜索的缩略图托盘（`#freeAttachTray`），`toggleFreeAttachment(id)` 切换选择并把上限固定为 4 张（`FREE_ATTACH_LIMIT`），超限时提示且不写入。`#freeAttachCount` 显示 `已选 / 4`。
- 附件挂在用户消息的 `assets` 字段上并随请求发送；发送后自动清空待发附件并重绘托盘。「清空本次自由对话」也会清空待发附件。
- `callFreeAgent` 接受每条用户消息的 `assets`，用 `resolveAgentImages()` 逐条读取；读取失败的编号写进该消息正文的括号说明。无工具路径改为 `tools: []` + `maxRounds: 1` 走同一循环，工具不可用时的降级同理——**附图在两条路径上都会保留**，不再因为接口不支持工具而丢失。原先的一次性提示词路径与 `transcriptOf()` 随之删除。
- 返回值 `images` 汇报**本次模型实际收到的图片总数**（作者显式附件 + 工具附图），而不是只统计工具附图；`vision` 在任一路径成功收到图片时都为 `ok`。
- 缓存版本更新为 `app.js?v=41`、`styles.css?v=33`。全量 Node 回归测试为 130 项，全部通过。
- 另以最小 DOM 桩运行真实 `app.js` 验证 25 项行为：托盘渲染与搜索过滤、4 张上限的拒绝与释放、附件随消息进入请求载荷、发送后清空、预览两行内容与折叠、无参考资料授权时仅显示图片行、历史消息的附件与快照不被后续操作改写。

## 2026-10-15 Agent 视觉原型增量

- 工具集扩展到五个：新增 `list_art_assets`（按目标/目标类型/用途过滤，返回资产编号、用途、绑定目标、生成通道、尺寸与生成时间的索引）与 `get_art_asset`（按编号查看 1–4 张原画的实际画面）。
- 图像不能放在工具结果消息里，因此 `get_art_asset` 只返回 `imageIds` 与元数据文本；`resolveAgentImages()` 在服务端按编号读取资产文件并转成 data URL，由 `runAgentLoop` 作为**紧随工具结果之后的一条用户消息**附上。工具消息永远不带图。
- `buildChatMessages` / `buildResponsesInput` 支持带图用户消息：前者产出 `[{type:'text'},{type:'image_url',image_url:{url,detail}}]`，后者产出 `[{type:'input_text'},{type:'input_image',image_url,detail}]`。
- 单轮附图上限 4 张（`AGENT_LIMITS.maxImages`），附图消息注明「以画面为准；与文字不符时说明差异」。
- 视觉降级：模型接口拒绝图片（400/404/422）时把已附图的消息改写成文字说明并继续对话，`vision` 返回 `unavailable`；其他错误照常抛出，不会被降级逻辑吞掉。返回值新增 `vision`（`ok`/`unavailable`/`none`）与 `images` 张数，轨迹每条带 `images`。
- 前端在对话气泡下如实展示「附图 N 张」或「模型接口不接受图片，已移除附图」；`sendFreeMessage()` 上传美术资产元数据索引（上限 200 条，不含文件字节），可见范围沿用 ADR-0021 的授权模型。
- 缓存版本更新为 `app.js?v=39`。全量 Node 回归测试为 128 项，全部通过。
- 对真实模型做了两次端到端验证：一次纯文本工具调用（4 轮 / 5 次调用，答出只有读到正文才能知道的事实）；一次视觉验证（2 轮 / 1 次调用，`vision: ok`，附上 1 张真实原画，并且**故意不提供原始提示词**）。视觉验证的回复准确描述了前景翻泥的跪姿人物与木器、灌溉水渠与背陶罐的人、木栅与茅草顶泥墙屋、工坊内唯一的蓝紫色发光晶体、远景大河木桥与方山、以及暖赭＋泥棕＋橄榄绿的色调与低角度暖光，连画面右下角很淡的「AI生成」水印都被识别出来。

## 2026-10-15 自由创作 Agent 工具调用增量

- 自由创作从单轮问答升级为多轮工具调用。新增 `ai-tools.mjs`：`prepareLibrary(entries)` 规范化并裁剪资料库快照；`FREE_AGENT_TOOLS` 声明 `search_lore`、`get_lore_entry`、`list_lore` 三个只读工具；`runToolCall(name, args, library)` 执行单个调用并返回 `{ ok, content, summary }`，未知工具与非法参数以可恢复错误回给模型而不是抛出。
- 新增 `ai-agent.mjs`：`runAgentLoop({ messages, tools, callModel, runTool, maxRounds, maxToolCalls, onTrace })` 是纯编排，模型调用与工具执行由调用方注入；预算用尽后不再提供工具，轮次用尽则追加收尾指令强制作答，停止原因如实返回。
- `createToolCaller({ config, system, fetchImpl })` 把 Chat Completions 与 Responses 两种风格统一成 `callModel({ messages, tools })`；`buildChatMessages` / `buildResponsesInput` / `parseChatToolCalls` / `parseResponsesToolCalls` 等线格式函数独立可测。
- `callFreeAgent` 重写：资料库快照经 `prepareLibrary` 进入工具；系统提示追加工具使用规则（先读正文再引用、`proposed`/`unknown` 不得当作正史、工具只读）；返回 `{ reply, toolMode, trace, rounds, toolCalls, stopped }`。模型服务拒绝工具（400/404/422）时退回不带工具的单轮问答并标注 `toolMode: 'unavailable'`；没有可检索范围时标注 `toolMode: 'none'`。
- 前端 `sendFreeMessage()` 按「参考资料选择 → 全库开关 → 无」决定发给服务端的可检索范围，并在会话气泡下用 `freeAgentMeta(message)` 以可折叠形式展示检索轨迹（轮次、工具名、成败与摘要）。
- `Dockerfile` 的 COPY 白名单补入两个新模块。此前漏登记会导致镜像构建成功但容器启动即 `ERR_MODULE_NOT_FOUND`；新增 `tests/docker-packaging.test.mjs` 从 `server.mjs` 解析本地模块传递闭包并逐个核对 COPY 白名单。
- 缓存版本更新为 `app.js?v=38`、`styles.css?v=31`。全量 Node 回归测试为 118 项，全部通过。
- 对真实模型做了一次端到端验证（Responses 风格）：给定两条资料，问一个只有读到正文才能答的问题。结果为 4 轮、5 次工具调用、`toolMode: native`、`stopped: answer`，轨迹依次为 `search_lore` → `get_lore_entry` → 收尾检索，回答准确给出正文中的两个事实并标注了条目的 `status` 与 `truthScope`，同时说明条目未涵盖的内容以避免臆测。

## 2026-10-15 选择窗口三处复用增量

- 选择窗口从写死「关联资料」改为按目标驱动：新增 `pickerTargets` 注册表，共 `lore`（关联资料）、`card`（卡牌设定来源）、`free`（自由创作参考资料）三个目标，各自声明标题、排除规则、读写状态、已选区容器、按钮文案、空状态与提交后副作用。打开时按目标改写 `#relationDialogTitle` 与 `#relationDialogEyebrow`。
- 卡牌「设定来源」不再使用多选下拉：改为已选标签（`#cardLoreRefSummary`）加「选择设定来源（N）」按钮（`#openCardLoreRefPicker`）；`populateCardLoreRefs()` 写入状态数组，`selectedCardLoreRefs()` 读取该数组，卡牌保存、生图上下文与参考图画作池继续沿用同一入口。
- 自由创作新增「参考资料」已选区（`#freeRefSummary`）与选择入口（`#openFreeRefPicker`）。`sendFreeMessage()` 在已选条目时把 `library` 收窄为这些条目并自动附带索引（即使「附带资料库条目索引」未勾选）；未选时维持原行为，由该复选框决定是否附带全部条目索引。服务端 `/api/ai/free` 契约不变。
- 三个目标共用同一份草稿窗口与过滤器；切换目标不会串档，提交只影响当前目标。
- 失效引用在三个目标上都按「N 条已失效引用」提示。
- `renderPickerSummary(key)` / `renderPickerSummaries()` 取代原先只服务关联资料的渲染函数；`openPicker` / `renderPicker` / `applyPicker` 取代 `openRelationPicker` / `renderRelationPicker` / `applyRelations`。
- 缓存版本更新为 `app.js?v=37`（样式与其余模块未变）。全量 Node 回归测试为 90 项，全部通过。
- 另以最小 DOM 桩运行真实 `app.js` 验证三处目标：启动时三个已选区均为空状态、窗口标题与眉标随目标切换、关联资料排除当前编辑条目而卡牌与自由创作不排除、选择互不串档、`collectLoreForm()` 与 `selectedCardLoreRefs()` 读取正确、自由创作实际发出的请求载荷在已选时收窄为所选条目并自动附带索引、未选且未勾选时不附带索引且回退为全量、失效引用在卡牌侧同样提示，共 24 项行为断言全部通过。

## 2026-10-15 关联资料选择窗口增量

- 「关联资料」由 `<select multiple>` 改为 `<dialog id="relationDialog">` 分栏选择窗口：一侧为全量资料池，另一侧为已选关联，窄屏上下堆叠。编辑器表单里只保留已选标签（`#relationSummary`）与「选择关联资料（N）」按钮。
- 新增 `dist/relation-picker.js` 纯函数模块：`filter(entries, options)` 支持 `query / type / status / worldMode / currentWorldId / excludeId / selectedIds / view`，`toggle`、`remove`、`summarize`、`missingCount` 处理选择与汇总；配有独立 Node 测试。
- `openRelationPicker()` 把已提交选择复制成草稿并重置过滤器；`renderRelationPicker()` 同时渲染资料池与已选区；`applyRelations()` 才把草稿写回 `relationSelection`，「取消」或关闭窗口丢弃草稿。
- 资料池过滤器：搜索（名称、编号、摘要、正文、标签）、类型（13 类 + 全部）、世界（当前世界 / 其他世界 / 全部世界，默认当前世界）、状态（canon / proposed / unknown / deprecated / 全部）、显示（全部 / 仅未选 / 仅已选）。当前正在编辑的条目始终被排除。
- `renderRelationSummary()` 在表单里显示已选标签，并把已删除条目留下的失效引用标为「N 条已失效引用」，不静默丢弃。
- `collectLoreForm()` 改为读取 `relationSelection`，不再读下拉框的 `selectedOptions`。
- 修复 `fillLoreForm()` 仍向已移除的 `#loreWorldId` 元素写值的问题：该动作会让「应用 AI 候选到当前表单」直接抛错。同一类问题（`loadLore` 与 `fillLoreForm` 的「id → 值」映射表）已由 `tests/subpath-routing.test.mjs` 的映射键检查覆盖。
- 缓存版本更新为 `app.js?v=36`、`styles.css?v=30`，并新增 `relation-picker.js?v=1`。全量 Node 回归测试为 90 项，全部通过。
- 另以最小 DOM 桩运行真实 `app.js` 验证：空状态与标签渲染、打开时草稿的初始化、资料池排除当前条目与其他世界、搜索与类型/世界/显示过滤、点选与取消、移除按钮、取消丢弃与应用的提交语义、`collectLoreForm()` 读取结果、失效引用提示，共 21 项行为断言全部通过。

## 2026-10-15 世界观两级结构增量

- 世界观模块拆成两级：一级 `#worldHub` 是世界面板列表，二级 `#worldDetail` 是单个世界的资料工作区。`enterWorld(worldId)` 进入并重置到「世界」分类，`leaveWorld()` 返回一级并清空当前世界；`switchModule('world')` 与 `bootstrap()` 都会回到一级。
- 新增 `dist/world-scope.js`：`worldIdOf(entry)`、`groups(entries)`、`loreOfWorld(entries, worldId)`、`nextWorldId(entries)`、`countByType(entries)`、`searchWorlds(groups, query)`、`reassign(entries, sourceWorldId, targetWorldId)`，全部为纯函数并配有独立 Node 测试。
- 一级面板数据源是「世界条目 ∪ 数据中出现过的 `worldId`」的并集。`worldId` 没有对应世界条目的资料会变成 `unassigned` 面板，而不是消失；面板上的归入选择器调用 `adoptWorldGroup(sourceId, targetId)` 把这些资料改到目标世界。
- `renderLoreList()` 改为先把 `readLore()` 结果交给 `WorldforgeWorldScope.loreOfWorld(readLore(), activeWorldId)`，再按分类过滤；标签页计数、`renderGeographyTree()` 与 `renderChronicleTree()` 都只收到当前世界的资料。
- `populateRelations()` 按世界分组：当前世界条目平铺，其他世界条目进入「其他世界（跨世界引用）」`<optgroup>`，跨世界引用能力保留但被显式区分。
- 编辑器里的「所属世界」从自由文本输入改为只读 `#loreWorldIdText`，由 `renderWorldIdField(worldId)` 渲染为「W01 · 魔导工业世界」；`collectLoreForm()`、`currentWorldId()`、`populateLocationParents()`、`populateChronicleParents()`、`updateAiExampleMeta()` 全部改用当前世界而非表单字段。
- 新增 `createWorld()`：用 `nextWorldId()` 分配最小未占用的两位编号，并同时写入世界条目的 `id` 与 `worldId`，随后进入该世界并聚焦名称输入框。
- 一级搜索 `#worldSearch` 只按世界名称、编号、摘要与正文过滤面板；`#loreSearch` 只搜索当前世界。
- 缓存版本更新为 `app.js?v=35`、`styles.css?v=29`，并新增 `world-scope.js?v=1`。全量 Node 回归测试为 82 项，全部通过。
- 另以最小 DOM 桩运行真实 `app.js` 做行为验证：一级面板标题与计数、`unassigned` 面板、W01/W02 分类列表互不串档、世界分类只显示自身条目、关联下拉的同世界与跨世界分组、新建世界编号分配、归入操作与 `leaveWorld()` 状态复位均符合预期。

## 2026-10-15 卡面子类型、预览同构与全量原画集增量

- 新增卡牌子类型词表：随从种族由 `WorldforgeCards.minionTribes`（`proposed` 候选：人类、构装体、蒸汽机械、亡灵、野兽）提供，法术派系由 `WorldforgeCards.spellSchools` 提供，直接采用 W01 canon 的十一种魔法派系并按基础 / 高阶 / 更高层分组。
- `WorldforgeCards.normalizeSubtype(type, card)` 按类型固化子类型：随从只保留 `tribeId`，法术只保留 `spellSchoolId`，武器两者清空；未知 ID 读取时丢弃，切换类型不保留不适用字段的旧值。
- `WorldforgeCards.tribeName(id)` / `spellSchoolName(id)` / `subtypeText(card)` 解析显示名与搜索文本；卡牌库搜索命中范围加入种族与派系。
- `renderCardSubtype(type, pending)` 按类型重建编辑器选择器：种族为平铺选项并带“无种族”，派系按层次使用 `<optgroup>` 并带“无派系”；武器隐藏标签与选择器，标签文本在“种族 / 派系”之间切换。
- 随从种族与法术派系共用卡面底部中央的单一子类型行：`updateCardSubtypeLines(type, value)` 负责预览，`drawCardSubtype(ctx, card)` 负责编译 PNG 的 `(330, 826)`；两者都只在对应类型且已选值时才显示。
- 编辑器预览改为与编译卡面同构（ADR-0018）：预览固定 330×460，编译 PNG 固定 660×920，**预览 = PNG ÷ 2**。原画窗按类型取 `artRect()` 的一半，名称横幅为 `38,232,254×37`、规则框为 `39,274,252×121`，属性圆章缩为 48px 并使圆心落在 PNG 圆心的一半处。
- 预览保留卡面内的直接编辑，并用 `z-index` 让名称横幅与规则框绘制在原画之上，与编译绘制顺序一致；卡面底色、名称横幅与规则框改用编译 PNG 的配色。
- 原画集改为覆盖素材库全部原画（ADR-0018）：`artworkEntries()` 遍历 `artAssets`（排除上传参考图）并判定 `used`，`renderArtworkGallery()` 按新增的 `#artworkFilter` 渲染，“已使用原画”为默认分类，可切换“未使用原画”和“全部原画”。未使用素材以虚线边框与去饱和缩略图区分，点开仍可查看大图。
- `#cardSubtypeLabel[hidden]` 与 `#cardSubtype[hidden]` 显式隐藏，避免被既有 `display` 规则覆盖。
- `cards/schema/card.schema.json` 新增 `tribe` 与 `spell_school` 枚举，并以类型条件约束武器两者为 `null`；`templates/card.yaml` 同步。SQLite 物理 Schema 与完整 JSON 导出结构不变。
- 缓存版本更新为 `app.js?v=34`、`cards.js?v=6`、`styles.css?v=28`。全量 Node 回归测试为 74 项，全部通过。
- 本次改动后以脚本按 PNG 常量反算预览坐标，确认每个预览盒都等于 PNG ÷ 2、落在卡内且规则框不压子类型行、子类型行不压属性圆章。

## 2026-10-15 卡牌有限富文本、无水印与属性圆章增量

- `buildSeedreamBody(config, request)` 固定发送 `watermark: false`；Mock 回归测试断言请求边界，不调用真实 Seedream 或产生费用。
- `WorldforgeCards.parseRichText(value)` 将 `<b>...</b>` / `**...**` 编译为粗体 run，将 `<i>...</i>` / `*...*` 编译为斜体 run。未列入白名单的 HTML 保留为普通文字，DOM 预览使用 `textContent`，不会执行输入内容。
- `WorldforgeCards.compileDescription(card, keywords)` 在原有“独立关键词 → 带说明关键词 → 普通文本”顺序上，把关键词附加说明与普通文本展开为安全样式 run；`text` 与 `lines` 返回去除受支持标记后的纯文本。
- `canvasTextFont()`、`richTextLines()` 与 `drawCompiledDescription()` 让编译 PNG 和编辑器预览共用粗体/斜体语义。Canvas 的测量字体与绘制字体一致，换行仍按实际字形宽度计算。
- 编辑卡面的属性圆章隐藏内部 `<span>` 名称，`drawCardStat()` 不再向 PNG 绘制名称；费用、攻击、生命与耐久输入继续保留 `aria-label`。
- 缓存版本更新为 `app.js?v=32`、`cards.js?v=5`、`styles.css?v=26`。全量 Node 回归测试为 67 项，全部通过。

## 2026-10-15 卡面 PNG、富文本规则框与原画交互增量

- `WorldforgeCards.compileDescription(card, keywords)` 除分组与纯文本 `lines` 外新增可渲染 `runs`：独立关键词先出现，带说明关键词随后出现，普通规则文本最后出现。关键词名与冒号标为粗体，独立关键词之间使用中文逗号，普通文本在关键词组后换段。
- `renderCardKeywordPreview()` 直接消费 `runs`，在编辑卡面同一规则框内生成连续富文本和自然换行；右侧 `renderKeywordPreview()` 仍按作者添加顺序逐项、逐行编辑，展示重排不会修改存储顺序。
- `compileCardPng(card, map)` 使用 660×920 Canvas，把统一底板、类型原画窗、非破坏性裁剪、名称、富文本规则与类型属性编译为 PNG data URL。PNG 是随时可由卡牌数据再生的展示缓存，不写入 SQLite 或导出 JSON，避免放大内容快照。
- `miniCard(card, map)` 不再拼装图片、标题、描述和属性 DOM；卡牌库只渲染编译 PNG。旧卡牌进入卡牌库时会按现有数据即时编译，保存卡牌时会先刷新该卡的 PNG 缓存。
- `bindCardArtGestures()` 为编辑卡面原画增加 Pointer Events 拖动与滚轮缩放，并同步 `cardCropX / cardCropY / cardCropZoom`；滑杆精调和重置仍可用，最终 PNG 使用完全相同的裁剪参数。
- 原画查看器新增下载入口。`serveArtAsset(id, res, download)` 在 `?download=1` 时返回 `Content-Disposition: attachment`，文件名固定为稳定美术资产 ID，扩展名按 PNG/JPEG/WebP 的真实 MIME 类型确定；普通图片展示请求仍保持 inline。
- 缓存版本更新为 `app.js?v=31`、`cards.js?v=4`、`styles.css?v=25`。自动化覆盖增至 66 项；真实 Docker 页面已验收卡牌 PNG、富文本顺序、拖动焦点、滚轮缩放，并确认下载响应名为 `ART-….jpg`。

## 2026-10-15 卡牌库、类型属性与描述编译增量

- 卡牌模块拆为互斥的卡牌库、原画集和创建/编辑器三个视图。`switchCardTab(tab)` 负责视图切换；编辑器隐藏子 Tab 并提供返回卡牌库操作。
- 卡牌库由 `renderCards()` 生成，支持名称、规则文本和关键词搜索，类型/稀有度分类筛选，以及每页 8 张的上一页/下一页导航；点击任一卡牌调用 `loadCard(id)` 进入独立编辑器。
- `WorldforgeCards.normalizeStats(type, card)` 固化类型属性：随从保存攻击与生命，法术清空攻击、生命和耐久，武器保存攻击与耐久。旧武器数据缺少 `durability` 时兼容读取原 `health`，但后续保存只写耐久。
- `renderCardFrame()` 与卡牌库缩略图按类型显示属性：法术没有底部两个属性位，武器的第二属性明确标为“耐久”。三类卡继续共用同一底板、尺寸和主色，只改变原画窗与必要格式细节。
- 关键词在编辑器中逐行显示并保持添加顺序。`WorldforgeCards.compileDescription(card, keywords)` 将保存后的文本稳定编译为“独立关键词 → 带附加描述关键词 → 普通文本”；`renderCardKeywordPreview()` 和卡牌库缩略图复用同一结果。
- `cards/schema/card.schema.json` 使用类型条件约束 `stats`；卡牌模板、README、项目设计、ADR-0016、Changelog 和 TODO 已同步。完整 JSON 导出升级到 schemaVersion 10，SQLite 物理 Schema 无需变化。
- 自动化覆盖增至 65 项，新增类型属性与描述编译顺序检查；真实 Docker 页面已验收卡牌库、独立编辑器、原画集、法术无属性位和武器攻击/耐久显示。

## 2026-10-15 卡牌视觉、原画集与裁剪增量

- 卡牌模块新增“卡牌库 / 原画集”子 Tab；`switchCardTab(tab)` 切换编辑工作区与绑定原画汇总，`renderArtworkGallery()` 按已保存卡牌聚合原画、类型、趣闻和裁剪预览。
- 三类卡牌共用 `dist/assets/card-frames/shared.png` 统一底板、尺寸和配色；`renderCardFrame()` 只按类型设置卡面数据属性，原画窗分别使用蛋形、圆角长方形和圆形轮廓，不建立三套主题皮肤。
- `currentCardCrop()` / `applyCardCrop(image, crop)`：读取横向焦点、纵向焦点和 1–2.5 倍缩放，把同一原画非破坏性裁切到卡面与原画集缩略图；重置操作恢复居中和 1 倍缩放。
- `normalizeCard(card)` 新增 `artCrop` 与 `flavorText`：裁剪值会限制在合法范围；趣闻信息始终随卡牌保存和导出，但默认不显示在卡面正文。
- 对外显示第三类为“武器”，内部稳定类型仍保留 `equipment`，避免破坏旧草案、Schema 与来源映射。
- 自动化覆盖增至 63 项，新增趣闻/裁剪规范化及卡牌子 Tab 互斥测试。

## 2026-10-15 世界观视觉与参考图增量

- `unbindCardFromLore(cardId)`：从指定卡牌的 `loreRefs` 中移除当前设定 ID，保留卡牌、设定与其他来源引用，并立即持久化可重新绑定的结果。
- `createModelBody(config, prompt, options)` 新增 `images`：Responses 请求构造 `input_text + input_image`，Chat Completions 请求构造 `text + image_url`；无图片时保持原有纯文本请求结构。
- `runAi()` 会把设定助手当前选中的参考资产 ID 发送给服务端；`callAi()` 只从本地资产库解析这些图片，并把实际采用的 ID 写入 `contextMeta.visionAssetIds`。
- `referenceButton()` / `renderReferenceAssets()`：世界观视觉区和设定助手图片区共享同一选择状态，选择变化会同步两处 UI。
- 视觉能力由用户配置的 LLM 决定；兼容接口拒绝图片输入时展示明确错误，不把图片静默丢弃。

- `renderLoreLinkedCards()`：按 `card.loreRefs` 反向列出引用当前设定的卡牌，显示已有卡面，并允许跳转到卡牌编辑器。
- `bindExistingCardToLore()`：把当前设定 ID 追加到用户选定的已有卡牌，不创建新卡、不修改设定状态。
- `openImageViewer(asset, title)`：在共用模态窗口中显示卡牌、设定或参考资产的大图及来源元数据。
- `referencePool(kind)` / `renderReferenceAssets(kind)`：为卡牌或设定聚合本对象与双向关联对象的既有画作，维护最多 10 张的参考图选择。
- `uploadReferenceFiles(kind, files)`：校验 PNG、JPEG、WebP 与 8 MB 本地限制，调用 `POST /api/reference-assets` 后把上传图登记到共用资源库。
- `parseReferenceUpload(payload)` / `normalizeReferenceAssetIds(value)` / `toReferenceDataUrl(asset, bytes)`：服务端参考图边界；验证目标、格式、大小和数量，并在请求 Seedream 前把本地文件转换成 data URL。
- `createReferenceAsset(payload)` / `resolveReferenceImages(value)`：持久化用户参考图并按资源 ID 安全解析生成请求；生成资产会记录 `referenceAssetIds`。
- `buildSeedreamBody(config, request)`：有参考图时写入方舟图片生成接口的 `image` 字段；单图使用字符串，多图使用数组。
- `normalizeCard(card)` 新增 `referenceAssetIds`：卡牌保存去重后的前 10 张参考资源，支持连续生成同系列卡面。
- ComfyUI 尚无统一的参考图节点契约；带参考图请求会返回明确错误，不会静默忽略。
- 自动化覆盖增至 61 项，并在 Docker 实际页面验证了世界观关联卡牌区、卡牌参考图区与大图查看器。

## 1. 产品定位

Worldforge 是一个无前端构建依赖的单页写作资料工作台，分为“世界设定编辑器”“卡牌设计”和“自由创作”。设定编辑器覆盖 13 类资料，包括可挂载到人物、地点等条目的独立背景故事；自由创作提供不受模块 Schema 限制的对话 Agent 与常用工具。AI 功能由零依赖 Node 服务代理，运行时创作内容由 SQLite 统一持久化；它不会自动修改仓库或把草案晋升为正史。

## 2. 文件入口

| 文件 | 职责 |
|---|---|
| `dist/index.html` | 页面语义结构、内容与交互入口 |
| `dist/styles.css` | 简约信息管理界面、双模块布局与响应式规则 |
| `dist/app.js` | 模块切换、资料/卡牌编辑、SQLite 同步、浏览器缓存、设置、搜索与导出 |
| `dist/cards.js` | 卡牌类型/稀有度规范化、旧类型迁移、来源去重与设定到卡牌默认映射 |
| `dist/geography.js` | 地理层级定义、父级规则、世界地图树构造、祖先搜索与旧地点隔离 |
| `dist/world-scope.js` | 世界分组、按世界取资料、下一世界编号分配、世界搜索与资料归属搬运 |
| `dist/relation-picker.js` | 关联资料池的搜索与类型/世界/状态/显示过滤、选择切换、已选汇总与失效引用统计 |
| `dist/chronicle.js` | 编年史容器/节点规范化、父级校验、纪年排序、搜索与旧数据兼容 |
| `server.mjs` | 静态服务、内容 API、本机设置持久化、AI 状态与模型请求代理 |
| `storage.mjs` | SQLite Schema、输入校验、事务化快照读写、revision 冲突保护与健康检查 |
| `storage-migrations.mjs` | 内容域 Schema 的有序前向迁移、版本检测、逐步事务升级与未来版本拒绝 |
| `simulation/compiler/world-package.mjs` | JSON 发布清单校验、内容筛选、机制依赖编译、确定性 World Package 与内容哈希 |
| `simulation/rules/mechanic-runtime.mjs` | 运行时机制注册、确定性冲突样本、白名单 Effect Resolver 与资源守恒 |
| `simulation/rules/energy-crisis-mechanic.mjs` | M1 合成能源机制及申请、转交、消耗三种行动 |
| `simulation/runtime/simulation-runtime.mjs` | Tick 批次、状态版本、行动校验/结算、事件提交、快照重放 |
| `simulation/runtime/knowledge-view.mjs` | 主体知识视图的 Tick/过期过滤与传播接收者计算 |
| `simulation/scenarios/m1-energy-crisis.mjs` | 非正史 W99 单城市、双主体、单资源实验包 |
| `simulation/storage/instance-store.mjs` | 独立模拟 SQLite Schema、定义包实例化、基础地区/实体/事件读取 |
| `scripts/compile-world-package.mjs` | 从命令行把 JSON 发布清单编译到指定 World Package 文件 |
| `ai-harness.mjs` | AI 上下文排序与预算、提示边界、候选 Schema、解析和校验 |
| `ai-tools.mjs` | 自由创作 Agent 的只读资料工具：资料库快照规范化、`search_lore` / `get_lore_entry` / `list_lore` 执行与结果裁剪 |
| `ai-agent.mjs` | 多轮工具调用编排、Chat Completions 与 Responses 两种工具的线格式构造与解析 |
| `ai-content-specs.mjs` | 13 类资料的内容块定义、标签、字段说明与动态 Schema 类型 |
| `prompt-settings.mjs` | 13 类默认提示词、个性化提示词规范化、分类白名单与长度校验 |
| `.env.example` | LLM 服务配置模板；实际密钥使用不入库的 `.env.local` |
| `.openai/hosting.json` | 静态站点发布目录声明 |
| `Dockerfile` | 基于 Node 22 Alpine 的本地生产镜像 |
| `compose.yaml` | 本地端口、可选 `.env.local`、重启、只读文件系统与临时目录配置 |
| `docker/nginx.conf` | 旧版 Nginx 配置存档；当前镜像不再使用 |
| `.dockerignore` | 限制镜像构建上下文，不打包设计源文档与托管配置 |

## 3. 静态函数

### `readStore(key, fallback): unknown`

- 位置：`dist/app.js`
- 从 `localStorage` 读取并解析指定数据。
- 数据损坏或不存在时返回调用方提供的回退值；内容键在联网模式下只是 SQLite 的浏览器缓存。

### `writeStore(key, value): void`

- 将内容序列化到浏览器缓存；设定、卡牌、关键词或备注变更会防抖触发 SQLite 保存。
- 编辑偏好继续只保存在当前浏览器，不写入 SQLite。

### `hydrateContent(): Promise<void>`

- 启动时读取 `GET /api/content`，以 SQLite 内容填充当前 Origin 的浏览器缓存。
- 数据库未初始化且浏览器存在旧内容时，自动将旧内容写入 SQLite。
- 后续 Origin 仍有旧内容时，按稳定 ID 与数据库合并，并在 `worldforge-pre-sqlite-backup-v1` 留存迁移前缓存。
- 无法连接服务端时保留浏览器离线缓存，不宣称已经写入数据库。

### `persistContent(): Promise<void>`

- 将当前设定、卡牌、关键词和备注作为一个事务快照写入 `PUT /api/content`。
- 携带当前 revision；服务端返回 409 时停止后续自动写入，防止旧页面静默覆盖新内容。
- 同步状态显示在顶栏，包括连接、保存、失败和版本冲突。

### `showToast(message: string): void`

- 位置：`dist/app.js`
- 显示短时状态提示；重复调用会重置隐藏计时。

### `switchModule(moduleName): void`

- 位置：`dist/app.js`
- 在“世界观架构”“卡牌设计”和“自由创作”页面之间切换。
- 同步顶部导航状态与文档标题。

### `openNote(key: string): void`

- 位置：`dist/app.js`
- 根据稳定键打开备注对话框并恢复本地内容。

### `refreshNotes(): void`

- 统计五个核心未决问题的已记录数量。
- 更新未决问题列表的状态点。

### `normalizeCard(card): CardDraft`

- 兼容旧版浏览器草案并补齐费用、类型属性、关键词、趣闻、原画裁剪和状态字段。
- 调用 `normalizeStats(type, card)`：随从保留攻击/生命，法术清空战斗属性，武器保留攻击/耐久；旧武器 `health` 可迁移为耐久。

### `compileDescription(card, keywords): CompiledDescription`

- 按卡牌中 `keywordUsages` 的添加顺序解析关键词。
- 返回独立关键词、带附加描述关键词、普通规则文本、纯文本 `lines`，以及供 DOM/Canvas 共用的粗体与换段 `runs`。

### `compileCardPng(card, keywordMap): Promise<string>`

- 使用 Canvas 将底框、类型原画窗、原画裁剪、名称、规则富文本和类型属性编译为 PNG data URL。
- 编译结果只作为卡牌库会话缓存；数据源仍是卡牌 JSON 与原画资产，不把大体积 PNG 写回 SQLite 内容快照。

### `bindCardArtGestures(): void`

- 在卡面原画上监听拖动与滚轮，换算并限制横向/纵向焦点及 1–2.5 倍缩放。
- 实时同步三个裁剪滑杆，点击未拖动的原画仍打开大图查看器。

### `minionTribes` / `spellSchools` / `schoolTierLabels`

- 位置：`dist/cards.js`
- `minionTribes` 为随从种族候选词表，当前五项均标记 `proposed`：人类、构装体、蒸汽机械、亡灵、野兽。
- `spellSchools` 为法术派系词表，取自 W01 canon 的十一种魔法派系并标记 `canon`，保留 `basic / advanced / higher` 三档；`schoolTierLabels` 提供中文层次名。

### `normalizeSubtype(type, card): { tribeId, spellSchoolId }`

- 按卡牌类型固化子类型：随从只保留合法 `tribeId`，法术只保留合法 `spellSchoolId`，武器两者清空。
- 未知或越界 ID 返回空字符串；不适用于该类型的字段不保留旧值。

### `tribeName(id)` / `spellSchoolName(id)` / `subtypeText(card): string`

- 前两者把词表 ID 解析为显示名，未命中返回空字符串。
- `subtypeText(card)` 只在对应类型返回内容：随从返回种族，法术返回派系，武器返回空；用于卡牌库搜索与卡面显示。

### `renderCardSubtype(type, pending): void`

- 位置：`dist/app.js`
- 按当前类型重建编辑器子类型选择器：随从使用平铺种族选项并带“无种族”，法术按层次用 `<optgroup>` 分组并带“无派系”。
- 武器隐藏标签与选择器；`pending` 显式指定时优先于当前选择，切换类型时只保留仍然合法的值。

### `updateCardSubtypeLines(type, value): void`

- 把当前类型解析出的种族或派系写入卡面底部唯一的子类型行；空值隐藏该行，不留下空占位。

### `drawCardSubtype(ctx, card): void`

- 位置：`dist/app.js`
- 在编译 PNG 的底部中央 `(330, 826)` 绘制 `subtypeText(card)`，与底部属性圆章同一高度；没有种族或派系时不绘制任何内容。

### `drawCardName(ctx, card): void`

- 位置：`dist/app.js`
- 在名称横幅内绘制卡牌名称，字号仍按 450px 宽度自适应收缩；名称横幅坐标为 `76,464,508×74`。

### `artworkEntries(): Array`

- 位置：`dist/app.js`
- 遍历素材库全部原画（排除 `provenance === 'user_reference'` 的上传参考图），为每项附带引用它的卡牌、是否绑定到仍然存在的设定条目，以及 `used` 判定。
- `used` 为真表示至少一张已保存卡牌绑定了该原画，或该原画的设定目标条目仍然存在。

### `renderArtworkGallery(): void`

- 按 `artworkFilter`（默认 `used`）渲染全量原画集；已使用项显示卡牌名称、类型与趣闻，绑定设定的项显示条目名称，未使用项显示目标、用途与生成渠道并加 `unused` 样式。
- 计数显示为“可见 / 总量 幅”，空状态标题与说明随分类切换。

### `renderKeywords(): void`

- 渲染本地关键词定义，并同步当前卡牌的选择状态。

### `renderKeywordPreview(): void`

- 按添加顺序逐行生成卡牌级关键词及其可选附加说明输入框。

### `formatKeywordUsage(keyword, detail = ''): string`

- 将关键词引用格式化为独立名称，或“关键词：附加说明”。

### `renderCardKeywordPreview(): void`

- 根据当前关键词、附加说明和普通文本实时编译卡面，顺序为独立关键词、带附加描述关键词、普通文本；不重建右侧输入框，避免输入焦点丢失。

### `renderCards(query = ''): void`

- 从本地存储渲染卡牌库缩略卡面。
- 支持名称、类型、规则文本和关键词搜索，类型/稀有度筛选及每页 8 张分页，并同步草案数量与空状态。

### `resetCardEditor(): void`

- 将可编辑卡面恢复为费用 0、攻击 0、生命 1 的新随从状态，并清除规则文本、趣闻、原画与关键词选择。

### `loadCard(id): void`

- 将已保存草案重新载入独立编辑器；武器把耐久装入第二属性输入位。

### `saveCurrentCard(): Promise<void>`

- 保存名称、费用、类型专属属性、编译所需的普通文本与关键词引用、趣闻及原画裁剪；法术不保存攻击/生命，武器只保存攻击/耐久。
- 保存期间刷新当前卡的 PNG 会话缓存；缓存失败不阻止结构化卡牌草案保存。
- 草案状态固定为 `proposed`，平衡状态固定为 `untested`。

### 设定资料函数

- `readLore()`：读取本地资料，并在缺少时注入只读 W01 基线。
- `normalizeLore(entry)`：规范 13 类资料的通用字段、类型属性、地图字段和编年史字段；地理条目保留标准化 `kind` 与稳定 `parentId`，旧时间线默认成为编年史容器；`story` 只保留标题、正文与关系，内部固定为 `proposed / unknown` 并清空摘要、约束、开放问题、标签和类型属性。
- `selectLoreType(type)` / `renderLoreList()`：切换分类、搜索并更新分类计数；世界地图使用嵌套地理树，编年史使用容器/节点树，不与普通资料列表共用平铺展示。
- `loadLore(id)` / `resetLoreEditor(type)`：载入条目或建立默认 `proposed` 草案。
- `collectLoreForm()` / `saveLore()` / `deleteLore()`：收集、保存或删除浏览器本地草案；删除会清理其他条目的失效引用。
- `populateLocationParents(selected)`：按地理层级和所属世界生成合法父级选项；大陆直接属于世界，国家及其他条目必须选择同世界的允许上级。
- `beginGeographyEntry(kind, parentId, worldId)`：从世界或现有地理节点内部建立子级草案，并预选层级、世界和父级。
- `renderGeographyTree(all, query)` / `geographyNode(entry, tree)`：按世界分组渲染国家及其后代；城市、地点不会与国家平铺，搜索时保留匹配条目的祖先路径。
- `prepareGeographyFramework()`：准备一个大陆级草案和 AI 作者要求，使现有候选流程可用于生成世界大地图的大陆框架。
- `populateRelations(selected)`：生成跨类型关联选项。
- `renderAttachedStories(id)`：根据故事的正向引用及故事间双向引用，为当前资料渲染挂载故事或相关故事；列表只显示标题与正文片段。
- `createAttachedStory()`：从当前已保存资料建立 `proposed / unknown` 的故事草案，并预选当前资料为关联。
- `refreshAiStatus()` / `runAi()`：读取服务端配置状态，提交当前草案、资料库、候选数量、作者要求和作者勾选的内容块；背景故事动作自动切换为只含标题与正文的故事契约。
- `renderAiContentBlocks()` / `selectedAiBlocks()`：根据当前资料类型与编年史容器/节点状态渲染可生成内容块，并读取作者选择。
- `renderAiVariants(data)`：按服务端返回的内容块契约渲染可多选方案卡，不再假定所有模块都具有摘要、约束或开放问题。
- `updateAiSelection()`：同步已选数量，仅在至少选择一项时允许保存。
- `saveAiSelections()`：把最终选中的每份方案分别保存为独立 `proposed` 草案；背景故事模式只保存标题、正文和锚点关系，未选方案不写入存储。
- `readPreferences()` / `applyPreferences()`：读取主题、密度和新资料默认值并应用到界面。
- `openSettings()` / `saveSettings(event)`：载入安全的服务端配置摘要、13 类提示词及个性化风格，保存 AI 配置与浏览器编辑偏好。
- `captureTypePrompt()` / `showTypePrompt(type, capture)`：在设置页切换设定分类时保留尚未保存的编辑，并显示当前分类提示词。
- `updateAiExampleMeta()`：统计当前世界和类型可作为示例的 canon 条目，并在生成面板说明自动示例数量。
- `renderFreeChat()` / `sendFreeMessage(event)`：维护当前页面内的自由 Agent 对话并调用非结构化生成接口；对话不会写入 SQLite 内容库。
- `runNameTool()`：按对象类型、数量、命名要求与关联信息生成名称；候选可复制，在世界观模块可回填当前名称输入框。

### 世界范围函数

- `currentWorldId(): string`：返回当前进入的世界编号；未进入世界时回退到编辑偏好里的默认世界，再回退到 `WorldforgeWorldScope.DEFAULT_WORLD_ID`。
- `worldGroups(): Array`：把 `readLore()` 的完整资料交给 `WorldforgeWorldScope.groups()`，供一级面板与只读世界字段使用。
- `renderWorldIdField(worldId)`：把「所属世界」只读字段渲染为「W01 · 魔导工业世界」或纯编号。
- `renderWorldHub(): void`：按 `#worldSearch` 过滤并渲染一级世界面板，同时更新世界数与资料总数。
- `worldPanel(group, adoptTargets): HTMLElement`：生成单个世界面板；`unassigned` 面板附带归入目标选择器与归入按钮。
- `enterWorld(worldId): void` / `leaveWorld(): void`：在两级之间切换，并复位当前条目、搜索框与分类标签。
- `renderWorldDetailHeader(): void`：渲染二级标题、世界编号/状态与概述。
- `createWorld(): void`：用 `nextWorldId()` 分配新世界编号，写入世界条目后直接进入该世界。
- `adoptWorldGroup(sourceId, targetId): void`：把某个未归属世界编号下的全部非世界条目改到目标世界并重新渲染一级。

### World Scope 纯函数

- 位置：`dist/world-scope.js`
- `worldIdOf(entry)`：返回条目的世界编号，缺失时回退到 `W01`。
- `groups(entries)`：按世界编号分组，附带世界条目、非世界条目、各类型计数、标题与 `assigned` 判定；按编号排序。
- `loreOfWorld(entries, worldId)`：只返回该世界的资料；`worldId` 为空时返回全部资料的副本。
- `nextWorldId(entries)`：返回最小未占用的两位世界编号；已被资料引用但无世界条目的编号也算占用。
- `countByType(entries)`：按资料类型计数。
- `searchWorlds(groups, query)`：按世界标题、编号、摘要与正文过滤分组。
- `reassign(entries, sourceWorldId, targetWorldId)`：把来源编号下的非世界条目改到目标编号，返回新数组与实际搬运条数；世界条目自身不参与搬运。

### 选择窗口函数

- `pickerTargets`：选择窗口的目标注册表。`lore`（关联资料，排除当前编辑条目）、`card`（卡牌设定来源，提交后刷新参考图画作池）、`free`（自由创作参考资料）；每个目标声明 `title`、`eyebrow`、`exclude`、`get`、`set`、`summary`、`button`、`label`、`empty`、`after`。
- `relationTypeOptions(): void`：首次打开窗口时用 13 类资料填充 `#relationTypeFilter`。
- `normalizeSelection(value): string[]`：去重、去空并规范化为稳定 ID 数组，供三个目标共用。
- `renderPickerSummary(key)` / `renderPickerSummaries(): void`：渲染某个目标（或全部目标）的已选标签、失效引用提示、空状态与按钮文案。
- `populateRelations(selected): void` / `populateCardLoreRefs(selected): void`：把已保存条目装入对应目标的选择状态；名称保留，供载入、保存与 AI 候选应用复用。
- `selectedCardLoreRefs(): string[]` / `freeReferenceIds(): string[]`：读取卡牌设定来源与自由创作参考资料的当前选择。
- `pickerFilters(): object`：从窗口控件与当前世界组装过滤条件。
- `openPicker(key): void`：按目标改写标题与眉标、把该目标的选择复制为草稿、重置过滤器并打开窗口。
- `renderPicker(): void`：渲染资料池与已选区并更新计数与空状态；排除规则来自当前目标。
- `pickerPoolRow(entry)` / `pickerChosenRow(entry)`：生成资料池条目（点击切换草稿）与已选条目（带移除按钮）。
- `applyPicker(): void`：把草稿写回当前目标、刷新该目标已选区并执行其 `after` 副作用；取消或关闭窗口不会写回。

### Relation Picker 纯函数

- 位置：`dist/relation-picker.js`
- `filter(entries, options)`：按查询、类型、状态、世界模式、排除项、显示视图与已选集合过滤资料；`worldMode` 支持 `current` / `other` / `all`，当前世界为空时不做世界收窄。
- `toggle(ids, id)`：加入或移除一条关联，保持添加顺序。
- `remove(ids, id)`：移除指定关联。
- `summarize(ids, entries)`：按选择顺序返回仍然存在的条目，用于标签与已选区渲染。
- `missingCount(ids, entries)`：返回已失效引用的数量。

### Agent 工具函数

- 位置：`ai-tools.mjs`
- `AGENT_LIMITS`：条目数、正文长度、搜索/读取条数、单次结果字符、美术资产条数与附图张数的硬上限。
- `prepareLibrary(entries)` / `prepareArtAssets(assets)`：规范化并裁剪资料条目与美术资产索引；后者只接受 `ART-` 前缀编号。
- `FREE_AGENT_TOOLS` / `FREE_AGENT_TOOL_NAMES`：五个只读工具的说明与参数 Schema，全部 `additionalProperties: false`。
- `runToolCall(name, args, library, artAssets)`：执行单个工具，返回 `{ ok, content, summary, imageIds? }`；`imageIds` 是需要由调用方解析并附到对话里的资产编号。未知工具、缺参或越界都以可恢复错误文本交回模型，不抛出。

### Agent 循环与线格式函数

- 位置：`ai-agent.mjs`
- `runAgentLoop(options)`：多轮编排。模型调用与工具执行由 `callModel` / `runTool` 注入；`maxRounds` 默认 6、`maxToolCalls` 默认 12；单轮附图上限 4 张，附图作为工具结果之后的用户消息发出。返回 `{ reply, trace, rounds, toolCalls, stopped, vision, images }`，`stopped` 为 `answer` / `tool_budget` / `round_limit`，`vision` 为 `ok` / `unavailable` / `none`。
- `countImages(messages)` / `stripImages(messages)`：统计会话中的附图数量；降级时把附图改写为文字说明，不静默丢图。
- `toolsForChat(tools)` / `toolsForResponses(tools)`：把统一工具声明转成两种风格的线格式。
- `buildChatMessages(system, messages)` / `buildResponsesInput(messages)`：把统一会话转成 `tool_calls` + `role: 'tool'`，或 `function_call` + `function_call_output`；带图用户消息分别产出 `image_url` 与 `input_image` 内容块。
- `parseChatText(data)` / `parseChatToolCalls(data)` / `parseResponsesText(data)` / `parseResponsesToolCalls(data)`：从两种响应体提取文本与工具调用。
- `createToolCaller({ config, system, fetchImpl, timeout })`：返回 `callModel({ messages, tools })`；`tools` 为空数组时不发送工具字段，用于强制收尾。

### 界面偏好与素材绑定函数

- `readUiState()` / `setAiPanel(state)` / `applyAiPanel()` / `aiPanelState()`：AI 助手浮动窗口的三态开关，状态存于本地键 `worldforge-ui-state-v1`。
- `clearCardArt(): void`：取消当前卡牌的原画选择并重绘卡面。
- `unbindArtAsset(asset): void`：确认后调用 `POST /api/art-assets/:id/unbind`，成功时把本地资产标记为 `unbound` 并重绘视觉原型、附件托盘与原画集。
- `overwriteWithAiVariant(index): void`：用指定候选覆盖当前已保存条目已勾选的内容块并立即保存；仅在非故事模式且存在 `activeLoreId` 时提供入口。

### 服务端函数

- `loadLocalEnv()`：解析本机配置文件；持久化配置优先于启动时注入的同名 LLM 环境变量。
- `saveLocalEnv(values)`：保留无关配置并原子更新受管理的 LLM 字段；Docker 中写入持久化卷。
- `loadPromptSettings()` / `savePromptSettings(settings)`：读取、补齐默认值并原子保存 `prompt-settings.json`；Docker 中与其他本机设置共用持久化卷。
- `aiConfig()`：返回服务端 LLM 地址、模型与 API 风格；不向前端返回 Key。
- `validateSettings(payload)`：限制 URL、模型、Key 长度及换行字符，并委托提示词设置校验拒绝未知分类或超长文本。
- `normalizePromptSettings(value)` / `validatePromptSettings(value)`：保证 13 类提示词齐全，保留作者空值和精调内容，限制分类白名单与每段 8000 字符。
- `buildContextBundle(payload, budget)`：先抽取最多 4 条同世界、同类型 canon 条目作为独立示例，再按显式关联、同世界 canon、同世界、同类型和共享标签排序其他上下文，隔离无关世界并按预算裁剪。
- `contentSpec(type, draft)` / `normalizeSelectedBlocks(type, selected, draft)`：返回类型专属内容块，并在编年史容器中移除只属于节点的纪年与排序字段。
- `generationContract(payload)` / `createLoreResponseSchema(payload)`：把作者勾选项编译为本次唯一允许返回的动态内容块契约与严格 JSON Schema。
- `buildPrompt(payload, bundle)`：分层组合模块写作重点、选中内容块说明、作者要求、分类提示、个性化风格、示例和上下文，并禁止元说明进入正文。
- `createModelBody(config, prompt, options)`：为 Responses 或 Chat Completions 构造动态原生 JSON Schema 或自由文本请求；兼容服务可降级。
- `validateAiResponse(value, payload)` / `parseAiResponse(raw, payload)`：验证候选数量、唯一 key、选中字段的类型，并拒绝缺失块或任何未选择字段。
- `parseNameResponse(raw, expectedCount)`：验证名称生成器的候选数量、名称与简短说明。
- `callAi(payload)`：执行结构化请求、兼容降级、一次格式修复和候选数量复核。
- `callFreeAgent(payload)`：裁剪最近 20 条对话与作者关联信息；有可检索范围时以只读资料工具驱动多轮调用（`runAgentLoop` + `createToolCaller`），否则退回单轮问答；返回 `{ reply, toolMode, vision, images, trace, rounds, toolCalls, stopped }`。模型拒绝工具时降级为不带工具的单轮问答并标注 `toolMode: 'unavailable'`。
- `resolveAgentImages(value, maximum)`：按资产编号从资产目录读取图片并转成 data URL；单个编号失败只记入 `missing`，不影响其余图片。
- `callNameGenerator(payload)`：按命名类型、数量、要求和上下文执行独立的结构化名称生成。
- `serveStatic(req, res)`：安全解析路径并提供 `dist/` 静态文件。
- `createContentStore(databasePath)`：打开 SQLite、设置连接参数并执行内容域前向迁移；迁移失败时关闭连接，成功后返回快照读取、事务替换、健康检查、美术资产读写与关闭接口。
- `setArtAssetTarget(id, target)`：`target` 为空或缺少 `targetId` 时解除该美术资产的绑定（置 `unbound`、清空目标），否则重新绑定；资产不存在返回 `null`。解除不删除文件与记录。
- `contentSchemaVersion(database)`：读取 `PRAGMA user_version`，作为现有作者内容域的 Schema 版本。
- `applyContentMigrations(database)`：从当前版本顺序应用缺失迁移；每一步在独立事务中完成 DDL、索引和版本提交，并返回本次启动的迁移报告。
- `UnsupportedContentSchemaError`：数据库版本高于当前程序支持版本时抛出的明确错误，防止旧程序误写未来格式。
- `validateContentSnapshot(value)`：限制数组规模、备注长度、稳定 ID 和重复 ID，避免非法快照进入数据库。

### World Package 与实例函数

- `canonicalJson(value)`：递归按对象键排序并生成无空白规范 JSON，作为可重复内容寻址输入。
- `packageHash(value)`：对规范 JSON 计算 SHA-256；编译产物和实例化入口共同使用该哈希检测定义篡改。
- `compileWorldPackage({ manifest, contentSources, mechanicRegistry })`：执行纯内存编译；校验 JSON 清单、稳定 ID、世界边界、发布状态、引用、事实层次、机制参数与依赖，并返回递归冻结的 World Package。
- `compileWorldPackageFile(manifestPath)`：读取清单中的相对 JSON 内容源和机制注册表后调用纯编译器；依赖路径限制在清单目录的上一级边界内，不读取 SQLite 作者工作区或边界外文件。
- `writeWorldPackageFile(manifestPath, outputPath)`：编译并把格式化 JSON 包写入显式输出路径。
- `createWorldInstanceStore(databasePath)`：打开独立模拟数据库、执行 `sim_schema_migrations`，返回实例化、读取、健康检查和关闭接口。
- `instantiate(worldPackage, { instanceId, randomSeed })`：复核包哈希，并在单一事务中写入实例元数据、内嵌定义包、初始地区、实体和事件。
- `read(instanceId)`：返回实例锁定的定义版本/哈希、随机种子、当前 Tick 和基础状态；不存在时返回 `null`。

### M1 规则与运行时函数

- `validateSchema(schema, value, path, code)`：执行运行时受限 JSON Schema 子集校验；支持对象、字符串、安全整数、有限数值、布尔、`const`、`enum`、范围、正则与 `oneOf`，失败时返回稳定规则错误码。
- `validateContract(mechanic)`：注册机制时验证具体 Action/Effect、受控资源访问路径和知识分类/TTL 权限；缺少契约或使用任意 JSONPath 会拒绝启动。
- `effectWritePaths(effect)`：把 `resource.transfer` 的来源与目标端点规范化为资源写路径，供机制写集授权检查。
- `scopedContext(contract, context)`：按机制 `reads` 声明投影 Tick、主体、知识及地区/实体资源字段，不把未声明状态或额外真值交给 Validator、Resolver 与知识策略。
- `deterministicSample(seed, tick, scope)`：对实例 seed、目标 Tick 和 Action ID 计算 SHA-256 样本；用于稳定排序同 Tick 竞争行动，样本随 Action/Event 持久化。
- `createMechanicRuntime(mechanics)`：按 Action 命名空间注册受信任机制，统一调用可用行动、校验和效果候选接口；在业务 Validator 前校验 Action，在 Resolver 后校验 Effect 类型/Schema/写集，并限制知识分类与 TTL。
- `resourceTotal(state, resourceId)`：汇总地区储备、已消耗池与实体余额，拒绝负数、非整数或不安全总量。
- `applyWorldEffects(state, effects)`：在状态副本上只执行白名单 `resource.transfer`，检查端点、余额和转移前后总量守恒，不直接写数据库。
- `createEnergyCrisisMechanic({ resourceId })`：建立 `MEC-001@1.1.0`，提供 `energy.request / transfer / consume` 及其契约；资源不足的公共储备拒绝原因不返回隐藏余额。
- `compileKnowledgeView(records, subjectId, atTick)`：只返回属于该主体、已观测且尚未过期的知识，按观测 Tick 和稳定 ID 排序。
- `knowledgeRecipients(action, state, policy)`：默认只包含行动者；能源转交包含接收者；仅受信任机制返回公开知识策略时广播给全部实体，主体不能自行指定传播或过期策略。
- `createSimulationRuntime({ store, mechanics })`：组合机制运行时和实例存储，提供 `advance`、`availableActions`、`knowledgeView` 与 `replay`。
- `advance(instanceId, { expectedStateVersion, actions })`：验证状态版本和 expected Tick，以记录的确定性样本排序，在工作副本中顺序解决冲突，最后原子提交 Action、Event、KnowledgeRecord、状态和 Snapshot。
- `availableActions(instanceId, subjectId)`：只把冻结的主体资料、KnowledgeView 与当前 Tick 交给决策入口，不提供全局权威状态。
- `replay(instanceId, targetTick, { snapshotTick })`：从指定快照开始应用已提交的行动效果与知识事件，不重新运行机制/随机数；结果哈希必须匹配目标快照。
- `replayCommittedEvents(snapshot, events, targetTick)`：纯函数重放器，供运行时和测试复用。
- `commitTick(...)`：模拟存储的事务提交入口；在事务内再次检查 Tick/状态版本，更新状态并写入完整审计记录和快照。
- `readSnapshot` / `readEvents` / `readKnowledge` / `readActions`：读取权威快照、事件范围、主体知识原始记录和行动审计。

### M1 契约编译函数

- `validateContractSchema(schema, path)`：编译期验证首版受限 Schema 结构，要求对象拒绝额外字段且必填字段必须有属性定义。
- `compileMechanicContract(mechanic)`：验证 Action/Effect 命名空间、唯一类型、受控资源路径、知识分类与最大 TTL，并生成进入 World Package 的契约副本。
- `compileMechanics(...)`：除版本、参数与依赖拓扑外，将机制契约嵌入编译模块；契约变化会改变规范 JSON 和 `packageHash`。

### M2A 模拟观察台函数

- `createSimulationDashboardService(databasePath, options)`：打开独立模拟存档，确保固定 W99 实验实例存在，并组合运行时提供 `view`、`advance`、`run`、`reset`、健康检查和关闭入口。
- `normalizeProposals(proposals, instance)`：限制每 Tick 至多 10 个提案，只接受当前实例主体和 `energy.*` 类型，由服务器生成 Action ID 与 expected Tick。
- `view()`：返回实例元数据、机制 Action 契约、地区/主体资源、能源流转进度、重放校验、记录计数、最近 30 条 Action/Event 和逐主体 KnowledgeView。
- `advance(payload)`：校验 expectedStateVersion 后把外部提案送入现有模拟运行时，成功提交后返回新的完整观察视图；过期版本返回 409。
- `proposeEnergyCrisisActions(instance)`：为 W99 的供能机构和市政机构生成确定性 Action 提案，只使用主体角色、自身余额、公开地区和目标 ID。
- `energyCrisisProgress(instance)`：汇总储备、主体持有和累计消耗，并在储备与持有同时归零时标记危机完成。
- `run(payload)`：在 1–50 Tick 的有界循环中调用规则主体和标准运行时，达到完成条件或上限后停止并验证 Tick 0 历史重放。
- `reset(worldPackage, options)` / `reset(payload)`：在 SQLite 事务内删除固定实验实例的全部关联记录并以相同定义和随机种子重建 Tick 0；服务层要求当前状态版本。
- `refreshSimulation()` / `renderSimulation()`：读取观察 API，并把 Tick、版本、能源、权威状态、主体知识、行动审计和事件流渲染到“世界模拟”模块。
- `simulationPreset(name)` / `advanceSimulation(name)`：构造竞争申请、主体转交、能源消耗或空 Tick 提案，通过带请求标记的相对 API URL 提交并刷新页面。
- `runFullSimulation()` / `resetSimulation()`：从 UI 发起完整有界推演或经确认后重置，期间锁定控制区并显示完成原因和重放结果。

### `apiUrl(path: string): URL`

- 位置：`dist/app.js`
- 以当前 `app.js` 的实际 URL 为基准构造同目录下的 `api/` 请求地址。
- 根路径部署时继续请求 `/api/...`；挂载于 `/worldforge` 时自动请求 `/worldforge/api/...`，无需维护两套镜像或占用站点根路径。

## 4. 本地数据契约

SQLite 是运行时内容的权威数据源。Docker 使用 `/data/worldforge.sqlite`；本机 `npm start` 默认使用 `.data/worldforge.sqlite`。数据库 Schema 版本 2 包含：

- `metadata`：初始化状态、revision 与更新时间；
- `lore_entries`：设定稳定 ID、名称、类型、状态、事实层次、世界 ID 和完整 JSON；
- `card_drafts`：卡牌稳定 ID、名称、类型、状态、世界 ID 和完整 JSON；
- `keywords`：关键词稳定 ID、名称、状态、定义和完整 JSON；
- `notes`：固定问题键、正文和更新时间。
- `art_assets`：AI 卡面候选元数据；图片本体保存在持久卷文件目录。

内容库从版本 0 按 `0 → 1 → 2` 顺序升级，版本号只在对应迁移事务成功后更新。版本 1 的既有内容会原位保留并补充版本 2 的美术资产表；高于版本 2 的数据库会被拒绝打开。`GET /api/health` 的数据库信息会返回本次启动的迁移起点、当前版本和已应用步骤。

`PRAGMA user_version` 只属于现有作者内容域。未来模拟状态使用 `sim_` 表名前缀、独立的 `sim_schema_migrations` 账本与 `simulation/storage/` 边界；M0A 没有创建任何模拟表，也没有把作者草案当作可运行世界状态。

M0B 发布清单与定义包使用 UTF-8 JSON。清单固定声明世界、Definition 版本、源 commit、编译器、内容源、状态选择、机制和初始状态；默认只选择 `canon`，显式实验条目会使包标记为 `experimental`。编译输出按 `objectiveDefinitions / beliefSeeds / unresolvedMetadata` 保存事实层次，并带确定性 `packageHash`。

模拟存档 Schema 版本 2 使用独立数据库和 `sim_schema_migrations`。版本 1 的 `sim_instances / regions / entities / events` 继续保留；版本 2 为实例增加 `state_version` 和状态，并新增 `sim_actions`、`sim_knowledge_records`、`sim_snapshots`。实例仍内嵌完整只读定义包；旧 M0B 实例升级时会在当前 Tick 回填状态快照。

M1 每次推进恰好增加一个 Tick 和一个状态版本。行动状态变更、接受/拒绝审计、效果事件、知识观察事件、Tick 提交事件及目标快照在同一 SQLite 事务中提交。快照保存地区/实体权威状态、截至该 Tick 的知识日志和规范状态哈希；重放不会从目标真值补写过去知识。

M2A 默认在内容数据库同目录建立 `worldforge-simulation.sqlite`，也可用 `WORLDFORGE_SIM_DB_PATH` 指定。`GET /api/simulation` 只公开固定 W99 实验实例的观察视图；`POST /api/simulation/advance` 要求 `X-Worldforge-Simulation: 1` 和当前状态版本，只接受 Action 提案，不接受客户端 Effect、知识记录、随机样本、Action ID 或 Tick。

浏览器缓存键 `worldforge-decisions-v1` 的数据结构为：

```json
{
  "medium": "作者对魔导介质的草案备注",
  "formula": "作者对术式工程的草案备注",
  "divinity": "作者对神性边界的草案备注",
  "faith": "作者对神迹可证性的草案备注",
  "combat": "作者对基础对战规则的草案备注"
}
```

统一导出当前 schemaVersion 为 10，包含 `project`、`exportedAt`、`loreEntries`（含 `story`、地理父级和编年史结构）、`notes`、`keywords`、`cardDrafts` 与 `artAssets`。每张卡牌草案自身固定带有 `proposed` 和 `untested` 状态，避免把运行时草案误认为正式内容。

卡牌草案存储键：`worldforge-card-drafts-v1`。每个条目包含本地草案 ID、名称、世界归属、三分类类型、稀有度、按类型规范化的属性、关键词引用、多个 `loreRefs` 来源、规则文本、趣闻、原画与裁剪参数、`proposed` 状态及 `untested` 平衡状态。随从使用 `attack + health`，法术三项战斗属性均为 `null`，武器使用 `attack + durability`。关键词引用使用 `keywordUsages: [{ keywordId, detail }]`；兼容字段 `keywordIds` 继续由规范化函数生成。

关键词存储键：`worldforge-keywords-v1`。每个条目包含本地关键词 ID、名称、规则说明和 `proposed` 状态。统一导出文件包含 `notes`、`keywords` 和 `cardDrafts`。

设定资料缓存键：`worldforge-lore-entries-v1`。普通条目包含 `id`、`type`、`name`、`status`、`truthScope`、`worldId`、摘要、正文、约束、开放问题、标签、关联 ID、三个类型专属属性和可选地图信息。地理信息使用 `location: { kind, parentId, x, y, environment }`；`kind` 支持 `country / region / area / city / site / route`，非国家条目通过 `parentId` 引用同一世界中的合法上级。背景故事使用 `type: story` 与 `STORY-W01-DRAFT-*` 本地 ID；创作内容仅使用 `name` 与 `details`，通过 `relationIds` 挂载普通资料并关联其他故事。兼容字段在存储中固定为空或内部默认值，不进入故事编辑界面。

编辑偏好存储键：`worldforge-preferences-v1`，包含 `theme`、`density`、`worldId`、`defaultStatus` 与 `truthScope`。该数据不进入统一内容导出。API Key 永不进入浏览器存储；`GET /api/settings` 只返回 `configured` 布尔值和非敏感配置。

提示词设置保存在本机服务端 `prompt-settings.json`；Docker 默认位于 `worldforge-data` 卷。结构为 `{ version, personalizedPrompt, typePrompts }`，其中 `typePrompts` 固定覆盖 13 类 lore。提示词不是 lore、不会进入 SQLite 内容快照或统一 JSON 导出，也不会自动晋升为正史；`GET /api/settings` 会把这些非敏感文本返回设置界面。

模块 AI 返回 `{ variants: [{ key, content }] }`；`content` 的必填键和允许键都由本次勾选内容块动态决定。当前支持名称、摘要、正文、三个类型属性、限制、开放问题、白名单关联建议，以及地图环境、编年纪年与排序等类型专属块。返回未选字段、遗漏选中字段或引用上下文外 ID 都会被拒绝。自由创作接口返回自然语言 `reply`，不使用模块 Schema；名称工具返回 `{ names: [{ name, note }] }`。

## 14. 2026-10-12 AI 上下文工程与候选选择归档

- 上下文包包含当前草案、项目固定约束及按相关度挑选的资料条目；显式关联优先，其次为同世界 canon，再到同世界同类型或共享标签资料。
- 非显式关联的其他世界资料被隔离；单条正文和整体上下文均有限额，最多接收 500 个本地候选条目并在约 60000 字符预算内选择。
- 上下文被标记为不可信数据，模型不得执行资料正文中出现的指令。
- Responses API 与 Chat Completions 均优先使用原生 JSON Schema；不兼容服务仅在 400/404/422 时降级为 JSON 指令模式。
- 返回值经过服务端二次校验；格式、字段、候选数量或关联 ID 错误时最多发起一次修复请求，修复后仍失败则不向前端交付候选。
- 前端允许生成 2–5 份方案，逐份展示摘要、正文、约束、开放问题、冲突、假设和建议关联。
- 生成阶段不写 `localStorage`；用户可多选、单选或不选，只有点击保存时才为所选方案分配新 ID 并分别保存为 `proposed`。

验证：`node:test` 的 4 个 harness 测试覆盖上下文优先级与跨世界隔离、动态候选数量、非法引用拒绝、代码围栏解析及两类 API 的原生 Schema 请求；全部通过。`server.mjs`、`ai-harness.mjs` 与 `dist/app.js` 语法检查通过，108 个 HTML ID 唯一且脚本引用存在；Docker 镜像构建成功，交付首页返回 HTTP 200，容器状态为 `healthy`。未配置真实 Key，因此没有声称完成外部模型端到端调用。

## 15. 2026-10-12 Tailscale 子路径交付归档

本次修改不涉及世界观、正史、卡牌语义或公开内容数据接口，只调整部署路径兼容与本机交付：

- `dist/app.js` 新增 `API_ROOT` 与 `apiUrl(path)`，根据脚本自身地址生成设置和 AI API URL，消除写死的根路径 `/api/...`。
- `openSettings()`、`saveSettings()`、`refreshAiStatus()` 与 `runAi()` 全部改用子路径感知的 API URL。
- `dist/index.html` 将脚本版本查询参数更新为 `v=9`，避免浏览器继续使用不支持子路径的缓存脚本。
- `dist/index.html` 在加载相对资源前将无扩展名、无尾斜杠的挂载地址规范化为带 `/` 的地址；`/worldforge` 因此会进入 `/worldforge/`，而 `/` 与直接打开 `index.html` 保持不变。
- 新增 `tests/subpath-routing.test.mjs`，检查所有浏览器 API 请求均通过 `apiUrl()`，并禁止重新引入 `fetch('/api/...')`。
- `tests/README.md` 增加现有两组测试的职责说明。
- 本机 Tailscale Serve 新增 `/worldforge` 到 `http://127.0.0.1:4173` 的代理，保留原有 `/`、`/dsh`、`/agent`、`/calendar` 与 `/calendar.ics` 路由。
- Docker 端口继续只绑定本机回环地址；Tailscale 路由为 tailnet-only，没有启用 Funnel。

运行入口：<https://sisi-laptop.tail921448.ts.net/worldforge/>。

验证：`npm run check` 的语法检查和 6 项 Node 测试全部通过；Docker 镜像重新构建后容器进入 `healthy`；tailnet HTTPS 首页、静态资源与 `/worldforge/api/ai/status` 均返回 HTTP 200。未向外部模型发起生成请求。

## 16. 2026-10-13 SQLite 内容持久化归档

本次修改由作者明确要求，并由 [ADR-0004](../adr/ADR-0004-sqlite-content-persistence.md) 记录。它不改变世界观、正史层级、卡牌语义或作者审核边界。

### 存储与服务端

- 新增 `storage.mjs`，使用 Node 22 的 `node:sqlite` 创建 Schema 版本 1。
- `lore_entries`、`card_drafts`、`keywords` 和 `notes` 分表保存；常用筛选字段独立成列，完整条目同时保存为受 `json_valid` 约束的 JSON。
- 启用 WAL、`synchronous=NORMAL`、严格表与常用索引；一次内容保存由 `BEGIN IMMEDIATE` 事务整体提交或回滚。
- `metadata` 保存初始化状态、递增 revision 与最后更新时间；客户端写入旧 revision 时返回 HTTP 409，不静默覆盖。
- `validateContentSnapshot()` 限制每类最多 10000 项、备注最多 200 项，检查稳定 ID、重复 ID、备注类型与长度。
- 本机默认数据库为 `.data/worldforge.sqlite`；Compose 显式设置 `/data/worldforge.sqlite`，沿用 `worldforge-data` 持久化卷。
- Docker 镜像新增 `storage.mjs`，健康检查由 AI 状态改为 `/api/health` 的 SQLite `quick_check`。
- Node.js 最低版本由 20 提升为 22.5；没有新增 npm 依赖。

### HTTP 接口

- `GET /api/health`：返回服务状态、SQLite `quick_check`、数据库路径和 Schema 版本。
- `GET /api/content`：返回初始化状态、revision、更新时间及四类完整内容。
- `PUT /api/content`：要求 JSON 与 `X-Worldforge-Content: 1`，校验后事务替换完整快照；revision 不匹配时返回 409。
- 内容接口不返回 API Key，也不开放跨域；Tailscale 部署继续使用 `/worldforge/api/...` 子路径。

### 浏览器同步与迁移

- `hydrateContent()` 在界面渲染前读取 SQLite，并将结果写入当前 Origin 的 `localStorage` 缓存。
- `writeStore()` 对内容键继续立即写缓存，同时以 160ms 防抖调用 `persistContent()` 保存数据库。
- 数据库未初始化时，首个包含旧内容的浏览器自动迁移；空浏览器不会抢先初始化数据库。
- 数据库已经存在而新 Origin 仍有旧内容时，设定、卡牌和关键词按稳定 ID 合并，备注按键合并；同 ID 以正在迁移的浏览器版本为准。
- 合并前的浏览器快照保存在 `worldforge-pre-sqlite-backup-v1`，迁移完成标记为 `worldforge-sqlite-migrated-v1`。
- 顶栏显示“正在连接 SQLite”“SQLite 已连接/已保存”“保存失败”或“存在版本冲突”。服务不可用时继续显示浏览器缓存，但明确标记为离线。
- JSON 导出升级到 schemaVersion 3，文件名统一为 `worldforge-data.json`；编辑偏好仍不进入 SQLite 或导出。

### 修改文件

- 新增：`storage.mjs`、`tests/storage.test.mjs`、`docs/adr/ADR-0004-sqlite-content-persistence.md`。
- 修改：`server.mjs`、`Dockerfile`、`compose.yaml`、`package.json`、`.gitignore`。
- 修改：`dist/app.js`、`dist/index.html`、`dist/styles.css`。
- 更新：`README.md`、`CHANGELOG.md`、`todo.md`、`tests/README.md`、ADR 索引与本静态文档。

### 验证与限制

- `npm run check` 的语法检查和 8 项 Node 测试全部通过；SQLite 测试覆盖结构化内容往返、健康检查、重复 ID 拒绝与过期 revision 拒绝。
- 使用独立测试容器和临时内存数据库验证 HTTP 内容写入、读取与过期 revision 返回 409；测试容器随后已删除，未接触生产卷。
- `docker compose config` 解析通过；镜像重建后容器状态为 `healthy`。
- 本机与 Tailscale 的 `/api/health` 均确认数据库 `ok: true`、路径 `/data/worldforge.sqlite`、Schema 版本 1。
- 持久化卷内已创建 SQLite 主文件、WAL 与共享内存文件；只读检查确认生产数据库仍为 `initialized: false / revision: 0`，没有写入测试数据。
- 当前没有实时多人协作、自动 Git 正史同步、定时数据库备份或恢复 UI；这些项目已列入 TODO，不能宣称已经完成。

## 13. 2026-10-12 全局设置栏归档

- 顶栏新增“设置”，分为 AI 服务、编辑偏好和数据管理。
- AI 服务可编辑 API Key、Base URL、模型和 Responses / Chat Completions 类型，也可显式清除已保存 Key。
- 服务端新增 `GET/POST /api/settings`；写请求要求 JSON 和 `X-Worldforge-Settings: 1`，不开放跨域，也不回传 Key。
- 本机运行写入 `.env.local`；Docker 写入 `worldforge-data` 卷，并在当前进程立即生效。
- 编辑偏好支持浅色、深色、跟随系统、舒适/紧凑密度，以及新资料默认世界、状态和事实层次。
- 数据管理显示本地设定、卡牌、关键词数量，并复用完整 JSON 导出。
- Compose 继续使用只读根文件系统，仅 `/data` 持久化卷和 `/tmp` 可写。

验证：Node 语法、106 个唯一 DOM ID 与脚本引用、Compose 配置均通过；使用隔离文件验证配置保存与即时状态更新；使用虚拟 Key 验证 Docker 重启持久化并在测试后清除。未向外部模型发起测试请求。

## 12. 2026-10-12 设定编辑器与 AI 接入归档

- 原只读世界观面板升级为 12 类结构化资料库；新资料始终默认 `proposed`，宗教资料默认使用 `in_world_belief`。
- W01 现有基线作为不可删除的种子条目显示，编辑后保存会形成浏览器本地副本，不直接改仓库正史。
- 地图与地点具有区域类型、坐标、环境交通字段；其他类型分别显示三项常用专业属性。
- 条目支持约束、开放问题、标签与跨类型引用；删除草案时同步移除悬空引用。
- 新增服务端 AI 代理，Key 只从 `.env.local` / 进程环境读取；浏览器只获得是否已配置、模型名和输出文本。
- AI 系统提示强制区分事实层次、把新增内容保持为候选，并规避第三方 IP 复制。
- Docker 镜像改用 Node 22 Alpine；Compose 可选加载 `.env.local`，仍为只读容器和本机端口。

验证：`dist/app.js` 与 `server.mjs` 通过 Node 语法检查；86 个 HTML ID 唯一且脚本引用存在；Compose 配置解析与 Docker 镜像构建通过；在含中文的 Windows 路径上验证 `/api/ai/status` 返回未配置状态，首页返回 HTTP 200；交付容器为 `healthy`。真实浏览器自动化因工具无法可靠确认当前 Edge URL 而中止，未声称完成视觉验收。

## 5. 边界与验证

- 页面不依赖构建工具；可直接打开 `dist/index.html`。
- 界面只使用系统字体，不依赖外部字体或图片资源。
- 完整模式下，草案保存在 SQLite，清理浏览器数据不会删除数据库内容；直接打开 HTML 时只能使用当前浏览器缓存。
- 页面不读取或写入仓库内容；当前支持跨地址共享，不提供多人实时协作。
- 支持窄屏布局、键盘可达的按钮与对话框、减少动态效果偏好。

## 6. 2026-10-11 初始化归档

本次修改完成 M0 与 HTML 产品首版，变更范围如下：

- 产品：新增 `dist/index.html`、`dist/styles.css`、`dist/app.js`，包含响应式展示、状态筛选、裁定对话框、本地存储、JSON 导出与主题切换。
- 托管：新增 `.openai/hosting.json`，静态目录指向 `dist`；站点项目 ID 已持久化，但源码同步与部署需要作者明确授权。
- 宇宙：新增 `UNI-001` 至 `UNI-003` 的 `proposed`/`unknown` 占位条目及开放问题索引，没有建立宇宙正史。
- 世界：新增 W01 概述、物理、技术、社会、宗教、时间线及势力、角色、地点、事件索引；只确认项目文档已有的魔导工业方向。
- 机制与卡牌：新增待定规则文档、关键词索引、卡牌索引与最小 JSON Schema；没有生成正式卡池或宣称平衡结果。
- 模板：新增 lore、势力、角色、事件、关键词、卡牌与 ADR 模板。
- 项目管理：新增 `CHANGELOG.md`、`todo.md`、编辑风格、正史政策、ADR 索引以及 scripts/exports/tests 说明。
- 入口说明：更新 `README.md`，增加 HTML 产品的直接使用方式。

检查记录：HTML 已通过标准库解析；`dist/app.js` 已通过 Node 语法检查；新增文件已完成静态内容复核。由于隔离浏览器无法访问本机预览端口，尚未完成真实浏览器视觉 QA。

## 7. 2026-10-11 Docker 本地交付归档

本次修改未改变任何世界观、机制或卡牌语义，只增加本地运行能力：

- 新增 `Dockerfile`，使用 Nginx 提供 `dist/` 静态内容，容器端口为 `8080`。
- 新增 `compose.yaml`，将服务限制在 `127.0.0.1:4173`，配置 `unless-stopped`、只读根文件系统、临时写目录与 `no-new-privileges`。
- 新增 `docker/nginx.conf`，提供单页回退、gzip、静态缓存与基础安全响应头。
- 新增 `.dockerignore`，确保镜像不包含 `.git`、`.openai`、设计源文档、模板和测试目录。
- 更新 `README.md`、`CHANGELOG.md` 与 `todo.md`，记录启动、停止和完成状态。

### 运行接口

- 启动：`docker compose up -d --build`
- 访问：`http://127.0.0.1:4173`
- 停止：`docker compose down`
- 容器名：`worldforge`
- 镜像名：`worldforge:local`

### 运行约束

- `4173` 仅绑定本机回环地址，不对局域网公开。
- 浏览器草案仍保存在访问该地址的浏览器 `localStorage` 中。
- 容器重新创建不会清除浏览器本地草案。
- Docker 镜像不包含内容仓库的 Markdown/YAML 源文件。

### 验证记录

- `docker compose config` 解析通过。
- 镜像 `worldforge:local` 构建成功，容器 `worldforge` 状态为 `running / healthy`。
- `http://127.0.0.1:4173/` 返回 `HTTP 200` 与 `text/html; charset=utf-8`。
- 真实浏览器已验证首屏渲染、内容状态筛选、草案对话框、本地保存与计数更新；测试草案随后已清空。
- 初始版本页面标题与资源加载已通过浏览器验证。

## 8. 2026-10-11 双模块简约界面归档

本次根据作者反馈重构产品界面，不改变设定文件、规则或卡牌正史：

- 保留 `Worldforge` 作为产品名，不增加功能层面的主题化别名。
- 移除口号、锻造隐喻、巨幅标题、轨道图形、深色叙事区块与装饰性动效。
- 顶部导航固定为“世界观架构”和“卡牌设计”两个产品模块。
- 世界观模块新增目录、项目统计、基础设定列表、搜索、未决问题和本地备注。
- 卡牌模块新增规则准备度、卡牌字段说明、草案列表、搜索和本地草案表单。
- 卡牌草案固定标记为 `proposed / untested`；基础规则未确认时不生成正式卡池。
- 视觉改为中性色背景、白色面板、细边框、蓝色主操作和系统字体，优先保证信息层级与可读性。
- 为 CSS 与 JavaScript 入口增加版本查询参数，避免 Docker 重建后浏览器继续使用旧资源缓存。
- 卡牌草案对话框的关闭与取消操作跳过必填校验，保证空白表单可以直接退出。
- 保留 Docker 本地交付方式和 `127.0.0.1:4173` 端口，不执行 Sites 上传。
- 已在桌面与窄屏浏览器验证两个模块切换、备注入口、卡牌表单打开与空白取消；控制台未发现警告或错误。

## 9. 2026-10-11 卡面编辑与关键词系统归档

本次修改依据作者明确确认的卡牌基础信息要求，并由 `ADR-0001` 记录边界：

- 卡面左上角为可编辑费用，左下角为可编辑攻击，右下角为可编辑血量。
- 卡面中下部为可编辑描述，名称也可在卡面顶部直接修改。
- 关键词可通过独立对话框定义名称和规则说明，创建后自动加入当前卡牌。
- 点击关键词列表可切换当前卡牌引用；已选关键词显示在卡牌描述区域。
- 保存后的卡牌以相同的数值位置和描述结构显示在预览列表，点击可重新编辑。
- 旧版浏览器草案会自动补齐攻击 0、血量 1 和空关键词列表。
- JSON 导出新增 `keywords`，卡牌草案新增 `attack`、`health` 与 `keywordIds`。
- 卡牌 Schema 与模板同步要求 `stats.attack`、`stats.health`、`keywords` 和 `rules_text`。
- UI 采用 Worldforge 原创的简约卡面，不复制第三方卡框、图标、美术或现成关键词。
- CSS 与 JavaScript 资源版本均更新为 `v=3`，避免 Docker 重建后沿用旧卡牌样式缓存。
- 窄屏卡面宽度受容器约束；在侧栏级视口中仍保持费用、攻击、血量和描述的卡面布局。

### 验证记录

- `dist/app.js` 通过 Node 语法检查；HTML 与卡牌 JSON Schema 解析通过。
- 在隔离的 `localhost:4173` 浏览器源中创建“连锁”测试关键词并保存测试卡牌，确认费用 `3`、攻击 `4`、血量 `5`、描述和关键词均持久化到同布局预览。
- 交付地址 `127.0.0.1:4173` 仅测试未保存的直接编辑和关键词对话框，随后已恢复空白编辑器，未写入验收数据。
- 真实窄屏浏览器复核了新版样式和响应式卡面；隔离验收页已关闭。

## 10. 2026-10-11 关键词附加说明归档

本次修改由作者明确确认，并由 `ADR-0002` 记录：

- 关键词定义继续保存名称和通用规则说明。
- 选择关键词后，卡牌编辑区提供可选的“附加说明”输入框。
- 未填写附加说明时，卡面只显示关键词名称。
- 填写后，编辑卡面和已保存卡牌统一显示为“关键词：附加说明”。
- 卡牌草案使用 `keywordUsages` 保存关键词 ID 与卡牌级 `detail`；旧版 `keywordIds` 自动迁移为空说明。
- 搜索会同时匹配关键词名称和附加说明。
- 卡牌 YAML 模板、JSON Schema、机制词典、ADR 索引、README、CHANGELOG 与 TODO 已同步。
- CSS 与 JavaScript 资源版本更新为 `v=4`，本地 Docker 重建后不会沿用旧缓存。

### 验证记录

- `dist/app.js` 通过 Node 语法检查；HTML 与卡牌 JSON Schema 解析通过。
- 在隔离的 `localhost:4173` 浏览器源中载入旧版测试卡，确认原关键词可无说明显示。
- 为该关键词填写卡牌级说明并保存，确认编辑卡面、右侧输入框和保存预览均显示完整的“关键词：附加说明”。
- 验收使用的隔离标签页已关闭；交付地址 `127.0.0.1:4173` 未写入测试数据。

## 11. 2026-10-11 W01 V0.1 导入归档

本次根据作者提供的《W01 魔导工业世界设定集 V0.1》导入世界设定，并由 `ADR-0003` 记录状态升级：

- 原稿“已确定”映射为 `canon`，“推导 / 提案”映射为 `proposed`，“待定”映射为 `unknown`。
- 重写 `overview.md`、`physics.md`、`technology.md`、`society.md`、`religions.md` 与 `timeline.md`，新增 `magic.md`。
- 导入以太与魔力、蕴魔矿、蓄魔矿与蓄魔器、四级法师序列、十一魔法派系、施法信息结构、魔导器组件、能源经济和技术史。
- 保留魔法天赋来源、人工逆向转换、效果字段边界、产业细节和神性秩序为 `unknown`。
- 世界观页面将 W01 状态更新为 `canon`，展示六组核心设定和传统法师 / 魔导器两条执行路径。
- 世界观统计更新为 7 组正史基线、12 项未决问题；右栏显示其中 5 项重点问题。
- 本地备注键保持不变以兼容浏览器数据，但标题和提示语更新为 V0.1 的重点未决问题。
- CSS 与 JavaScript 资源版本更新为 `v=5`，新增 `canon` 状态样式和施法路径摘要布局。

### 冲突处理

- 旧版 W01 文档将以太、术式和魔导回路整体标为 `proposed`；作者提供的新稿明确区分已确定与待定，因此按新稿和 ADR-0003 更新，不保留旧的整体待定表述。
- 神性内容没有升级为正史；宗教观点继续与客观事实分离。
- 没有新增势力、角色、地点、正式事件或卡牌，也没有把推导内容提升为正史。

### 验证记录

- `dist/app.js` 通过 Node 语法检查，`dist/index.html` 通过 HTML 解析。
- 真实窄屏浏览器确认 W01 的 canon 状态、六组核心设定、两条施法路径与五项重点未决问题正常呈现。
- 世界观搜索使用“蓄魔”验证，非匹配条目正确隐藏，清空搜索后恢复。
- Docker Compose 配置解析通过；容器状态为 `running / healthy`。
- `http://127.0.0.1:4173/` 返回 `HTTP 200`，服务内容包含 W01 V0.1 与 `v=5` 资源入口。

## 12. 2026-10-13 双通道卡面生成归档

本次修改不改变世界观 canon、基础对战规则或既有卡牌语义。作者明确选择火山方舟 Seedream，并要求同时支持本地 ComfyUI 与生成前语言模型提示词优化。

### 服务端接口

- `GET /api/images/status`：返回 Seedream 密钥与 ComfyUI 工作流的配置状态，不返回密钥。
- `POST /api/images/optimize-prompt`：使用现有 LLM Responses / Chat Completions 配置优化卡面提示词，只返回文本供作者确认。
- `POST /api/images/generate`：按 `provider` 分派到 `seedream` 或 `comfyui`，请求必须带 `X-Worldforge-Image: 1`。
- `GET /api/art-assets`：列出 SQLite 中的卡面候选元数据。
- `GET /api/art-assets/:id/file`：从持久卷读取候选图片，并按记录的 MIME 类型返回。

### `seedream.mjs`

- `validateSeedreamSettings(payload)`：限制火山方舟中国区 API v3 地址、Seedream 模型 ID 与密钥格式。
- `validateImageRequest(payload)`：校验提示词、尺寸和卡牌 ID；支持 `2K`、`1872x1248` 与 `1248x1872`。
- `buildSeedreamBody(config, request)`：按作者提供的格式生成 `response_format: url`、`stream: false` 请求体；当前水印参数已在 2026-10-15 后续增量中改为 `watermark: false`。
- `generateSeedreamImage(config, payload, fetchImpl)`：调用 `/images/generations`，立即下载临时 URL，并限制图片为 30 MB。

### `comfyui.mjs`

- `validateComfyUiSettings(payload)`：校验 HTTP(S) 地址、API Format JSON 和必需的 `{{PROMPT}}` 占位符。
- `fillComfyWorkflow(template, request)`：深拷贝工作流并替换 `{{PROMPT}}`、`{{NEGATIVE_PROMPT}}`、`{{WIDTH}}`、`{{HEIGHT}}`、`{{SEED}}`；数值占位符保持数值类型。
- `generateComfyUiImage(config, template, request, fetchImpl, waitImpl)`：调用 `/prompt` 入队，轮询 `/history/{prompt_id}`，从首个图片输出构造 `/view` 请求并下载文件。

### 持久化与前端

- SQLite schema 升级为 2，新增 `art_assets` 表；图片本体位于 `/data/assets/cards`，ComfyUI 工作流位于 `/data/comfyui-workflow.json`。
- 卡牌草案新增可选 `artAssetId`，YAML 模板 / Schema 对应 `art_asset_id`。
- 设置页新增“图像生成”分区，分别配置 Seedream 和 ComfyUI；Docker 内本地 ComfyUI 默认地址为 `http://host.docker.internal:8188`。
- 卡牌编辑器可填写或由语言模型优化提示词、选择生成通道与尺寸、生成一张候选图、在候选间切换并保存卡牌绑定。
- 生成图记录 `provider`、模型、尺寸、提示词、MIME 与 provider 元数据，固定为 `proposed / ai_generated`，不会自动晋升正史。
- 完整 JSON 导出升级到 schemaVersion 4，包含美术资产元数据但不嵌入图片二进制或 API Key。

### 检查与未验证项

- 单元测试使用 mock 覆盖 Seedream 请求/下载与 ComfyUI 入队/轮询/下载，不产生付费调用。
- `npm run check` 通过 13/13 项；HTML 的 128 个 `id` 无重复。
- Docker 镜像重建并复用原 `worldforge-data` 卷；`GET /api/health` 返回数据库 `ok` 且 schemaVersion 为 2。
- 本机与 Tailscale `/worldforge/` 均返回新版界面；设置接口不返回 Seedream 密钥字段。
- 在未配置状态下分别提交 Seedream 与 ComfyUI 生成请求，两者均在外部调用前按预期拒绝，没有产生图片或费用。
- 未调用真实 Seedream API；需要作者在设置页提供自己的密钥后才能生成。
- 未假定或验证作者本地 ComfyUI 的 checkpoint、自定义节点或工作流；必须粘贴已经能在本机运行且包含输出图片节点的 API Format JSON。
- 后续事项已记录到 `todo.md`：资产删除/重新绑定、参考图/图生图、ComfyUI 队列进度与中断。

## 17. 2026-10-13 背景故事与渐进式世界构建归档

本次修改由作者明确要求，并由 [ADR-0006](../adr/ADR-0006-background-stories.md) 记录。它新增叙事资料能力，但没有创建故事内容、改变世界观 canon 或把叙事自动视为客观事实。

### 数据与语义

- 资料类型由 12 类扩展为 13 类，新增 `story`；稳定 ID 约定为 `STORY-W##-####`，界面本地草案使用 `STORY-W01-DRAFT-*`。
- 背景故事是独立文本，创作内容仅包含标题与正文，不提供摘要、约束、开放问题、标签、类型属性或可编辑状态；ID、世界、固定状态和 `relationIds` 只用于内部管理。
- 一个普通条目可被多篇故事引用；一篇故事可引用多个普通条目和其他故事。普通条目的“挂载故事”由故事的反向引用计算，故事的“相关故事”同时识别正向和反向显式关系。
- 手工故事与 AI 故事内部固定为 `proposed / unknown`，界面不显示这些技术字段。故事叙述不会自动晋升为 `objective canon`。
- 继续复用 SQLite `lore_entries`，不升级数据库物理 Schema，现有数据库无需迁移；完整 JSON 导出升级到 schemaVersion 5。

### 前端函数与交互

- `LORE_TYPES` 保留“背景故事”用于分类与 ID 分配，但故事编辑器只显示标题、正文和关联。
- `renderAttachedStories(id)` 在资料编辑器底部展示当前人物、地点等条目的挂载故事；打开故事时展示显式相关故事。
- `createAttachedStory()` 从当前已保存条目建立新故事，自动预选当前条目为关联；未保存条目不会产生悬空挂载。
- AI 协助方式新增 `background_story`。`runAi()` 要求锚点条目已经保存，并锁定生成时的动作、锚点 ID 与表单快照；候选区只显示标题与正文，`saveAiSelections()` 也只保存故事文本和原始锚点关系。
- 设置页分别统计普通设定与背景故事；背景故事仍包含在统一资料缓存、SQLite 快照、搜索和导出中。

### AI 提示边界

- `buildPrompt()` 对背景故事要求从传记、轶事或局部事件切入，直接写具体行动、场景与因果，而不是百科式改写；Schema 中的分析数组必须为空。
- 模型返回仍使用原有严格候选 Schema；新增故事只在作者勾选并保存后落盘。
- 自动测试只验证提示边界和结构，没有调用真实模型或评价故事文学质量。

### 修改文件

- 修改：`dist/index.html`、`dist/styles.css`、`dist/app.js`、`ai-harness.mjs`。
- 修改：`tests/ai-harness.test.mjs`、`tests/storage.test.mjs`、`tests/subpath-routing.test.mjs`、`tests/README.md`。
- 新增：`templates/story.md`、`docs/adr/ADR-0006-background-stories.md`。
- 更新：`README.md`、`docs/PROJECT_DESIGN.md`、`docs/adr/README.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 的语法检查和 14 项 Node 测试全部通过；新增测试覆盖背景故事提示边界与故事关联的 SQLite 往返。
- HTML 唯一 ID、脚本引用和故事交互所需元素已做静态检查。
- Docker 镜像已重新构建为 `worldforge:local`，现有 `worldforge-data` 持久卷保持挂载；容器重建后状态为 `healthy`。
- 本机 `/api/health` 返回数据库 `ok: true`、Schema 版本 2；本机 `127.0.0.1:4173` 与 tailnet `/worldforge/` 页面均确认包含纯文本背景故事表单并加载 `app.js?v=13`。
- 当前未调用真实语言模型，也未向生产数据库写入验收故事。
- 尚未实现关系类型、章节排序、版本分支、长篇章节管理或故事专用时间线视图；这些扩展已记录在 TODO。

### 2026-10-13 纯文本故事修订

- 根据作者反馈，故事不再沿用普通设定表单；编辑界面只保留标题、正文和关联人物/地点/故事。
- 故事列表与挂载列表移除状态、事实层次、ID 和摘要展示，改为正文片段。
- `normalizeLore()` 对故事强制清空 `summary`、`constraints`、`openQuestions`、`tags` 与类型属性；`readLore()`、统一内容快照和 JSON 导出都会经过该规范化，旧故事在下一次任意内容保存时写回精简结构。
- AI 故事候选不展示或保存约束、开放问题、冲突、假设、摘要和建议关联，只保存作者选择的故事文本并挂载原始锚点。
- Docker 镜像已再次重建；容器为 `healthy`，本机与 tailnet 页面均确认加载 `app.js?v=13` 和精简故事表单，现有持久卷未删除。

## 18. 2026-10-13 世界地图层级框架归档

本次修改由作者明确要求。它改变运行时地理资料的组织方式和导出结构，但没有新增国家、城市或地点内容，也没有修改世界观 canon。地图图像与边界绘制不在本次范围内。

### 数据模型与兼容

- `location.kind` 扩展并规范为 `country / region / area / city / site / route`，分别对应国家、地区、区域、城市、地点与路线/通道。
- `location.parentId` 保存稳定父级 ID。国家直接属于 `worldId`；地区必须属于国家；区域可属于国家或地区；城市、地点和路线可挂载到同世界中的合法上级，但始终沿祖先链显示在国家内部。
- 保存时拒绝缺少合法父级或跨世界挂载；若修改层级或世界会使已有子级失去有效归属，同样停止保存。删除仍有子级的条目时也会停止操作，避免新建悬空层级。
- 旧地点没有有效 `parentId` 时不自动猜测归属，而是进入“待整理的旧地点”；作者打开条目并选择父级后即可归位。
- SQLite 继续保存完整 lore JSON，无需升级物理 Schema；完整 JSON 导出升级到 schemaVersion 6。

### 地理树与入口

- 原“地图与地点”分类更名为“世界地图”，左侧列表改为按世界分组的嵌套地理树。
- 世界构成是可视根节点，根节点下只显示国家；地区、区域、城市与地点只显示在所属上级内部，不再与国家一级平铺。
- 每个节点提供默认的下一级创建入口：国家 → 地区 → 区域 → 城市 → 地点。编辑器中的父级选择仍允许省略不适用的中间行政层，但城市和地点必须位于某个国家的祖先树中。
- 地理搜索命中子级时同时保留祖先路径，使结果仍能表达该城市或地点属于哪个国家。
- “AI 生成国家框架”会建立国家级草稿并预填作者要求，随后复用现有 2–5 个候选、作者勾选后保存的审核流程；它不会自动创建正史或一次写入完整世界。
- 当前地图坐标仍为可选文本数据，没有实现地图画布、边界几何、拖拽定位或地形生成。

### 静态地理函数

- `WorldforgeGeography.normalizeKind(kind)`：将旧值规范到受支持地理层级。
- `WorldforgeGeography.allowedParentKinds(kind)` / `canParent(parent, childKind, worldId)`：返回允许父级并验证类型、世界和父子关系。
- `WorldforgeGeography.buildTree(entries, query)`：构造国家根节点、子级索引、待整理条目和搜索可见 ID；匹配子级时向上补齐祖先。
- `populateLocationParents(selected)`：将纯规则映射到当前编辑表单，排除自身、跨世界条目和不允许的父级类型。
- `renderGeographyTree(all, query)`：按世界创建地理树及旧数据待整理区域。
- `beginGeographyEntry(kind, parentId, worldId)`：从世界或父节点建立预填子级草案。
- `prepareGeographyFramework()`：建立国家草案并准备国家级 AI 框架提示。

### 修改文件

- 新增：`dist/geography.js`、`tests/geography.test.mjs`。
- 修改：`dist/index.html`、`dist/styles.css`、`dist/app.js`、`package.json`。
- 修改：`tests/subpath-routing.test.mjs`、`tests/README.md`。
- 更新：`README.md`、`docs/PROJECT_DESIGN.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 的语法检查和 16 项 Node 测试全部通过。
- 地理测试覆盖完整国家到地点路径、子级搜索时保留祖先、无效父级隔离和跨世界父级拒绝。
- HTML 的 78 个 ID 已检查为唯一；新脚本由 `dist/index.html` 在主应用之前加载。
- Docker 镜像已重建并复用现有 `worldforge-data` 卷；容器为 `healthy`，`GET /api/health` 返回数据库 `ok: true`、Schema 版本 2。
- 本机 `127.0.0.1:4173` 与 tailnet `/worldforge/` 均已加载 `geography.js?v=1` 和 `app.js?v=14`；真实浏览器验收确认世界构成、建立国家、AI 生成国家框架、旧地点待整理区和父级表单可见，控制台无警告或错误。
- 本次没有调用真实语言模型，没有生成地理内容，也没有修改生产 SQLite 数据；现有两个旧地点只读显示在待整理区。
- 可视化地图画布仍在 TODO；后续画布必须复用 `location.parentId` 地理树，不能建立与资料库分离的第二套地点数据。

## 19. 2026-10-13 可编辑提示词工程归档

本次修改由作者明确要求。它只改变 AI 请求的提示词配置与示例选择，不创建世界观内容、不修改 canon，也不触碰卡牌规则。卡牌—世界观联动、卡牌稀有度和随从/法术/装备类型已追加到 TODO，本次没有提前实现。

### 提示词分层

- 固定 `SYSTEM_INSTRUCTIONS` 继续负责原创性、canon 不可静默覆盖、事实层次、能量边界和 JSON Schema 等不可被设置替换的项目规则。
- `prompt-settings.mjs` 为世界、世界地图、势力、角色、种族、文化、宗教、魔法、科技、物品、事件、时间线和背景故事提供 13 份默认类型提示词。
- 设置页新增“提示词工程”分区。作者可在分类间切换并精调提示词、恢复当前分类默认值，以及维护应用于全部生成的统一个性化提示词。
- 分类提示和个性化提示各自最多 8000 字符；服务端拒绝未知类型和超长设置。浏览器切换分类时先缓存当前未保存编辑，最终由“保存设置”统一提交。
- 配置原子写入 `prompt-settings.json`。本机默认与 `.env.local` 同目录；Docker 默认进入 `/data` 持久卷。提示词不进入 SQLite 内容、浏览器存储或 JSON 内容导出。

### 示例层

- `buildContextBundle()` 从请求资料库前 500 个候选中筛选与当前草稿同世界、同类型且为 `canon` 的条目，按 ID 稳定排序，最多纳入 4 条并受 16000 字符示例预算限制。
- 被选为示例的条目从普通相关上下文中移除，避免同一内容重复拼接；其他条目继续使用原相关度和总上下文预算。
- 生成面板新增“本次补充示例”，最多 6000 字符，只发送给本次 AI 请求，不保存到提示词设置或资料库。
- 最终请求按任务与作者要求、`author_type_prompt`、`author_personalized_style`、`worldforge_examples`、`worldforge_context` 分层排列；自动示例和临时示例不会绕过固定系统边界。
- 返回的 `contextMeta` 新增 `exampleIds` 与 `omittedExampleCount`，候选面板分别显示自动示例和其他上下文数量。

### HTTP 与界面

- `GET /api/settings` 返回当前 `promptSettings` 及只用于恢复默认值的 `promptDefaults`，不返回 API Key。
- `POST /api/settings` 接受完整 `promptSettings`，在原 AI、Seedream 与 ComfyUI 设置保存成功时同步原子写入提示词文件。
- `callAi()` 每次请求都从服务端读取最新提示词设置，根据 `draft.type` 选择分类提示，避免由浏览器伪造持久配置。
- AI 生成面板会根据当前条目类型、世界和状态实时说明可用 canon 示例数量；更改所属世界时立即刷新。

### 修改文件

- 新增：`prompt-settings.mjs`、`tests/prompt-settings.test.mjs`。
- 修改：`server.mjs`、`ai-harness.mjs`、`Dockerfile`、`package.json`。
- 修改：`dist/index.html`、`dist/styles.css`、`dist/app.js`。
- 修改：`tests/ai-harness.test.mjs`、`tests/subpath-routing.test.mjs`、`tests/README.md`。
- 更新：`README.md`、`docs/PROJECT_DESIGN.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 的语法检查和 20 项 Node 测试全部通过，覆盖提示词分类默认值、个性化微调、非法分类/长度拒绝、canon 示例筛选及完整分层提示组合。
- HTML 的 80 个 ID 已检查为唯一；浏览器验收确认“提示词工程”设置分区可见、13 个分类可切换并载入各自提示词、“本次补充示例”可见，控制台无警告或错误。
- Docker 镜像已重建并复用现有 `worldforge-data` 卷；容器为 `healthy`，`GET /api/health` 返回数据库 `ok: true`、Schema 版本 2。
- 生产式 `GET /api/settings` 已确认返回 13 个分类提示与默认值；使用原值进行的幂等 `POST /api/settings` 成功，并将配置写入 `/data/prompt-settings.json`，未清除已有 API Key。
- 没有调用真实语言模型或评价生成质量；示例层只验证选择与拼接规则。
- 自动示例目前使用确定性 ID 排序和预算截断，不是语义检索；后续渐进式检索 Agent 仍按 TODO 单独实现。

## 20. 2026-10-13 大陆层级归档

本次修改由作者明确要求。它扩展地理资料结构，不创建大陆或国家内容，不修改任何 canon。此前世界下直接建立的国家不会被自动归入某个大陆。

### 层级与兼容

- `location.kind` 新增 `continent`，完整层级为“世界构成 → 大陆 → 国家 → 地区 → 区域 → 城市 → 地点”。大陆是世界下唯一允许无 `parentId` 的地理条目。
- 国家现在必须以同世界大陆为父级；地区及更深层级继续遵守既有允许父级规则。`nextKinds` 增加“大陆 → 国家”的默认创建路径。
- 旧国家如果没有 `parentId`，会和其他缺少合法父级的旧资料一起进入“待整理的地理条目”，不会被自动猜测或静默迁移。选择大陆并保存后即可进入新树。
- 搜索命中深层地点时会保留城市、地区、国家和大陆的完整祖先路径。完整 JSON 导出升级到 schemaVersion 7；SQLite 物理 Schema 无需变化。

### 界面与生成入口

- 世界地图说明、快捷新建、世界根节点按钮和空状态统一改为从“大陆”开始；地理编辑器默认新建大陆。
- 地理层级选择新增“大陆”。编辑大陆时父级控件显示“直接属于当前世界”并禁用；编辑国家时只能选择同世界大陆。
- 大陆节点自动提供“＋国家”，国家节点继续提供“＋地区”，后续层级保持原有逐层创建方式。
- 原“AI 生成国家框架”调整为“AI 生成大陆框架”，候选提示聚焦大陆边界、地貌、气候带、资源、跨区域交通以及承载多个国家的能力。
- 地理分类默认提示同步加入大陆与国家归属要求；旧版原封未改的默认提示会自动迁移，自定义提示不会被新版默认值覆盖。提示词配置规范版本升至 2。

### 修改文件

- 修改：`dist/geography.js`、`dist/index.html`、`dist/app.js`、`prompt-settings.mjs`。
- 修改：`tests/geography.test.mjs`、`tests/subpath-routing.test.mjs`、`tests/README.md`。
- 更新：`README.md`、`docs/PROJECT_DESIGN.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 的语法检查和 20 项 Node 测试全部通过；地理测试覆盖大陆根节点、国家父级、完整祖先搜索、旧国家隔离与跨世界拒绝。
- HTML 的 80 个 ID 已检查为唯一；真实浏览器验收确认建立大陆、世界根节点“＋大陆”、大陆级 AI 框架、国家缺少大陆时的阻止提示及旧数据待整理区均可见，控制台无警告或错误。
- Docker 镜像已重建为 `worldforge:local` 并复用现有持久卷；容器为 `healthy`，`GET /api/health` 返回数据库 `ok: true`、Schema 版本 2。
- Docker 中的 `GET /api/settings` 曾确认旧版默认地理提示被升级为包含“大陆 → 国家”的新默认内容；后续编年史提示迁移将配置规范继续升至版本 3。
- 本次没有创建大陆资料、自动迁移旧国家、调用真实语言模型或修改现有 canon。

## 21. 2026-10-13 编年史结构归档

本次修改由作者明确要求。实现采用“保留原 `timeline` 类型、增加编年史容器与节点子结构”的方式，没有增加新的顶层资料类型，也没有修改现有世界观内容或 canon。

### 数据结构与兼容

- `timeline.chronicle.kind` 为 `chronicle` 或 `entry`；前者表示一部编年史容器，后者表示容器内的编年节点。
- 节点使用 `parentId` 指向同世界的编年史容器；`dateLabel` 保存展示用的虚构纪年文本，`order` 保存可为空、可为负数或小数的数值排序键。
- 旧时间线没有 `chronicle` 字段时规范化为 `chronicle` 容器，不拆分正文、不猜测节点日期，也不修改 canon。
- 转换仍含节点的容器或删除仍含节点的编年史会被阻止；缺少有效父级的节点进入“待整理的编年节点”。
- 完整 JSON 导出升级到 schemaVersion 8；SQLite 继续保存 lore JSON，无需升级物理 Schema。

### 界面与排序

- 顶层“时间线”标签改为“编年史”，编辑器新增“编年史 / 编年史节点”、所属编年史、纪年文本和排序值字段。
- 编年史列表按容器展示，每个容器提供“＋节点”；节点优先按数值 `order` 升序排列，缺少排序值时再按纪年文本或标题稳定排列。
- 纪年文本和排序值分离，允许显示“炉历 112 年”“第三潮汐纪末”等虚构纪年，同时保持可靠的先后顺序。
- 搜索节点时保留所属编年史；节点仍可通过普通关联字段连接人物、地点、势力、事件和故事。
- `timeline` 默认提示改为编年史写作要求；旧版未改动的默认提示自动迁移，自定义提示保持不变，提示词配置规范升至版本 3。

### 静态函数

- `WorldforgeChronicle.normalize(value, enabled)`：规范容器/节点、父级、纪年文本和排序值，并将旧时间线兼容为容器。
- `WorldforgeChronicle.canParent(parent, child, worldId)`：验证节点只能挂到同世界的编年史容器。
- `WorldforgeChronicle.sortEntries(entries)`：优先按数值排序键、再按纪年文本或标题排序。
- `WorldforgeChronicle.build(entries, query)`：建立容器、节点、待整理节点和搜索可见集合。
- `populateChronicleParents(selected)`：为节点生成同世界的合法编年史选项，并控制纪年字段启用状态。
- `beginChronicleEntry(kind, parentId, worldId)` / `renderChronicleTree(all, query)`：建立容器或节点草案，并渲染编年史树。

### 修改文件

- 新增：`dist/chronicle.js`、`tests/chronicle.test.mjs`。
- 修改：`dist/index.html`、`dist/styles.css`、`dist/app.js`、`prompt-settings.mjs`、`package.json`。
- 修改：`tests/prompt-settings.test.mjs`、`tests/subpath-routing.test.mjs`、`tests/README.md`。
- 更新：`README.md`、`docs/PROJECT_DESIGN.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 的语法检查和 22 项 Node 测试全部通过；新增测试覆盖节点分组、数值排序、祖先搜索、无效父级隔离、跨世界拒绝和旧提示迁移。
- HTML 的 87 个 ID 已检查为唯一；真实浏览器验收确认“编年史”标签、容器入口、节点类型切换、父级缺失提示、纪年文本与排序值启用状态均正确，控制台无警告或错误。
- Docker 镜像已重建并复用现有持久卷；容器为 `healthy`，健康接口返回数据库 `ok: true`、Schema 版本 2。
- Docker 中 `GET /api/settings` 已确认提示词配置规范为版本 3，旧默认时间线提示已迁移为编年史写作提示。
- 本次没有创建编年史内容、调用真实语言模型或修改现有 canon。

## 22. 2026-10-13 卡牌 TODO 实现归档

本次修改由作者明确要求，并由 [ADR-0007](../adr/ADR-0007-card-types-rarity-lore-linkage.md) 记录。它确认卡牌分类、稀有度枚举与设定来源联动，但没有生成任何正式卡牌，也没有确认基础对战流程。

### 数据结构与兼容

- 卡牌类型统一为 `minion / spell / equipment`，界面显示“随从 / 法术 / 装备”。旧 `unit / action / asset` 在读取、同步与导出时分别迁移为新类型，未知类型回落为随从。
- 卡牌新增 `rarity`，取值为 `common / rare / epic / legendary`，界面显示“普通 / 稀有 / 史诗 / 传说”；旧数据和非法值安全回落为普通。
- 卡牌新增去重后的 `loreRefs`；YAML 与 JSON Schema 对应 `lore_refs`，允许一张卡保留多个设定来源。
- 所属世界改为可编辑字段，卡牌草案 ID 使用该世界 ID。完整 JSON 导出升级到 schemaVersion 9；SQLite 保存完整卡牌 JSON，无需升级物理 Schema。

### 世界观联动与审核边界

- 已保存的角色、种族、势力、物品、科技、地点、魔法和事件显示“生成卡牌草案”入口。世界、文化、宗教、编年史与背景故事不显示直接入口，但仍可在卡牌编辑器中作为补充来源选择。
- 联动只预填名称、所属世界、建议类型和来源引用，不自动编写规则文本，不自动保存，也不改变来源设定状态。
- 默认映射为“角色 / 种族 / 势力 → 随从”“物品 / 科技 / 地点 → 装备”“魔法 / 事件 → 法术”；作者可在保存前修改。
- 保存卡牌后，右侧预览显示类型、稀有度及可读来源名称；搜索同时覆盖中英文类型、稀有度、来源 ID 与规则文本。
- 所有界面卡牌继续固定为 `proposed / untested`。法术和装备暂时保留攻击与血量字段，等待基础对战规则决定其最终语义。

### 静态函数

- `WorldforgeCards.normalizeType(value)` / `normalizeRarity(value)`：规范新枚举，并处理旧类型或非法稀有度。
- `WorldforgeCards.normalizeLoreRefs(value)`：清理空值并按首次出现顺序去重来源 ID。
- `WorldforgeCards.isCardableLore(entry)` / `defaultTypeForLore(entry)`：判断直接联动资格并给出可修改的默认卡牌类型。
- `WorldforgeCards.normalize(card)`：统一规范卡牌字段、旧关键词引用、来源引用与固定审核状态。
- `beginCardFromLore()`：从当前已保存设定建立未保存卡牌草案并切换到卡牌页。
- `populateCardLoreRefs(selected)`：列出设定库中的可引用来源并恢复多选状态。

### 修改文件

- 新增：`dist/cards.js`、`tests/cards.test.mjs`、`docs/adr/ADR-0007-card-types-rarity-lore-linkage.md`。
- 修改：`dist/index.html`、`dist/styles.css`、`dist/app.js`、`package.json`。
- 修改：`cards/schema/card.schema.json`、`templates/card.yaml`、`cards/README.md`、`mechanics/combat-rules.md`。
- 修改：`tests/subpath-routing.test.mjs`、`tests/README.md`。
- 更新：`README.md`、`docs/PROJECT_DESIGN.md`、`docs/adr/README.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 的语法检查和 25 项 Node 测试全部通过；新增测试覆盖三种旧类型迁移、稀有度回落、多来源去重、实体条目资格及默认类型映射。
- HTML 的 163 个 ID 已检查为唯一，卡牌 JSON Schema 可解析。真实浏览器验收确认人物条目显示联动入口，跳转后正确预填名称、世界、随从类型与来源；类型可改为装备、稀有度可改为传说、来源可同时选择人物与背景故事，控制台无警告或错误。验收未保存测试草案。
- Docker 镜像已重建为 `worldforge:local` 并复用现有 `worldforge-data` 卷；容器为 `healthy`，健康接口返回数据库 `ok: true`、Schema 版本 2。
- 本次尚未确认费用系统、回合时序、场位、构筑规则、稀有度概率，以及法术 / 装备的攻击和血量语义；因此没有生成正式卡池或宣称平衡完成。

## 23. 2026-10-13 项目进展与 2.0 设计校正归档

本次只修改项目管理与设计文档，没有修改 HTML 产品函数、运行时数据约定、世界观 canon、卡牌规则或外部 API。

### 核查结论

- 新增 `docs/PROJECT_PROGRESS_2026-10-13.md`，将当前已实现的 13 类设定编辑、地理树、编年史、背景故事、卡牌联动、AI 候选、双图像通道、SQLite 持久化和 Docker 形态归档为 2.0 基线。
- 明确尚未实现 World Package、世界实例、Tick、规则引擎、Action Validator、模拟事件日志、快照回放、多尺度精度和外部 World API。
- 核查时 `main` 分支尚无提交；随后已按 M0A 要求通过 `init` 首次提交建立可追溯基线。

### 2.0 设计调整

- `docs/WorldForge_2.0_Design_Document_V1.0.md` 的文档版本升为 V1.1，保留原文件名以避免破坏已有引用。
- 将“Git 定义 / 模拟存档”两层调整为“作者工作区 / 已编译定义 / 模拟实例 / 主体认知”四层，禁止将 SQLite 中的 `proposed` 草案默认当作实例真值。
- 将首版技术路线改为基于现有 JavaScript/Node 22/SQLite 的增量实现；React、NestJS、PostgreSQL、Prisma、PostGIS 和外部队列改为经实测瓶颈或团队需求触发的 ADR 决策。
- 新增 V2.0-M0A 基线固化阶段，并将 M1 首个验收收窄为单城市、单资源、少量行动、可重放事件的纯规则纵切切片。

### 修改文件

- 新增：`docs/PROJECT_PROGRESS_2026-10-13.md`。
- 更新：`docs/WorldForge_2.0_Design_Document_V1.0.md`、`README.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 的脚本语法检查与 27 项 Node 测试全部通过。
- 本次未调用真实 LLM、Seedream 或 ComfyUI，也未重复 Docker、Tailscale 或真实浏览器验收；报告区分了本次测试与历史文档记录。
- 此轮文档校正完成后，已通过 `init` 提交建立 Git 基线；仍未批准 2.0 技术 ADR，未实现任何模拟能力。

## 24. 2026-10-13 2.0 机制注册、LLM 调度与知识隔离归档

本次修改由作者提出的三项 2.0 架构建议驱动，只更新提案性设计、进展缺口、变更记录和待办项；没有实现模拟代码、修改现有 HTML 产品函数、调用外部模型或变更世界观 canon。

### 模拟机制注册系统

- `SimulationMechanic` 使用稳定 ID、精确版本、参数 Schema、依赖、可用 Action、校验和解算接口。
- 机制只通过只读 `MechanicReadContext` 观察状态，`initialize` / `resolve` 只返回 `WorldEffect` 候选，不直接写数据库。
- 统一 Resolver 负责 Schema、读写集、资源守恒、互斥、状态版本和权限校验。World Package 锁定机制注册表，机制升级必须显式迁移或分支。
- 首版只允许仓库内受信任代码；任意第三方脚本需要后续安全 ADR。

### LLM 模拟预算调度器

- 预算维度包含 token、调用次数、并发、延迟、上下文、云端费用和可选能耗，不再只限制 token。
- 按任务能力标签在本地小模型、本地主力模型和经显式允许的更强本地/云端模型间路由；结构化校验优先使用程序。
- 调度器实施实例/区域/任务/全局多层配额、`local_only` 硬边界和可审计降级链，以支持 NAS + Mac Studio 等家庭服务器环境。

### 模拟知识隔离

- 内部国家、组织和人物 Agent 与外部 Actor 共用 `KnowledgeView` 过滤管线，禁止直接读取全局权威状态。
- `KnowledgeRecord` 记录来源事件、观测 Tick、置信度、保密等级、过期时间和观测/推断/转述/欺骗状态。
- Validator 可使用客观状态判定动作不可行，但向 Actor 返回的理由也必须经过知识过滤，不能通过拒绝消息泄露敌方秘密。
- 知识日志随快照、分支和重放保留，不从后来已知的客观状态反向补全过去的 Agent 视野。

### 里程碑与风险调整

- M0B 增加机制注册表与依赖校验；M1 增加规则 Agent 知识隔离；M2 增加 LLM 预算调度、数据策略和“无上帝视角”验收。
- 新增机制模块直写/冲突、Agent 全知和模型路由隐私/费用失控三类风险与缓解策略。

### 修改文件与检查边界

- 更新：`docs/WorldForge_2.0_Design_Document_V1.0.md`、`docs/PROJECT_PROGRESS_2026-10-13.md`、`README.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。
- 本次是设计文档修订，不声称上述机制已实现或经压测。当前自动化检查仍只覆盖现有内容工作台。

## 25. 2026-10-13 W0 首次 Git 基线归档

本次操作响应作者“开始开发 W0，先提交一个 init”的要求，将当前项目状态固化为首个可追溯基线。没有新增模拟功能、修改世界观 canon 或导入本机运行时数据。

### 提交边界

- 提交信息固定为 `init`，作为后续 W0/M0 实现的差异起点。
- `.gitignore` 排除 `.env.local`、`node_modules/`、`*.log` 和 `.data/`；已确认本机 `.data/worldforge.sqlite` 受忽略规则保护。
- `.env.example` 仅包含空密钥占位符；提交前密钥模式检查未发现实际凭据。
- `.openai/hosting.json` 作为静态托管配置进入基线；运行时数据、生成资产和本地设置不进入基线。

### 文档同步

- `docs/PROJECT_PROGRESS_2026-10-13.md` 从“Git 基线尚未建立”更新为“已由 `init` 提交建立”，并从后续建议中移除已完成的基线任务。
- `docs/WorldForge_2.0_Design_Document_V1.0.md` 的 M0A 与风险表改为持续维护基线、防止本地数据或密钥进入提交。
- `todo.md` 将首次 Git 基线任务标记为完成，`CHANGELOG.md` 记录首次提交及安全边界。

### 检查

- 提交前重新执行 `npm run check`；核心脚本语法检查和 27 项 Node 测试必须全部通过后才创建提交。
- 提交后检查 `git status`，确认基线工作区清洁。

## 26. 2026-10-13 V2.0-M0A 第一阶段归档

本阶段完成“基线固化与数据边界”的最小实现：把作者工作区、可发布定义和未来模拟状态分开，并将现有 SQLite 从隐式建表改为可验证的前向迁移。没有实现 Definition 编译器、世界实例、Tick、规则结算或 Agent，也没有改变任何世界观 canon。

### 发布与模拟边界

- 新增 `ADR-0008`：SQLite 是作者工作区，不是模拟 Definition 的直接来源；默认发布只接纳 `canon`，`proposed` 只能通过显式实验清单进入带实验标记的包。
- `objective`、`in_world_belief` 与 `unknown` 在未来编译中分别进入权威初始定义、知识/信念种子和未决元数据；`unknown` 不得成为可执行规则或确定初值。
- 新增 `simulation/README.md` 与 `simulation/storage/README.md`，预留编译、机制、运行时和模拟存储边界。模拟表未来使用 `sim_` 前缀和独立迁移账本，不共享内容库版本号。

### 内容库迁移

- 新增 `storage-migrations.mjs`，将原有内容 Schema 拆成版本 1（核心内容）和版本 2（美术资产）的有序迁移。
- 新库从版本 0 依次应用两个迁移；版本 1 数据库原位升级并保留内容；高于当前支持版本的数据库通过 `UnsupportedContentSchemaError` 拒绝打开。
- 每个迁移步骤使用独立 `BEGIN IMMEDIATE` 事务，`PRAGMA user_version` 与该步结构变更共同提交，避免失败后留下虚假版本。
- `storage.mjs` 启动时委托迁移模块，失败会关闭数据库；健康信息增加本次启动的迁移报告。Docker 镜像与语法检查入口同步纳入新模块。

### 修改文件

- 新增：`storage-migrations.mjs`、`docs/adr/ADR-0008-authoring-definition-boundary.md`、`docs/adr/ADR-0009-content-schema-migrations.md`、`simulation/README.md`、`simulation/storage/README.md`。
- 更新：`storage.mjs`、`tests/storage.test.mjs`、`tests/README.md`、`Dockerfile`、`package.json`、`README.md`、`docs/PROJECT_DESIGN.md`、`docs/WorldForge_2.0_Design_Document_V1.0.md`、`docs/PROJECT_PROGRESS_2026-10-13.md`、`docs/adr/README.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 检查与未实现项

- `npm run check` 通过：核心脚本语法检查及 30 项 Node 测试全部成功；新增覆盖新库有序迁移、v1 数据无损升级与未来版本拒绝。
- `docker compose config` 通过；本阶段未重建或启动容器，也未调用真实 LLM 或图像服务。
- 本机 `.data/worldforge.sqlite` 未纳入版本库，测试均使用临时数据库；尚未实现 World Package Schema、编译器、模拟状态迁移或运行时。

## 27. 2026-10-13 V2.0-M0B 定义编译与实例基础归档

本阶段响应作者“发布清单使用 JSON，继续开发 M0B”的决定，交付从经审核内容到确定性定义包、再到独立 SQLite 实例的最小纵向链路。它没有实现世界时钟、行动结算、资源系统、快照、重放或任何 LLM 模拟。

### JSON 发布与编译

- 新增 ADR-0010，将发布清单、编译内容源、机制注册表和 World Package 固定为 UTF-8 JSON，并提供四份 Draft 2020-12 JSON Schema。
- `compileWorldPackage` 默认只选择 `canon`；`proposed` 必须由 `experimentalIncludes` 精确列出，`deprecated` 始终排除。所选条目的引用必须也在包内，跨世界内容会被拒绝。
- `objective / in_world_belief / unknown` 分别写入权威定义、信念种子和未决元数据；初始状态只能引用已发布的 `objective` 条目。
- 产物不包含构建时间等不稳定字段，使用规范 JSON 的 SHA-256 作为 `packageHash`。相同输入得到相同哈希，实例化前再次校验。
- 新增 `npm run compile:world -- <manifest.json> <output.json>`；W01 0.1.0 示例清单引用 `d8826ba` 基线中的既有 W01 canon，只做最小机器投影，不新增正史。

### 机制注册编译层

- 注册表记录稳定机制 ID、精确版本、参数 Schema、依赖、Action 命名空间和 Effect 命名空间。
- 编译器验证注册表版本、模块版本、参数类型/必填/枚举/数值边界、命名空间唯一性，并按依赖拓扑顺序输出模块。
- 缺失依赖、依赖版本不兼容和循环依赖均会在编译期失败。M0B 尚未实现运行时 `SimulationMechanic`、Validator 或统一 Resolver。

### 独立世界实例

- `instance-store.mjs` 使用独立模拟数据库和 `sim_schema_migrations`，不占用内容库 `PRAGMA user_version`。
- 首个迁移建立实例、地区、实体和事件表。实例保存 `instanceId`、`worldId`、Definition 版本/哈希、完整包、随机种子、Tick 0 和创建时间。
- 定义包及初始状态在单一事务中写入；重复实例 ID、篡改包和未来模拟 Schema 会被拒绝。事件表当前只承载定义包初始事件，不代表事件源或重放已经完成。

### 修改文件

- 新增：`simulation/compiler/world-package.mjs`、`simulation/storage/instance-store.mjs`、`scripts/compile-world-package.mjs`、四份 `simulation/schemas/*.json`、W01 JSON 内容投影/清单、空核心机制注册表、`tests/world-package.test.mjs`、`docs/adr/ADR-0010-json-world-package-contract.md`。
- 更新：`AGENTS.md`、`package.json`、`Dockerfile`、`README.md`、`simulation/` 与 `exports/` 说明、项目设计/进展/2.0 设计、ADR 索引、测试说明、`CHANGELOG.md`、`todo.md` 与本静态文档。
- `AGENTS.md` 根据作者新要求增加：每次代码开发在测试、静态归档和 TODO 更新后创建 Git 提交，但不自动推送。

### 检查与边界

- `npm run check` 通过：核心脚本语法检查及 38 项 Node 测试全部成功；M0B 新增 8 项测试。
- W01 清单通过 CLI 编译，独立重复编译得到相同哈希；输出写入临时目录，未把生成包误作内容源提交。
- `docker compose config --quiet` 通过；没有启动容器、真实模型或图像服务。
- JSON Schema 当前是公开契约和编辑器提示，关键约束由零依赖编译器执行；尚未接入完整第三方 Draft 2020-12 验证引擎。

## 28. 2026-10-14 V2.0-M1 纯规则纵切归档

本阶段交付可实际推进和重放的最小模拟闭环。为避免擅自补全 W01 社会、城市与势力设定，验收场景使用显式 `experimental` 的 W99 合成世界；其中名称、组织、资源分配均是测试数据，不属于 canon。

### 机制与资源结算

- 新增通用运行时机制注册器，机制通过 Action 命名空间接入并只能读取冻结状态副本、返回效果候选。Action 可用性入口只接收主体资料和 KnowledgeView，不接收全局状态。
- 新增 `MEC-001@1.0.0` 合成能源机制，固定三种行动：从城市储备申请、主体间转交、把自身能源转入城市已消耗池。
- 核心 Resolver 首版只允许整数 `resource.transfer`，统一检查端点存在、余额非负和转移前后资源总量不变。机制没有数据库写权限。
- 同 Tick Action 以 `seed + tick + actionId` 的 SHA-256 样本确定冲突顺序，样本随审计记录保存；相同 seed 和 Action 集得到相同接受者。

### Tick、事件、快照与重放

- 每次 `advance` 要求 Action 的 `expectedTick` 和批次的 `expectedStateVersion`；运行时预检、SQLite 事务内再次校验，过期写入不会静默覆盖新状态。
- 接受行动产生带 Effects 和随机样本的 `simulation.action_committed`；知识传播产生 `knowledge.observed`；每次推进产生 `simulation.tick_committed`。接受/拒绝 Action 均保留独立审计记录。
- 模拟 Schema 从 1 升至 2，新增 Action、KnowledgeRecord、Snapshot、状态版本和实例状态。新实例在 Tick 0 建快照，旧 M0B 实例迁移时为当前 Tick 回填快照。
- 每 Tick 的状态、Action、Event、KnowledgeRecord、实例版本和 Snapshot 在一个事务内提交。重放从显式快照出发，只应用已提交效果/知识事件，并比较目标快照的规范状态哈希。

### 知识隔离

- KnowledgeRecord 保存主体、命题、来源事件、观测 Tick、置信度、保密级别、知识状态和可选过期 Tick。
- 私有申请结果只对行动者可见；能源转交结果同时传播给接收者；只有受信任机制的公开知识策略才广播，Action 提交者不能自行控制知识范围或过期时间。
- 同一 Tick 的两个主体可得到不同 KnowledgeView；过期记录从视图消失但仍保留在审计与快照中。Validator 可读权威状态，但公共储备不足只返回通用不可执行原因，不泄露隐藏余量。

### 文件与文档

- 新增：`simulation/rules/mechanic-runtime.mjs`、`simulation/rules/energy-crisis-mechanic.mjs`、`simulation/runtime/simulation-runtime.mjs`、`simulation/runtime/knowledge-view.mjs`、`simulation/scenarios/m1-energy-crisis.mjs`、三个目录说明、`tests/simulation-runtime.test.mjs`、`docs/adr/ADR-0011-deterministic-m1-runtime.md`。
- 更新：`simulation/storage/instance-store.mjs`、`tests/world-package.test.mjs`、`package.json`、`README.md`、项目设计/进展/2.0 设计、模拟/测试说明、ADR 索引、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 通过：核心脚本语法检查及 43 项 Node 测试全部成功；M1 新增 4 项纵切测试和 1 项旧存档迁移回填测试。
- 测试证明三种 Action 可发现、同 seed 冲突结果一致、总能源恒为 12、旧状态版本被拒绝、拒绝文本不泄露储备、主体视图不同、知识会过期，以及 Tick 0 快照可重放到 Tick 2 并匹配权威哈希。
- `docker compose config --quiet` 通过；没有调用真实 LLM、图像服务或创建 W01 正史内容。
- 当前每 Tick 保存完整快照，只适合原型；尚无分支、快照压缩、生产/价格/人口模型、通用 Action/Effect JSON Schema、UI 或外部实例 API。

## 29. 2026-10-14 AI 生成助手革新归档

本次改造响应作者对模块内容质量、部分生成、自由创作和常用工具的要求。它改变 AI 请求/响应契约与 HTML 产品界面，但不创建设定内容、不修改 canon、不调用真实模型，也不改变 SQLite 物理 Schema。

### 模块内容块与部分生成

- 新增 `ai-content-specs.mjs`，为世界、地图、势力、角色、种族、文化、宗教、魔法、科技、物品、事件、编年史和背景故事分别声明内容块、显示名称、生成要求与数据类型。
- 世界正文强调底层法则与社会条件；地图正文和环境交通分离；势力、人物、种族、文化、宗教、魔法、科技、物品和事件各自使用面向该模块的正文与三个专业属性；编年史节点独立提供纪年文本和排序值；背景故事只有标题与正文。
- 模块侧栏新增“生成内容块”多选区。服务端根据本次勾选项构建动态严格 JSON Schema；模型必须返回且只能返回选中的字段。
- 保存候选时把生成字段合并到请求时的表单快照，未选择字段保持原值。候选仍分别保存为 `proposed`；部分生成不会直接覆盖当前条目。
- AI Harness 升级为 `2.0.0`，响应由统一的九字段候选改为 `{ key, content }`。提示明确要求正文可直接回填，并禁止“本候选”“层次位置”“设计说明”、Schema 或字段解释进入成品内容。
- 背景故事动作仍以已保存条目为锚点，但请求时切换到故事专属契约；编年史容器不显示节点专用的纪年和排序块。

### 自由创作 Agent 与常用工具

- 顶部新增“自由创作”模块。作者可提供关联信息、选择是否附带资料库条目索引，并在当前页面中进行连续对话。
- `POST /api/ai/free` 使用独立的自由文本系统边界，不要求 JSON 或资料模块格式；服务端最多携带最近 20 条消息、裁剪后的作者信息和最多 120 条资料索引。回复不会自动写入资料库。
- 常用工具区首批提供名称生成器。`POST /api/ai/tools/names` 接受对象类型、3/5/8/10 个候选、命名要求与关联信息，返回 `{ name, note }`；候选可复制，在世界观模块打开时可回填名称输入框。
- 自由 Agent 与名称生成器复用现有语言模型配置，但不复用模块候选 Schema；三类入口均不自动晋升正史。

### 文件与接口

- 新增：`ai-content-specs.mjs`。
- 修改：`ai-harness.mjs`、`server.mjs`、`dist/index.html`、`dist/styles.css`、`dist/app.js`、`package.json`。
- 修改测试：`tests/ai-harness.test.mjs`、`tests/subpath-routing.test.mjs`、`tests/README.md`。
- 更新文档：`README.md`、`docs/PROJECT_DESIGN.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。
- 新增 HTTP 接口：`POST /api/ai/free`、`POST /api/ai/tools/names`；原 `POST /api/ai` 保留路径但使用动态内容块响应。

### 验证与限制

- `npm run check` 通过，43 项 Node 测试全部成功；新增覆盖类型专属块、编年史容器过滤、部分字段 Schema、未选字段拒绝、关联 ID 白名单、自由文本请求格式和名称数量校验。
- HTML 静态检查确认 201 个 `id` 唯一；子路径回归测试覆盖两个新增 API，并确认加载 `app.js?v=20`。
- 使用隔离临时 SQLite 路径启动 Node 服务成功，随后停止服务并删除临时 QA 数据库。由于浏览器自动化环境无法访问该隔离端口，且重建共享的 tailnet Docker 服务未获安全审批，本次没有声称完成真实浏览器视觉验收或外部模型端到端调用。
- 自由对话当前只保留在页面内，刷新即清空；名称生成器是首个常用工具，其他工具需根据作者实际使用频率逐项加入。

## 30. 2026-10-14 AI 助手 Docker 部署修复归档

本次部署不改变产品接口、世界观内容或持久化 Schema，只修复镜像构建清单并将第 29 节的 AI 助手版本部署到现有 Docker 服务。

### 构建修复

- `.dockerignore` 原先整体排除 `scripts/`，与 Dockerfile 复制 `scripts/compile-world-package.mjs` 的指令冲突；现仅对该运行时需要的 CLI 文件增加精确例外，其他脚本仍不进入构建上下文。
- Dockerfile 的根模块清单加入 `ai-content-specs.mjs` 与 `image-context.mjs`，覆盖 `ai-harness.mjs` 和 `server.mjs` 的直接运行时依赖。
- 没有修改 Compose 端口、只读文件系统、安全选项或命名卷配置；重新创建容器时继续挂载 `worldforge-data`，不会重置 SQLite、生成图片或服务端提示词设置。

### 验证

- `docker compose config --quiet` 通过；`npm run check` 通过，43 项 Node 测试全部成功。
- `docker compose up -d --build` 成功构建 `worldforge:local` 并重建 `worldforge` 容器；Docker 健康状态为 `healthy`。
- 本机 `http://127.0.0.1:4173/api/health` 返回 `status: ok`、数据库 Schema 版本 2；本机首页与 tailnet `/worldforge/` 均返回 HTTP 200，并确认加载 `app.js?v=20` 和“自由创作”入口。
- 部署验证没有调用真实 LLM 或图像生成服务，也没有生成或修改任何 canon 内容。

## 31. 2026-10-14 AI 创作 UI、候选回填与地图正文归档

本次修订处理自由创作页面的可用性、模块候选的编辑路径和地图内容块命名。它不改变 SQLite Schema、不自动保存生成内容，也不修改任何 canon。

### 自由创作界面

- `styles.css` 补齐自由创作表单控件、对话空状态、消息区、上下文折叠区、名称生成器两栏输入与候选按钮的完整样式；桌面端采用对话主区加工具侧栏，窄屏自动单列。
- 关联信息与资料库索引收进“添加参考资料”折叠区，主要消息输入保持在首要位置；名称生成器把命名对象和候选数量组合为紧凑行。
- `styles.css` 缓存参数升至 `v=15`，`app.js` 升至 `v=21`，避免已部署浏览器继续读取不包含自由创作样式的旧 CSS。

### 候选应用与地图详细设定

- 每张模块 AI 候选卡新增独立“应用到当前表单”按钮；应用时以当前表单为基础，只覆盖响应中实际存在的内容块，关联建议在该操作中替换当前关联选择。
- 应用操作只更新浏览器中的编辑表单并标记“尚未保存”，不写 SQLite；作者仍需使用原编辑器保存按钮。原有多选“保存所选为独立草案”保持不变。
- 背景故事候选的对应操作显示“在编辑器中打开”，建立未保存的故事表单并保留来源关联，不覆盖来源条目。
- 世界地图 `details` 内容块在服务端契约、前端选择器和候选展示中统一命名为“详细设定”，生成说明要求返回可直接填入正文栏的完整内容；“环境与交通”仍是单独内容块。

### 验证与部署

- `npm run check` 通过，44 项 Node 测试全部成功；新增断言覆盖地图“详细设定”、候选应用入口、自由创作关键样式和新静态资源版本。
- `docker compose up -d --build` 成功重建现有服务并保留 `worldforge-data` 卷。
- 在实际 tailnet 页面完成浏览器视觉验收：桌面端为对话/工具双栏，319 CSS 像素窄屏为单栏；世界地图助手可见“详细设定”内容块。
- 未调用真实语言模型或图像服务，因此没有声称外部模型端到端生成已在本次验收中执行。

## 32. 2026-10-15 M1 Action/Effect 契约加固归档

本次迭代落实 ADR-0012，为进入 LLM Action 提案和外部实例 API 前建立默认拒绝的机器契约。它不改变 W01 canon、M1 能源数值或 SQLite Schema。

### 发布与编译契约

- 新增 `simulation/schemas/action.schema.json` 与 `effect.schema.json`，分别定义通用 Action 信封和核心 `resource.transfer` Effect；机制注册表和 World Package Schema 增加契约字段。
- 机制注册表中的每个非空机制必须声明具体 Action 参数 Schema、Effect Schema、受控资源读写路径、允许知识分类和最大 TTL。路径只支持 actor/knowledge/tick 及地区或实体资源路径，不接受任意 JSONPath 或脚本。
- 编译器校验契约命名空间、类型唯一性、Schema 子集、访问路径和知识权限，并将完整契约嵌入 World Package；契约内容参与规范哈希。
- W99 合成能源机制升级为 `MEC-001@1.1.0`，注册表版本升至 `0.3.0`；申请、转交、消耗各自声明参数 Schema，并只授权 `resource.transfer`、energy 资源路径和 restricted 知识。

### 运行时权限

- 运行时按 `reads` 声明投影机制上下文，并在业务 Validator 前校验 Action 信封和具体参数；未声明状态不会交给机制，额外参数、缺失参数、错误类型与未知 Action 会在写入状态前失败。
- Resolver 结果必须匹配已登记 Effect Schema，且来源和目标资源路径都必须位于机制写集中；未登记 Effect 和越权资源写入不会进入核心状态结算器。
- 知识策略必须使用契约允许的分类且 TTL 不超过上限；M1 原有拒绝信息过滤、原子 Tick、确定性冲突、资源守恒、知识隔离与事件重放语义不变。
- 首版保持零第三方运行时依赖，只实现当前实际需要的受限 Schema 子集；动态能力令牌和通用策略语言留待多区域、多资源或第三方机制出现后评估。

### 文件与验证

- 新增：`docs/adr/ADR-0012-action-effect-contracts.md`、`simulation/schemas/action.schema.json`、`simulation/schemas/effect.schema.json`。
- 更新：机制编译器、机制运行时、能源机制、W99 场景、机制/产物 Schema、两组模拟测试、README、项目进展、2.0 设计、规则/测试说明、ADR 索引、`CHANGELOG.md`、`todo.md` 与本静态文档。
- 定向测试 15 项全部通过；新增测试覆盖契约随包发布并参与哈希、非法访问路径、Action 额外参数、越权资源写入和越权知识策略。
- 完整 `npm run check` 通过，46 项 Node 测试全部成功，0 失败；未调用真实 LLM、图像服务或修改 W01 正史。

## 33. 2026-10-15 V2.0-M2A 实验模拟观察台归档

本阶段把 M1 纯规则纵切首次接入实际产品 UI。目标是先让作者看见状态、行动和主体认知，再接入 LLM Action 提案，避免规则、模型和界面同时成为不可观察黑箱。W99 仍为 `experimental`，不属于 W01 或宇宙正史。

### 模拟服务与 API

- 新增 `simulation/dashboard-service.mjs`，使用独立 `worldforge-simulation.sqlite`，服务启动时确保 `INST-W99-DASHBOARD` 存在；内容数据库和模拟数据库保持物理分离。
- `GET /api/simulation` 返回 Tick、状态版本、定义哈希、机制 Action 契约、地区/主体资源、总能源、记录计数、最近 Action/Event 和逐主体 KnowledgeView。
- `POST /api/simulation/advance` 要求请求标记和当前版本，每 Tick 最多接收 10 个 W99 energy Action 提案。服务器生成 ID/Tick，客户端不能提交 Effect、随机样本或知识范围。
- `/api/health` 增加模拟数据库健康与迁移信息；Docker 的现有 `/data` 持久卷同时保存模拟数据库，无需新增卷或数据库迁移。

### 世界模拟 UI

- 顶部导航新增“世界模拟”。页面明确标记 `experimental · W99`，显示当前 Tick、状态版本、总能源、行动数、城市储备/消耗、主体余额、KnowledgeView、行动审计与事件流。
- 提供四种手动实验：双方同 Tick 竞争申请、持有能源最多的主体向另一方转交、主体消耗能源、无 Action 推进空 Tick。
- 页面使用相对 `apiUrl`，继续兼容根路径和 `/worldforge` 子路径；`styles.css` 升至 `v=16`，`app.js` 升至 `v=22`。
- 桌面三栏展示权威状态、单步控制和主体视野；中等宽度降为两栏并把主体视野铺满，窄屏降为单栏、顶栏模块导航可横向滚动，审计区域同步纵向排列。

### 验证与限制

- 新增 `simulation-dashboard.test.mjs` 两项服务测试，并扩展静态路由/UI 测试；覆盖 W99 标记、初始状态、Action 发现、单步推进、版本冲突、能源守恒、审计与主体知识差异。
- 隔离本机服务在 `127.0.0.1:8091` 完成真实浏览器验收：初始 Tick 0/能源 12；点击竞争申请后进入 Tick 1，一项接受、一项拒绝，能源仍为 12，只有接受主体出现私有知识记录。
- 完整 `npm run check` 通过，49 项 Node 测试全部成功，0 失败；视觉验收后已停止隔离服务并删除临时数据库。
- 当前只有固定 W99 实例和预设 Action，尚无实例生命周期、认证、重置、地图/趋势/因果图、LLM Action 提案或预算调度。

### 文件与文档

- 新增：`simulation/dashboard-service.mjs`、`tests/simulation-dashboard.test.mjs`、`docs/adr/ADR-0013-experimental-simulation-dashboard.md`。
- 更新：`server.mjs`、`dist/index.html`、`dist/app.js`、`dist/styles.css`、`package.json`、`.env.example`、README、项目进展、2.0 设计、模拟/测试说明、ADR 索引、`CHANGELOG.md`、`todo.md` 与本静态文档。

## 34. 2026-10-15 W99 全量规则推演闭环归档

本阶段按作者“先全量跑通模拟”的要求，把 M2A 的手动单步观察台扩展为可重复的一键完整推演。它只改变 W99 experimental 技术场景和模拟接口，不修改 W01 canon，也不把规则主体描述为通用智能或 LLM 模拟。

### 规则主体与完整运行

- 新增 `simulation/agents/rule-agent.mjs`：供能机构在持有能源时向市政机构转交，否则申请固定配额；市政机构持有能源时消耗，否则申请固定配额。提案只包含标准 `energy.*` Action，不直接写 Effect 或状态。
- `energyCrisisProgress()` 汇总城市储备、主体持有、累计消耗和守恒总量；储备与主体持有同时归零时视为本场能源危机完成。
- `dashboard-service.run()` 校验状态版本和 `maxTicks`，在默认 20、最大 50 Tick 的有界循环中逐 Tick 调用规则主体与原运行时。所有提案继续经过 Action/Effect 契约、Validator、确定性冲突排序、Resolver、事件/知识写入和原子快照。
- 每次视图读取均从 Tick 0 快照重放到当前 Tick 并核对权威状态哈希；完整运行响应记录实际推进 Tick、停止原因、接受/拒绝数和重放结果。

### 重置与 API

- `instance-store.reset()` 先校验 World Package 与随机种子，再在单个 SQLite 事务内级联删除旧实例历史并重建相同 `instanceId` 的 Tick 0 状态；失败会回滚，不留下半重置实例。
- 新增 `POST /api/simulation/run` 与 `POST /api/simulation/reset`。两者都要求 `X-Worldforge-Simulation: 1` 和当前 `expectedStateVersion`；过期页面返回 409。
- 重置只作用于固定 `INST-W99-DASHBOARD`，不接触内容数据库、W01、模型设置或图片资产。

### UI

- 模拟页新增能源流转条，直接显示“城市储备 → 主体持有 → 累计消耗”和历史重放状态。
- 控制区把“运行完整模拟”作为主入口，说明两个规则主体将自主推进至危机结束；“重置实验”需要用户确认。原有四个单步按钮保留为调试入口。
- 前端继续使用子路径感知 API；`styles.css` 缓存版本升至 `v=17`，`app.js` 升至 `v=23`，新增控件在窄屏下保持可读。

### 文件与文档

- 新增：`simulation/agents/rule-agent.mjs`、`docs/adr/ADR-0014-bounded-rule-agent-full-run.md`。
- 更新：`simulation/dashboard-service.mjs`、`simulation/storage/instance-store.mjs`、`server.mjs`、`dist/index.html`、`dist/app.js`、`dist/styles.css`、`package.json`、模拟/测试 README、两组测试、根 README、项目进展、2.0 设计、ADR 索引、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 通过，50 项 Node 测试全部成功、0 失败；新增测试确认自动推演在 7 Tick 完成、12 能源守恒、13 项 Action 接受、1 项拒绝、重放一致，重置后再次运行得到相同最终状态哈希。
- Docker 镜像已重建并复用现有 `worldforge-data` 卷，容器状态为 `healthy`。真实容器 API 先重置再运行，最终为 Tick 7、储备 0、主体持有 0、累计消耗 12，状态哈希为 `6366981b0df899226f0795f17295cf331cbe1f63e76310c32fe0e21297666e97`。
- 真实浏览器确认新版脚本 `v=23`、完整模拟主按钮、重置按钮、能源流转、Tick 7 完成态、14 条行动审计、主体 KnowledgeView 和“历史重放一致”均正常显示。
- 当前仍是单个 W99、单城市、单资源和同步有界运行；没有真实 LLM 提案、预算调度、多地区经济、后台任务、取消、分支或通用实例管理，后续不得把本阶段描述成完整 2.0 成品。

## 35. 2026-10-15 W98 宏观地图与局部 LLM 提案归档

本阶段纠正了“模拟等于单资源流程”的产品偏差，按 ADR-0015 建立“宏观规则演化 + 局部 LLM 提案”分层。W98 是 `proposed / experimental` 合成世界，不属于 W01 或宇宙正史；参数未经平衡。

### 文件与职责

- 新增 `simulation/scenarios/m2-macro-continent.mjs`：编译 W98、12 个六角邻接地区、3 个政体及其人口/粮食/产粮/工业/基建/稳定/驻军/财政/合法性/关系初态。
- 新增 `simulation/rules/macro-world-engine.mjs`：确定性季度结算；处理局部行动、生产、邻接贸易、消费与短缺、人口增长、迁徙、工业增长、财政、合法性、关系漂移及年度边界变化。
- 新增 `simulation/llm/macro-proposal.mjs`：声明局部提案 JSON Schema，构造不可信有限上下文提示，解析并验证模型输出，在模型不可用时生成同契约规则提案。
- 新增 `simulation/macro-simulation-service.mjs`：管理固定 `INST-W98-MACRO`，提供地图视图、季度推进、连续推进、重置、局部上下文、提案验证和基于 `macro.state_committed` 事件的重放校验。
- 新增 `dist/macro.js`：渲染地图、政体摘要、局部详情、季度趋势和事件；政体图层使用阵营色，稳定/粮食/人口图层按指标梯度着色；实现刷新、单季/四季推进、重置、请求提案及采纳提案。浏览器验收发现并修复延迟调用时 `document.currentScript` 为空的问题，脚本改为加载时捕获基址；最终缓存版本为 `v=3`。
- 更新 `server.mjs`：增加 `GET /api/macro`、`POST /api/macro/step|run|reset|local-proposal`；写操作继续要求 `X-Worldforge-Simulation: 1`。模型失败返回显式 `rule_fallback`，不阻塞宏观时钟。
- 更新 `dist/index.html` 与 `dist/styles.css`：世界模拟页以 W98 地图为主，支持政体/稳定/粮食/人口图层；W99 整体移入折叠开发诊断区；新增桌面和窄屏布局。浏览器发现旧缓存会使地图退化为原生按钮或保留旧间距，最终样式缓存版本升至 `v=19`。
- 新增 `tests/macro-simulation.test.mjs` 并扩展静态 UI 测试与 `package.json` 检查入口；更新 README、设计文档、模拟/测试说明、ADR 索引、Changelog 和 TODO。

### 静态函数与接口

- `createMacroContinentPackage()`：生成递归冻结、可校验哈希的 W98 World Package。
- `validateMacroAction(action, state)`：默认拒绝未知行动、越权地区、额外参数、财政不足、基建上限与非邻接谈判。
- `advanceMacroWorld(instance, proposals)`：复制权威状态，先处理局部行动，再按稳定顺序完成一个季度结算，返回新状态、行动审计、事件候选和汇总；不直接写数据库。
- `macroSummary(instanceOrState)`：汇总全局及逐政体的人口、粮食、工业、军力、财政、合法性和地区数。
- `buildMacroProposalPrompt(context)`：只序列化选中地区有限上下文，明确数据不可信、模型只能从行动目录提出一个提案。
- `parseMacroProposal(raw, context, state)`：清理 JSON 代码围栏，限制地区与行动字段，补入地区所属政体并调用权威规则预校验。
- `fallbackMacroProposal(context, state)`：根据短缺、稳定度、基建与边境条件选择赈济、投资、动员或谈判，并通过同一 Validator。
- `createMacroSimulationService(databasePath)`：返回 `view/step/run/reset/localContext/fallbackProposal/parseModelProposal/validateProposal/health/close`；每次提交生成审计、事件、快照和完整状态重放事件。
- `callMacroProposal(payload)`：复用现有 Responses/Chat Completions 代理与结构化 Schema；不支持结构化输出时降级 JSON 文本，任何模型或解析失败再降级到规则提案。
- `WorldforgeMacro.refresh()`：世界模拟模块打开时加载 W98 视图；浏览器 API URL 相对 `macro.js` 挂载位置计算，兼容 `/worldforge` 子路径。

### 已验证与待验证

- `npm run check` 通过，54 项 Node 测试全部成功、0 失败。测试确认 W98 初态为 12 地区/3 政体/人口 1160；连续 4 季度后出现年度边界事件，重放哈希一致；重置并重复运行得到相同哈希；局部上下文不包含全地区集合，越区模型提案会被拒绝。
- Docker 已用现有 `worldforge-data` 卷重建并达到 `healthy`；真实容器从 Tick 0 连续推进 4 季度，人口 1160→1182、粮食 153→303、平均稳定 61→63，产生 1 次年度边界变化且重放一致。
- 真实浏览器验收确认 `macro.js?v=2`、`styles.css?v=18`、12 个六角地区、政体摘要、季度趋势、事件流、地区点击与局部详情可见；同时修复奇数行最右六角被裁切和隐藏提案出现空边框的问题。
- 已配置模型的端到端提案会把 W98 合成地区上下文发送给配置的模型服务；本次安全审批未授权该次外发，因此没有绕过或声称真实模型调用成功。结构化解析、规则预校验与规则回退由自动测试覆盖。
- 当前宏观规则仍是 W98 专用 MVP，尚未进入机制注册表；LLM 尚无 token/费用/并发预算调度，局部精细化尚未深入到人物和场景，也没有结果回聚与分支历史。

## 36. 2026-10-15 AI 候选部分验收与差额补齐归档

本次改动优化结构化设定候选的失败可见性和补齐策略，不改变任何 canon、世界设定或模拟规则。目标是让模型返回不完整或部分非法时，作者仍能使用合法内容并理解失败原因。

### 服务端与 Harness

- `createLoreResponseSchema(payload)` 现在把 `variants` 的 `minItems` 与 `maxItems` 都设为本次请求数量；初次生成和差额补充分别使用各自的精确数量 Schema。
- `inspectAiResponse(raw, payload, stage)` 解析模型信封并逐候选调用现有严格验证，保留合法候选，同时为无效 JSON、缺失 `variants`、字段越界、非法关联和重复 key 生成带阶段、索引、原因及截断原始片段的诊断。
- `completeAiVariants(...)` 合并初次合法候选；若少于请求数，只通过回调请求差额一次。补充候选继续经过相同验证并按 key 去重；补充仍失败时返回 `partial` 结果而不是丢弃全部内容或制造完整成功假象。
- `buildSupplementPrompt(...)` 明确列出已验收候选并要求模型不要重写，只返回缺少的 N 份不同候选。`callAi(payload)` 使用该流程替代原先的整包修复重试。

### 前端

- AI 结果区新增校验诊断卡：显示初次验收数、仅补数量和最终数量；作者可展开每条错误，并继续展开查看经过长度限制的模型原始片段。
- 合法候选卡与诊断同时显示，仍可应用到当前表单或保存为独立 `proposed` 草案。若最终没有合法候选，结果区仍显示诊断，不再只给出不可追溯的失败提示。
- `styles.css` 缓存版本升至 `v=20`，`app.js` 升至 `v=25`。

### 验证

- `ai-harness.test.mjs` 新增逐候选保留、仅补差额和补充失败仍返回可见诊断三项测试；动态 Schema 测试同时确认精确数组长度。
- `subpath-routing.test.mjs` 增加诊断渲染、原始片段入口与样式存在性检查。

## 37. 2026-10-15 生图空响应容错与资产找回归档

本次修复针对 Seedream / ComfyUI 长耗时请求的连接异常，不修改生图提示词、模型选择或任何正史内容。原实现直接调用 `response.json()`；HTTP 响应为空或被中间层截断时，真正的服务状态会被浏览器 `Unexpected end of JSON input` 覆盖。

### 请求与恢复流程

- `readApiJson(response, label)` 先读取文本，再区分空响应、非 JSON、HTTP 错误和合法 JSON；错误信息包含 HTTP 状态，不再把解析异常当作模型错误。
- `requestGeneratedAsset(payload)` 为每次生图建立 `clientRequestId`。若连接损坏、响应为空或响应不是 JSON，只按该 ID调用只读资产列表最多等待约 12 秒，尝试找回服务端已经完成并持久化的同一次结果。
- 找回流程不会再次调用 `/api/images/generate`，避免用户因网络或代理异常承担重复生成费用。未找回时界面显示请求 ID并明确“未自动重试付费生成”。
- 卡牌插画和设定视觉原型共用该流程；找回资产会去重后置顶，并显示“连接中断，但已找回”的明确状态。

### 服务端可观测性

- `/api/images/generate` 接收并验证 `clientRequestId`，相同 ID若已持久化会直接返回既有资产。资产元数据保留该 ID，现有 SQLite 表无需迁移。
- 服务端为每次生成记录不含提示词的开始、成功或失败日志，包含请求 ID、provider、目标 ID、耗时及截断后的错误信息；API 错误 JSON 同时返回请求 ID。
- `app.js` 缓存版本升至 `v=26`。

### 验证边界

- 测试确认请求 ID可随资产元数据持久化，并静态验证安全响应解析、资产找回和“未自动重试付费生成”边界。
- 自动化验证不主动调用真实 Seedream，避免产生未经作者确认的外部费用；真实 provider 的错误可在后续请求中通过请求 ID与容器日志对应。
