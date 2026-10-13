# ADR-0009：内容库显式迁移与模拟域命名边界

- 状态：canon（技术边界）
- 日期：2026-10-13
- 决策者：作者
- 来源：WorldForge 2.0 M0A 第一阶段开发

## 背景

`storage.mjs` 原本在每次启动时执行最终建表 SQL，然后直接将 `PRAGMA user_version` 设为 2。这个方式能创建当前数据库，但不能审计数据库经过了哪些升级，也会将“新建”、“旧版升级”与“当前服务读到未来版本”混为同一路径。

## 决策

1. 内容库迁移由 `storage-migrations.mjs` 集中定义，每个迁移包含单调递增版本、稳定名称和 `up` 操作。
2. 新建库按 `0 → 1 → 2` 顺序执行；旧库只执行高于当前 `user_version` 的迁移。每一步在独立 `BEGIN IMMEDIATE` 事务中执行，Schema 修改与版本提升同时提交或回滚。
3. 当数据库 `user_version` 高于当前服务支持版本时立即拒绝打开，不尝试降级、覆盖或猜测兼容。
4. 当前 `user_version` 仅属于作者内容域。未来模拟域的表统一使用 `sim_` 前缀，迁移位于 `simulation/storage/`，并使用自己的 `sim_schema_migrations` 版本账本，不与内容库共享 `PRAGMA user_version`。
5. M0A 只预留模拟域命名与目录，不创建任何 `sim_` 表。首个模拟表迁移属于 M0B/M1，必须随实例数据模型与回滚/备份方案一起审查。
6. 迁移是前向的、非交互的并且可重复验证。破坏性迁移必须在新版本中提供显式备份/恢复步骤，不得在启动过程中静默删除用户内容。

## 影响范围

- `storage-migrations.mjs`、`storage.mjs` 和 SQLite 健康信息。
- `tests/storage.test.mjs` 的新建、v1 升级、数据保留和未来版本拒绝测试。
- 未来 `simulation/storage/` 与所有 `sim_` 表。

## 未解决问题

- 内容域后续是否从 `PRAGMA user_version` 迁移到独立的 `content_schema_migrations` 账本，等首次需要记录数据变换的迁移时再评估。
- 生产持久卷的自动备份、恢复验证和迁移 UI 仍在 TODO 中。
