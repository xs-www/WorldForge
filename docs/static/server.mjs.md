# `server.mjs`

> 作用：WorldForge 的单进程 HTTP 入口。启动时读取 `.env.local`、打开内容库与模拟库 SQLite、冻结 Agent Profile Registry、打开账号库，然后在一个 `createServer` 回调内先做会话门禁（401/403），再按「方法 + 精确路径 + 自定义请求标记头」分发 API，未命中则回落到 `dist/` 静态文件（未登录的页面导航返回 `login.html`）。

> 篇幅说明：路由表需按源码逐分支覆盖，故略超常规长度预算。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `loadLocalEnv()` / `saveLocalEnv(values)` | 读/写 `.env.local`；写盘用临时文件 + `rename`、`mode 0600`，只重写托管键并保留其余行 | `L40` / `L220` |
| `readProductVersion()` | 启动时读 `package.json` 的 `version` 作为 `PRODUCT_VERSION`；读不到回落 `0.0.0`，不阻止启动（版本只用于显示与 stale 诊断） | `L241` |
| `readBody(req, maxLength = 2000000)` | 累积请求体并 `JSON.parse`；超限抛「请求内容过长」，空体解析为 `{}` | `L252` |
| `buildCardContext(payload)` | 卡牌受限上下文：草案、引用 lore 内容（与 `draft.loreRefs` 交集）、关键词定义（按 `draft.keywordIds` ∪ `allowedKeywordIds` 过滤）、W97 `experimental` 规则摘要 | `L742` |
| `callCardAgent(payload)` | 卡牌入口：`structured_card` + `toolPolicy=none`，返回补丁（评审由作者完成）、`agent` 快照与 `diagnostics`；补生成沿用同一 system；结构化请求被 400/404/422 拒绝时降级并以 `fallbackReason`（+ `structured:false`）如实告知 | `L791` |
| `validateSettings(payload)` | 校验 baseUrl/model/apiKey，并合并 Seedream、ComfyUI、提示词设置 | `L262` |
| `createReferenceAsset` / `createArtAsset` / `serveArtAsset` | 参考图上传、生图落盘、资产文件读取 | `L302` / `L338` / `L391` |
| `resolveAgentImages(value, maximum)` | Agent 取图；单张失败只记入 `missing`，不影响其余图片 | `L318` |
| `resolveSurfaceProfile(surface, presetId)` / `toolsForPolicy` | 按「请求快照 > `agent-settings.json` 保存值 > Registry 默认」解析 preset；回滚模式下直接返回 legacy profile，不解析 presetId；把 `toolPolicy` 映射为服务端工具白名单 | `L568` / `L599` |
| `agentSystemPrompt(profile, options)` | 拼装第 1–3 层；legacy profile 不传 `presetPrompt`，第 2 层退回代码内固定 persona | `L593` |<!-- anchor:agent-system-prompt-def -->
| `agentDefaults` / `agentRegistryHealth` / `agentPresetsView` / `agentSettingsView` / `agentSelectionPatch` | 回滚与降级路径的对外视图：`/api/health` 摘要、`/api/ai/presets`、`/api/settings` 片段，以及设置写入守卫 | `L183` / `L188` / `L195` / `L211` / `L200` |<!-- anchor:agent-defaults-def agent-registry-health-def agent-presets-view-def agent-settings-view-def agent-selection-patch-def -->
| `callAi` / `callFreeAgent` / `callNameGenerator` / `callMacroProposal` | 四个 AI 入口，均先做 preset 解析或规则降级 | `L608` / `L657` / `L840` / `L852` |
| `requestModelText(config, prompt, options)` / `requestModel` | 统一模型调用层：跨响应形状取正文（chat `choices` / responses `output` / 网关 `data` 包装）、空响应诊断（`style/finish/返回字段/reasoning_content`）、默认 `thinking:{type:'disabled'}` 且供应商 400/422 拒绝时去掉重试并记住；`requestModel` 空内容直接抛带诊断的错误 | `L494` / `L543` |<!-- anchor:request-model-text request-model -->
| `extractModelText(data)` / `describeModelBody(data)` / `emptyModelError(meta)` | 响应正文压平（跳过 `type:"reasoning"` 等思考项，只读 message 文本）、空响应诊断对象与可读错误文案；模块级 `modelThinkingSupport` 缓存供应商是否接受 `thinking` | `L437` / `L459` / `L524` |<!-- anchor:extract-model-text describe-model-body empty-model-error -->
| `mapLimited(items, limit, mapper)` | 有界并发映射；设定导入用它把分段请求限制在 3 路 | `L878` |<!-- anchor:map-limited -->
| `callLoreImport(payload, session)` | 设定导入解析：分段调用设定入口 preset、逐段计费、确定性合并，返回预览计划（**不写库**） | `L901` |<!-- anchor:call-lore-import -->
| `commitLoreImport(body, { actor })` | 确认导入：复核客户端回传的计划 → 追加世界与资料 → 同一个 `contentStore.replace` 乐观锁；编号冲突 409 | `L1022` |<!-- anchor:commit-lore-import -->
| `fileExists(path)` / `collectExportImages(artAssets)` | 导入用的一次性存在性判断；导出时把美术资产读成 base64，缺文件只丢图片、不阻止导出 | `L1061` / `L1066` |<!-- anchor:file-exists export-images -->
| `runImport(body, {actor})` | 导入主流程：解析包 → 与 `validateContentSnapshot` 同源校验 → `planImport` / `planArtAssetImport` → `dryRun` 只返回统计 → 写内容 → 落图片 → 注册美术元数据 | `L1079` |<!-- anchor:run-import -->
| `serveStatic` | 服务 `dist/`；文件不存在时回退 `index.html` | `L1115` |

