# ADR-0031：以「五项固定资料组 + 作者自定义组」取代十三类固定类型

- 状态：accepted（2026-10-20，用户确认「只保留世界、世界信息、角色、编年史、背景故事五个固定类，其余均可由用户自定义添加」）
- 关联：ADR-0003（W01 V0.1 基线）、ADR-0006（背景故事）、ADR-0017（随从种族与法术派系）、ADR-0019（世界两级导航）、ADR-0029（提示词分层）
- 影响面：`dist/app.js`、`dist/index.html`、`dist/lore-groups.js`（新增）、`dist/cards.js`、`dist/world-scope.js`、`dist/geography.js`、`dist/chronicle.js`、`storage*.mjs`、`ai-content-specs.mjs`、`ai-harness.mjs`、`prompt-settings.mjs`、`image-context.mjs`、`tests/`、静态文档

## 背景

0.3.0 之前，产品把资料固定分成十三类（世界、世界地图、势力、角色、种族、文化、宗教、魔法、科技、物品、事件、编年史、背景故事），并把其中几类的东西写进了产品常量：

- `dist/cards.js` 里有全局随从种族表（含「蒸汽机械」）与「W01 canon 的十一种魔法派系」；
- `dist/app.js` 里有一份 13 类静态表 `LORE_TYPES`（含 ID 前缀、属性名）和一份 13 类 AI 内容块表 `AI_CONTENT_BLOCKS`；
- `prompt-settings.mjs` 有 13 份出厂分类提示词，其中 `magic` / `technology` 直接写死了「能量守恒」「工业系统」；
- `ai-content-specs.mjs` 有 13 份内容块契约，未识别类型回落到 `world`。

项目范围已经扩展到多用户、多世界。以上任何一项都会把 W01 的题材（魔导工业 / 蒸汽与魔法）当成产品级前提：科幻世界拿到「魔法」分类、无魔法世界拿到「力量来源/施展成本」字段、作者想在两个世界用两套势力分类时无处可放。

## 决策

### 1. 只固定五项，其余全部由作者定义

固定组与它们的 `form`：

| id | 标签 | form | 为什么固定 |
| --- | --- | --- | --- |
| `world` | 世界 | generic | 世界是资料作用域本身，导航第一层 |
| `info` | 世界信息 | generic | 其他一切世界内资料的通用容器，也是未知类型的兜底 |
| `character` | 角色 | generic | 与卡牌、背景故事、事件强关联的实体 |
| `timeline` | 编年史 | chronicle | 需要容器/节点两态与排序值 |
| `story` | 背景故事 | story | 只有标题与正文，状态恒 `proposed`/`unknown` |

作者可新建任意数量的自定义组（上限 40），每组声明 `label`、`form`（`generic` / `story` / `chronicle` / `geography`）与三个属性名。`form` 与组名解耦：把某个组设成 `geography` 就会进入地理树，设成 `chronicle` 就有纪年与排序值。

### 2. 旧数据不改写：按 `LEGACY_GROUPS` 派生组

`deriveGroups(entries, customGroups)` 扫描资料里出现过的 `type`，为每个尚未定义的 `type` 建一个同 ID 的自定义组。旧九类按原标签迁移（`location`→世界地图、`faction`→势力、`magic`→力量体系、`technology`→技术体系……）。因此：

- `loreEntries[].type` 的值**一个都不改**，旧库打开即可用；
- `location` 迁移成 `form:'geography'` 的组，地理树照旧；
- 作者可以把迁移出来的组改名、改 form、或删掉（组里还有资料时拒绝删除）。

### 3. 单一真源：`dist/lore-groups.js`

分组规则只写一份（经典脚本，挂 `WorldforgeLoreGroups`）；服务端通过 `lore-groups.mjs` 的副作用导入复用同一张表。这消除了「前端一份、服务端一份」的漂移，也让 `tests/lore-groups.test.mjs` 能同时断言两侧。

### 4. 提示词档位收敛到五档，但旧键不丢

`PROMPT_TYPE_KEYS` 只保留五个固定键；生成时按「资料真实 `type` 精确命中 → 否则收敛到 `info`」取档位。旧的九个键不再参与生成，但 `normalizePromptSettings` 会**原样保留**作者写过的文本（不静默丢弃），`validatePromptSettings` 也仍然接受它们。

### 5. 卡牌子类型改为按世界派生

删除全局随从种族表与法术派系表。`subtypeOptions({cards,lore,worldId,type})` 从当前世界已有卡牌与同世界资料（随从取 `species` 组、法术取 `magic` 组）派生候选，作者还能直接输入新名称；`normalizeSubtype` 不再因为「不在词表里」而清空数据。旧草案里的稳定 ID 通过 `legacySubtypeLabels` 保留展示名。

### 6. 同时移除默认世界

这一版一并删掉浏览器里的 `W01_SEED`：新装实例没有任何世界或题材种子，`worldIdOf` 不再把缺失的世界归属算进 `W01`，而是显示为「未归属资料」桶（并提供归入操作）。`readLore()` 会过滤 `seeded` 标记，因此已有浏览器缓存里的默认世界会在下次保存时被移除。

## 后果

- **正面**：任意题材的世界可以零改代码接入；资料组由作者定义，不再需要为每个题材发一次版本；旧库无需迁移脚本即可打开。
- **代价**：`type` 变成自由字符串，`ai-content-specs` 必须在没有 group 时也能给出可用契约（已按旧类型表回落）；分组信息成为内容库的一部分，因此 `content` 增加 `loreGroups` 字段与 `lore_groups` 表（schema v3）。
- **剩余风险**：卡牌类型（随从/法术/武器）仍是产品常量，本轮未改；自定义组之间没有继承关系，重复的属性名需要作者各自维护。
