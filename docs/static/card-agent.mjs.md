# `card-agent.mjs`

> 作用：卡牌文字 Agent 的受限契约（Sprint 4）。只接受字段补丁与静态评审；所有校验在服务端、返回浏览器前完成，AI 不能保存、不能改 canon、不能调用图像生成。

## 关键符号

| 符号 | 作用 / 契约 |
| --- | --- |
| `CARD_FIELDS` / `CARD_TYPES` / `CARD_RARITIES` / `CARD_ACTIONS` | 允许的补丁字段、卡牌类型、稀有度与五种操作 |
| `createCardResponseSchema({selectedFields, variantCount})` | patch 只含勾选字段；1–3 个候选；review 必填 legalTargets/timing/effectOrder/duration/counterplay/edgeCases |
| `validateCardVariant(variant, payload)` | 单候选校验：未勾选字段、类型互斥、ID 白名单、效果白名单与脚本拒绝、评审完整性、禁平衡声明、数值自动附 `数值未经测试（untested）` |
| `inspectCardResponse(raw, payload, stage)` | 逐候选校验并收集 `INVALID_JSON`/`INVALID_ENVELOPE`/`INVALID_VARIANT` 诊断，不抛到路由层；先按 `ai-harness.mjs` 的宽松收敛处理模型返回 |
| `completeCardVariants({raw, payload, expectedCount, requestSupplement})` | 初次验收 + 一次差额补生成；返回 `{variants, diagnostics}` |

## 重要约束

- 依赖 `ai-harness.mjs` 的 `parseLooseJson` / `coerceVariants` / `withFallbackKey` / `previewOf`：裸候选对象（`{patch, review}`）、顶层数组、夹带说明或围栏的 JSON 都收敛为 `{variants:[...]}`；候选缺 `key` 时补 `candidate-N`，`key` 只作客户端标识。
- `INVALID_JSON` / `INVALID_ENVELOPE` 诊断必须带 `preview`（模型原文片段，≤240 字符），否则无法区分「模型没按外壳返回」与「模型没返回 JSON」。
- 类型互斥：法术无 attack/health/durability，武器无 health/tribeId/spellSchoolId，随从无 durability/spellSchoolId。
- `effects` 只允许 `deal_damage`/`heal`/`draw_card`；`params` 出现脚本或表达式即拒绝。
- review 或文本中出现「已平衡」「经过仿真验证」即拒绝；数值字段一律补 untested 标记。
