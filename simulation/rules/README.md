# Simulation Rules

- `mechanic-runtime.mjs`：运行时机制注册、Action/Effect Schema、资源写集与知识权限校验、确定性 PRNG 样本、白名单 Effect Resolver 与资源守恒检查。
- `energy-crisis-mechanic.mjs`：M1 的 `MEC-001@1.1.0` 合成能源机制，提供申请、转交、消耗三种行动及其可发布契约。

机制得到的是冻结副本，只能返回已登记的效果候选。Action 在业务 Validator 前校验，Effect、资源写集和知识策略在提交前校验；权威状态写入由 `simulation-runtime.mjs` 与存储事务统一完成。M1 机制是合成测试规则，不定义 W01 的能源政治或社会正史。