## 路由表

API 行全部用 `req.url` 整串相等比较（含 query），带 `?x=1` 的 API 请求不会命中，会落入静态分支。🔒 表示要求自定义请求标记头，缺失返回 `403`。源码中没有 `/worldforge` 之类的前缀剥离，`pathname` 直接与字面量比较。

| 方法 | 路径 | 位置 | 作用 | 关键错误码/状态 |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | `L1142` | `version`（启动时读 `package.json`，前端据此判断页面是否过期）、`harnessVersion`、`auth` 摘要（`mode/users/requireAuth`）、内容库、模拟、宏观模拟 health（**去掉 `databasePath`**：公开端点不泄露绝对路径）+ Agent Registry 摘要；回滚/降级时附带 `promptSource` / `degraded` | 200 |
| GET | `/api/auth/session` | `L1143` | 当前会话：`mode`（`accounts`/`anonymous`）、`required`、`user`（含 `role` 与当日 `usage`）或 `null`；公开端点 | 200 |
| POST | `/api/auth/login` 🔒`x-worldforge-auth` | `L1144` | 登录；成功 `Set-Cookie: wf_session`，未知账号与错误口令同码 | 400 / 401 / 403 / 429 |
| POST | `/api/auth/logout` | `L1152` | 清 Cookie 并写审计；公开端点 | 200 |
| POST | `/api/auth/password` 🔒`x-worldforge-auth` | `L1158` | 自助改口令：需要旧口令，成功后换发 Cookie | 400 / 401 / 403 |
| GET | `/api/users` | `L1293` | 账号列表 + `quotaDefaults`（仅 admin） | 200 / 403 |
| POST | `/api/users` 🔒`x-worldforge-auth` | `L1297` | 创建账号，返回一次性口令（仅 admin） | 201 / 400 / 409 / 403 |
| GET | `/api/macro` | `L1167` | 宏观模拟视图 | 200 |
| POST | `/api/macro/step` 🔒`x-worldforge-simulation` | `L1168` | 宏观推进一步 | 403 |
| POST | `/api/macro/run` 🔒 | `L1172` | 宏观连续推进 | 403 |
| POST | `/api/macro/reset` 🔒 | `L1176` | 宏观重置 | 403 |
| POST | `/api/macro/local-proposal` 🔒 | `L1180` | LLM 逐区提案，任何失败降级为 `rule_fallback` | 403 |
| GET | `/api/simulation` | `L1185` | 仪表盘视图 | 200 |
| POST | `/api/simulation/advance` 🔒 | `L1186` | 推进 | 403 |
| POST | `/api/simulation/run` 🔒 | `L1190` | 批量运行 | 403 |
| POST | `/api/simulation/reset` 🔒 | `L1194` | 重置 | 403 |
| GET | `/api/content` | `L1198` | 读取整库快照 | 200 |
| PUT | `/api/content` 🔒`x-worldforge-content` | `L1199` | 全量替换，支持 `expectedRevision` 乐观锁 | 403 / 409 |
| GET | `/api/export` | `L1206` | 整库导出（`?images=1` 内嵌 base64 图片），带 `Content-Disposition` 下载头；普通成员可用 | 200 |
| POST | `/api/import` 🔒`x-worldforge-import` | `L1214` | 整库导入；`dryRun` 只给统计，`mode=merge\|replace`；仅管理员，导入文件不合格返回 400 | 400 / 403 / 409 |
| GET | `/api/art-assets` | `L1229` | 美术资产列表 | 200 |
| POST | `/api/reference-assets` 🔒`x-worldforge-image` | `L1230` | 上传参考图（body 上限 12 MB） | 201 / 403 |
| GET | `/api/art-assets/:id/file` | `L1235` | 读资产文件；`?download=1` 加 `Content-Disposition` | 404 / 403 |
| POST | `/api/art-assets/:id/unbind` 🔒`x-worldforge-image` | `L1239` | 解除资产绑定 | 200 / 404 / 403 |
| GET | `/api/seedream/status` | `L1243` | Seedream 配置状态 | 200 |
| GET | `/api/images/status` | `L1244` | Seedream + ComfyUI 状态（是否已配置 workflow） | 200 |
| POST | `/api/images/generate` 🔒`x-worldforge-image` | `L1245` | 生图并落盘，`clientRequestId` 幂等 | 403 / `error.status` 或 500 |
| POST | `/api/images/compose-prompt` 🔒 | `L1259` | 按卡片/设定上下文合成提示词 | 403 |
| POST | `/api/images/optimize-prompt` 🔒 | `L1263` | 用 LLM 改写提示词 | 403 / 500 |
| GET | `/api/ai/status` | `L1268` | LLM 配置状态（不含 key） | 200 |
| GET | `/api/ai/presets` | `L1270` | `agentPresetsView`：默认走 `publicRegistryView` 脱敏视图；回滚时保持结构并带 `fallback: 'legacy-fixed-prompts'` | 200 |
| GET | `/api/settings` | `L1271` | 设置 + 提示词默认值 + workflow 文本 + `agentPresets` / `agentPresetDefaults` / `agentSettingsSource`（回滚时另有 `agentPromptSource`） | 200 |
| POST | `/api/settings` 🔒`x-worldforge-settings` | `L1272` | 写 `.env.local`、workflow、提示词设置；`agentPresets` 部分更新 `agent-settings.json`，回滚模式携带该字段直接 400 | 400 / 403 |
| POST | `/api/ai/card` | `L1344` | 卡牌文字 Agent：只返回字段补丁（评审由作者完成），不保存、不生成图片、不改 canon | 400 / 500 |
| POST | `/api/ai/free` | `L1324` | 自由创作 Agent（可选工具循环） | 200 |
| POST | `/api/lore-import/parse` | `L1336` | 设定导入解析：分段调用设定入口 preset，只返回预览计划（不写库）；带 `intoWorld` 时计划并入该世界；每段一次 AI 配额 | 400 / 429 / 500 |
| POST | `/api/lore-import/extract` 🔒`x-worldforge-lore-import` | `L1327` | 把上传文档读成文本（docx/xlsx/md/txt/zip；doc 尽力抽取；rar/pdf 拒绝）；不写库、不计配额 | 400 / 403 |
| POST | `/api/lore-import/commit` 🔒`x-worldforge-lore-import` | `L1337` | 确认导入：追加一个新世界（默认）或并入已有世界（`mode:"existing"`）；只追加、不覆盖既有条目 | 400 / 403 / 409 |
| POST | `/api/ai/tools/names` | `L1345` | 名称生成 | 200 |
| POST | `/api/ai` | `L1346` | 结构化设定补全 | 200 |
| 非 GET/HEAD | 未匹配任何分支 | `L1347` | 405「不支持的请求方法」 | 405 | <!-- anchor:bad-method-fallback -->
| GET/HEAD | 未匹配任何分支 | `L1349` | `serveStatic`，文件缺失回退 `index.html` | 200（无 404 兜底） | <!-- anchor:static-fallback -->

