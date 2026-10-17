# `simulation/macro-simulation-service.mjs`

> 作用：W98 宏观大陆实验的服务层——确定性宏观引擎负责结算，LLM 只产出局部提案且必须再经规则校验；视图与 LLM 输入上下文都由本文件组装。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `MacroSimulationError(code, message, status = 400)` | 服务错误；`status` 为建议 HTTP 状态码 | `L12` |
| `createMacroSimulationService(databasePath, { instanceId = 'INST-W98-MACRO' })` | 建仓储；实例不存在则以 `createMacroContinentPackage()` + 固定 seed `'worldforge-macro-continent-v1'` 落库 | `L39`–`L41` |
| `view()` | 组装宏观视图 | `L74` |
| `step(payload = {})` | 结算一个季度，可带 ≤3 个局部行动 | `L95` |
| `run(payload = {})` | 连续结算 `quarters`（1–40，缺省 4）个季度，每季度不带行动 | `L112` |
| `reset(payload = {})` | 用同包同 seed 重建实例 | `L124` |
| `localContext(regionId)` | 构造 LLM 输入上下文；地区不存在抛 404 | `L53` |
| `fallbackProposal` / `parseModelProposal` / `validateProposal` | 提案三入口，均返回 `{ ...proposal, context }` 形态 | `L131` / `L137` / `L143` |
| `replay` / `clock` / `normalizeActions` | 哈希校验、季度时钟、Action 归一 | `L43` / `L35` / `L22` |

## 视图数据形状（`view`）
- `experimental: true`；`architecture: { macro: 'deterministic_rules', local: 'llm_proposal_then_rule_validation' }`（`L81`–`L82`）。
- `clock`：`year = floor(tick/4)+1`、`quarter = tick%4+1`、`elapsedQuarters = tick`（`L35`–`L37`）。
- `totals` 取自 `macroSummary`（人口 / 粮食 / 工业 / 财政 / 平均稳定度 + 各政体汇总）；`polities` 额外补 `title` 与完整 `relations`；`regions` 补 `title` 并展开 `state`（`L79`–`L87`）。
- `actions` 直接就是 `MACRO_ACTIONS`（4 类局部行动）；`history` 取全部 `macro.quarter_summary` 事件；`recentEvents` 排除 `macro.state_committed` 后取最近 24 条倒序（`L77`–`L90`）。
- `verification` 由 `replay()` 给出 `{ replayVerified, stateHash, replayHash }`（`L43`–`L51`）。

## 入口语义
- `step`：`expectedStateVersion` 严格相等校验（不符 409）；`normalizeActions` 限 3 条并生成 `ACT-MACRO-<nextTick>-<idx>`；`advanceMacroWorld` 为纯函数，返回 `{ state, actions, events }`；事件 ID 为 `EVT-W98-<tick>-<idx>`，另固定追加尾号 `998` 的 `macro.state_committed`（携带整份 state）后一次 `commitTick` 落库，`knowledgeRecords` 传空数组（`L96`–`L108`）。
- `run`：每轮 `step` 都传空 `actions`，即纯自然演化；返回值追加 `run.quartersAdvanced`（`L117`–`L121`）。
- 提案链路：`localContext` → `parseModelProposal`（或 `fallbackProposal`）→ `validateProposal`。`validateProposal` 先查 `parameters.regionId` 越界（`REGION_SCOPE_VIOLATION`），再 `validateMacroAction`，失败抛服务错误（`L143`–`L149`）。本模块不做自动降级，降级由调用方决定。
- `replay`：以 Tick 0 快照 `state` 为起点，按顺序用 `macro.state_committed` 事件的 `payload.state` 覆盖，再与当前 Tick 快照 `stateHash` 比较；不一致只把 `replayVerified` 置 `false`，不抛错（`L44`–`L50`）。

## 重要约束
- `localContext` 是 LLM 的唯一可见窗口：`selectedRegion` 全量 state、owner 的 treasury / legitimacy、邻接地区摘要、owner 的 relations、最近 8 条相关事件（窗口 `currentTick-4 .. currentTick`，匹配 `sourceId` / `payload.regionId` / 邻区 `sourceId`）（`L60`–`L70`）。
- 数据库路径由首参传入，本文件不读环境变量；与 W99 观察台共用同一个 simulation sqlite，靠默认 `instanceId` 区分。
- `step` 中 Action 的 `randomSample` 由 `deterministicSample(seed, tick, '<actionId>:<index>')` 生成并旁路记录，实际结算发生在 `advanceMacroWorld` 内部（`L101`–`L105`）。
