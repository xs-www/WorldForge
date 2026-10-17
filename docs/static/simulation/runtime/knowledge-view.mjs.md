# `simulation/runtime/knowledge-view.mjs`

> 作用：把扁平知识记录裁剪成「某主体在某 Tick 可见」的视图，并决定一条 Action 的知情者集合。

- `compileKnowledgeView(records, subjectId, atTick)` `L1`：三重过滤——`subjectId` 相等、`observedAtTick <= atTick`、`expiresAtTick == null || expiresAtTick > atTick`（因此 `expiresAtTick === atTick` 已算过期，`L5`）；按 `observedAtTick` 升序、`knowledgeId` 字典序排序后逐条 `structuredClone`，调用方修改不会回写原记录。
- `knowledgeRecipients(action, state, { broadcast = false })` `L10`：默认只含 `action.actorId`；`energy.transfer` 且 `parameters.targetId` 为字符串时追加该目标；`broadcast` 为真时加入 `state.entities` 全部 ID；以排序去重数组返回。