参数化账号路由（不进入上表，避免与「整串精确匹配」的约定混淆）：账号角色/停用/配额的更新、账号删除，以及管理员重置口令，分别由 `PATCH` / `DELETE` 与 `POST .../password` 处理；三者都要求 admin 会话与 `x-worldforge-auth` 标记头，用户名先按 `^[a-z0-9._-]{1,32}$` 校验再交给账号层。

## 重点逻辑

### 账号门禁与会话（ADR-0030）
- 启动阶段打开 `users.json`；`WORLDFORGE_REQUIRE_AUTH=1` 时缺失或损坏直接退出（稳定错误码 `AUTH_USERS_MISSING` / `AUTH_USERS_INVALID`），否则警告后保持匿名本机模式。公开端点写死在 `AUTH_PUBLIC_API`：health、session、login、logout。
- 每个请求先 `sessionOf` 取会话，再由 `apiNeedsSession` 判 401、`apiNeedsAdmin` 判 403；门禁在路由分发之前，任何 API 分支都拿不到未授权请求。相关的 `L151` / `L141` / `L144`。
- `sessionView` 只回 `{mode, required, user:{username, role, usage}}`；`login` 的 Cookie 是否带 `Secure` 由 `cookieSecure` 决定（`WORLDFORGE_COOKIE_SECURE` 优先，否则看 `x-forwarded-proto` 与 TLS）。相关的 `L152` / `L162`。
- 会触发模型费用的入口（`/api/ai*`、`/api/images/generate`、`/api/images/optimize-prompt`、`/api/macro/local-proposal`）在调用前 `chargeQuota`；超限返回 429 与 `kind/limit/used/resetAt`，管理员（`quota: null`）不限。相关的 `L166`。
- `PUT /api/content` 把会话用户名传给内容库，返回的 `lastSavedBy` 供界面显示；内容与 `POST /api/settings` 的保存都会写审计（不记录口令、令牌或 API Key 值）。
- `apiNeedsAdmin` 除 `/api/settings`（含 GET）与 `/api/users*` 外，还覆盖 `POST /api/import`：导入会整库覆盖作者资料，属于管理员操作；导出只是读取，普通成员即可用。
- `serveStatic` 在账号模式下对「未登录且无扩展名」的导航返回 `login.html`（`no-cache`），带扩展名的静态资源仍可匿名取用。相关的 `L1115`。
- 顶层 catch 统一输出 `{error, code?, ...details}`；`AuthError` 的 message 保留 `CODE: ` 前缀（既有 Agent 错误契约依赖它），登录页自行裁掉前缀展示。

