# `ai-harness.mjs`

> 作用：把 ADR-0029 §7 的六层提示词组装成请求（system 侧 + 用户侧上下文 + 结构化输出契约），并承担上下文预算裁剪、模型返回校验与候选补全诊断。由 `server.mjs` 消费，内部依赖 `ai-content-specs.mjs` 与 `agent-profile-contract.mjs`。

## 六层提示词在产品代码中的落点

| 层 | `AGENT_PROMPT_LAYERS` 名 | 本文件载体 | 位置 |
| --- | --- | --- | --- |
| 1 | `product_boundary` | `PRODUCT_BOUNDARY_INSTRUCTIONS` | `L12` |
| 2 | `preset_runtime` | `composeAgentSystemPrompt({ presetPrompt })` | `L70` |
| 3 | `entry_contract` | `LORE_ENTRY_CONTRACT` / `FREE_ENTRY_CONTRACT` / `FREE_AGENT_TOOL_GUIDE` | `L18` / `L24` / `L28` |
| 4 | `author_prompts` | `<author_type_prompt>` + `<author_personalized_style>` | `L152` |
| 5 | `task_request` | 目标模块、action、候选数、已勾选内容块清单 | `L153` |
| 6 | `untrusted_context` | `<worldforge_examples>` + `<worldforge_context>`；或 `attachUntrustedContext` 追加的 `<untrusted_context>` | `L154` / `L86` |

