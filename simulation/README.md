# Simulation

此目录用于 WorldForge 2.0 世界实例与规则模拟。M0B 已实现 JSON World Package 的最小编译与独立 SQLite 实例化；尚未实现世界时钟、行动结算、快照或重放。

- `compiler/`：确定性 World Package 编译器、关键契约校验与内容哈希。
- `schemas/`：发布清单、内容源、机制注册表和产物的 JSON Schema。
- `manifests/`：经审核的 JSON 发布清单。
- `content/`：从 Git 正史显式投影的编译内容源，不接受 SQLite 草案直连。
- `registries/`：受信任机制元数据、版本、参数 Schema、依赖与命名空间。
- `rules/`：M0B/M1 的受信任模拟机制与统一 Action/Effect 协议。
- `runtime/`：M0B/M1 的世界实例、Tick、Validator、Resolver、Event 与 Snapshot。
- `storage/`：模拟域数据表和前向迁移。

模拟域不得直接写现有作者内容表，也不得将 SQLite 工作区中的 `proposed` 草案当作权威世界定义。发布边界见 [ADR-0008](../docs/adr/ADR-0008-authoring-definition-boundary.md)，JSON 契约见 [ADR-0010](../docs/adr/ADR-0010-json-world-package-contract.md)。

编译示例：

```powershell
npm run compile:world -- simulation/manifests/w01-0.1.0.json exports/world-packages/w01-0.1.0.json
```