### 启动序列（`L54`–`L140`） <!-- anchor:boot-start boot-end -->
- 顶层 `await loadLocalEnv()` 先于所有 `WORLDFORGE_*` 路径解析，因此 `.env.local` 可覆盖 DB／资产／模拟库路径；`.env.local`、ComfyUI workflow、提示词设置三个文件默认同目录（`dirname(envPath)`）。
- 作者资料库按 `WORLDFORGE_DB_DRIVER`（或存在 `WORLDFORGE_DATABASE_URL` 时自动 `postgres`）选择驱动：`sqlite` 直接 `createContentStore`（`L72`），`postgres` 才动态 `import('./storage-postgres.mjs')`，因此纯 SQLite 部署不需要任何第三方包；驱动态非法或选 pg 却没连接串时打印稳定原因并 `process.exit(1)`。随后创建两个模拟服务（`L77`–`L78`）并 `mkdir(assetsPath)`（`L79`）。 <!-- anchor:content-store sim-dashboard sim-macro assets-mkdir -->
- `loadAgentProfiles()` 在这之后执行（`L96`）；失败时打印 `code: message` 与逐条 details，再 `process.exit(1)`（`L140`）——注释说明仅 `throw` 会让已打开的事件循环与 SQLite 锁继续存活。 <!-- anchor:profiles-load boot-end -->
- 唯一例外是显式回滚开关：`legacyPrompts` 为真时才跳过上面的退出（`L104`），改为记录 `agentRegistryFailure` 并降级启动；默认路径的 fail-fast 与错误码输出不变。 <!-- anchor:legacy-degrade -->
- 随后加载 `agent-settings.json`（`L116`，路径由 `WORLDFORGE_AGENT_SETTINGS_PATH` 或配置同目录决定）；`reason` 为 `missing`/`corrupt` 时回落默认值并 `console.warn`，不阻止启动；回滚模式下默认值改用 `legacyDefaults()`。 <!-- anchor:settings-load -->

