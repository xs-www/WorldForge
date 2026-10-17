# `dist/lore-groups.js`

> 作用：**资料组的唯一真源**（跨前端与服务端）。一个组 = 名称 + 作用范围 + 表单形态 + **自己的字段列表** + 该组的 AI 写作提示。**名称与详细设定是每个条目内置的两块**（不计入组字段），其余内容块全部由作者定义，可以为空。固定的是「组」本身（世界 / 世界地图 / 角色 / 编年史 / 背景故事），它们的字段同样可改。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `FORMS` / `FIELD_KINDS` | 表单形态（generic/story/chronicle/geography）与字段类型（text/multiline/lines/number） | `L14`–`L15` |
| `FIXED_GROUPS` | 五个固定组，各自带一份**默认字段**（目前都只有「详细设定」） | `L22` |
| `LEGACY_GROUPS` | 旧十三类里八个非固定类型的迁移声明（标签、图标、form、旧字段集） | `L30` |
| `DEFAULT_FIELDS` / `MINIMAL_FIELDS` | 默认额外字段集为空：新建组与固定组都只有内置的名称与详细设定 | `L21` |
| `LEGACY_FIELD_LABELS` | 旧字段 → 标签/类型，迁移旧资料时用来把「实际有值」的旧字段补回组定义 | `L63` |
| `normalizeFields(value,fallback)` | 字段列表规范化：key 正则、类型白名单、去重、上限 16、空列表回落默认 | `L89` |
| `normalizeGroup` / `normalizeGroups` | 组规范化；视图层丢掉固定组，落库层（`normalizeStoredGroups`）保留固定组的覆盖行 | `L101` / `L116` |
| `materializeFixed(stored)` | 把固定组默认字段与作者保存的覆盖行合并成可用的固定组 | `L129` |
| `allGroups(custom)` | 固定组 + 本世界自定义组（固定组覆盖行不重复出现） | `L136` |
| `groupsForWorld(custom,worldId)` | 取某世界的自定义组：本世界优先，共享组次之 | `L166` |
| `migrateLegacyGroups(groups,entries)` | 旧组迁移：按使用情况推断 `worldId`，把 `attributes:[a,b,c]` 转成字段，补空 `prompt`；幂等 | `L182` |
| `deriveGroups(entries,custom,worldId)` | 只按**本世界**资料派生缺失的组，所以新建世界只有五个固定组 | `L214` |
| `createGroup(label,options)` | 新建组：默认一个「详细设定」字段，id 在同一作用范围内唯一 | `L160` |
| `groupResponseSchema(group)` | 由字段列表生成给 Agent 的返回 JSON 约束（名称 + 每个字段） | `L243` |
| `imageKey(groupOrId)` | 组 → 生图档位：固定 id 直接用，自定义组按 form 归到 location/timeline/story/other | `L143` |

## 重点逻辑

### 字段是组的一部分，不是产品常量
- `normalizeFields` 只要求 key 合法；标签与类型都可改。`normalizeGroup` 在作者没给字段时回落到该组的默认字段（固定组/旧组各有自己的默认集，新建组只有一个 `details`）。
- `groupResponseSchema` 把字段转成 JSON Schema：`name` 恒为必需，`lines` → `array<string>`、`number` → `number|null`、`multiline/text` → `string`；资料组对话框会把它原样展示给作者。

### 固定组的字段可以被覆盖
- 保存固定组的字段/提示时写一行 `worldId:''` 的覆盖记录（`normalizeStoredGroups` 保留 `fixed` 组，`normalizeGroups` 丢弃）。
- `materializeFixed` 以覆盖行的字段/提示为准，否则用默认字段；`allGroups` 因此既能读到覆盖，也不会把固定组当成自定义组列出来。

### 旧数据迁移
- 组没有 `fields` 时：优先用组里保存的 `attributes:[a,b,c]` 生成三个 text 字段（保留作者改过的标签），否则用 `LEGACY_GROUPS` 的旧字段集。
- 组没有 `worldId` 时按实际使用情况推断：只在一个世界用到 → 收窄到该世界；跨世界或没有资料 → 共享。
- 迁移只补缺失字段、不改已有值，重复执行结果相同。

## 重要约束
- 本文件是经典脚本（不是 ESM）：只通过 `module.exports` 或 `globalThis.WorldforgeLoreGroups` 导出，`app.js` 必须在它之后加载。
- 固定组的 id 是接口契约（world/location/character/timeline/story），改名会破坏存储、提示词档位与旧数据迁移。
- 条目里的字段值存在 `values` 里；用 `valuesFromFields` 收集时只保留**当前字段列表**的键，删除字段即删除该字段的值。
