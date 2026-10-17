# `dist/macro.js`

> 作用：W98 宏观世界模拟的前端（IIFE，自带事件绑定）。地图与局部面板只读服务端规则结算结果，LLM 仅提供“局部干预提案”，采纳后才作为 action 推进一个季度。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `scriptRoot` / `q` / `api(path)` | 由 `document.currentScript.src` 取目录，API = 目录 + `api/<path>` | `L2` |
| `view` / `selectedId` / `proposal` / `busy` | 全部 UI 状态；`busy` 同时充当互斥锁与按钮禁用源 | `L3` |
| `post(path,body)` | POST 封装，带 `X-Worldforge-Simulation:1`；非 2xx 抛 `data.error` | `L7` |
| `setBusy(value,message)` | 统一禁用 5 个操作按钮并写 `#macroStatus` | `L6` |
| `mapMetric` / `layerColor` / `polityClass` / `riskClass` | 图层指标文案、三套 `hsl` 配色（稳定/粮食/人口）、政体配色类、稳定度分级 | `L9` / `L10` / `L4` / `L8` |
| `renderMap()` | 六边形格位（`--q`/`--r`/`--offset`）重建地图；点击地区即选中并清空提案 | `L11` |
| `renderPolities` / `renderLocal` / `renderEvents` / `renderChart` | 政体卡片、局部统计+相邻地区跳转、最近事件（含 `macro.*` 事件类型中文映射）、近 12 季度三条折线 SVG | `L12`–`L16` |
| `renderProposal()` | 提案卡片；标出 `source==='llm'` 与 `model`，或“规则回退”及 `fallbackReason` | `L14` |
| `render()` | 汇总世界钟、总人口/粮食/稳定、重放校验结论，并调用各子渲染 | `L17` |
| `refresh()` | GET `macro`；若 `selectedId` 已不在新视图中则清空选择 | `L18` |
| `advance(quarters,actions)` | 1 季度走 `macro/step`（可带 actions），多季度走 `macro/run`；均传 `expectedStateVersion` | `L19` |
| `ask()` | POST `macro/local-proposal`（仅 `regionId`），只给 LLM 局部上下文 | `L20` |
| `WorldforgeMacro.refresh` | 唯一导出，供 `app.js` 的模块切换调用 | `L22` |

## 重点逻辑

- **人工采纳闸门**：“采纳并推进一季度”把 `proposal.action` 作为 `actions` 传给 `macro/step`（`L21`），在此之前规则状态不变。
- **乐观锁**：`refresh/advance/reset` 三处都发送 `expectedStateVersion`，服务端据此拒绝过期写入（版本冲突的具体响应码静态分析无法确认）。
- **重置确认**：`#macroReset` 先 `confirm` 再 POST `macro/reset`，明确提示会清空季度、行动与事件（`L21`）。

## 重要约束

- 本文件是自包含 IIFE，**不依赖 `app.js`**，但依赖 `#macro*` 系列 DOM 在加载时已存在（`L21` 立即绑定）。
- 与 `app.js` 共用 `api/` 前缀约定；若 `script` 以 `type="module"` 加载，`document.currentScript` 为 `null`，`L2` 会立即抛错。
- 显示的稳定度/粮食/人口等数值全部来自服务端规则结算，前端只做文案与配色，不参与计算。
