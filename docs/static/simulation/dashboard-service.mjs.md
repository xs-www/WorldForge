# `simulation/dashboard-service.mjs`

> 作用：W99 能源危机观察台的服务层——组合单实例仓储、`SimulationRuntime` 与确定性规则 Agent；对外只暴露与 HTTP 无关的方法，其返回值即前端视图结构。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `SimulationDashboardError(code, message, status = 400)` | 服务层错误；`status` 为建议 HTTP 状态码 | `L11` |
| `createSimulationDashboardService(databasePath, { instanceId = 'INST-W99-DASHBOARD' })` | 建仓储与 Runtime；实例不存在则以 `createM1EnergyCrisisPackage()` + 固定 seed `'worldforge-dashboard-seed'` 落库 | `L52`–`L55` |
| `view()` | 组装完整观察台视图 | `L57` |
| `advance(payload)` | 提交一批 UI Action，推进一个 Tick，返回新视图 | `L98` |
| `run(payload)` | 规则 Agent 连续自动推演，返回视图 + `run` 统计 | `L116` |
| `reset(payload)` | 用同一包、同一 seed 重建实例（回到 Tick 0） | `L146` |
| `normalizeProposals(proposals, instance)` | 校验并补全 UI 提案为 Action 信封 | `L32` |
| `health()` / `close()` | 直接转发仓储同名方法 | `L155` |

## 视图数据形状（`view`）
- `experimental: true` 恒定；`instance` 含 `instanceId/worldId/title/currentTick/stateVersion/definitionHash/status`（`L73`–`L81`）。
- `mechanics`：来自 `definition.mechanics.modules`，每项 `{ id, version, actions: [{ type, parametersSchema }] }`（`L82`–`L85`）。
- `regions` / `entities`：仓储行展开并补 `title`；标题索引取 `content.objectiveDefinitions + beliefSeeds + unresolvedMetadata`，缺失回落为 ID（`L24`–`L30`、`L86`–`L87`）。
- `totals.energy`：各地区 `reserve + consumed` 与各实体 `resources.energy` 之和；`progress` 为 `energyCrisisProgress(instance)`；`counts` 为全量 Action / 事件条数（`L65`–`L91`）。
- `knowledge`：以 entityId 为键，每个实体一份 `runtime.knowledgeView`（`L60`）。
- `actions` / `events`：各取最近 30 条并倒序；事件窗口为 Tick `0..currentTick`（`L61`–`L64`）。
- `verification`：`{ replayVerified: true, stateHash }`——`runtime.replay` 抛 `REPLAY_DIVERGENCE` 时该函数不会走到返回，因此到达此处的视图即为未检出一致性错误（`L70`、`L90`）。

## 入口语义
- 三个写入口都先做 `expectedStateVersion` 前置校验，不符返回 `STALE_STATE_VERSION`（HTTP 409）（`L100`、`L119`、`L148`）。
- `normalizeProposals` 约束：数组且 ≤ `MAX_ACTIONS_PER_TICK`(10)；`actorId` 必须是当前实例实体；`type` 必须以 `energy.` 开头；Action ID 由服务生成 `ACT-UI-<nextTick>-<idx>`，`expectedTick` 固定为当前 Tick（`L33`–`L48`）。
- `run`：`maxTicks` 缺省 20、范围 1–`MAX_AUTO_TICKS`(50)；每轮以 `proposeEnergyCrisisActions(instance)` 生成提案并推进，直到 `energyCrisisProgress().completed` 或达上限；`stopReason` 取 `'completed' | 'tick_limit'`，accepted/rejected 只统计 `tick > startingTick` 的记录（`L122`–`L143`）。
- `advance` 把 Runtime 的 `STALE_STATE_VERSION` / `STALE_INSTANCE_STATE` 统一改写为 409，其余带 `code` 的错误按原 code 抛 400，无 `code` 的错误继续上抛（`L104`–`L112`）。

## 重要约束
- 数据库路径完全由首参决定，本文件不读环境变量；`server.mjs` 传入 `WORLDFORGE_SIM_DB_PATH`，与宏观服务共用同一个 simulation sqlite，隔离靠 `instanceId`。
- 构造函数可能写库（懒创建实例）；`reset` 走 `store.reset`，删除同名实例及其 Action / 事件 / 知识 / 快照后重建。
- 每次 `view()` 都执行一次全量 `runtime.replay`（从 Tick 0 快照重放全部事件）以产出 `verification`（`L70`）。
