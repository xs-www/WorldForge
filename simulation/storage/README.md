# Simulation Storage

模拟域将使用 `sim_` 表名前缀与独立 `sim_schema_migrations` 版本账本。它不与作者内容域共享 `PRAGMA user_version`，也不复用 `/api/content` 的整体快照写入语义。

M0A 不创建任何模拟表。首个迁移必须与 M0B/M1 的实例数据模型、事务边界、备份与恢复方案一起审查。详见 [ADR-0009](../../docs/adr/ADR-0009-content-schema-migrations.md)。
