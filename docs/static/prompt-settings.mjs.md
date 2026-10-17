# `prompt-settings.mjs`

> 作用：提示词设置的类型清单、出厂默认文案（分类提示词、统一视觉风格、生图提示词）与两段式处理——`normalizePromptSettings` 合并默认值，`validatePromptSettings` 先校验再复用前者。出厂文案只描述**写作方法与边界**，不假设世界有魔法、机械、工业或神性。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `PROMPT_TYPE_KEYS` | 五个固定资料组键（world / info / character / timeline / story），是保存与校验的白名单 | `L4` |
| `LEGACY_PROMPT_TYPE_KEYS` | 旧十三类里九个非固定键；不再有出场默认值，但作者写过的文本必须原样保留 | `L7` |
| `IMAGE_PROMPT_KEYS` | `'card'` + 五个固定键 + `'other'`，共 7 个生图档位 | `L8` |
| `DEFAULT_TYPE_PROMPTS` | 五类默认写作提示 | `L10` |
| `DEFAULT_VISUAL_STYLE_PROMPT` | 跨图统一的材质/工艺一致性提示 | `L18` |
| `DEFAULT_IMAGE_PROMPTS` | 7 个生图档位默认提示 | `L20` |
| `normalizePromptSettings(value)` | 合并默认值并输出 `version: 5` | `L35` |
| `validatePromptSettings(value)` | 校验非法输入后返回 `normalizePromptSettings` 的结果 | `L52` |

## 合并规则（默认值 + 用户覆盖）
- 逐键判定「用户是否显式提供」（`Object.prototype.hasOwnProperty.call`），不是按真值判断：显式提交空字符串会**保留空串**，而不是回落默认值。
- `version` 恒为 `5`，不接受调用方传入。
- `typePrompts`：五个固定键缺失时补 `DEFAULT_TYPE_PROMPTS[key]`；旧的九个分类键**只在作者显式提供时原样保留**（`L40`），不参与生成，但也不会被悄悄丢弃。
- 仍有一条一次性迁移：`timeline` 的值等于旧 `LEGACY_TIMELINE_PROMPT` 时替换为新默认（`L41`）；旧的 `location` 迁移随 `location` 变成自定义组一并移除。
- `imagePrompts`：整个字段缺失时全档位取默认；存在时逐档位判定同上，旧分类键同样原样保留。
- `personalizedPrompt` 无默认值，缺省为 `''`。
- 所有文本统一过 `text()`：`String(value ?? '').trim().slice(0, 8000)`，因此长度上限在合并阶段就已生效。

## 非法输入拒绝边界（`validatePromptSettings`）
- `value` 非对象即抛错；`personalizedPrompt` / `visualStylePrompt` 存在但非字符串、或原始长度 > 8000 抛错（长度判定用未截断的原值）。
- `typePrompts` **必填**且必须是非数组对象——只提交 `personalizedPrompt` 也会因缺少该字段被拒；键既不在固定键也不在旧分类键时抛「未知提示词分类」；值非字符串或 > 8000 抛错。
- `imagePrompts` 可选，但若存在必须是非数组对象，键不在 7 个档位也不在旧分类键时抛「未知生图提示词分类」，值约束同上。
- 校验函数只做白名单与长度检查，不校验文案内容语义；错误以 `Error` 抛出、无错误码。

## 重要约束
- 自定义资料组没有独立档位：`server.mjs` 先用资料的真实 `type` 精确命中（兼容作者以前按旧类型写的提示词），未命中才收敛到 `info` 档。
- 出厂默认值不得重新引入题材假设：`tests/prompt-settings.test.mjs` 会断言默认文案里不出现「魔法/法术/蒸汽/工业/神力/神性/以太」等词。