- 第 1–3 层只经 `composeAgentSystemPrompt` 进入 system 侧；第 4–6 层只经 `buildPrompt` / `attachUntrustedContext` 进入用户侧，两条路径互不交叉。
- 层名与优先级常量定义在 `agent-profile-contract.mjs`；本文件只 import 两个 tag 白名单，拼装顺序在此硬编码，不读取 `AGENT_PROMPT_LAYERS`。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `HARNESS_VERSION` | `'2.1.0'`，随 `context` 一起进入提示与 `contextMeta` | `L5` |
| `assertPresetPromptPortable(prompt)` | preset 文本含 `AGENT_PROMPT_RESERVED_TAGS` 即抛 `AGENT_MANIFEST_INVALID` | `L41` |
| `assertInstructionLayerClean(label, text)` | 指令层文本含 `AGENT_UNTRUSTED_TAGS` 即抛 `AGENT_UNTRUSTED_LEAK` | `L55` |
| `composeAgentSystemPrompt({presetPrompt, entryContract, extraContracts})` | 产出 `<product_boundary>` / `<agent_preset>` / `<entry_contract>` 三段，空层省略 | `L70` |
| `attachUntrustedContext(messages, blocks)` | 把不可信块拼到**最后一条**消息的 `content` 末尾，返回新数组 | `L86` |
| `SYSTEM_INSTRUCTIONS` / `FREE_AGENT_INSTRUCTIONS` | 无 preset 时的固定回滚基线（计划 §12.4）；分别 = 边界+`LORE_ENTRY_CONTRACT` / 边界+`FREE_ENTRY_CONTRACT` | `L97` / `L98` |
| `buildContextBundle(payload, budget)` | 资料库清洗、排序、按字符预算装入 examples 与 entries | `L119` |
| `generationContract(payload)` | 由 `type` + `selectedBlocks` 解析出实际内容块，是 Schema 与校验的共同真值 | `L133` |
| `createLoreResponseSchema(payload)` | 由 `blockSchema` 生成 `{variants:[{key,content}]}` 的 strict JSON Schema | `L138` |
| `buildPrompt(payload, bundle)` | 组装第 4→6 层文本 | `L144` |
| `validateAiResponse(value, payload)` | 强校验并返回 `{variants, contract}`；失败抛 `Error` | `L159` |
| `parseAiResponse(raw, payload)` | 去 ``` 围栏后交给 `validateAiResponse`；JSON 语法错误改写为「模型没有返回有效 JSON」 | `L181` |
| `inspectAiResponse(raw, payload, stage)` | 不抛错的诊断版校验，收集 `INVALID_JSON`/`INVALID_ENVELOPE`/`INVALID_VARIANT` | `L199` |
| `buildSupplementPrompt(...)` | 生成只补差额的二次请求文本，声明已验收候选不得重写 | `L221` |
| `completeAiVariants({raw, payload, expectedCount, requestSupplement})` | 初次验收 + 一次补充 + `diagnostics` 汇总 | `L226` |
| `createModelBody(config, prompt, options)` | 按 `config.style` 产出 chat 或 responses 请求体 | `L271` |
| `NAME_RESPONSE_SCHEMA` / `parseNameResponse(raw, n)` | 命名请求的 Schema 与数量严格校验（数量不等即抛错） | `L279` / `L280` |

## 重点逻辑

### `composeAgentSystemPrompt(...)`
- 依次校验三层：第 1 层常量自检 → preset 先过 `assertPresetPromptPortable` 再过 `assertInstructionLayerClean` → `entryContract` 与 `extraContracts` 逐个校验、`trim` 后去空。
- 顺序固定为 `product_boundary` → `agent_preset` → `entry_contract`，层间以空行连接；preset 或契约全空时对应整段不输出。
- 不接收第 4–6 层：注释与函数签名都排除作者提示、任务要求与不可信上下文。

### `attachUntrustedContext(messages, blocks)`
- `blocks` 去空后拼接；内容为空时**原样返回**入参（非数组时返回 `[]`）。
- 非空时先 `map` 浅拷贝每条消息，再改写最后一条的 `content` 为 `原文 + "\n\n<untrusted_context>…"`；调用方数组与消息对象不被修改，缺省 `content` 时会拼出 `"undefined…"` 前缀（静态分析无法确认调用方是否总带 `content`）。
- 服务端不保存会话，因此该上下文不会被跨请求累积。

### `buildPrompt(payload, bundle)`
- 段顺序被 ADR-0029 §7 冻结：`<author_type_prompt>` → `<author_personalized_style>`（第 4 层）→ 任务要求段（第 5 层）→ `<worldforge_examples>` + `<worldforge_context>`（第 6 层）。
- 候选数取 `clamp(1, 5, Number(variantCount) || 3)`，与 `createLoreResponseSchema` 的 `minItems/maxItems` 同源计算。
- `action` 只映射到 5 条固定指引（`brainstorm`/`polish`/`conflict_check`/`relations`/`background_story`），未知值回落为「提供彼此有实质差异的候选」。
- 第 6 层内容用 `JSON.stringify(…, null, 2)` 原样嵌入，只以标签包裹，不做转义；`userExamples` 被截到 6000 字符。

### `buildContextBundle(payload, budget = 60000)`
- 资料库先 `sanitizeEntry` 并按 `id` 去重、剔除草稿自身，原始库最多取 500 条。
- 同世界同类型的 `canon` 条目优先作为 examples：最多 4 条，且此阶段预算为 `min(budget, 16000)`。
- `relevance` 加权：直接关联 +1000、同世界 canon +500、同世界 +80、同类型 +40、命中标签每个 +25、关联重合 +10；跨世界且非直接关联直接返回 0 被过滤。
- `used` 以 `JSON.stringify` 长度累计，装不下的条目跳过而非中断；`contextMeta` 记录 `includedIds`、`exampleIds`、`omittedExampleCount`、`omittedCount`、`approximateCharacters`。

### `validateAiResponse` / `inspectAiResponse` / `completeAiVariants`
- 校验层：`variants` 必须 1–5 条；`key` 唯一且 1–80 字符；`content` 的键集合必须**恰好等于**已选内容块（多或少都抛错）。
- 按 `kind` 分支：`relations` ≤12 项且 `id` 必须属于 `payload.allowedRelationIds`、`reason` 必填；`array` ≤12 项、每项非空且 ≤1000 字符；`number` 允许 `null`；其余为字符串，`details` 上限 16000、其他 2000。
- `inspectAiResponse` 逐条 `validateAiResponse({variants:[candidate]})` 收集问题而不中断，同时返回 `receivedCount` 与 `contract`。
- `completeAiVariants` 只保留前 `wanted` 条（超出记 `EXTRA_VARIANTS`）；不足时请求一次补充，按原顺序去重 key 后追加，补充抛错记 `SUPPLEMENT_FAILED` 并保留已验收候选；`status` 为 `complete` 或 `partial`。

### `createModelBody(config, prompt, options)`
- `options` 允许直接传布尔值（视作 `structured`）；`structured === false` 时不发 `response_format` / `text.format`。
- `config.style === 'chat'` 走 `messages` + `response_format.json_schema`，否则走 `instructions` + `input` + `text.format` 且 schema 置于 `format` 顶层。
- 仅当 `options.images` 非空时把用户内容改为 `text`/`input_text` + 图片分片数组，图片 `detail` 固定 `auto`。

## 重要约束
- 不可信内容只能走用户侧：任何 `<worldforge_context>`、`<untrusted_context>`、`<author_notes>` 等标记出现在指令层或 preset 都会抛错，而不是被静默拼入。
- 两处断言的错误码是硬契约：preset 侧 `AGENT_MANIFEST_INVALID`，指令层泄漏 `AGENT_UNTRUSTED_LEAK`。
- `blockSchema`（`ai-content-specs.mjs`）与 `validateAiResponse` 的 `kind` 分支必须同步：Schema 只约束形状，长度/引用白名单只在校验层生效。
- 关联建议的合法性依赖调用方传入 `allowedRelationIds`；缺省时集合为空，任何 `relations` 内容都会被拒。
- `SYSTEM_INSTRUCTIONS` / `FREE_AGENT_INSTRUCTIONS` 是预设缺失时的回滚基线，改动会直接影响无 preset 请求。
