# Simulation

此目录用于 WorldForge 2.0 世界实例与规则模拟。当前仅建立 M0A 边界，不表示已实现世界时钟、机制注册、事件日志、快照或重放。

- `compiler/`：M0B 的 World Package 编译器。
- `rules/`：M0B/M1 的受信任模拟机制与统一 Action/Effect 协议。
- `runtime/`：M0B/M1 的世界实例、Tick、Validator、Resolver、Event 与 Snapshot。
- `storage/`：模拟域数据表和前向迁移。

模拟域不得直接写现有作者内容表，也不得将 SQLite 工作区中的 `proposed` 草案当作权威世界定义。发布边界见 [ADR-0008](../docs/adr/ADR-0008-authoring-definition-boundary.md)。
