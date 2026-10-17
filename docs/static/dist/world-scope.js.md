# `dist/world-scope.js`

> 作用：世界归属层的纯函数——`W##` ID 归一与生成、按 `worldId` 分组、世界检索、跨世界批量迁移。同时以 `module.exports` 暴露，`app.js` 靠它实现“每个世界只看到自己的资料”。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `worldIdPattern` / `UNASSIGNED_WORLD_ID` / `UNASSIGNED_WORLD_TITLE` | `/^W\d{2}$/`；未归属桶的 id（空串）与标题「未归属资料」 | `L6–L9` |
| `worldIdOf(entry)` | 条目世界 ID；**缺省就是空串**，不再回落到任何默认世界 | `L10` |
| `nextWorldId(entries)` | 从已用 ID（世界条目的 `id` 与所有条目的 `worldId`）取最小未占用序号，`padStart(2,'0')`，超过 99 时自然变 3 位 | `L5–L14` |
| `countByType(entries)` | 按 `type` 计数，空 type 忽略 | `L15–L19` |
| `groups(entries)` | 按 `worldId` 分组，输出 `{worldId, world, entries, others, counts, total, title, assigned}`，按 `worldId` 升序 | `L20–L33` |
| `loreOfWorld(entries,worldId)` | 不传 `worldId` 返回全量拷贝；传空串表示「未归属桶」；否则按 `worldIdOf` 精确过滤 | `L47–L52` |
| `searchWorlds(groups_,query)` | 在 `title`/`worldId`/世界条目 `summary`/`details` 上做小写包含匹配 | `L39–L43` |
| `reassign(entries,sourceWorldId,targetWorldId)` | 把源世界的非世界条目改 `worldId`，返回 `{entries,moved}` | `L44–L55` |

## 重点逻辑

- **`assigned` 的含义**：分组存在一个 `type==='world'` 且 `id===worldId` 的条目才算已归属；否则 `world=null`、`assigned=false`，UI 据此渲染「未归属资料」卡片与归入下拉。
- **未归属桶排在最后**：`groups()` 把 `worldId` 为空的分组固定置于真实世界之后，避免它抢在世界前成为默认入口。
- **`others`**：分组的条目里剔除世界条目本身，`counts`/`total` 都基于 `others` 计算，所以世界卡片上显示的是“资料数”而非包含世界条目的总数。

## 重要约束

- `reassign` 不改 `type==='world'` 的条目，也不改与 `sourceWorldId` 无关的条目；`source===target` 或两者皆空时原样返回 `moved:0`。`source` 传空串即表示把未归属桶搬进某个真实世界。
- 世界 ID 的合法性由 `worldIdPattern` 单独判定；`worldIdOf` 只做空值兜底，不校验格式，因此形如 `W1` 的脏数据会被保留并在分组时自成一类。
