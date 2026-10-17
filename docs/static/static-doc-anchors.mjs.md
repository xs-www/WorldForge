# `static-doc-anchors.mjs`

> 作用：静态文档位置索引的可执行契约。文档里的每个 `L###` 必须归属一个锚点（唯一命中的期望源码子串），行号由本脚本核对或重写（`--write`），无法归属或与锚点不符一律失败。

## 关键符号

| 符号 | 作用 / 契约 |
| --- | --- |
| `resolveAnchor(name, anchor, sourceLines)` | 期望子串必须**同时**出现在同一行；命中行数必须等于 `count`（默认 1），否则抛 `ANCHOR_MISSING`/`ANCHOR_AMBIGUOUS`；`nth` 在同构行中定位 |
| `resolveAnchors(anchors, sourceLines)` | 预解析全部锚点，名称 → 行号 |
| `scanLine(line, anchors)` | 从文档行提取 `L###` 引用与锚点候选；优先 `<!-- anchor:a b -->`，其次「方法 + 路径」路由，最后反引号符号名 |
| `verifyDocument({docText, sourceLines, anchors, rewrite})` | 校验或重写；单行验证全部锚点，区间（`–` 连接）要求起点早于终点，独立引用允许递减 |

## 命令行

`node static-doc-anchors.mjs --check`（默认，供 `npm run check`）；`--write` 按锚点重写行号；`--doc`/`--anchors` 可指定文件。

## 重要约束

- 锚点定义在 `docs/static/anchors.json`，与文档同目录、一起评审。
- 不猜测：无法归属的 `L###` 直接报错；重复构造必须用 `count`/`nth` 明确锁定，源码漂移会让 `count` 失配。
- 测试见 `tests/static-doc-anchors.test.mjs`，用内存夹具覆盖错误子串、歧义、倒置区间与源码漂移。
