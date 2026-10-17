# `dist/lore-groups.js`

> 作用：**资料组的唯一真源**（跨前端与服务端）。定义五个固定组（世界、世界信息、角色、编年史、背景故事）、作者自定义组的规范化与派生规则、以及「任意组 → 五个提示词档位」的收敛函数。以经典脚本加载，挂 `WorldforgeLoreGroups`；`lore-groups.mjs` 通过副作用导入复用同一份表。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `FORMS` | 表单形态：`generic` / `story` / `chronicle` / `geography`；决定表单字段与树视图，与组名无关 | `L11` |
| `FIXED_GROUPS` | 五项固定组，`fixed:true`，各带三个属性名 | `L12` |
| `PROMPT_KEYS` | 拥有独立提示词档位的固定键 | `L20` |
| `LEGACY_GROUPS` | 旧十三类里九个非固定类型的迁移声明（标签、图标、form、属性名）；只声明「迁移成什么样」，不强制存在 | `L23` |
| `MAX_GROUPS` / `ID_PATTERN` | 自定义组上限 40；组 id 必须是 `^[a-z][a-z0-9_-]{0,31}$` | `L34` |
| `normalizeGroups(value)` | 丢弃固定组 id、重复 id、非法 id，截断到上限 | `L43` |
| `allGroups(custom)` | 固定组 + 规范化后的自定义组 | `L52` |
| `promptKey(id)` | 任意组 id → 提示词档位；非固定键一律落到 `info` | `L59` |
| `nextGroupId` / `createGroup` | 生成稳定且不撞号的组 id（ASCII 标签取 slug，否则 `group[-N]`） | `L61` / `L69` |
| `deriveGroups(entries,customGroups)` | 保证资料里出现过的每个 `type` 都有对应组：旧类型按 `LEGACY_GROUPS` 迁移，未知类型原样建组；只新增不修改 | `L77` |
| `groupForEntry(...)` | 查不到组时回落到 `info`，绝不回落到 `world` | `L89` |

## 重点逻辑

### 为什么只有五项固定
- 固定组保证模块导航、编年史树、地理树与背景故事视图始终可用；它们靠 `form` 而不是靠题材区分。
- 其余分类（势力、地理、力量体系、技术体系、物品、事件……）都是作者自定义组：`deriveGroups` 会把旧数据里的 `type` 自动迁移成同 ID 的自定义组，因此 `loreEntries[].type` 不需要改写。

### 规范化边界
- `normalizeGroup` 会补全缺失的 label/icon/form/三个属性名，并强制 `fixed`/`custom` 由 id 决定；非法 id 返回 `null`，由调用方过滤。
- `normalizeGroups` 只保留 `custom:true` 的组：任何试图通过导入文件「覆盖」固定组的条目都会被静默丢弃。
- `deriveGroups` 是幂等的：已存在的组不会被再次追加，因此每次 `readLore()` 派生都安全。

## 重要约束
- 本文件是经典脚本（不是 ESM）：只通过 `module.exports` 或 `globalThis.WorldforgeLoreGroups` 导出，`app.js` 必须在它之后加载。
- 「组名」与「表单形态」解耦：作者可以把 `form:'geography'` 的组叫任何名字，地理树仍然按 `form` 渲染。
- 固定组的 id 是接口契约（`world`/`info`/`character`/`timeline`/`story`），改名会破坏存储、提示词档位与旧数据迁移。
