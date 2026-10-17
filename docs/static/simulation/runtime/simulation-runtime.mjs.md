# `simulation/runtime/simulation-runtime.mjs`

> 作用：把「一批 Action → 一次确定性 Tick 结算 → 事件 / 知识 / 快照落库」封装为事务性接口，并提供基于快照 + 事件流的历史重放校验。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `SimulationRuntimeError(code, message, details)` | 运行时错误；`code` 为机器判定标识，`details` 原样保留 | `L10` |
| `createSimulationRuntime({ store, mechanics })` | 绑定实例仓储与机制集合，返回 `{ advance, availableActions, knowledgeView, replay }` | `L83`、`L242` |
| `knowledgeView(instanceId, subjectId, atTick?)` | `atTick` 缺省为当前 Tick；非整数或不在 `0..currentTick` 抛 `INVALID_KNOWLEDGE_TICK` | `L86` |
| `availableActions(instanceId, subjectId)` | 转发机制的 `getAvailableActions`；上下文只含 `tick/actor/knowledge`，不含 state | `L94` |
| `advance(instanceId, { expectedStateVersion, actions })` | 推进恰好一个 Tick，返回 store 提交后的实例 | `L106` |
| `replay(instanceId, targetTick, { snapshotTick = 0 })` | 从快照重放至 `targetTick`，返回 `{ tick, state, knowledge, stateHash }` | `L227` |
| `replayCommittedEvents(snapshot, events, targetTick)` | 纯函数：依次叠加 committed events 的 effects 与 observed 知识记录 | `L72` |
| `validateBatch` / `contextFor` / `rejection` | 批次校验（`STALE_TICK`）、deepFreeze 机制上下文、rejected 记录构造 | `L48` / `L30` / `L60` |

## 重点逻辑
### `advance` 的真实时序
1. 版本闸门：读实例后比对 `expectedStateVersion`，不符抛 `STALE_STATE_VERSION`（`L109`）；随后 `validateBatch` 要求 `action.expectedTick === currentTick`（`L110`、`L56`）。
2. 排序：按 `deterministicSample(randomSeed, nextTick, actionId)` 升序，等值再按 `actionId` 字典序（`L114`–`L117`）；排序键不读 state，只保证同批顺序可复现。
3. 结算：每个 Action 的知识上下文固定取**本 Tick 起点**（`readKnowledge(instanceId, currentTick)`，`L126`），state 却取**已累积**的 `workingState`（`L127`、`L143`），故同一 Tick 中后者可见前者的效果。
4. 事件：accepted Action 产出 `simulation.action_committed`（`L165`），再按收件人逐个展开 `knowledge.observed`（`L180`–`L200`），末尾追加一条 `simulation.tick_committed`，带 accepted/rejected 清单与 `packageHash(workingState)`（`L203`）。
5. 提交：一次性 `store.commitTick`（`L215`）——状态、Action 记录、事件、知识、快照同事务写入，`state_version` 由存储层 +1。
- rejected Action 只写 `sim_actions`（`L60`–`L70`），不产生事件与知识，也不推进 state。
- 仅 `UNKNOWN_ACTION_TYPE`（校验期）与 `RESOURCE_CONFLICT`（结算期）被降级为 rejected；其它 `SimulationRuleError` 上抛，该 Tick 不提交（`L131`–`L134`、`L144`–`L147`）。知识策略非法（classification 越界或 ttl 非正整数）抛 `INVALID_KNOWLEDGE_POLICY`，同样在提交之前（`L149`–`L153`）。

### `replay`
- 合法范围 `snapshotTick ≤ targetTick ≤ currentTick`，否则 `INVALID_REPLAY_RANGE`；快照缺失抛 `SNAPSHOT_NOT_FOUND`（`L230`–`L234`）。
- 只重放 `(snapshotTick, targetTick]`；`replayCommittedEvents` 遇 `event.tick > targetTick` 即 break，依赖事件按 tick 有序返回（`L75`–`L79`）。
- 目标 Tick 若存在权威快照，则比较 `packageHash(replayed.state)` 与 `snapshot.stateHash`，不一致抛 `REPLAY_DIVERGENCE`；返回值中的 `tick` 恒为传入的 `targetTick`（`L236`–`L239`）。

## 重要约束
- 提交需同时满足 `expectedStateVersion` 与 `expectedTick`，两者由存储层 `commitTick` 二次校验并可能改为抛 `STALE_INSTANCE_STATE`。
- `action.actorId` 在 `state.entities` 中不存在时 `context.actor` 为 `null`，判负责任交给机制（`L31`、`L34`）。
- 知识隔离依赖 `knowledgeRecipients`：actor 必含；`energy.transfer` 追加 `parameters.targetId`；`classification === 'public'` 额外广播给全部 entity；`ttl` 有效时写 `expiresAtTick = nextTick + ttl`（`L180`、`L190`）。
