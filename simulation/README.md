# Simulation

此目录用于 WorldForge 2.0 世界实例与规则模拟。M0B 已实现 JSON World Package 与独立实例化；M1 已实现单城市能源危机的确定性 Tick、行动结算、主体知识、逐 Tick 快照和事件重放，并由 ADR-0012 补齐可发布 Action/Effect 契约、资源读写集与知识权限。尚未实现 LLM 模拟、多地区扩展或外部实例 API。

- `compiler/`：确定性 World Package 编译器、关键契约校验与内容哈希。
- `schemas/`：发布清单、内容源、机制注册表、Action/Effect 和产物的 JSON Schema。
- `manifests/`：经审核的 JSON 发布清单。
- `content/`：从 Git 正史显式投影的编译内容源，不接受 SQLite 草案直连。
- `registries/`：受信任机制元数据、版本、参数 Schema、依赖、命名空间、资源访问集与知识权限。
- `rules/`：受信任模拟机制、Action/Effect 契约校验、确定性随机样本与统一 Effect Resolver。
- `runtime/`：Tick、Action、Validator、Event、KnowledgeView、Snapshot 与 Replay。
- `scenarios/`：不属于正史的合成验收场景。
- `storage/`：模拟域数据表和前向迁移。

模拟域不得直接写现有作者内容表，也不得将 SQLite 工作区中的 `proposed` 草案当作权威世界定义。发布边界见 [ADR-0008](../docs/adr/ADR-0008-authoring-definition-boundary.md)，JSON 契约见 [ADR-0010](../docs/adr/ADR-0010-json-world-package-contract.md)，运行时机制权限见 [ADR-0012](../docs/adr/ADR-0012-action-effect-contracts.md)。

编译示例：

```powershell
npm run compile:world -- simulation/manifests/w01-0.1.0.json exports/world-packages/w01-0.1.0.json
```
