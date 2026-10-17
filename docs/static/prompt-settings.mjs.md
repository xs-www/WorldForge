# `prompt-settings.mjs`

> 作用：提示词设置的类型清单、出厂默认文案（分类提示词、统一视觉风格、生图提示词）与两段式处理——`normalizePromptSettings` 合并默认值，`validatePromptSettings` 先校验再复用前者。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `PROMPT_TYPE_KEYS` | 13 类资料分类键，是保存与校验的枚举白名单 | `L1` |
| `IMAGE_PROMPT_KEYS` | `'card'` + 13 类 + `'other'`，共 15 个生图档位 | `L2` |
| `DEFAULT_TYPE_PROMPTS` | 13 类默认写作提示（含能量守恒、canon/proposed 区分等约束文案） | `L4` |
| `DEFAULT_VISUAL_STYLE_PROMPT` | 跨图统一的材质/工艺一致性提示 | `L20` |
| `DEFAULT_IMAGE_PROMPTS` | 15 个生图档位默认提示 | `L22` |
| `normalizePromptSettings(value)` | 合并默认值并输出 `version: 4` | `L44` |
| `validatePromptSettings(value)` | 校验非法输入后返回 `normalizePromptSettings` 的结果 | `L61` |

## 合并规则（默认值 + 用户覆盖）
- 逐键判定「用户是否显式提供」（`Object.prototype.hasOwnProperty.call`），不是按真值判断：显式提交空字符串会**保留空串**，而不是回落默认值。
- `version` 恒为 `4`，不接受调用方传入。
- `typePrompts`：缺失的键补 `DEFAULT_TYPE_PROMPTS[key]`；另外有两条一次性迁移——值仍等于旧 `LEGACY_LOCATION_PROMPT` / `LEGACY_TIMELINE_PROMPT` 时替换为新默认（`L54`–`L55`）。
- `imagePrompts`：整个字段缺失时全档位取默认；存在时逐档位判定同上。
- `personalizedPrompt` 无默认值，缺省为 `''`。
- 所有文本统一过 `text()`：`String(value ?? '').trim().slice(0, 8000)`，因此长度上限在合并阶段就已生效。

## 非法输入拒绝边界（`validatePromptSettings`）
- `value` 非对象即抛错；`personalizedPrompt` / `visualStylePrompt` 存在但非字符串、或原始长度 > 8000 抛错（长度判定用未截断的原值）。
- `typePrompts` **必填**且必须是非数组对象——只提交 `personalizedPrompt` 也会因缺少该字段被拒；键不在 `PROMPT_TYPE_KEYS` 抛「未知提示词分类」；值非字符串或 > 8000 抛错。
- `imagePrompts` 可选，但若存在必须是非数组对象，键不在 `IMAGE_PROMPT_KEYS` 抛「未知生图提示词分类」，值约束同上。
- 校验函数只做白名单与长度检查，不校验文案内容语义；错误以 `Error` 抛出、无错误码。
