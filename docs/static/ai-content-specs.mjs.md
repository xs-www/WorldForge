# `ai-content-specs.mjs`

> 作用：13 类资料内容块（block）的单一真值表——每类的标签、写作指引与 `kind`，同时驱动 JSON Schema 生成与返回校验。消费方：`ai-harness.mjs`（`generationContract`、`createLoreResponseSchema`、`validateAiResponse`）。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `CONTENT_SPECS` | 冻结的类型表：`{label, blocks, focus}`；未知类型回落到 `world` | `L18` |
| `contentSpec(type, draft)` | 取类型 spec；`timeline` 且 `draft.chronicle.kind === 'chronicle'` 时过滤掉 `dateLabel`/`order` | `L38` |
| `normalizeSelectedBlocks(type, selected, draft)` | 只保留该类型允许的块并去重；无可选项时回落到**该类型全部块** | `L44` |
| `blockSchema(item)` | 由 `kind` 生成 JSON Schema 片段 | `L50` |

## 结构规律（同一模板 + 类型差异）
所有类型共享同一个块模板，差异只在“中间段”的块集合与文案，因此不必逐类抄字段清单：

| 分组 | 块键 | 出现范围 | 差异点 |
| --- | --- | --- | --- |
| 通用头 | `name`、`summary` | 除 `story` 外全部（`story` 只用 `name`） | 文案相同，无类型差异 |
| 类型化正文 | `details` | 全部 | 每类 `label` 与 `instruction` 不同（如 `location` 为“详细设定”、`timeline` 为“史料正文”、`story` 为“故事正文”） |
| 三元属性 | `attributeA/B/C` | 除 `story` 外全部 | 由 `attributes(a, b, c)` 生成，每类三个标签不同（如 `world`=题材/时代/尺度，`magic`=力量来源/施展成本/硬性限制） |
| 类型专属 | `environment`（`location`）、`dateLabel`+`order`（`timeline`） | 单一类型 | `order` 是唯一的 `kind:'number'` 块，可返回 `null` |
| 通用尾 | `constraints`、`openQuestions`、`relations` | `constraints`/`openQuestions` 除 `story` 外全部；`relations` 由 `L34`–`L36` 的循环追加到**除 `story` 外**全部类型 | 尾部文案全类型相同 |

- `kind` 只有 4 种：省略即 `'string'`、`'array'`、`'relations'`、`'number'`；这是 `blockSchema` 与 `ai-harness.mjs` 校验分支之间唯一的耦合点，两侧必须同步。`blockSchema` 只表达形状（`array` ≤12 项、`relations` 的 `{id, reason}`、`number|null`），长度与 ID 白名单由 `validateAiResponse` 负责。
- `relations` 不在 `CONTENT_SPECS` 字面量里声明，而是构造后循环追加；`Object.freeze` 是浅冻结，`blocks` 数组仍被这个循环原地 push。
- `contentSpec` 对 `timeline` 的过滤只针对编年史**容器**（`chronicle.kind === 'chronicle'`）；节点保留 `dateLabel`/`order`。
