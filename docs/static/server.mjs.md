# `server.mjs`

> 作用：WorldForge 的单进程 HTTP 入口。启动时读取 `.env.local`、打开内容库与模拟库 SQLite、冻结 Agent Profile Registry，然后在一个 `createServer` 回调内按「方法 + 精确路径 + 自定义请求标记头」分发 API，未命中则回落到 `dist/` 静态文件。

> 篇幅说明：路由表需按源码逐分支覆盖，故略超常规长度预算。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `loadLocalEnv()` / `saveLocalEnv(values)` | 读/写 `.env.local`；写盘用临时文件 + `rename`、`mode 0600`，只重写托管键并保留其余行 | `L26` / `L67` |
| `readBody(req, maxLength = 2000000)` | 累积请求体并 `JSON.parse`；超限抛「请求内容过长」，空体解析为 `{}` | `L91` |
| `validateSettings(payload)` | 校验 baseUrl/model/apiKey，并合并 Seedream、ComfyUI、提示词设置 | `L101` |
| `createReferenceAsset` / `createArtAsset` / `serveArtAsset` | 参考图上传、生图落盘、资产文件读取 | `L141` / `L177` / `L230` |
| `resolveAgentImages(value, maximum)` | Agent 取图；单张失败只记入 `missing`，不影响其余图片 | `L157` |
| `resolveSurfaceProfile` / `toolsForPolicy` | 解析 preset；把 `toolPolicy` 映射为服务端工具白名单 | `L277` / `L293` |
| `callAi` / `callFreeAgent` / `callNameGenerator` / `callMacroProposal` | 四个 AI 入口，均先做 preset 解析或规则降级 | `L302` / `L340` / `L422` / `L434` |
| `serveStatic` | 服务 `dist/`；文件不存在时回退 `index.html` | `L454` |

## 路由表

API 行全部用 `req.url` 整串相等比较（含 query），带 `?x=1` 的 API 请求不会命中，会落入静态分支。🔒 表示要求自定义请求标记头，缺失返回 `403`。源码中没有 `/worldforge` 之类的前缀剥离，`pathname` 直接与字面量比较。

| 方法 | 路径 | 位置 | 作用 | 关键错误码/状态 |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | `L470` | 内容库、模拟、宏观模拟 health + registry 摘要 | 200 |
| GET | `/api/macro` | `L471` | 宏观模拟视图 | 200 |
| POST | `/api/macro/step` 🔒`x-worldforge-simulation` | `L472` | 宏观推进一步 | 403 |
| POST | `/api/macro/run` 🔒 | `L476` | 宏观连续推进 | 403 |
| POST | `/api/macro/reset` 🔒 | `L480` | 宏观重置 | 403 |
| POST | `/api/macro/local-proposal` 🔒 | `L484` | LLM 逐区提案，任何失败降级为 `rule_fallback` | 403 |
| GET | `/api/simulation` | `L488` | 仪表盘视图 | 200 |
| POST | `/api/simulation/advance` 🔒 | `L489` | 推进 | 403 |
| POST | `/api/simulation/run` 🔒 | `L493` | 批量运行 | 403 |
| POST | `/api/simulation/reset` 🔒 | `L497` | 重置 | 403 |
| GET | `/api/content` | `L501` | 读取整库快照 | 200 |
| PUT | `/api/content` 🔒`x-worldforge-content` | `L502` | 全量替换，支持 `expectedRevision` 乐观锁 | 403 / 409 |
| GET | `/api/art-assets` | `L506` | 美术资产列表 | 200 |
| POST | `/api/reference-assets` 🔒`x-worldforge-image` | `L507` | 上传参考图（body 上限 12 MB） | 201 / 403 |
| GET | `/api/art-assets/:id/file` | `L511` | 读资产文件；`?download=1` 加 `Content-Disposition` | 404 / 403 |
| POST | `/api/art-assets/:id/unbind` 🔒`x-worldforge-image` | `L513` | 解除资产绑定 | 200 / 404 / 403 |
| GET | `/api/seedream/status` | `L520` | Seedream 配置状态 | 200 |
| GET | `/api/images/status` | `L521` | Seedream + ComfyUI 状态（是否已配置 workflow） | 200 |
| POST | `/api/images/generate` 🔒`x-worldforge-image` | `L522` | 生图并落盘，`clientRequestId` 幂等 | 403 / `error.status` 或 500 |
| POST | `/api/images/compose-prompt` 🔒 | `L535` | 按卡片/设定上下文合成提示词 | 403 |
| POST | `/api/images/optimize-prompt` 🔒 | `L539` | 用 LLM 改写提示词 | 403 / 500 |
| GET | `/api/ai/status` | `L543` | LLM 配置状态（不含 key） | 200 |
| GET | `/api/ai/presets` | `L545` | `publicRegistryView` 脱敏预设视图 | 200 |
| GET | `/api/settings` | `L546` | 设置 + 提示词默认值 + workflow 文本 | 200 |
| POST | `/api/settings` 🔒`x-worldforge-settings` | `L547` | 写 `.env.local`、workflow、提示词设置 | 403 |
| POST | `/api/ai/free` | `L558` | 自由创作 Agent（可选工具循环） | 200 |
| POST | `/api/ai/tools/names` | `L559` | 名称生成 | 200 |
| POST | `/api/ai` | `L560` | 结构化设定补全 | 200 |
| 非 GET/HEAD | 未匹配任何分支 | `L561` | 405「不支持的请求方法」 | 405 |
| GET/HEAD | 未匹配任何分支 | `L562` | `serveStatic`，文件缺失回退 `index.html` | 200（无 404 兜底） |

