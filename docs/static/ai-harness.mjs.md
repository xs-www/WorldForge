# `ai-harness.mjs`

> 作用：把 ADR-0029 §7 的六层提示词组装成请求（system 侧 + 用户侧上下文 + 结构化输出契约），并承担上下文预算裁剪、模型返回校验与候选补全诊断。由 `server.mjs` 消费，内部依赖 `ai-content-specs.mjs` 与 `agent-profile-contract.mjs`。

## 六层提示词在产品代码中的落点

| 层 | `AGENT_PROMPT_LAYERS` 名 | 本文件载体 | 位置 |
| --- | --- | --- | --- |
| 1 | `product_boundary` | `PRODUCT_BOUNDARY_INSTRUCTIONS` | `L55` |
| 2 | `preset_runtime` | `composeAgentSystemPrompt({ presetPrompt })` | `L147` |
| 3 | `entry_contract` | `LORE_ENTRY_CONTRACT` / `FREE_ENTRY_CONTRACT` / `FREE_AGENT_TOOL_GUIDE` / `CARD_ENTRY_CONTRACT` | `L61` / `L67` / `L71` / `L84` |
| 4 | `author_prompts` | `<author_type_prompt>` + `<author_personalized_style>`（设定/自由 `L233`，卡牌 `L96`） | `L233` |
| 5 | `task_request` | 目标模块、action、候选数、已勾选内容块清单、JSON 响应外壳（设定 `L239`，卡牌 `L112`） | `L239` |
| 6 | `untrusted_context` | `<worldforge_examples>` + `<worldforge_context>`；`<card_draft>` 等卡牌区块；或 `attachUntrustedContext` 追加的 `<untrusted_context>` | `L240` / `L113` / `L163` |

- 第 1–3 层只经 `composeAgentSystemPrompt` 进入 system 侧；第 4–6 层只经 `buildPrompt` / `attachUntrustedContext` 进入用户侧，两条路径互不交叉。
- 层名与优先级常量定义在 `agent-profile-contract.mjs`；本文件只 import 两个 tag 白名单，拼装顺序在此硬编码，不读取 `AGENT_PROMPT_LAYERS`。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `HARNESS_VERSION` | `'2.1.0'`，随 `context` 一起进入提示与 `contextMeta` | `L5` |
| `previewOf(value, max = 240)` | 诊断用的单行模型原文片段（压平空白并截断） | `L13` |
| `parseLooseJson(text)` | 去 ``` 围栏、必要时按最外层 `{}`/`[]` 切片后解析；失败返回 `undefined` | `L19` |
| `coerceVariants(value, discriminators)` | 把数组 / `{variants}` / 裸候选对象收敛为 `{variants:[…]}`；`discriminators` 判定裸候选（卡牌 `patch`/`review`，设定 `content`） | `L36` |
| `withFallbackKey(candidate, index)` | 候选缺 `key` 时补 `candidate-<index+1>`；`key` 只是客户端标识 | `L45` |
| `assertPresetPromptPortable(prompt)` | preset 文本含 `AGENT_PROMPT_RESERVED_TAGS` 即抛 `AGENT_MANIFEST_INVALID` | `L118` |
| `assertInstructionLayerClean(label, text)` | 指令层文本含 `AGENT_UNTRUSTED_TAGS` 即抛 `AGENT_UNTRUSTED_LEAK` | `L132` |
| `composeAgentSystemPrompt({presetPrompt, entryContract, extraContracts})` | 产出 `<product_boundary>` / `<agent_preset>` / `<entry_contract>` 三段，空层省略 | `L147` |
| `attachUntrustedContext(messages, blocks)` | 把不可信块拼到**最后一条**消息的 `content` 末尾，返回新数组 | `L163` |
| `SYSTEM_INSTRUCTIONS` / `FREE_AGENT_INSTRUCTIONS` | 无 preset 时的固定回滚基线（计划 §12.4）；分别 = 边界+`LORE_ENTRY_CONTRACT` / 边界+`FREE_ENTRY_CONTRACT` | `L174` / `L175` |
| `buildContextBundle(payload, budget)` | 资料库清洗、排序、按字符预算装入 examples 与 entries | `L196` |
| `generationContract(payload)` | 由 `type` + `selectedBlocks` 解析出实际内容块，是 Schema 与校验的共同真值 | `L210` |
| `createLoreResponseSchema(payload)` | 由 `blockSchema` 生成 `{variants:[{key,content}]}` 的 strict JSON Schema | `L215` |
| `lorePromptSections(payload, bundle)` | 内部分段函数，返回 `{authorPrompts, taskRequest, untrusted}`，初次与补生成共用 | `L227` |
| `buildPrompt(payload, bundle)` | 由 `lorePromptSections` 拼出第 4→6 层文本 | `L244` |
| `validateAiResponse(value, payload)` | 强校验并返回 `{variants, contract}`；失败抛 `Error` | `L252` |
| `parseAiResponse(raw, payload)` | 去 ``` 围栏后交给 `validateAiResponse`；JSON 语法错误改写为「模型没有返回有效 JSON」 | `L274` |
| `inspectAiResponse(raw, payload, stage)` | 不抛错的诊断版校验，收集 `INVALID_JSON`/`INVALID_ENVELOPE`/`INVALID_VARIANT` | `L292` |
| `buildSupplementPrompt(payload, bundle, {missingCount, acceptedVariants, issues})` | 补生成请求；与初次共用同一层结构，补生成指令并入第 5 层 | `L323` |
| `completeAiVariants({raw, payload, expectedCount, requestSupplement})` | 初次验收 + 一次补充 + `diagnostics` 汇总 | `L331` |
| `createModelBody(config, prompt, options)` | 按 `config.style` 产出 chat 或 responses 请求体 | `L376` |
| `buildCardPrompt(payload, context, {requireJson})` | 卡牌入口第 4–6 层；第 5 层含 JSON 响应外壳与字段示例 | `L94` |
| `NAME_RESPONSE_SCHEMA` / `parseNameResponse(raw, n)` | 命名请求的 Schema 与数量严格校验（数量不等即抛错） | `L384` / `L385` |

