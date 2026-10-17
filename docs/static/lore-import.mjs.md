# `lore-import.mjs`

> 作用：设定导入（ADR-0033）的**纯变换层**。把作者粘贴的长篇原文切成段、给出单段抽取的严格 Schema 与第 4–6 层提示词、收敛模型返回、跨段确定性合并，最后改写成项目资料格式并生成「世界 + 条目 + 可选资料组」计划。不读写磁盘、不连数据库、不发 HTTP；调用模型、计费与落库都在 `server.mjs`。

> 篇幅说明：切分、Schema、提示词外壳与落库复核四类契约都需要逐条写清，故略超常规长度预算。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `LORE_IMPORT_TYPES` | 唯一允许的五种条目类型：`character` / `location` / `timeline` / `story` / `info` | `L20` |
| `LORE_IMPORT_ENTRY_CONTRACT` | 第 3 层入口契约：只整理原文已写出的信息、不新造设定、缺口进 `openQuestions`、结果一律 `proposed` | `L26` |
| `LORE_IMPORT_LIMITS` | 输入、切分、条目与并发上限的唯一真值（90000 字符 / 9000 每段 / 10 段 / 24 每条 / 160 总计 / 3 并发） | `L33` |
| `normalizeImportSource(value)` | 去 BOM、统一换行、拒绝空文本；超限按段落边界截断并回报丢弃字符数 | `L103` |
| `splitImportSource(text, options)` | 确定性切分：窗口内取最靠后的段落 / 换行 / 句末断点（≥40% 才用），返回 `{chunks, truncated, droppedCharacters}` | `L133` |
| `IMPORT_EXTRACTION_SCHEMA` | 单段抽取的严格 JSON Schema：`{world:{name,summary,details}, entries:[…18 个键…]}` | `L183` |
| `buildImportPrompt(options)` | 第 4 层作者风格 → 第 5 层任务 / 规则 / 响应外壳 → 第 6 层原文；`requireJson` 只影响第 5 层 | `L207` |
| `normalizeExtraction(raw, options)` | 收敛模型返回（外壳 / 裸数组 / 裸条目 / 围栏）；坏条目只丢自己并记 `issues`，不抛错 | `L304` |
| `mergeExtractions(extractions)` | 按「类型 + 名称」去重合并，世界名与概述取首段非空值，返回告警 | `L346` |
| `nextWorldIdOf(entries)` | 最小可用 `W##`；与浏览器 `WorldforgeWorldScope.nextWorldId` 同一规则 | `L404` |
| `buildLoreEntries(planEntries, options)` | 分配 `CHR/LOC/EVT/STY/INF-W##-###`、解析关联名称、补建编年史容器、改写为 `values` + `location` + `chronicle` | `L450` |
| `buildWorldEntry(options)` | 世界条目：名称取作者输入 → 模型识别 → `导入的世界 W##`，固定 `proposed` / `objective` | `L515` |
| `buildImportGroups(entries, worldId)` | 仅当存在 `info` 条目时产出本世界的 `info` 资料组（复用 `fallbackGroup('info')` 的字段） | `L538` |
| `buildImportPlan(options)` | 汇总解析结果：世界编号、条目、资料组、告警与统计 | `L548` |
| `validateImportPlan(value, options)` | 落库前复核客户端回传的计划：强制 `proposed`、剔除越界关联 / 父级、编号冲突 400 与 `409` | `L634` |

## 重点逻辑

### `buildImportPrompt(options)`
- 三层顺序被测试冻结：`<author_personalized_style>` → 规则与响应外壳 → `<worldforge_import_source>`。原文只能出现在最后一段。
- 响应外壳写在第 5 层（不依赖 `json_schema`）：示例里每个键都给出「不适用时用空字符串 / 空数组 / null」的占位值。
- 原文里的 `</worldforge_import_source>` 会被改写成 `< /worldforge_import_source`，避免原文伪装成指令段；原文其余内容原样保留。

### `normalizeExtraction` / `mergeExtractions`
- `coerceExtraction` 接受四种形状：`{world, entries}`、`{items:[…]}`、顶层数组、单个裸条目。
- 单段返回非法 JSON 或外壳不对时返回空条目 + `INVALID_JSON` / `INVALID_ENVELOPE`，不抛错；调用方以「全部段落都失败」为整体失败条件。
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
- 类型别名表（`TYPE_ALIASES`）只用于非结构化降级下的中文类型名；封闭集合仍是 `LORE_IMPORT_TYPES`。
- 世界编号与条目编号都依赖调用方传入的当前条目集合；并发导入同一编号时由写入阶段的 409 兜底，本模块不做加锁。
