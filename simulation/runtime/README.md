# Simulation Runtime

- `simulation-runtime.mjs`：Tick 批次、状态版本、确定性冲突、Validator/Resolver、事件发布、快照重放。
- `knowledge-view.mjs`：按主体、观测 Tick 和过期 Tick 编译 KnowledgeView，并计算行动结果的合法接收者。

主体决策入口不接收全局状态。权威状态只进入受信任机制的校验与结算副本；重放只消费已提交事件，不重新运行机制或随机采样。
