# `dist/relation-picker.js`

> 作用：关联资料选择器的纯逻辑层。提供筛选、多选切换、摘要与“失联引用计数”；UI（`#relationDialog`）与状态由 `app.js` 持有。同时以 `module.exports` 暴露。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| 工厂依赖 | 优先用 `root.WorldforgeWorldScope.worldIdOf`，缺失时退回本地实现（默认 `W01`） | `L6` |
| `haystack(entry)` | 搜索语料：`name`/`id`/`summary`/`details`/`tags` 拼接后小写 | `L7` |
| `filter(entries,options)` | 组合筛选（见下） | `L8–L26` |
| `toggle(ids,id)` / `remove(ids,id)` | 不可变多选切换/移除，返回新数组；空 id 时原样拷贝 | `L27–L35` |
| `summarize(ids,entries)` | 按选择顺序把 ID 还原成条目对象，缺失项被过滤 | `L36–L39` |
| `missingCount(ids,entries)` | `选中数 − 可解析数`，用于提示已失效引用 | `L40–L43` |

## 重点逻辑

- `filter` 的选项契约：`query`（小写包含）、`excludeId`（排除自身，避免自关联）、`type`/`status`（`'all'` 或具体值）、`currentWorldId` + `worldMode`（`current` 仅本世界 / `other` 仅其他世界 / `all` 不限）、`view`（`all`/`selected`/`unselected`）、`selectedIds`。
- 过滤顺序：空 id → 自身 → 类型 → 状态 → 世界 → 视图 → 关键词；任一步不通过即短路返回。

## 重要约束

- 所有函数入参先做 `Array.isArray` 兜底，非数组按空数组处理；本模块不修改传入数组。
- 世界过滤仅在 `worldMode !== 'all'` 且 `currentWorldId` 非空时生效；只传 `worldMode` 而不传 `currentWorldId` 时该维度被跳过。
