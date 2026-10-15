# ADR-0011：M1 使用确定性 Tick、统一效果结算与主体知识日志

- 状态：canon（技术边界）
- 日期：2026-10-14
- 决策者：作者
- 来源：WorldForge 2.0 M1 开发授权

## 背景

M0B 已能编译和实例化世界定义，但实例没有推进语义。M1 需要用最小纵切验证行动、资源、事件、快照、重放和知识隔离能否在同一事务边界内协作，同时不能用未经批准的 W01 社会设定填充原型。

## 决策

1. M1 使用显式 `experimental` 的 W99 合成测试包：一个城市、两个组织主体、一种 `energy` 资源，不属于任何世界观正史。
2. 首个受信任机制为 `MEC-001@1.0.0`，只公开 `energy.request`、`energy.transfer`、`energy.consume` 三种行动。机制只返回 `resource.transfer` 效果，不直接写数据库。
3. 核心 Resolver 只接受白名单效果，在内存工作状态中逐项检查端点、非负余额与资源总量守恒；通过后才由存储层一次性提交状态、Action、Event、KnowledgeRecord 和 Snapshot。
4. 每个 Tick 按收集、校验、确定性冲突排序、效果结算、原子提交、知识发布执行。冲突顺序由实例 seed、目标 Tick 和 Action ID 计算并记录的 SHA-256 样本决定。
5. Action 必须携带 `expectedTick`，批次必须携带 `expectedStateVersion`。过期写入在进入事务前和事务内都会被拒绝。
6. 决策主体只能通过 `KnowledgeView` 获取知识记录和可用行动定义。受信任 Validator/Resolver 可读取最小权威状态，但面向主体的拒绝原因不得包含隐藏库存等真值。
7. 知识记录按主体保存来源事件、观测 Tick、置信度、保密级别、状态和可选过期 Tick。传播范围和时效由受信任机制的知识策略决定，不能由提交 Action 的主体自行指定；转交结果只传播给参与主体，公开策略才广播。
8. M1 每个 Tick 保存一个权威快照。重放从指定快照开始，只应用已提交的效果事件和知识事件，不重新运行机制或采样随机数；结果必须与目标快照哈希一致。
9. `sim_schema_migrations` 升至版本 2，增加状态版本、实例状态、Action、KnowledgeRecord 和 Snapshot；升级既有 M0B 存档时为其当前 Tick 回填快照。

## 影响范围

- `simulation/rules/`、`simulation/runtime/`、`simulation/scenarios/` 与 `simulation/storage/instance-store.mjs`。
- M1 测试、未来分支/快照压缩、Action API 和机制扩展。

## 未解决问题

- 每 Tick 快照适合最小原型，规模扩大后需要增量快照、保留策略与压缩评测。
- M1 只支持整数单资源转移，不包含生产函数、价格、人口、运输损耗或多地区传播。
- Action/Effect JSON Schema、机制级资源读写集与知识权限已由 [ADR-0012](ADR-0012-action-effect-contracts.md) 完成；分支历史仍留待后续迭代。
- 尚未提供 UI 或 `/api/instances/...` 外部接口；当前能力通过模块 API 和自动化测试验收。
