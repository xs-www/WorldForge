# `seedream.mjs`

> 作用：火山方舟 Seedream 生图的配置读取、设置校验、请求校验与一次「生成 + 下载」调用。外部 I/O 边界模块，由 `server.mjs` 消费。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `seedreamConfig(env)` | 从 `SEEDREAM_API_KEY` / `SEEDREAM_BASE_URL` / `SEEDREAM_MODEL` 取值并去尾部斜杠 | `L5` |
| `validateSeedreamSettings(payload)` | 校验用户提交的 Base URL / 模型 ID / API Key | `L13` |
| `validateImageRequest(payload)` | 归一化并校验一次生图请求，返回 `{prompt, size, targetType, targetId, purpose, cardId, referenceImages}` | `L23` |
| `buildSeedreamBody(config, request)` | 构造请求体，固定若干参数 | `L40` |
| `generateSeedreamImage(config, payload, fetchImpl)` | POST 生成 → 取 URL → 下载字节 | `L53` |
| `SEEDREAM_DEFAULTS` | 默认 Base URL / 模型 / 允许尺寸 | `L78` |

## 固定写死的参数与端点
- 端点：`POST ${baseUrl}/images/generations`，Header `Authorization: Bearer <key>`；Base URL 校验要求**精确等于** `https://ark.cn-beijing.volces.com/api/v3`（正则带首尾锚定），不接受其他区域或路径。
- 请求体固定 `response_format: 'url'`、`stream: false`、`watermark: false`；`prompt` 一律追加固定后缀「仅生成原创视觉原型或插画本体，不要文字、数字、卡框、标志或界面元素」。
- `size` 只接受 `2K` / `1872x1248` / `1248x1872` 三个值，缺省 `2K`；模型 ID 必须匹配 `^doubao-seedream-[a-z0-9.-]+$`（默认 `doubao-seedream-5-0-flash-260915`）。
- 参考图上限 10 张，每张必须是 `data:image/(png|jpeg|webp);base64,…` 正则；单张以字符串、多张以数组写入 `image` 字段。
- 超时：生成请求 180000 ms，图片下载 60000 ms（`AbortSignal.timeout`）。
- `purpose` 缺省按目标类型取 `card_art` 或 `concept`，截断 40 字符；`targetId` 对卡牌要求 `^CARD-[A-Za-z0-9-]+$`、对设定条目要求 `^[A-Za-z0-9][A-Za-z0-9-]{1,159}$`。

## 失败如何上报
- 缺 API Key：`generateSeedreamImage` 首行直接抛「尚未配置 Seedream API Key」，不发起网络请求。
- 参数不合法：`validateImageRequest` 抛 `Error`（提示词 1–3000 字符、尺寸不支持、目标 ID 无效、参考图过多/格式无效），消息为固定中文文案，无错误码。
- 服务返回非 2xx：抛 `Error(data.error?.message || 'Seedream 返回 <status>')` 并附 `error.status`（响应体解析失败按 `{}` 处理）。
- 成功响应里 `data.data[0].url` 缺失或非 `https:` 即抛「Seedream 未返回有效图片 URL」；下载非 2xx 抛「下载 Seedream 图片失败：<status>」；字节数为 0 或 > 30 MB 抛「Seedream 图片数据大小无效」。
- 设置侧：`seedreamApiKey === undefined` 表示“不修改”，`clearSeedreamApiKey` 为真时置空串；校验只拒绝超过 1000 字符或含换行的 Key，不要求非空。
- 成功返回 `{request, bytes, mimeType, providerMetadata}`；`mimeType` 取响应 `content-type` 主类型，缺失时回落 `image/jpeg`；`providerMetadata` 原样带 `created`、`usage`、`returnedSize`（取 `output.size` 或请求尺寸）。
