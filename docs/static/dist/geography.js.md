# `dist/geography.js`

> 作用：地点层级（大陆→国家→地区→区域→城市→地点/路线）的规则表与树构建。纯函数，无 DOM；同时以 `module.exports` 暴露。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `kinds` | 7 种层级及 `rank`（`route` 与 `site` 同为 5） | `L2–L10` |
| `parentKinds` | 每种层级的合法父级集合：大陆无父级；国家仅大陆；地区仅国家；区域可挂国家/地区；城市可挂国家/地区/区域；地点与路线可挂到城市一级 | `L11–L19` |
| `nextKinds` | 新建子项时的默认下一层（`route` 未列入，故路线无默认子层） | `L20` |
| `normalizeKind(kind)` | 未知值回落 `region`，旧值 `place` 映射为 `site` | `L21` |
| `allowedParentKinds(kind)` | 父级候选取值（给下拉框用） | `L22` |
| `canParent(parent,childKind,worldId,types)` | 父级必须属于地理组集合（`types` 缺省时退回 `type==='location'`）、同 `worldId`、且层级在 `allowedParentKinds` 内 | `L25` |
| `sortEntries(entries)` | 先按层级 `rank`，同层按 `name` 中文排序 | `L24–L27` |
| `buildTree(entries,query,types)` | 输出 `{roots, orphans, children, visibleIds, hasQuery}`；`types` 是当前被设为「地理层级」表单的资料组 id 集合 | `L30–L60` |

## 重点逻辑

- **孤儿判定**：有父级 ID 但父级不存在、跨世界、或层级不被允许的地点进入 `orphans`，不会静默挂到根；只有“无父级的大陆”进 `roots`（`L37–L39`）。
- **搜索可见性**：命中项沿 `parentId` 向上逐级加入 `visibleIds`，并用 `seen` 集合防环（`L46–L56`）；`children` 已按 `sortEntries` 排序，渲染端可直接按 `visibleIds` 过滤。
- **匹配范围**：`name` + `id` + `summary` + `details` + `tags` 全字段小写包含匹配。

## 重要约束

- 层级合法性以 `canParent` 为唯一判据；保存与渲染都应在同一份规则下判断，否则会出现“保存成功但树里看不到”的孤儿条目。
- `types` 让地理树不再写死 `location` 类型：作者把任意资料组设成 `form:'geography'` 后，该组的条目会自动进入同一棵树；不传 `types` 时行为与旧版完全一致。
- `kinds` 的 `rank` 决定排序，新增层级必须同时给 `kinds`/`parentKinds` 补齐，否则 `normalizeKind` 会把它降级成 `region`。
