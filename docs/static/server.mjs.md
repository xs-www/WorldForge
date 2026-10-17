# `server.mjs`

> 作用：WorldForge 的单进程 HTTP 入口。启动时读取 `.env.local`、打开内容库与模拟库 SQLite、冻结 Agent Profile Registry，然后在一个 `createServer` 回调内按「方法 + 精确路径 + 自定义请求标记头」分发 API，未命中则回落到 `dist/` 静态文件。

> 篇幅说明：路由表需按源码逐分支覆盖，故略超常规长度预算。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `loadLocalEnv()` / `saveLocalEnv(values)` | 读/写 `.env.local`；写盘用临时文件 + `rename`、`mode 0600`，只重写托管键并保留其余行 | `L31` / `L131` |
| `readBody(req, maxLength = 2000000)` | 累积请求体并 `JSON.parse`；超限抛「请求内容过长」，空体解析为 `{}` | `L155` |
| `buildCardContext(payload)` | 卡牌受限上下文：草案、引用 lore 内容（与 `draft.loreRefs` 交集）、关键词定义（按 `draft.keywordIds` ∪ `allowedKeywordIds` 过滤）、W97 `experimental` 规则摘要 | `L511` |
| `callCardAgent(payload)` | 卡牌入口：`structured_card` + `toolPolicy=none`，返回补丁（评审由作者完成）、`agent` 快照与 `diagnostics`；补生成沿用同一 system；结构化请求被 400/404/422 拒绝时降级并以 `fallbackReason`（+ `structured:false`）如实告知 | `L555` |
| `validateSettings(payload)` | 校验 baseUrl/model/apiKey，并合并 Seedream、ComfyUI、提示词设置 | `L165` |
| `createReferenceAsset` / `createArtAsset` / `serveArtAsset` | 参考图上传、生图落盘、资产文件读取 | `L205` / `L241` / `L294` |
| `resolveAgentImages(value, maximum)` | Agent 取图；单张失败只记入 `missing`，不影响其余图片 | `L221` |
| `resolveSurfaceProfile(surface, presetId)` / `toolsForPolicy` | 按「请求快照 > `agent-settings.json` 保存值 > Registry 默认」解析 preset；回滚模式下直接返回 legacy profile，不解析 presetId；把 `toolPolicy` 映射为服务端工具白名单 | `L341` / `L372` |
| `agentSystemPrompt(profile, options)` | 拼装第 1–3 层；legacy profile 不传 `presetPrompt`，第 2 层退回代码内固定 persona | `L366` |<!-- anchor:agent-system-prompt-def -->
| `agentDefaults` / `agentRegistryHealth` / `agentPresetsView` / `agentSettingsView` / `agentSelectionPatch` | 回滚与降级路径的对外视图：`/api/health` 摘要、`/api/ai/presets`、`/api/settings` 片段，以及设置写入守卫 | `L94` / `L99` / `L106` / `L122` / `L111` |<!-- anchor:agent-defaults-def agent-registry-health-def agent-presets-view-def agent-settings-view-def agent-selection-patch-def -->
| `callAi` / `callFreeAgent` / `callNameGenerator` / `callMacroProposal` | 四个 AI 入口，均先做 preset 解析或规则降级 | `L381` / `L426` / `L604` / `L616` |
| `serveStatic` | 服务 `dist/`；文件不存在时回退 `index.html` | `L636` |

## 路由表

API 行全部用 `req.url` 整串相等比较（含 query），带 `?x=1` 的 API 请求不会命中，会落入静态分支。🔒 表示要求自定义请求标记头，缺失返回 `403`。源码中没有 `/worldforge` 之类的前缀剥离，`pathname` 直接与字面量比较。