## 重点逻辑

### `composeAgentSystemPrompt(...)`
- 依次校验三层：第 1 层常量自检 → preset 先过 `assertPresetPromptPortable` 再过 `assertInstructionLayerClean` → `entryContract` 与 `extraContracts` 逐个校验、`trim` 后去空。
- 顺序固定为 `product_boundary` → `agent_preset` → `entry_contract`，层间以空行连接；preset 或契约全空时对应整段不输出。
- 不接收第 4–6 层：注释与函数签名都排除作者提示、任务要求与不可信上下文。

### `attachUntrustedContext(messages, blocks)`
- `blocks` 去空后拼接；内容为空时**原样返回**入参（非数组时返回 `[]`）。
- 非空时先 `map` 浅拷贝每条消息，再改写最后一条的 `content` 为 `原文 + "\n\n<untrusted_context>…"`；调用方数组与消息对象不被修改，缺省 `content` 时会拼出 `"undefined…"` 前缀（静态分析无法确认调用方是否总带 `content`）。
- 服务端不保存会话，因此该上下文不会被跨请求累积。

### `buildPrompt(payload, bundle, options)`
- 只做拼接：从 `lorePromptSections` 取三段，顺序为 `<author_type_prompt>` → `<author_personalized_style>`（第 4 层）→ 任务要求段（第 5 层）→ `<worldforge_examples>` + `<worldforge_context>`（第 6 层）。
- `options.requireJson` 为真时把「严格只返回 JSON 对象」并入第 5 层任务段末尾。非结构化降级必须用这个选项，而不是在 prompt 尾部追加——后者会让以第 6 层结尾的 prompt 变成 4→5→6→5。
- 第 5 层**始终**包含响应外壳说明（`{"variants":[{"key","content":{已勾选块}}]}`、`key` 非空唯一、`content` 只能出现已勾选键），因为不少兼容接口会忽略 `json_schema`；示例正文写成「（此处写 … 的成品正文）」占位，避免被照抄。
- 候选数取 `clamp(1, 5, Number(variantCount) || 3)`，与 `createLoreResponseSchema` 的 `minItems/maxItems` 同源计算。
- `action` 只映射到 5 条固定指引（`brainstorm`/`polish`/`conflict_check`/`relations`/`background_story`），未知值回落为「提供彼此有实质差异的候选」。
- 第 6 层内容用 `JSON.stringify(…, null, 2)` 原样嵌入，只以标签包裹，不做转义；`userExamples` 被截到 6000 字符。

### `buildSupplementPrompt(payload, bundle, {missingCount, acceptedVariants, issues, requireJson})`
- 与初次请求共用 `lorePromptSections`，输出顺序为：第 4 层作者提示 → 第 5 层（初始任务 + 补生成指令）→ 第 6 层（示例/资料，随后是 `<accepted_variants>` 与 `<validation_issues>`）。
- `requireJson` 语义与 `buildPrompt` 相同：JSON 要求进第 5 层，补生成 prompt 仍以 `</validation_issues>` 结尾。
- 不接受「初始 prompt 字符串」作为入参：早期版本把内容追加到已含第 6 层的 prompt 尾部，形成 4→5→6→6→5；当前签名从结构上排除了这种拼接方式。
- **调用方必须传入已注入第 4 层且 `variantCount = missingCount` 的 payload**（`server.mjs` 用 `{ ...promptPayload, variantCount: missingCount }`）。传原始 payload 会让第 4 层退回「无额外分类提示」并产生「严格返回 2 份」与「只补 1 份」并存的矛盾；本函数不做兜底修正。
- 已验收候选与校验问题属于第 6 层最后区块；`issues` 只取前 8 条，为空时回落为「- 返回条数不足」。

