# `ai-tools.mjs`

> 作用：自由创作 Agent 的只读资料工具集——工具声明（JSON Schema）、快照清洗、执行分派与结果裁剪。工具只读取随请求传入的资料库/美术资产快照，不访问文件系统、数据库或密钥。由 `server.mjs` 消费。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `AGENT_LIMITS` | 所有工具与 Schema 共用的硬上限常量（见表后说明） | `L4` |
| `prepareLibrary(value)` | 快照清洗：最多 400 条，`id` 为空即丢弃，字段按上限截断 | `L29` |
| `FREE_AGENT_TOOLS` | 5 个工具的 name/description/parameters 声明 | `L46` |
| `FREE_AGENT_TOOL_NAMES` | 由 `FREE_AGENT_TOOLS` 派生的白名单 | `L119` |
| `prepareArtAssets(value)` | 美术资产元数据清洗：最多 200 条，`id` 必须匹配 `^ART-` | `L122` |
| `runToolCall(name, args, library, artAssets)` | 唯一执行入口；返回 `{ok, content, summary, imageIds?}`，未知工具/参数错误/执行异常都不抛出 | `L226` |

## 工具契约（名称 → 作用 → 只读边界 → 参数上限）
| 工具 | 作用 | 只读边界 | 参数上限 |
| --- | --- | --- | --- |
| `search_lore` | 在快照上按 `query`+筛选条件检索，返回编号/资料组/名称/状态/事实层次/摘要 | 不返回 `details` 正文 | `query` ≤200 字符，`limit` 默认 8、夹到 1–12；`total` 是**过滤后且被 `limit` 截断后**的条数 |
| `get_lore_entry` | 按稳定 ID 读完整条目（含 `details`/`constraints`/`openQuestions`/`relationIds`） | 返回 `includePrivateNotes: false` 固定；不存在的 ID 进 `missing` 而非报错 | `ids` 1–5 个，单个 ID ≤100 字符 |
| `list_lore` | 列出索引（编号/类型/名称/状态/世界），可按类型、世界、状态过滤 | 不含摘要与正文 | `limit` 默认 20、夹到 1–30；返回 `total` 与 `returned` |
| `list_art_assets` | 列出美术资产元数据索引 | 不含 `prompt` 与原图 | `limit` 默认 20、夹到 1–30；`targetType` 枚举只有 `lore`/`card` |
| `get_art_asset` | 取 1–4 张资产的元数据 + `imageIds`，图片本体由调用方读盘后附到对话 | 工具消息本身不携带图片 | `ids` 最少 1、最多 4（`AGENT_LIMITS.maxImages`） |

## 重点逻辑

### `runToolCall(name, args, library, artAssets = [])`
- 工具参数的 `type` 字段是**资料组 id**（固定五组或作者自定义组），`worldId` 是世界编号；两者都只做精确匹配，传未知值只会得到空结果。
- 名称不在白名单时返回 `ok: false` 且 `content` 里列出 `available`，不抛异常。
- 非对象 `args` 归一为 `{}`；`searchLore` 走 `clampLimit`，`getLoreEntry`/`getArtAsset` 对空 `ids` 内部抛错，被外层 `catch` 转成 `ok: false` 的错误文本，交回模型自行修正。
- 所有成功结果都经 `clip`：`JSON.stringify` 超过 6000 字符时改写为 `{truncated, note, preview}`，此时**结构失效**、只剩前 6000 字符字符串，调用方不能再按原字段解析。
- `get_art_asset` 额外返回 `imageIds`（资产 ID 列表）与 `originalPrompt`；其余工具无该字段。

### 白名单与预算约束（`AGENT_LIMITS`）
- Schema 的 `maximum` 与执行期 `clampLimit` 共用同一常量，因此模型声明的上限即服务端实际生效上限：`searchLimit` 12、`getLimit` 5、`listLimit` 30、`artListLimit` 30、`maxImages` 4。
- 快照规模上限 400 条条目 / 200 个资产，超出的尾部条目在 `prepareLibrary`/`prepareArtAssets` 里被 `slice` 静默丢弃，条目本身不报错。
- 字段裁剪：`maxSummary` 1200、`maxDetails` 8000、`maxFieldText` 300、列表项 20 条（`relationIds` 40 条）、`maxImagePrompt` 300。
- `runToolCall` 不调用 `prepareLibrary`：调用方必须先清洗快照，否则长度上限与 `id` 过滤不生效。