| 方法 | 路径 | 位置 | 作用 | 关键错误码/状态 |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | `L652` | 内容库、模拟、宏观模拟 health + Agent Registry 摘要；回滚/降级时附带 `promptSource` / `degraded` | 200 |
| GET | `/api/macro` | `L653` | 宏观模拟视图 | 200 |
| POST | `/api/macro/step` 🔒`x-worldforge-simulation` | `L654` | 宏观推进一步 | 403 |
| POST | `/api/macro/run` 🔒 | `L658` | 宏观连续推进 | 403 |
| POST | `/api/macro/reset` 🔒 | `L662` | 宏观重置 | 403 |
| POST | `/api/macro/local-proposal` 🔒 | `L666` | LLM 逐区提案，任何失败降级为 `rule_fallback` | 403 |
| GET | `/api/simulation` | `L670` | 仪表盘视图 | 200 |
| POST | `/api/simulation/advance` 🔒 | `L671` | 推进 | 403 |
| POST | `/api/simulation/run` 🔒 | `L675` | 批量运行 | 403 |
| POST | `/api/simulation/reset` 🔒 | `L679` | 重置 | 403 |
| GET | `/api/content` | `L683` | 读取整库快照 | 200 |
| PUT | `/api/content` 🔒`x-worldforge-content` | `L684` | 全量替换，支持 `expectedRevision` 乐观锁 | 403 / 409 |
| GET | `/api/art-assets` | `L688` | 美术资产列表 | 200 |
| POST | `/api/reference-assets` 🔒`x-worldforge-image` | `L689` | 上传参考图（body 上限 12 MB） | 201 / 403 |
| GET | `/api/art-assets/:id/file` | `L694` | 读资产文件；`?download=1` 加 `Content-Disposition` | 404 / 403 |
| POST | `/api/art-assets/:id/unbind` 🔒`x-worldforge-image` | `L698` | 解除资产绑定 | 200 / 404 / 403 |
| GET | `/api/seedream/status` | `L702` | Seedream 配置状态 | 200 |
| GET | `/api/images/status` | `L703` | Seedream + ComfyUI 状态（是否已配置 workflow） | 200 |
| POST | `/api/images/generate` 🔒`x-worldforge-image` | `L704` | 生图并落盘，`clientRequestId` 幂等 | 403 / `error.status` 或 500 |
| POST | `/api/images/compose-prompt` 🔒 | `L717` | 按卡片/设定上下文合成提示词 | 403 |
| POST | `/api/images/optimize-prompt` 🔒 | `L721` | 用 LLM 改写提示词 | 403 / 500 |
| GET | `/api/ai/status` | `L725` | LLM 配置状态（不含 key） | 200 |
| GET | `/api/ai/presets` | `L727` | `agentPresetsView`：默认走 `publicRegistryView` 脱敏视图；回滚时保持结构并带 `fallback: 'legacy-fixed-prompts'` | 200 |
| GET | `/api/settings` | `L728` | 设置 + 提示词默认值 + workflow 文本 + `agentPresets` / `agentPresetDefaults` / `agentSettingsSource`（回滚时另有 `agentPromptSource`） | 200 |
| POST | `/api/settings` 🔒`x-worldforge-settings` | `L729` | 写 `.env.local`、workflow、提示词设置；`agentPresets` 部分更新 `agent-settings.json`，回滚模式携带该字段直接 400 | 400 / 403 |
| POST | `/api/ai/card` | `L749` | 卡牌文字 Agent：只返回字段补丁（评审由作者完成），不保存、不生成图片、不改 canon | 400 / 500 |
| POST | `/api/ai/free` | `L747` | 自由创作 Agent（可选工具循环） | 200 |
| POST | `/api/ai/tools/names` | `L750` | 名称生成 | 200 |
| POST | `/api/ai` | `L751` | 结构化设定补全 | 200 |
| 非 GET/HEAD | 未匹配任何分支 | `L752` | 405「不支持的请求方法」 | 405 | <!-- anchor:bad-method-fallback -->
| GET/HEAD | 未匹配任何分支 | `L753` | `serveStatic`，文件缺失回退 `index.html` | 200（无 404 兜底） | <!-- anchor:static-fallback -->

## 重点逻辑

