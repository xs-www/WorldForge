# `dist/`（前端运行层）

> 作用：零依赖、无构建步骤的手写前端。`dist/index.html` 用普通 `<script src>` 按固定顺序加载 9 个 `.js`，所有脚本共享全局作用域；`app.js` 是唯一的组合根，其余脚本向 `window` 暴露 `Worldforge*` 命名空间。

## 脚本装配顺序（`index.html` L433–L441，不可调序）

| # | 文件（`?v=`） | 全局导出 | 职责 | 位置 |
| --- | --- | --- | --- | --- |
| 1 | `geography.js`（`?v=2`） | `WorldforgeGeography` | 地点层级秩、父级合法性、按层级排序、树构建与搜索可见集 | `L433` |
| 2 | `chronicle.js`（`?v=1`） | `WorldforgeChronicle` | 编年史/节点两态、排序值排序、树构建 | `L434` |
| 3 | `world-scope.js`（`?v=1`） | `WorldforgeWorldScope` | `W\d{2}` 世界 ID 归一、分组、搜索、跨世界归属迁移 | `L435` |
| 4 | `relation-picker.js`（`?v=1`） | `WorldforgeRelationPicker` | 关联条目纯函数筛选/切换/摘要 | `L436` |
| 5 | `cards.js`（`?v=6`） | `WorldforgeCards` | 卡牌归一化、子类型表、富文本 run 解析、卡面描述编译 | `L437` |
| 6 | `battle.js`（`?v=1`） | `WorldforgeBattle` | 确定性对战规则引擎（无 DOM） | `L438` |
| 7 | `battle-ui.js`（`?v=1`） | `WorldforgeBattleUI` | 对战 DOM 渲染与事件绑定，依赖 6 | `L439` |
| 8 | `macro.js`（`?v=3`） | `WorldforgeMacro`（仅 `refresh`） | W98 宏观模拟前端，自带 IIFE 与事件绑定 | `L440` |
| 9 | `app.js`（`?v=44`） | 无导出（组合根） | 世界观/卡牌/自由创作/W99 诊断的 DOM、状态、API 与持久化 | `L441` |

`styles.css?v=36` 在 `<head>`（`L13`）。

## 全局耦合规则

- **加载顺序即依赖顺序**：`app.js` 顶层在加载末尾同步执行 `bootstrap()`（`app.js L211`），此前的函数体还会调用 `WorldforgeGeography` / `WorldforgeChronicle` / `WorldforgeWorldScope` / `WorldforgeRelationPicker` / `WorldforgeCards`；缺任一个即抛错。`battle-ui.js` L3 在加载时读取 `globalThis.WorldforgeBattle`，缺失则直接 return（静默降级）。
- **脚本必须在 `</body>` 前**：`battle-ui.js` L12、`macro.js` L21、`app.js` L180–L205 在**加载时**就查找 `#battleReset`、`#macroStep`、`#saveCard` 等元素并绑定 handler，此时 DOM 必须已解析完毕。
- **`app.js` 的后置覆盖**：`L199` 先保存原始实现（`baseLoadLore`/`baseResetLoreEditor`/`baseRefreshArtAssets`），`L200–L202` 再重新赋值同名函数做包装，`L203` 覆盖 `#saveLore`/`#openSettings`/`#saveSettings` 的 handler。因此这些入口的最终行为以 `L199–L205` 为准，`L180–L198` 的绑定只是被替换掉的一版。
- **模块切换的跨脚本钩子**：`switchModule()`（`app.js L37`）在进入 `battle` 时调 `window.WorldforgeBattleUI?.refresh()`，进入 `simulation` 时调 `window.WorldforgeMacro?.refresh()` 与 `refreshSimulation()`；`free`、`cards`、`world` 无外部脚本回调。

## API 前缀解析

```js
const SCRIPT_ROOT = new URL('./', document.currentScript.src);
const API_ROOT   = new URL('./api/', document.currentScript.src);
const apiUrl = path => new URL(path, API_ROOT);
```

