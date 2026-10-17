# `ai-content-specs.mjs`

> 作用：把「资料组的字段列表」翻译成内容块（block）契约——每块的标签、写作指引与 `kind`，同时驱动 JSON Schema 生成与返回校验。字段由作者在资料组里定义，本文件**不再内置任何具体类型的块清单**。消费方：`ai-harness.mjs`（`generationContract`、`createLoreResponseSchema`、`validateAiResponse`）。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `NAME_BLOCK` / `RELATIONS_BLOCK` | 唯一两个非字段块：名称（恒有）与关联建议（背景故事以外恒有） | `L6` / `L7` |
| `KIND_TO_BLOCK` / `KIND_INSTRUCTION` | 字段类型 → 块 `kind`（text/multiline→string、lines→array、number→number）与缺省写作指引 | `L8` / `L9` |
| `fieldToBlock(item)` | 单个字段 → 内容块；字段自带 `hint` 时优先用它 | `L17` |
| `contentSpec(type, draft, group)` | 解析本次契约：优先用请求里（已清洗的）组，缺失时按 type 回落固定组/旧组的默认字段 | `L26` |
| `normalizeSelectedBlocks(type, selected, draft, group)` | 只保留该契约允许的块并去重；无可选项时回落到全部块 | `L40` |
| `blockSchema(item)` | 由块的 `kind` 生成 JSON Schema 片段 | `L46` |

## 契约形态
- 块清单 = `名称` + 组的每个字段（顺序即组的字段顺序）+ `关联建议`（`form:'story'` 时没有关联块）。
- 组的 `form` 只影响专属部件与是否有关联块，不影响字段：`generic/geography/chronicle/story` 都可以有自己的任意字段。
- `focus` 取组自己的写作提示（`group.prompt`）；没有提示时给一句中性的写作重点，不假设任何世界设定。

## 与浏览器的关系
- 浏览器侧用 `WorldforgeLoreGroups.groupResponseSchema(group)` 生成同一份约束并在资料组对话框里预览；两边的字段 → Schema 映射必须保持一致（`tests/lore-groups.test.mjs` 与 `tests/ai-harness.test.mjs` 各自断言）。
- `blockSchema` 只表达形状（`array` ≤12 项、`relations` 的 `{id, reason}`、`number|null`），长度与 ID 白名单仍由 `validateAiResponse` 负责。

## 重要约束
- 请求没带 `group` 时按 `type` 回落到固定组/旧组默认字段，因此旧客户端不会掉字段；但**新增字段只能通过组传递**。
- 字段 `key` 必须匹配 `^[a-z][A-Za-z0-9]{0,31}$`（由 `normalizeGroup` 保证），否则会被重命名成 `fieldN`。
