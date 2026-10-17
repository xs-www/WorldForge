# `simulation/llm/macro-proposal.mjs`

> 作用：定义 LLM 局部政策提案的上下文 prompt、结构化响应契约、解析校验，以及失败时使用的确定性规则降级提案。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `MACRO_PROPOSAL_SCHEMA` | 冻结的 structured-output JSON Schema；`action.type` 枚举取自 `MACRO_ACTIONS`，`parameters` 只允许 `regionId`（必填）与 `targetPolityId`，全部 `additionalProperties: false` | `L3` |
| `buildMacroProposalPrompt(context)` | 把 `context` 原样 JSON 嵌入 `<local_context>` 并声明其为不可信数据；只允许为 `selectedRegion` 提一个行动 | `L31` |
| `parseMacroProposal(raw, context, state)` | 解析并复核模型输出，返回 `{ title, rationale, expectedOutcome, action, validation }`；任何不合法即抛 `Error` | `L43` |
| `fallbackMacroProposal(context, state)` | 纯规则优先级链，返回同形状对象；无可行行动时抛 `Error` | `L68` |

## 重点逻辑
- **局部有限上下文**：裁剪由调用方完成（`macro-simulation-service.localContext` 只装 world / selectedRegion / owner / neighbors / relations / recentEvents / availableActions）；本文件的限制落在 prompt 文案（不虚构全局信息、类型须来自 `availableActions`，`L32`–`L35`）与 schema 参数面（`L18`–`L25`）。
- **结构化校验**：容错仅限字符串输入的 ```json 围栏剥离（`L44`–`L46`）；随后三道硬检查——顶层与 `action` 须为对象（`L47`）、`parameters.regionId` 必须等于 `context.selectedRegion.regionId`（`L51`）、`actorId` 被强制改写为 `context.owner.polityId`（`L53`）后交 `validateMacroAction` 复核（`L57`–`L58`）。文本字段经 `boundedText` 截断并带默认值：title 80 / rationale 500 / expectedOutcome 300（`L60`–`L62`）。
- **降级边界**：本模块不捕获异常、不自动降级，降级决策属调用方（`server.mjs` 的提案入口在未配置模型或提案失败时改调 `fallbackProposal`）。规则链为：粮食紧张（`food + foodOutput < ceil(population/12) + 8`）且财政 ≥12 → `relief`；稳定度 <52 且财政 ≥12 → `relief`；基础设施 <8 且财政 ≥15 → `invest`；存在非本国相邻地区且财政 ≥10 → `mobilize`；否则 → `negotiate`（`L71`–`L96`）。
- schema 的 `enum` 只约束模型侧；降级提案与模型提案共用同一出口 `validateMacroAction`，失败即抛而不返回 `null`（`L97`–`L98`）。末分支的 `targetPolityId` 取自 `context.neighbors.find(...)?.ownerId`，若无非本国相邻地区该值缺失，会以 `INVALID_DIPLOMATIC_TARGET` 被拒（`L92`–`L98`）。
