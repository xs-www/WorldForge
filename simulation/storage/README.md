# Simulation Storage

模拟域使用 `sim_` 表名前缀与独立 `sim_schema_migrations` 版本账本。它不与作者内容域共享 `PRAGMA user_version`，也不复用 `/api/content` 的整体快照写入语义。

M0B 首个迁移创建 `sim_instances`、`sim_regions`、`sim_entities` 与 `sim_events`。实例行嵌入完整 World Package 和定义哈希，初始地区、实体及事件在同一事务中物化；重复实例 ID、篡改的包和未来 Schema 版本会被拒绝。当前事件表仅保存初始事件，不代表 M1 的 Tick、事件提交、快照或重放已经完成。详见 [ADR-0009](../../docs/adr/ADR-0009-content-schema-migrations.md)。
