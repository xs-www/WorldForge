# `image-context.mjs`

> 作用：为生图请求挑选视觉参考资料并拼装提示词（含超长时的压缩回退）。纯函数，由 `server.mjs` 消费。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `selectVisualLore(payload)` | 库快照前 500 条；种子 = `lore` 目标的 id 或卡牌的 `loreRefs`；再双向扩展一层关联（种子→`relationIds`，反向引用种子的条目），上限 12 条 | `L15` |
| `imagePromptKey(payload)` | 非 `lore` 目标一律 `'card'`；`lore` 目标经 `imageKeyForId` 按表单形态收敛（地理→location、编年史→timeline、背景故事→story、其余→other） | `L34` |
| `composeImagePrompt(payload, settings)` | 拼 7 个块，超 3000 字符时改用压缩版并 `slice` 到 3000 | `L38` |

## 重点逻辑
### `selectVisualLore` / `composeImagePrompt`
- `lore` 目标若不在库快照里，会被 `unshift` 到结果首位再截断——即目标条目保证入选，可能挤掉最后一个关联条目。
- 块顺序固定：统一视觉方向（`settings.visualStylePrompt`）→ 本类生图要求（`settings.imagePrompts[key]`）→ 生成目标与用途 → 设定依据 → 卡牌规则意象（`card.rulesText`）→ 作者本次要求 → 固定的原创/无文字无 UI 约束句。
- 超长回退取 `blocks` **前 3 项**（视觉方向、本类要求、生成目标）+ 压缩版设定依据（每条 300 字符摘要）+ 过滤后数组的**倒数第二与最后一项**（通常即作者要求与固定约束句）；卡牌规则意象块不在保留范围内，且整体仍被 `slice` 到 3000，返回 `truncated: true`。前面的块为空会使下标前移，保留内容随之变化。
- 两条路径都返回 `contextIds`（实际入选条目 id），无论是否截断。
- 生图档位由 `lore-groups.mjs` 的 `promptKeyOf` 决定，因此「魔法」「科技」等旧分类不再各自占一个档位；`other` 只会在设置里被人工选择时使用。
