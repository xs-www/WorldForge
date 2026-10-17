# `simulation/agents/rule-agent.mjs`

> 作用：W99 能源危机的确定性规则主体——按固定规则为每个实体产出 Action，并给出终局进度。

- `proposeEnergyCrisisActions(instance)` `L8`：地区固定取 `instance.regions[0]`，无地区返回 `[]`；实体按 `entityId` 字典序处理。`role === 'utility'` 时：能源 ≤0 则 `energy.request`（4），否则向排序后第一个不同 ID 的实体 `energy.transfer`（`min(2, balance)`），若无其他实体则改为 `energy.consume`。其余角色：有余额则 `energy.consume`（`min(2, balance)`），否则 `energy.request`（4）。常量 `REQUEST_AMOUNT = 4`、`FLOW_AMOUNT = 2`（`L1`–`L2`）。
- `energyCrisisProgress(instance)` `L28`：返回 `{ reserve, held, consumed, total }`；`completed = reserve === 0 && held === 0`，即只要求地区储备与实体持有清空，不看 `consumed`。
