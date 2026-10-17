# `dist/chronicle.js`

> 作用：编年史（`timeline` 类型）的两态模型——容器 `chronicle` 与节点 `entry`——及其排序与树构建。纯函数，无 DOM；同时以 `module.exports` 暴露。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `normalize(value,enabled)` | 非 `timeline` 类型（`enabled=false`）一律返回空结构；否则 `kind` 只认 `entry`，其余归 `chronicle`；`parentId`/`dateLabel` 仅节点保留；`order` 非有限数时为 `null` | `L2–L13` |
| `canParent(parent,child,worldId,types)` | 父级必须属于编年史组集合（`types` 缺省时退回 `type==='timeline'`）、同世界且自身 `kind==='chronicle'`；子项必须是 `kind==='entry'` | `L17–L24` |
| `sortEntries(entries)` | 双有 `order` 时按数值升序；单边有 `order` 者优先；都无则按 `dateLabel`（缺省回退 `name`）中文排序 | `L22–L29` |
| `build(entries,query,types)` | 输出 `{roots, orphans, children, visibleIds, hasQuery}`；`types` 是当前被设为「编年史」表单的资料组 id 集合 | `L33–L56` |

## 重点逻辑

- **排序值只负责先后**：`dateLabel`（如“炉历 112 年”）只用于展示与兜底排序，可承载虚构历法与不确定日期；真实顺序由 `order`（可为负数/小数）决定。
- **搜索可见性**：命中节点会把它所属的编年史一并加入 `visibleIds`（`L50–L51`），因此搜索时父容器不会消失。

## 重要约束

- `order` 的“有值”判定用 `Number.isFinite`，所以 `''`、`null`、非数字文本都会退化为 `null` 并落到按 `dateLabel` 排序的兜底分支。
- 节点父级失效（父编年史被删或跨世界）时进入 `orphans`，不自动提升为根。
- `types` 让编年史树不再写死 `timeline` 类型：作者可另建一个 `form:'chronicle'` 的组，两组的节点互不串台；不传 `types` 时行为与旧版完全一致。
