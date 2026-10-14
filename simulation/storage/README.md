# Simulation Storage

模拟域使用 `sim_` 表名前缀与独立 `sim_schema_migrations` 版本账本。它不与作者内容域共享 `PRAGMA user_version`，也不复用 `/api/content` 的整体快照写入语义。

M0B 首个迁移创建 `sim_instances`、`sim_regions`、`sim_entities` 与 `sim_events`。M1 版本 2 增加状态版本/实例状态、`sim_actions`、`sim_knowledge_records` 和 `sim_snapshots`；旧版本 1 实例会在升级时为当前 Tick 回填快照。每个 Tick 的状态、行动、事件、知识与快照在同一事务中提交。详见 [ADR-0009](../../docs/adr/ADR-0009-content-schema-migrations.md) 与 [ADR-0011](../../docs/adr/ADR-0011-deterministic-m1-runtime.md)。
