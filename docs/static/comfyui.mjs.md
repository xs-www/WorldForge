# `comfyui.mjs`

> 作用：本地 ComfyUI 生图——配置/设置校验、工作流占位符替换、入队 + 轮询 history + 下载图片。外部 I/O 边界模块，由 `server.mjs` 消费。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `comfyUiConfig(env)` | 读 `COMFYUI_BASE_URL`，默认 `http://host.docker.internal:8188`，去尾部斜杠 | `L7` |
| `validateComfyUiSettings(payload)` | 校验 Base URL 与 API Format 工作流 JSON | `L11` |
| `fillComfyWorkflow(template, request)` | 递归替换占位符，返回 `{workflow, seed, width, height}` | `L33` |
| `generateComfyUiImage(config, template, request, fetchImpl, waitImpl)` | 入队 → 轮询 → 下载 | `L55` |
| `COMFYUI_DEFAULTS` | 默认 Base URL | `L87` |

## 固定写死的参数与端点
- 端点与超时：`POST ${baseUrl}/prompt`（30000 ms）、`GET ${baseUrl}/history/<prompt_id>`（10000 ms）、`GET ${baseUrl}/view?filename&subfolder&type`（60000 ms）。轮询间隔 `WAIT_MS = 1000`、最多 `MAX_POLLS = 180` 次，即约 3 分钟后超时。
- 入队体固定为 `{prompt: <workflow>, client_id: "worldforge-<uuid>"}`；`client_id` 每次调用随机生成，不持久化。
- 五个占位符：`{{PROMPT}}`、`{{NEGATIVE_PROMPT}}`、`{{WIDTH}}`、`{{HEIGHT}}`、`{{SEED}}`。字符串**整串等于**占位符时替换为非字符串值（宽度/高度/种子为 number）；否则只对 `{{PROMPT}}` / `{{NEGATIVE_PROMPT}}` 做子串替换——`{{WIDTH}}`、`{{HEIGHT}}`、`{{SEED}}` 嵌在长字符串里不会被替换。
- `negativePrompt` 缺省固定为 `text, logo, UI, card frame, numbers, low quality`。
- 尺寸映射：`1248x1872`→1248×1872、`1872x1248`→1872×1248，**其余任何值（含 `2K`）**都落到 1536×1024。
- 种子：`request.seed` 是安全整数时直接用，否则随机 `< 2147483647`。
- 工作流校验：`comfyUiWorkflow` 为 `undefined` 表示不改动；空串表示置 `null`；否则必须是对象（非数组）且原始文本包含字面量 `{{PROMPT}}`，缺占位符抛「ComfyUI 工作流必须包含 {{PROMPT}} 占位符」。

## 失败如何上报
- 未配置工作流：`generateComfyUiImage` 首行抛「尚未配置 ComfyUI API Format 工作流」，不发起请求。
- URL 校验：必须是 `http(s)://` 且长度 ≤500。
- 入队失败：`queueResponse` 非 2xx 或无 `prompt_id` 时抛 `queued.error?.message || queued.error || 'ComfyUI 入队失败：<status>'`。
- 轮询：history 非 2xx 抛「读取 ComfyUI 任务失败：<status>」；`record.status.status_str === 'error'` 抛「ComfyUI 工作流执行失败」；未找到图片则继续轮询，轮次耗尽抛「ComfyUI 生成超时或没有输出图片；工作流需包含 Save Image/Preview Image 输出」。
- 取图：`firstImage` 取 `outputs` 中**第一个**带 `filename` 的图片（多输出时不确定取到哪一张）；下载非 2xx 抛「下载 ComfyUI 图片失败：<status>」；字节数为 0 或 > 30 MB 抛「ComfyUI 图片数据大小无效」。
- 所有错误均为 `Error` + 固定中文文案，不带 HTTP 状态字段（与 `seedream.mjs` 不同，此处不设 `error.status`）。
- 成功返回 `{request, bytes, mimeType, providerMetadata}`；`mimeType` 缺省回落 `image/png`；`providerMetadata` 含 `promptId`、实际 `seed`、`width`、`height` 与命中的 `output` 元数据。