### 回滚基线：`WORLDFORGE_AGENT_LEGACY_PROMPTS=1`（`L87`） <!-- anchor:legacy-flag -->
- 只替换 persona 来源：`resolveSurfaceProfile` 在开关打开时直接返回 `legacyProfile(surface)`（`L571`），因此 `agentSystemPrompt` 不传 `presetPrompt`，第 2 层退回 `ai-harness.mjs` 的代码内固定 persona（`L593`）。 <!-- anchor:legacy-resolve agent-system-prompt-def -->
- 不放松任何能力边界：第 1 层产品安全边界与第 3 层入口契约逐字保留，Schema、`FREE_AGENT_TOOLS` 白名单、轮次/调用上限与 canon 纪律都不随开关变化（`L614`–`L804`）。 <!-- anchor:agent-system-lore agent-system-card -->
- 变量入口同样只换 persona：`systemFor` 只调整工具指南与可用范围，第 1–3 层仍由 `agentSystemPrompt` 拼装（`L693`）。 <!-- anchor:agent-system-free -->
- 回显的 `agent` 快照来自 legacy profile：`presetId = legacy-fixed-prompt`、`presetVersion = 0.0.0-legacy`、`presetHash = ''`，`mode` 仍取兼容矩阵；客户端伪造的哈希与版本不被采信。 <!-- anchor:agent-snapshot-call -->
- 对外视图统一经 `agentRegistryHealth` / `agentPresetsView` / `agentSettingsView`（`L188` / `L195` / `L211`）：`/api/health` 保持 200，降级时带 `degraded: true` 与 `diagnostics`，回滚时带 `promptSource`；`/api/ai/presets` 保持既有结构并带 `fallback: 'legacy-fixed-prompts'`，前端据此显示「固定提示（回滚模式）」而不是误报配置丢失。 <!-- anchor:agent-registry-health-def agent-presets-view-def agent-settings-view-def -->
- 写盘守卫：回滚模式下 `POST /api/settings` 一旦携带 `agentPresets` 就 `400`（`AGENT_SETTINGS_INVALID`），避免把「已保存但不生效」的选择写进 `agent-settings.json`（`L200`）。 <!-- anchor:agent-selection-patch-def -->

### `callAi(payload)`（`L608`）与 `callFreeAgent(payload)`（`L657`）：preset 解析与提示词分层 <!-- anchor:callAi-def callFreeAgent-def -->
- preset 在模型调用之前解析（`L612`/`L660`）；`resolveSurfaceProfile` 把 `AgentProfileError` 统一改写为 `status = 400`（`L568`），因此未知或不兼容 preset 不产生外部调用。请求未带 `presetId` 时取 `agentSettings.selections[surface]`，再回落 `agentProfiles.defaults`。 <!-- anchor:preset-resolve-lore preset-resolve-free resolveSurfaceProfile-def -->
- 回显的 `agent` 快照只含 `presetId / presetVersion / presetHash / mode`（`L613`）。 <!-- anchor:agent-snapshot-call -->
- `promptPayload` 一次性注入第 4 层（分类提示与个性化提示，`L623`），初次请求用 `buildPrompt(promptPayload)`（`L624`）；补生成用 `{ ...promptPayload, variantCount: missingCount }` 同时驱动 prompt、Schema 与 `expectedCount`（`L641`–`L651`），因此第 4 层与初次逐字一致、数量口径自洽。 <!-- anchor:prompt-payload initial-build-prompt supplement-start supplement-fallback -->
- 分类提示按「精确 type 优先、否则收敛到固定档」取：作者以前按旧类型（如 `magic`）保存过的提示词仍会命中，自定义资料组则落到 `info` 档（`L622`）。否则升级分组方式会让已有分类提示词全部失效。 <!-- anchor:prompt-type-key -->
- 结构化输出失败（HTTP 400/404/422）时降级为非结构化重试；三条降级分支（`L633`–`L651`）都用 `requireJson: true` 让 JSON 要求进入第 5 层，不再拼接 `${prompt}\n…`，因此降级请求仍是 4→5→6。 <!-- anchor:init-structured supplement-fallback -->
- 第 1–3 层只由 `composeAgentSystemPrompt` 拼装；作者笔记、资料库正文只用 `attachUntrustedContext` 附到用户侧消息（`L698`/`L731`）。 <!-- anchor:attach-main attach-fallback -->
- 工具策略：`free_lore_readonly` → `FREE_AGENT_TOOLS`，`none` → `[]`，其它值抛 `AGENT_PROFILE_INCOMPATIBLE`（`status 400`，`L599`）；工具仅在「有资料或资产」且策略非空时启用（`L682`）。 <!-- anchor:toolsForPolicy-def tool-gate -->

