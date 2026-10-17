# `lore-import.mjs`

> 作用：设定导入（ADR-0033）的**纯变换层**。把作者粘贴的长篇原文切成段、给出单段的输出契约与第 4–6 层提示词、收敛模型返回、跨段确定性合并，最后改写成项目资料格式并生成「世界 + 条目 + 可选资料组」计划。不读写磁盘、不连数据库、不发 HTTP；调用模型、计费与落库都在 `server.mjs`，把「模型写了什么」变成结构化数据则由 `model-json-normalizer.mjs` 负责。

> 篇幅说明：切分、字段清单、提示词记录契约与落库复核四类契约都需要逐条写清，故略超常规长度预算。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `LORE_IMPORT_TYPES` | 唯一允许的五种条目类型：`character` / `location` / `timeline` / `story` / `info` | `L21` |
| `LORE_IMPORT_ENTRY_CONTRACT` | 第 3 层入口契约：只整理原文已写出的信息、不新造设定、缺口进 `openQuestions`、结果一律 `proposed` | `L27` |
| `LORE_IMPORT_LIMITS` | 输入、切分、条目与并发上限的唯一真值（90000 字符 / 9000 每段 / 10 段 / 16 每条 / 160 总计 / 3 并发） | `L34` |
| `normalizeImportSource(value)` | 去 BOM、统一换行、拒绝空文本；超限按段落边界截断并回报丢弃字符数 | `L104` |
| `splitImportSource(text, options)` | 确定性切分：窗口内取最靠后的段落 / 换行 / 句末断点（≥40% 才用），返回 `{chunks, truncated, droppedCharacters}` | `L134` |
| `IMPORT_RECORD_FIELDS` | 记录格式的字段清单（键、中文名与别名、`text` / `lines` / `number`）；提示词第 5 层与规范化器共用这一份 | `L160` |
| `buildImportPrompt(options)` | 第 4 层作者风格 → 第 5 层任务 / 规则 / **记录格式契约** → 第 6 层原文；不再要求模型输出 JSON | `L182` |
| `normalizeExtraction(raw, options)` | 把一段模型输出收敛成 `{world, entries}`：记录格式或 JSON 都接受；空内容记 `EMPTY_RESPONSE`，坏条目只丢自己并记 `issues`，不抛错 | `L331` |
| `mergeExtractions(extractions)` | 按「类型 + 名称」去重合并，世界名与概述取首段非空值，返回告警 | `L380` |
| `nextWorldIdOf(entries)` | 最小可用 `W##`；与浏览器 `WorldforgeWorldScope.nextWorldId` 同一规则 | `L438` |
| `buildLoreEntries(planEntries, options)` | 分配 `CHR/LOC/EVT/STY/INF-W##-###`、解析关联名称、补建编年史容器、改写为 `values` + `location` + `chronicle` | `L484` |
| `buildWorldEntry(options)` | 世界条目：名称取作者输入 → 模型识别 → `导入的世界 W##`，固定 `proposed` / `objective` | `L549` |
| `buildImportGroups(entries, worldId)` | 仅当存在 `info` 条目时产出本世界的 `info` 资料组（复用 `fallbackGroup('info')` 的字段） | `L572` |
| `buildImportPlan(options)` | 汇总解析结果：世界编号、条目、资料组、告警与统计 | `L582` |
| `validateImportPlan(value, options)` | 落库前复核客户端回传的计划：强制 `proposed`、剔除越界关联 / 父级、编号冲突 400 与 `409` | `L668` |

## 重点逻辑

### `buildImportPrompt(options)`
- 三层顺序被测试冻结：`<author_personalized_style>` → 规则与记录格式契约 → `<worldforge_import_source>`。原文只能出现在最后一段。
- 第 5 层给出的是**记录格式**（`@@ 世界` / `@@ 条目` + `字段：值`），明确要求「不要写 JSON」：模型只负责把内容写清楚，转成结构化数据交给 `model-json-normalizer.mjs`。
- 字段名与 `IMPORT_RECORD_FIELDS` 的 `labels` 一一对应（有测试断言），避免提示词与解析器各写一份。
- 原文里的 `</worldforge_import_source>` 会被改写成 `< /worldforge_import_source`，避免原文伪装成指令段；原文其余内容原样保留。

### `normalizeExtraction` / `mergeExtractions`
- 先交给通用规范化器：模型照记录格式写就解析成 `{世界, 条目[]}`；仍写 JSON（哪怕语法有缺陷）也能被修复。两者都失败才记 `INVALID_OUTPUT`，空内容记 `EMPTY_RESPONSE`。
- 单段失败只记 issue、不抛错；调用方把 issue 的 `preview` 拼进段级告警，作者能在对话框里直接看到模型原文片段。
- 返回里带 `format` / `repairs` / `repaired`，服务端据此把「输出被截断、只保住完整条目」这类情况显式告警。
- 合并保留首条并补充：正文取包含关系下较长者、否则换行拼接；约束 / 开放问题 / 标签 / 关联取并集（各自上限 12）；`truthScope` 只要任一段是 `unknown` 就收敛为 `unknown`。

### `buildLoreEntries(planEntries, { worldId, existingIds, now })`
- 先 `ensureChronicleContainers`：节点带 `chronicleParent` 但没有同名容器时，按**原文名称**补建容器并告警；不发明别的设定。
- 关联按名称解析成 ID；同名多类型时只指向第一条并告警；找不到的名称丢弃并告警。
- 地理条目的 `parentId` / 编年史的 `parentId` 解析不到时留空，条目进入前端「待整理」区域。
- 产出字段：`id / type / worldId / name / status='proposed' / truthScope / values / tags / relationIds / location / chronicle / updatedAt`；`story` 固定 `unknown` 且不写标签。

### `validateImportPlan(value, { existingEntries, now })`
- 与 `PUT /api/content` 不同，这里是**追加**语义：世界编号已存在、条目编号与既有内容或同批次重复，都直接拒绝。
- 结构问题（缺名称、缺正文、非法类型、`values` 键不合法或超长）一律 400；世界编号冲突是 409。
- 未勾选条目导致的失效关联与父级会被清空并作为 `warnings` 回传，不静默保留悬空引用。

## 重要约束
- 本模块没有 I/O 与事务：调用方必须先完成模型调用与计费，再把 `buildImportPlan` 的结果交给前端预览；写库只能走 `server.mjs` 的 `commitLoreImport`。
- 导入永不产出 `canon` / `deprecated`：`status` 在改写与复核两处都被强制为 `proposed`。
- 类型别名表（`TYPE_ALIASES`）只用于收敛中文类型名；封闭集合仍是 `LORE_IMPORT_TYPES`。
- 本模块不发送 `json_schema`：字段契约在提示词第 5 层与 `IMPORT_RECORD_FIELDS`，输出结构由 `model-json-normalizer.mjs` 负责。新增字段必须两处同时改，否则模型写了也解析不出来。
- 世界编号与条目编号都依赖调用方传入的当前条目集合；并发导入同一编号时由写入阶段的 409 兜底，本模块不做加锁。
