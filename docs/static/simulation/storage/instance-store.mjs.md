# `simulation/storage/instance-store.mjs`

> 作用：用 Node 内建 `node:sqlite`（`DatabaseSync`）为模拟实例建表、执行前向迁移，并提供实例创建/重置、逐 Tick 原子提交、快照与事件/知识/行动读取。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `SIMULATION_SCHEMA_VERSION` | 当前模拟存档 schema 版本 `2` | `L6` |
| `WorldInstanceError` | 存储层唯一错误类型，携带 `code` | `L9` |
| `applySimulationMigrations(db)` | 幂等前向迁移：建表、加列、为旧实例回填 tick 快照 | `L17` |
| `createWorldInstanceStore(databasePath)` | 建目录、开连接（WAL / `synchronous=NORMAL` / 外键开启）、跑迁移，返回闭包 API | `L157` |
| `instantiate(worldPackage, {instanceId, randomSeed})` | 校验后单事务写入实例、地区、实体、事件与 tick 0 快照，返回 `read()` | `L237` |
| `reset(worldPackage, {instanceId, randomSeed})` | 删除旧实例（级联）后按同一套写入重建，返回 `read()` | `L254` |
| `read(instanceId)` | 聚合读取元数据 + 地区/实体状态 + 事件；实例不存在返回 `null` | `L271` |
| `commitTick({instanceId, expectedTick, expectedStateVersion, nextTick, state, actions, events, knowledgeRecords})` | 逐 Tick 唯一写入口：乐观版本校验 + 全量写入 + 快照，单事务 | `L291` |
| `readSnapshot` / `readEvents` / `readKnowledge` / `readActions` | 只读投影，均按 tick 升序；`readEvents` 为左开右闭区间 | `L350`、`L356`、`L362`、`L366` |
| `health()` | `PRAGMA quick_check` + 迁移记录 + 声明的 schema 版本 | `L380` |

## 表结构
- 迁移 1（`L30-81`）：`sim_schema_migrations`、`sim_instances`（主键 `instance_id`，含 `definition_version`/`definition_hash`/`definition_json`/`random_seed`/`current_tick`）、`sim_regions`、`sim_entities`（`(instance_id, region_id)` 复合外键指向 `sim_regions`）、`sim_events`（附 `(instance_id, tick, event_id)` 索引）。全部 `STRICT`，子表外键 `ON DELETE CASCADE`。
- 迁移 2（`L82-150`）：`sim_instances` 增加 `state_version`（默认 0）与 `status ∈ {paused, running, replaying, archived}`（默认 `paused`）；新增 `sim_actions`（`status ∈ {accepted, rejected}`、`random_sample ∈ [0,1)`）、`sim_knowledge_records`（`classification`、`knowledge_status` 枚举、`confidence ∈ [0,1]`、`expires_at_tick > observed_at_tick`）、`sim_snapshots`（主键 `(instance_id, tick)`，含 `state_hash`）。
- 迁移 2 为已存在实例回填 `current_tick` 时刻的快照：状态由 regions + entities 行组装，`knowledge_json` 固定 `'[]'`，`state_hash = packageHash(state)`，`created_at` 复用实例创建时间（`L128-142`）。

## 重点逻辑
### `commitTick` `L291`
- 事务内先重读 `current_tick` / `state_version`，要求与外部期望值一致且 `nextTick === expectedTick + 1`，否则 `STALE_INSTANCE_STATE`（`L294-298`）。
- 写入顺序固定：地区状态 → 实体状态 → actions → events → knowledge → 实例 `current_tick` 与 `state_version + 1` → tick 快照 → `COMMIT`（`L300-339`）。
- 地区与实体更新必须各命中 1 行，否则 `STATE_SHAPE_MISMATCH`；提交只改状态，不新增/删除地区或实体（`L302`、`L308`）。
- 版本递增再用 `UPDATE ... WHERE current_tick = ? AND state_version = ?` 保护一次，`changes !== 1` 同样报 `STALE_INSTANCE_STATE`（`L334-337`）。
- 快照的 `state` 取自入参，`knowledge` 取自同事务内回读的 `observed_at_tick <= nextTick` 记录（`L338`）——快照与事件/知识日志在同一次提交内一致。
- 失败按 SQLite 消息匹配 `sim_actions` 唯一约束并翻译为 `DUPLICATE_ACTION`（`L342`）。

### `instantiate` / `reset` `L237`、`L254`
- `validateInstantiation` 要求 `instanceId` 匹配 `INST-[A-Z0-9][A-Z0-9-]*`、`randomSeed` 为非空字符串、`worldPackage.formatVersion === 1`、`initialState` 三个数组齐全（`L201-208`）。
- 并重新计算"去掉 `packageHash` 后的 World Package"哈希，不等则 `WORLD_PACKAGE_HASH_MISMATCH`（`L209-210`）。
- 写入顺序：实例行 → regions → entities → events → tick 0 快照；`definition_json` 存完整 World Package（含 `packageHash`）（`L215-234`）。
- `reset` 先 `DELETE FROM sim_instances`，`changes !== 1` 报 `INSTANCE_NOT_FOUND`，随后复用同一 `insertInstance`（`L259-262`）。
- 唯一约束冲突按消息匹配 `sim_instances.instance_id` 翻译为 `INSTANCE_ALREADY_EXISTS`（`L246`）。

## 重要约束
- 所有写操作都在 `BEGIN IMMEDIATE` 事务内，异常统一 `ROLLBACK` 后重抛（`L31-33`、`L240-250`、`L257-267`、`L292-346`）。
- `sim_schema_migrations` 中出现高于 `SIMULATION_SCHEMA_VERSION` 的版本号时直接拒绝（`UNSUPPORTED_SIMULATION_SCHEMA`），不提供降级或回退（`L27`）。
- 并发写入的正确性依赖 `state_version` 乐观校验而非逐行锁；同一 `databasePath` 是否会被其他连接或进程同时打开，静态分析无法确认。
- 时间戳来自 `new Date().toISOString()`（`created_at`、`applied_at`，`L75`、`L144`、`L197`、`L218`），不参与 `packageHash` / `state_hash`；`state_hash` 只覆盖快照的状态（`L194`）。
- 实例级删除依赖外键级联清空全部子表，因此无实例行时不残留孤立的地区/事件/知识行（`L50`、`L99`、`L114`、`L125`）。