### 设定导入（`callLoreImport` `L901`、`commitLoreImport` `L1022`）（ADR-0033） <!-- anchor:call-lore-import commit-lore-import -->
- 三个端点分工固定：`/api/lore-import/extract` 只把上传文档读成文本（`lore-import-files.mjs`，不写库、不计配额）；`/api/lore-import/parse` 只生成、可读内容库（只用来分配世界编号），**不写任何数据**；`/api/lore-import/commit` 才写，并要求 `x-worldforge-lore-import: 1`。后两者复用同一个标记头，commit 不属于管理员操作：它只追加新世界或并入已有世界，权限与 `PUT /api/content` 同级。
- 并入已有世界（`intoWorld` / `mode:"existing"`）：解析前先校验目标世界存在（否则 400 且不调用模型），用该编号作为计划世界编号并按该世界既有条目避让编号；commit 时跳过「世界编号空闲」检查、不创建也不修改世界条目，只追加勾选的条目。
- preset 走「设定助手」入口（`resolveSurfaceProfile('lore', payload.presetId)`），未知或不兼容的 preset 在调用模型前 400，不产生外部请求。提示词用同一个 `agentSystemPrompt` 拼第 1–3 层，第 3 层换成 `LORE_IMPORT_ENTRY_CONTRACT`。
- 计费按段：`mapLimited` 以 3 路并发跑分段请求，每段调用模型前 `chargeQuota('ai', session)`，所以 2 段文本消耗 2 次 AI 配额。配额错误（`AUTH_QUOTA_EXCEEDED` / 429）是整体失败，不会继续撞后面的段。
- 单段失败只记 `CHUNK_FAILED` 警告；只有**全部段落都失败**才抛错。解析入口**不发送** `json_schema`（ADR-0033 §10）：输出契约是记录格式，模型输出由 `model-json-normalizer.mjs` 规范化，因此没有「结构化被拒→降级重试」的第二笔调用。
- 段级告警带模型原文片段（`preview`），规范化层救回被截断输出时额外记 `OUTPUT_TRUNCATED`；响应里的 `normalization: {formats, repairedChunks, style}` 供前端显示「规范化 N 段」与最终使用的 API 形状。
- 首段单独跑、其余段再并发：第一段返回空内容时换另一种 API 形状（chat ↔ responses）重试一次，成功就沿用到余下各段并记 `STYLE_FALLBACK`（该段多计 1 次配额）。这条兜底与「供应商只回空内容」的实测形态直接相关。
- 模型调用统一走 `requestModelText`：默认 `thinking:{type:'disabled'}`（思考型模型会把输出预算耗在推理上，正文变空），供应商 400/422 拒绝该参数时自动去掉重试并记住；空内容抛错时带 `style/finish/返回字段/reasoning_content` 诊断。
- 解析侧不自己造格式：切分、字段清单、合并与改写都在 `lore-import.mjs`；`server.mjs` 只负责 preset、计费、调用模型、`nextWorldIdOf` 取编号与组装响应。
- commit 顺序是「先复核、再一次性写入」：`validateImportPlan` 拒绝结构问题（400）与编号冲突（409），随后 `contentStore.replace` 用 `expectedRevision` 做乐观锁。`info` 资料组只在确有 `info` 条目时落库，且受 40 组上限约束（超限只告警，读时由前端按资料派生）。
- 审计动作是 `content.import_lore`，只记世界编号、条目数与 revision；导入永远是 `proposed`，不会写 canon，也不会写回仓库。

