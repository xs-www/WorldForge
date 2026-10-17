# `dist/card-agent-apply.js`

> 作用：卡牌 Agent 补丁回填的纯逻辑，浏览器与测试共用同一实现，避免「服务端允许跨类型、前端按旧类型回填」这类判断漂移。

## 关键符号

| 符号 | 作用 / 契约 |
| --- | --- |
| `window.WorldforgeCardAgentApply.resolveTargetType(patch, currentType)` | 返回 `patch.type || currentType` |
| `window.WorldforgeCardAgentApply.formAssignments(patch, currentType)` | 返回 `{ targetType, values }`；`values` 的键是编辑器元素 id（`cardName`/`cardCost`/`cardHealth`…） |

## 重要约束

- 先按 `targetType` 决定专属数值：目标为随从时 `health` 写入 `cardHealth`，目标为武器时 `durability` 写入 `cardHealth`；类型不变时不会把不适用字段写进表单。
- `keywordIds`、`notes`、`effects`、`loreRefs` 不在这里处理，由调用方另行应用或忽略。
- 测试用 `node:vm` 在沙箱中执行本文件并断言双向切换，因此它是可执行契约而不是说明文档。
