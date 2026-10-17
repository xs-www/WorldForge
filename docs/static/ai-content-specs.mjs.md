# `ai-content-specs.mjs`

> 作用：内容块（block）契约的单一真值表——每类的标签、写作指引与 `kind`，同时驱动 JSON Schema 生成与返回校验。消费方：`ai-harness.mjs`（`generationContract`、`createLoreResponseSchema`、`validateAiResponse`）。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `CONTENT_SPECS` | 冻结的**五个固定组**表：`{label, blocks, focus}`（world / info / character / timeline / story） | `L82` |
| `contentSpec(type, draft, group)` | 解析本次契约：固定组用内建 spec；旧类型用 `LEGACY_GROUPS` 的属性名与写作重点；自定义组用客户端提交的 `group`（已清洗） | `L152` |
| `normalizeSelectedBlocks(type, selected, draft, group)` | 只保留该契约允许的块并去重；无可选项时回落到**该契约全部块** | `L174` |
| `blockSchema(item)` | 由 `kind` 生成 JSON Schema 片段 | `L180` |

## 结构规律（同一模板 + 组差异）
所有组共享同一个块模板，差异只在“中间段”的块集合与文案，因此不必逐类抄字段清单：

| 分组 | 块键 | 出现范围 | 差异点 |
| --- | --- | --- | --- |
| 通用头 | `name`、`summary` | 除 `story` 外全部（`story` 只用 `name`） | 文案相同，无组差异 |
| 类型化正文 | `details` | 全部 | 每组 `label` 与 `instruction` 不同（如地理组为“详细设定”、`timeline` 为“史料正文”、`story` 为“故事正文”） |
| 三元属性 | `attributeA/B/C` | 除 `story` 外全部 | 由 `attributes(a, b, c)` 生成；固定组用内建标签，自定义组用组定义里的三个属性名 |
| 类型专属 | `environment`（地理组）、`dateLabel`+`order`（`timeline`） | 单一形态 | `order` 是唯一的 `kind:'number'` 块，可返回 `null` |
| 通用尾 | `constraints`、`openQuestions`、`relations` | `constraints`/`openQuestions` 除 `story` 外全部；`relations` 由构造后的循环追加到**除 `story` 外**全部组 | 尾部文案全组相同 |

- `kind` 只有 4 种：省略即 `'string'`、`'array'`、`'relations'`、`'number'`；这是 `blockSchema` 与 `ai-harness.mjs` 校验分支之间唯一的耦合点，两侧必须同步。`blockSchema` 只表达形状（`array` ≤12 项、`relations` 的 `{id, reason}`、`number|null`），长度与 ID 白名单由 `validateAiResponse` 负责。
- `relations` 不在 `CONTENT_SPECS` 字面量里声明，而是构造后循环追加；`Object.freeze` 是浅冻结，`blocks` 数组仍被这个循环原地 push。
- `contentSpec` 对 `timeline` 的过滤只针对编年史**容器**（`chronicle.kind === 'chronicle'`）；节点保留 `dateLabel`/`order`。

## 未知类型与自定义组（关键行为）
- 未知 `type` **不再回落到 `world`**（旧实现如此，会让科幻或自定义组拿到「世界」契约）。当前顺序是：固定组 → 旧类型（`LEGACY_GROUPS` + `LEGACY_FOCUS`）→ 按 form 生成的地理/编年史/背景故事契约 → 否则用组属性名 + `info` 写作重点。
- 客户端提交的 `group` 经 `sanitizeLoreGroup` 清洗（id 正则、标签与属性名长度），因此 Schema、提示词与校验看到的是同一份契约。
- 生成请求与返回校验都调用 `generationContract(payload)`，所以自定义组的属性名会同时出现在 prompt 第 5 层与 Schema 里；两边不可能漂移。