### 数据导入 / 导出（`runImport` `L1079`、`collectExportImages` `L1066`） <!-- anchor:run-import export-images -->
- 导出的真值是**服务端内容库**（`contentStore.read()` + `listArtAssets()`），不是浏览器缓存；`?images=1` 时把每张资产读成 base64，读不到只跳过该图。响应带 `Content-Disposition: attachment`，文件名含导出日期。 <!-- anchor:export-route -->
- 导入在 `apiNeedsAdmin` 处就要求管理员（匿名本机模式无账号库，故不拦截），并要求 `x-worldforge-import: 1`；`dryRun` 与真实导入共用 `parseImportBundle` + `validateContentSnapshot`，预检结论因此可信。 <!-- anchor:import-route -->
- 顺序是「先内容、后图片、最后登记元数据」：内容事务失败时不会留下半套资产；图片写盘用 `${file}.import` 临时名再 `rename`，已存在的文件计入 `existing` 而不覆盖。 <!-- anchor:file-exists -->
- 任何解析/校验异常都被改写为 `status = 400`（可预期的用户输入问题），`ContentConflictError` 的 409 保持原样；成功导入写一条 `content.import` 审计。

### 生图与资产落盘（`createArtAsset` `L338`、`serveArtAsset` `L391`） <!-- anchor:createArtAsset-def serveArtAsset-def -->
- `clientRequestId` 先按 `^[A-Za-z0-9-]{8,80}$` 校验，再用 `listArtAssets()` 全表扫描找同 ID 资产，命中直接返回旧资产（`L339`–`L342`）。 <!-- anchor:client-request-id client-request-id-reuse -->
- 参考图经 `resolveReferenceImages` 校验 ID、确认资产存在、按 `assetsPath` 前缀校验并读盘；ComfyUI 通道在不支持参考图时直接抛错（`L346`）。 <!-- anchor:resolve-reference-images -->
- 文件先写 `*.tmp`（`mode 0600`）再 `rename`（`L364`–`L365`）；DB 插入失败会 `unlink` 已写文件（`L388`）。 <!-- anchor:asset-tmp-write asset-rename asset-unlink -->
- `serveArtAsset` 以 `file.startsWith(assetsPath)` 做前缀校验（失败 403），`ENOENT` 返回 404，成功响应带 `immutable` 一年缓存与安全响应头。

### 设置读写与安全边界（`validateSettings` `L262`、`saveLocalEnv` `L220`） <!-- anchor:validateSettings-def saveLocalEnv-def -->
- API Key 三态：`clearApiKey` → 写空串；字段缺失（`undefined`）→ 不写入，已存密钥保留；否则按字符串校验（≤500 字符、禁 CRLF）。
- baseUrl 必须匹配 `^https?://\S+$` 且 ≤500 字符；model ≤120 字符且不含 CRLF；写入前统一去掉尾部 `/`。
- workflow 为 `null` 时 `unlink` 并吞掉 `ENOENT`；提示词设置为 `undefined` 时不做任何写入。
- 响应只含 `configured`、model、baseUrl 等元数据；preset 走 `publicRegistryView`，不含 prompt 正文与文件路径。

## 重要约束
- 写操作除了自定义请求标记头（`x-worldforge-simulation` / `-content` / `-image` / `-settings` / `-auth`）之外还要求会话：存在 `users.json` 时所有 `/api/*` 都有鉴权，`/api/settings` 与 `/api/users*` 还要求 `admin`；只有匿名本机模式才回到「仅标记头」的旧行为。
- 顶层 catch 统一 `error.status || 500`：无 `status` 的错误（`JSON.parse` 失败、`readBody` 超限、普通 `Error`）在 API 上表现为 500。
- `serveStatic` 会先 `decodeURIComponent` 再 `normalize` 并剥离前导 `../`，再用 `dist` 前缀校验；而 API 分发使用的 `pathname` 未解码。
- 数据库与模拟服务在启动阶段即打开；registry 加载失败默认必须 `process.exit(1)`，否则进程会带着已打开的 SQLite 存活。唯一例外是显式回滚开关：只有 `WORLDFORGE_AGENT_LEGACY_PROMPTS` 精确等于 `1` 才降级启动，`true`／`yes`／空值等都不算。