## 重点逻辑

### 启动序列（`L40`–`L65`）
- 顶层 `await loadLocalEnv()` 先于所有 `WORLDFORGE_*` 路径解析，因此 `.env.local` 可覆盖 DB／资产／模拟库路径；`.env.local`、ComfyUI workflow、提示词设置三个文件默认同目录（`dirname(envPath)`）。
- `createContentStore`（`L43`）打开 SQLite 并跑迁移；随后创建两个模拟服务（`L45`–`L46`）并 `mkdir(assetsPath)`（`L47`）。
- `loadAgentProfiles()` 在这之后执行（`L54`）；失败时打印 `code: message` 与逐条 details，再 `process.exit(1)`（`L64`）——注释说明仅 `throw` 会让已打开的事件循环与 SQLite 锁继续存活。

### `callAi(payload)`（`L302`）与 `callFreeAgent(payload)`（`L340`）：preset 解析与提示词分层
- preset 在模型调用之前解析（`L306`/`L343`）；`resolveSurfaceProfile` 把 `AgentProfileError` 统一改写为 `status = 400`（`L283`），因此未知或不兼容 preset 不产生外部调用。
- 回显的 `agent` 快照只含 `presetId / presetVersion / presetHash / mode`（`L289`）；差额补生成沿用同一 `system` 与快照（`L316`–`L317`）。
- 结构化输出失败（HTTP 400/404/422）时降级为「严格只返回 JSON 对象」的非结构化重试（`L322`–`L325`）；`callFreeAgent` 另有工具不可用时的单轮降级，把前 120 条资料索引放进用户侧 `<library_context>`（`L412`–`L416`）。
- 第 1–3 层只由 `composeAgentSystemPrompt` 拼装；作者笔记、资料库正文只用 `attachUntrustedContext` 附到用户侧消息（`L382`/`L415`）。
- 工具策略：`free_lore_readonly` → `FREE_AGENT_TOOLS`，`none` → `[]`，其它值抛 `AGENT_PROFILE_INCOMPATIBLE`（`status 400`，`L296`–`L299`）；工具仅在「有资料或资产」且策略非空时启用（`L367`）。

### 生图与资产落盘（`createArtAsset` `L177`、`serveArtAsset` `L230`）
- `clientRequestId` 先按 `^[A-Za-z0-9-]{8,80}$` 校验，再用 `listArtAssets()` 全表扫描找同 ID 资产，命中直接返回旧资产（`L180`–`L183`）。
- 参考图经 `resolveReferenceImages` 校验 ID、确认资产存在、按 `assetsPath` 前缀校验并读盘；ComfyUI 通道在不支持参考图时直接抛错（`L190`）。
- 文件先写 `*.tmp`（`mode 0600`）再 `rename`（`L203`–`L204`）；DB 插入失败会 `unlink` 已写文件（`L226`–`L227`）。
- `serveArtAsset` 以 `file.startsWith(assetsPath)` 做前缀校验（失败 403），`ENOENT` 返回 404，成功响应带 `immutable` 一年缓存与安全响应头。

### 设置读写与安全边界（`validateSettings` `L101`、`saveLocalEnv` `L67`）
- API Key 三态：`clearApiKey` → 写空串；字段缺失（`undefined`）→ 不写入，已存密钥保留；否则按字符串校验（≤500 字符、禁 CRLF）。
- baseUrl 必须匹配 `^https?://\S+$` 且 ≤500 字符；model ≤120 字符且不含 CRLF；写入前统一去掉尾部 `/`。
- workflow 为 `null` 时 `unlink` 并吞掉 `ENOENT`；提示词设置为 `undefined` 时不做任何写入。
- 响应只含 `configured`、model、baseUrl 等元数据；preset 走 `publicRegistryView`，不含 prompt 正文与文件路径。

## 重要约束
- 写操作只用自定义请求标记头区分来源（`x-worldforge-simulation` / `-content` / `-image` / `-settings`）；本文件中没有其他鉴权、会话或 `Origin` 校验。
- 顶层 catch 统一 `error.status || 500`：无 `status` 的错误（`JSON.parse` 失败、`readBody` 超限、普通 `Error`）在 API 上表现为 500。
- `serveStatic` 会先 `decodeURIComponent` 再 `normalize` 并剥离前导 `../`，再用 `dist` 前缀校验；而 API 分发使用的 `pathname` 未解码。
- 数据库与模拟服务在启动阶段即打开；registry 加载失败必须 `process.exit(1)`，否则进程会带着已打开的 SQLite 存活。