### 启动序列（`L45`–`L77`） <!-- anchor:boot-start boot-end -->
- 顶层 `await loadLocalEnv()` 先于所有 `WORLDFORGE_*` 路径解析，因此 `.env.local` 可覆盖 DB／资产／模拟库路径；`.env.local`、ComfyUI workflow、提示词设置三个文件默认同目录（`dirname(envPath)`）。
- `createContentStore`（`L48`）打开 SQLite 并跑迁移；随后创建两个模拟服务（`L50`–`L51`）并 `mkdir(assetsPath)`（`L52`）。 <!-- anchor:content-store sim-dashboard sim-macro assets-mkdir -->
- `loadAgentProfiles()` 在这之后执行（`L65`）；失败时打印 `code: message` 与逐条 details，再 `process.exit(1)`（`L77`）——注释说明仅 `throw` 会让已打开的事件循环与 SQLite 锁继续存活。 <!-- anchor:profiles-load boot-end -->
- 唯一例外是显式回滚开关：`legacyPrompts` 为真时才跳过上面的退出（`L73`），改为记录 `agentRegistryFailure` 并降级启动；默认路径的 fail-fast 与错误码输出不变。 <!-- anchor:legacy-degrade -->
- 随后加载 `agent-settings.json`（`L85`，路径由 `WORLDFORGE_AGENT_SETTINGS_PATH` 或配置同目录决定）；`reason` 为 `missing`/`corrupt` 时回落默认值并 `console.warn`，不阻止启动；回滚模式下默认值改用 `legacyDefaults()`。 <!-- anchor:settings-load -->

### 回滚基线：`WORLDFORGE_AGENT_LEGACY_PROMPTS=1`（`L56`） <!-- anchor:legacy-flag -->
- 只替换 persona 来源：`resolveSurfaceProfile` 在开关打开时直接返回 `legacyProfile(surface)`（`L344`），因此 `agentSystemPrompt` 不传 `presetPrompt`，第 2 层退回 `ai-harness.mjs` 的代码内固定 persona（`L366`）。 <!-- anchor:legacy-resolve agent-system-prompt-def -->
- 不放松任何能力边界：第 1 层产品安全边界与第 3 层入口契约逐字保留，Schema、`FREE_AGENT_TOOLS` 白名单、轮次/调用上限与 canon 纪律都不随开关变化（`L387`–`L568`）。 <!-- anchor:agent-system-lore agent-system-card -->
- 变量入口同样只换 persona：`systemFor` 只调整工具指南与可用范围，第 1–3 层仍由 `agentSystemPrompt` 拼装（`L462`）。 <!-- anchor:agent-system-free -->
- 回显的 `agent` 快照来自 legacy profile：`presetId = legacy-fixed-prompt`、`presetVersion = 0.0.0-legacy`、`presetHash = ''`，`mode` 仍取兼容矩阵；客户端伪造的哈希与版本不被采信。 <!-- anchor:agent-snapshot-call -->
- 对外视图统一经 `agentRegistryHealth` / `agentPresetsView` / `agentSettingsView`（`L99` / `L106` / `L122`）：`/api/health` 保持 200，降级时带 `degraded: true` 与 `diagnostics`，回滚时带 `promptSource`；`/api/ai/presets` 保持既有结构并带 `fallback: 'legacy-fixed-prompts'`，前端据此显示「固定提示（回滚模式）」而不是误报配置丢失。 <!-- anchor:agent-registry-health-def agent-presets-view-def agent-settings-view-def -->
- 写盘守卫：回滚模式下 `POST /api/settings` 一旦携带 `agentPresets` 就 `400`（`AGENT_SETTINGS_INVALID`），避免把「已保存但不生效」的选择写进 `agent-settings.json`（`L111`）。 <!-- anchor:agent-selection-patch-def -->