- 前缀 = **脚本自身所在目录** + `api/`，与页面 URL 无关；`macro.js L2` 用 `new URL('.', document.currentScript.src)` + `new URL('api/'+path, scriptRoot)` 得到同一结果。
- 因此必须以**普通 `<script>`（非 `type="module"`、非内联）**加载：module 模式下 `document.currentScript` 为 `null`，`app.js`/`macro.js` 会在解析 URL 时抛错。
- 子路径部署（如 `/worldforge/dist/`）无需配置；`index.html L9–L11` 的脚本只为补尾斜杠：当 `location.pathname` 末段不含 `.` 时 `location.replace` 到 `路径/`，否则 `./app.js`、`./styles.css` 这类相对引用会解析到上级目录。
- 请求头约定（服务端可据此拒绝跨源/非预期调用）：`X-Worldforge-Content`、`X-Worldforge-Image`、`X-Worldforge-Settings`、`X-Worldforge-Simulation`。
- 端点全集（`app.js`）：`content`(GET/PUT)、`settings`(GET/POST)、`ai`、`ai/free`、`ai/status`、`ai/tools/names`、`images/generate`、`images/compose-prompt`、`images/optimize-prompt`、`images/status`、`art-assets`、`art-assets/{id}/unbind`、`reference-assets`、`simulation`、`simulation/advance`、`simulation/run`、`simulation/reset`；`macro.js`：`macro`、`macro/step`、`macro/run`、`macro/reset`、`macro/local-proposal`。

## 数据边界：SQLite 为真值，localStorage 仅缓存/迁移

| localStorage 键 | 用途 | 是否同步到 SQLite |
| --- | --- | --- |
| `worldforge-lore-entries-v1` | 资料条目缓存 | 是（`content.loreEntries`） |
| `worldforge-card-drafts-v1` | 卡牌草案缓存 | 是 |
| `worldforge-keywords-v1` | 关键词缓存 | 是 |
| `worldforge-decisions-v1` | 条目备注 | 是（`content.notes`） |
| `worldforge-preferences-v1` | 主题/密度/默认世界等编辑偏好 | 否，仅本浏览器 |
| `worldforge-ui-state-v1` | AI 面板 open/min/closed | 否 |
| `worldforge-sqlite-migrated-v1` | 迁移完成标记 | 否 |
| `worldforge-pre-sqlite-backup-v1` | 迁移前本地快照 | 否 |

- 写入正文的路径是 `contentSnapshot()` → `PUT api/content`，携带 `expectedRevision`；服务端返回 `409` 时前端**停止同步**（`contentReady=false`）并提示先导出再刷新（`app.js L26`）。`localStorage` 只负责离线缓存与首次迁移（`app.js L27`）。

## 横切约束

- **富文本白名单**：卡面描述只识别 `<b>`/`</b>`/`<i>`/`</i>`/`**`/`*`（`cards.js L34–L51`），其余字符按纯文本收进 run；DOM 侧一律 `createElement` + `textContent` 渲染（`app.js L147`），`app.js` 中唯一的 `innerHTML` 是 `L167` 的静态空状态串。`battle-ui.js`、`macro.js` 使用模板字符串 `innerHTML`，其内容来自内置测试卡牌/服务端模拟数据，源码中未见转义。
- **预览与 PNG 同源**：`renderCardKeywordPreview`（`app.js L147`）与 `compileCardPng`（`L129`，660×920 canvas，经 `drawCompiledDescription` L125）都消费 `WorldforgeCards.compileDescription()` 的 `runs`，因此排版随 run 列表变化，改其一必须同步改另一侧。
- **付费生图不自动重试**：`requestGeneratedAsset`（`app.js L7`）为每次请求生成 `clientRequestId` 并只 POST 一次；仅在响应为空/非 JSON/网络中断时，通过轮询 `art-assets`（最多 8 次、间隔 1.5s）按 `clientRequestId` 找回已生成的资产（`L6`），失败时把请求 ID 写进错误文案。
- **缓存版本耦合**：新增或改动任一脚本/样式后必须同步递增 `index.html` 中对应的 `?v=`（当前 `styles 36 / app 44 / cards 6 / macro 3 / geography 2 / battle 1 / battle-ui 1 / chronicle 1 / world-scope 1 / relation-picker 1`），顺序不变，否则浏览器可能复用旧脚本并与新 `index.html` 的 DOM 契约错位。
- **状态分级由前端强制**：`cards.js L66` 把卡牌 `status` 固定为 `proposed`、`balanceStatus` 固定为 `untested`；资料条目的 `canon` 只能在 UI 中人工选择（`index.html L99`）。
