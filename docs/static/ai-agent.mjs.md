# `ai-agent.mjs`

> 作用：自由创作 Agent 的多轮工具调用循环（纯编排，`callModel`/`runTool` 由调用方注入），以及 chat / responses 两种 API 风格的请求体构造、工具消息编解码与解析器。由 `server.mjs` 消费。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `runAgentLoop(options)` | 主循环；缺 `callModel`/`runTool` 直接抛错 | `L41` |
| `createToolCaller({config, system, fetchImpl, timeout})` | 把两种 API 风格统一成 `callModel({messages, tools})`；无 `config.key` 抛错 | `L231` |
| `toolsForChat` / `toolsForResponses` | 同一工具声明的两种 wire 形状 | `L151` / `L155` |
| `buildChatMessages` / `buildResponsesInput` | 内部 transcript → 各风格请求体（含 tool_calls / function_call 映射） | `L163` / `L187` |
| `parseChatText` / `parseChatToolCalls` / `parseResponsesText` / `parseResponsesToolCalls` | 响应解析；`parseResponsesText` 先取 `output_text`，否则拼接 `output[].content[]` 中 `type==='output_text'` 的分片 | `L206`–`L224` |

## 重点逻辑

### `runAgentLoop(options)`
- 硬上限来自模块常量：`maxRounds` 默认 6、`maxToolCalls` 默认 12、`AGENT_IMAGE_CAP` 固定 4。前两个可由 options 覆盖，附图上限是模块常量、不经 options 暴露。
- 每轮先判预算：`trace.length < maxToolCalls` 才把 `tools` 传给模型；否则本轮不带工具。返回带工具调用但预算已尽时立即 `finish(text, 'tool_budget')`。
- 无工具调用即正常结束（`stopped` 为 `'answer'` 或预算耗尽的 `'tool_budget'`）；`trace.length` 只统计已执行工具调用，等价于“调用次数”计数器。
- 轮次用尽仍有工具请求时，追加一条固定的“已达检索上限”用户消息、以空 `tools` 再调一次模型，`stopped` 记为 `'round_limit'`（已是 `'tool_budget'` 则保留后者的优先级）。
- 返回 `{reply, trace, rounds, toolCalls, stopped, vision, images}`；`trace` 每项 `{round, name, ok, summary, images?}`，`onTrace` 逐条回调。

### 工具调用解析与失败降级
- `normalizeCalls` 丢弃 `name` 为空的调用，缺失 `id` 时补 `call_<序号>`。
- `parseArguments`：参数已是对象直接用；空字符串视作 `{}`；解析出非对象（含数组）记「工具参数必须是 JSON 对象」，语法错误记「工具参数不是合法 JSON」——两种情况都不调用 `runTool`，而是构造 `ok:false` 的结果消息喂回模型。
- `runSafely` 捕获 `runTool` 抛出的异常，转成 `{ok:false, content:{error}}`；循环本身不因单个工具失败中断。
- 工具消息不能携带图片，因此附图作为紧随其后的 `user` 消息发出，内容说明“以图片为准”，本轮跨工具累计图片按 `AGENT_IMAGE_CAP` 截断（每轮最多 4 张，`imagesAttached` 累加）。

### 附图能力降级（vision）
- 仅当请求发出时 transcript 中已有图片、且错误 `status` 属于 `400/404/422`、且 `vision` 尚未标记 `unavailable` 时才降级：把 `stripImages` 改写后的 transcript 重发一次。
- `stripImages` 把 `images` 数量写进消息正文后删除 `images` 字段（非静默丢图）；此后 `vision` 恒为 `'unavailable'`，不再附图。
- 其他状态码或未附图时的错误原样抛出——异常契约依赖注入的 `callModel` 在被拒时设置 `error.status`。

### `createToolCaller(...)`
- `style === 'chat'` 走 `${baseUrl}/chat/completions`，否则走 `${baseUrl}/responses`；`baseUrl` 去掉末尾斜杠。
- 非 2xx 时抛 `Error(data.error?.message || 模型服务返回 <status>)` 并带 `error.status`（vision 降级唯一依赖）；响应体解析失败按 `{}` 处理。
- 超时固定 `AbortSignal.timeout(timeout)`，默认 90000 ms；`tool_choice` 恒为 `'auto'`，只在有工具时才带 `tools`。