### `callAi(payload)`（`L381`）与 `callFreeAgent(payload)`（`L426`）：preset 解析与提示词分层 <!-- anchor:callAi-def callFreeAgent-def -->
- preset 在模型调用之前解析（`L385`/`L429`）；`resolveSurfaceProfile` 把 `AgentProfileError` 统一改写为 `status = 400`（`L341`），因此未知或不兼容 preset 不产生外部调用。请求未带 `presetId` 时取 `agentSettings.selections[surface]`，再回落 `agentProfiles.defaults`。 <!-- anchor:preset-resolve-lore preset-resolve-free resolveSurfaceProfile-def -->
- 回显的 `agent` 快照只含 `presetId / presetVersion / presetHash / mode`（`L386`）。 <!-- anchor:agent-snapshot-call -->
- `promptPayload` 一次性注入第 4 层（分类提示与个性化提示，`L392`），初次请求用 `buildPrompt(promptPayload)`（`L393`）；补生成用 `{ ...promptPayload, variantCount: missingCount }` 同时驱动 prompt、Schema 与 `expectedCount`（`L410`–`L420`），因此第 4 层与初次逐字一致、数量口径自洽。 <!-- anchor:prompt-payload initial-build-prompt supplement-start supplement-fallback -->
- 结构化输出失败（HTTP 400/404/422）时降级为非结构化重试；三条降级分支（`L402`–`L420`）都用 `requireJson: true` 让 JSON 要求进入第 5 层，不再拼接 `${prompt}\n…`，因此降级请求仍是 4→5→6。 <!-- anchor:init-structured supplement-fallback -->
- 第 1–3 层只由 `composeAgentSystemPrompt` 拼装；作者笔记、资料库正文只用 `attachUntrustedContext` 附到用户侧消息（`L467`/`L500`）。 <!-- anchor:attach-main attach-fallback -->
- 工具策略：`free_lore_readonly` → `FREE_AGENT_TOOLS`，`none` → `[]`，其它值抛 `AGENT_PROFILE_INCOMPATIBLE`（`status 400`，`L372`）；工具仅在「有资料或资产」且策略非空时启用（`L451`）。 <!-- anchor:toolsForPolicy-def tool-gate -->

### 生图与资产落盘（`createArtAsset` `L241`、`serveArtAsset` `L294`） <!-- anchor:createArtAsset-def serveArtAsset-def -->
- `clientRequestId` 先按 `^[A-Za-z0-9-]{8,80}$` 校验，再用 `listArtAssets()` 全表扫描找同 ID 资产，命中直接返回旧资产（`L242`–`L245`）。 <!-- anchor:client-request-id client-request-id-reuse -->
- 参考图经 `resolveReferenceImages` 校验 ID、确认资产存在、按 `assetsPath` 前缀校验并读盘；ComfyUI 通道在不支持参考图时直接抛错（`L249`）。 <!-- anchor:resolve-reference-images -->
- 文件先写 `*.tmp`（`mode 0600`）再 `rename`（`L267`–`L268`）；DB 插入失败会 `unlink` 已写文件（`L291`）。 <!-- anchor:asset-tmp-write asset-rename asset-unlink -->
- `serveArtAsset` 以 `file.startsWith(assetsPath)` 做前缀校验（失败 403），`ENOENT` 返回 404，成功响应带 `immutable` 一年缓存与安全响应头。

### 设置读写与安全边界（`validateSettings` `L165`、`saveLocalEnv` `L131`） <!-- anchor:validateSettings-def saveLocalEnv-def -->
- API Key 三态：`clearApiKey` → 写空串；字段缺失（`undefined`）→ 不写入，已存密钥保留；否则按字符串校验（≤500 字符、禁 CRLF）。
- baseUrl 必须匹配 `^https?://\S+$` 且 ≤500 字符；model ≤120 字符且不含 CRLF；写入前统一去掉尾部 `/`。
- workflow 为 `null` 时 `unlink` 并吞掉 `ENOENT`；提示词设置为 `undefined` 时不做任何写入。
- 响应只含 `configured`、model、baseUrl 等元数据；preset 走 `publicRegistryView`，不含 prompt 正文与文件路径。

## 重要约束
- 写操作只用自定义请求标记头区分来源（`x-worldforge-simulation` / `-content` / `-image` / `-settings`）；本文件中没有其他鉴权、会话或 `Origin` 校验。
- 顶层 catch 统一 `error.status || 500`：无 `status` 的错误（`JSON.parse` 失败、`readBody` 超限、普通 `Error`）在 API 上表现为 500。
- `serveStatic` 会先 `decodeURIComponent` 再 `normalize` 并剥离前导 `../`，再用 `dist` 前缀校验；而 API 分发使用的 `pathname` 未解码。
- 数据库与模拟服务在启动阶段即打开；registry 加载失败默认必须 `process.exit(1)`，否则进程会带着已打开的 SQLite 存活。唯一例外是显式回滚开关：只有 `WORLDFORGE_AGENT_LEGACY_PROMPTS` 精确等于 `1` 才降级启动，`true`／`yes`／空值等都不算。