### `buildContextBundle(payload, budget = 60000)`
- 资料库先 `sanitizeEntry` 并按 `id` 去重、剔除草稿自身，原始库最多取 500 条。
- 同世界同类型的 `canon` 条目优先作为 examples：最多 4 条，且此阶段预算为 `min(budget, 16000)`。
- `relevance` 加权：直接关联 +1000、同世界 canon +500、同世界 +80、同类型 +40、命中标签每个 +25、关联重合 +10；跨世界且非直接关联直接返回 0 被过滤。
- `used` 以 `JSON.stringify` 长度累计，装不下的条目跳过而非中断；`contextMeta` 记录 `includedIds`、`exampleIds`、`omittedExampleCount`、`omittedCount`、`approximateCharacters`。

### `validateAiResponse` / `inspectAiResponse` / `completeAiVariants`
- 校验层：`variants` 必须 1–5 条；`key` 唯一且 1–80 字符；`content` 的键集合必须**恰好等于**已选内容块（多或少都抛错）。
- 按 `kind` 分支：`relations` ≤12 项且 `id` 必须属于 `payload.allowedRelationIds`、`reason` 必填；`array` ≤12 项、每项非空且 ≤1000 字符；`number` 允许 `null`；其余为字符串，`details` 上限 16000、其他 2000。
- `inspectAiResponse` 先经 `parseLooseJson` + `coerceVariants(value, ['content'])` + `withFallbackKey` 收敛形状，再逐条 `validateAiResponse({variants:[candidate]})` 收集问题而不中断，同时返回 `receivedCount` 与 `contract`。
- `INVALID_JSON` / `INVALID_ENVELOPE` 诊断带 `previewOf(raw)`（≤240 字符单行片段），用于区分「不是 JSON」「JSON 但不是外壳」。
- `completeAiVariants` 只保留前 `wanted` 条（超出记 `EXTRA_VARIANTS`）；不足时请求一次补充，按原顺序去重 key 后追加，补充抛错记 `SUPPLEMENT_FAILED` 并保留已验收候选；`status` 为 `complete` 或 `partial`。

### `buildCardPrompt(payload, context, {requireJson})`
- 与 `lorePromptSections` 同构的第 4–6 层；第 5 层同样始终写死响应外壳，并按勾选字段生成示例值（`name`→`"新卡名"`、数值→ `3`、`keywordIds`/`loreRefs` → `[]`），避免模型照抄未提供的 ID。
- 示例值取安全值而非真实 ID 是关键约束：示例里出现 `KEY-001` 会让模型在未提供该关键词的请求里照样返回它，直接被白名单校验拒绝。

### `createModelBody(config, prompt, options)`
- `options` 允许直接传布尔值（视作 `structured`）；`structured === false` 时不发 `response_format` / `text.format`。
- `config.style === 'chat'` 走 `messages` + `response_format.json_schema`，否则走 `instructions` + `input` + `text.format` 且 schema 置于 `format` 顶层。
- 仅当 `options.images` 非空时把用户内容改为 `text`/`input_text` + 图片分片数组，图片 `detail` 固定 `auto`。

## 重要约束
- 不可信内容只能走用户侧：任何 `<worldforge_context>`、`<untrusted_context>`、`<author_notes>` 等标记出现在指令层或 preset 都会抛错，而不是被静默拼入。
- 两个入口都不能只靠 `json_schema` 表达输出结构：忽略 `response_format`/`text.format` 的兼容接口（如只支持 `json_object` 的端点）会把 Schema 里 `items` 的结构当根对象返回，因此响应外壳必须写在 prompt 第 5 层，解析侧再用 `coerceVariants` 收敛。
- 两处断言的错误码是硬契约：preset 侧 `AGENT_MANIFEST_INVALID`，指令层泄漏 `AGENT_UNTRUSTED_LEAK`。
- `blockSchema`（`ai-content-specs.mjs`）与 `validateAiResponse` 的 `kind` 分支必须同步：Schema 只约束形状，长度/引用白名单只在校验层生效。
- 关联建议的合法性依赖调用方传入 `allowedRelationIds`；缺省时集合为空，任何 `relations` 内容都会被拒。
- `SYSTEM_INSTRUCTIONS` / `FREE_AGENT_INSTRUCTIONS` 是预设缺失时的回滚基线，改动会直接影响无 preset 请求。
