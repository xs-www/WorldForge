# `dist/`（前端运行层）

> 作用：零依赖、无构建步骤的手写前端。`dist/index.html` 用普通 `<script src>` 按固定顺序加载 10 个 `.js`，所有脚本共享全局作用域；`app.js` 是唯一的组合根，其余脚本向 `window` 暴露 `Worldforge*` 命名空间。未登录时服务端返回的是独立的 `dist/login.html`（只加载 `styles.css` 与 `login.js`），因此匿名访客不会拿到应用外壳。

## 脚本装配顺序（`index.html` L433–L441，不可调序）

| # | 文件（`?v=`） | 全局导出 | 职责 | 位置 |
| --- | --- | --- | --- | --- |
| 1 | `geography.js`（`?v=2`） | `WorldforgeGeography` | 地点层级秩、父级合法性、按层级排序、树构建与搜索可见集 | `L433` |
| 2 | `chronicle.js`（`?v=1`） | `WorldforgeChronicle` | 编年史/节点两态、排序值排序、树构建 | `L434` |
| 3 | `world-scope.js`（`?v=2`） | `WorldforgeWorldScope` | `W\d{2}` 世界 ID 归一、分组（含未归属桶）、搜索、跨世界归属迁移 | `L435` |
| 4 | `relation-picker.js`（`?v=2`） | `WorldforgeRelationPicker` | 关联条目纯函数筛选/切换/摘要 | `L436` |
| 5 | `lore-groups.js`（`?v=1`） | `WorldforgeLoreGroups` | **资料组真源**：五个固定组、自定义组规范/派生（按世界作用范围）、提示词档位收敛；服务端 `lore-groups.mjs` 复用它 | `L437` |
| 6 | `cards.js`（`?v=7`） | `WorldforgeCards` | 卡牌归一化、按世界派生的子类型候选、富文本 run 解析、卡面描述编译 | `L438` |
| 6 | `battle.js`（`?v=1`） | `WorldforgeBattle` | 确定性对战规则引擎（无 DOM） | `L438` |
| 7 | `battle-ui.js`（`?v=1`） | `WorldforgeBattleUI` | 对战 DOM 渲染与事件绑定，依赖 6 | `L439` |
| 8 | `macro.js`（`?v=3`） | `WorldforgeMacro`（仅 `refresh`） | W98 宏观模拟前端，自带 IIFE 与事件绑定 | `L440` |
| 10 | `app.js`（`?v=54`） | 无导出（组合根） | 世界观/卡牌/自由创作/W99 诊断的 DOM、状态、API 与持久化 | `L462` |

`styles.css?v=45` 在 `<head>`（`L14`）。登录页 `login.html` 不在脚本装配表内：它是独立文档，只加载 `styles.css?v=45` 与 `login.js?v=1`。

## 全局耦合规则

- **加载顺序即依赖顺序**：`app.js` 顶层在加载末尾同步执行 `bootstrap()`（`app.js L284`），此前的函数体还会调用 `WorldforgeGeography` / `WorldforgeChronicle` / `WorldforgeWorldScope` / `WorldforgeRelationPicker` / `WorldforgeCards`；缺任一个即抛错。`battle-ui.js` L3 在加载时读取 `globalThis.WorldforgeBattle`，缺失则直接 return（静默降级）。
- **脚本必须在 `</body>` 前**：`battle-ui.js` L12、`macro.js` L21、`app.js` L180–L205 在**加载时**就查找 `#battleReset`、`#macroStep`、`#saveCard` 等元素并绑定 handler，此时 DOM 必须已解析完毕。
- **`app.js` 的后置覆盖**：`L246` 先保存原始实现（`baseLoadLore`/`baseResetLoreEditor`/`baseRefreshArtAssets`），`L247–L249` 再重新赋值同名函数做包装，`L250` 覆盖 `#saveLore`/`#openSettings`/`#saveSettings` 的 handler。因此这些入口的最终行为以 `L246–L250` 为准，前面的绑定只是被替换掉的一版。
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
- 端点全集（`app.js`）：`content`(GET/PUT)、`settings`(GET/POST)、`ai`、`ai/free`、`ai/card`、`ai/status`、`ai/presets`、`ai/tools/names`、`auth/session`、`auth/login`、`auth/logout`、`auth/password`、`users`、`users/{name}`、`users/{name}/password`、`images/generate`、`images/compose-prompt`、`images/optimize-prompt`、`images/status`、`art-assets`、`art-assets/{id}/unbind`、`reference-assets`、`simulation`、`simulation/advance`、`simulation/run`、`simulation/reset`、`health`；`macro.js`：`macro`、`macro/step`、`macro/run`、`macro/reset`、`macro/local-proposal`。

## 账号模式（v0.3.0，ADR-0030）

- **401 统一回登录页**：`app.js` 在顶层把 `window.fetch` 包一层，任何响应为 `401` 时 `location.replace(LOGIN_URL.href)`；`LOGIN_URL = new URL('./login.html', document.currentScript.src)`（`L4`）。登录页自身不经过这层包装。
- **会话快照决定可见性**：`bootstrap()` 先 `loadSession()`（`L263`，请求 `auth/session`），账号模式下没有会话就直接返回；`applySessionUi()` 按 `sessionMode` / `currentUser` 隐藏成员不可用的入口（`#openSettings`、`#settingsUsersTab`），并驱动页头用户名、改口令与退出按钮（`L261–L284`）。
- **账号面板**：设置里的 `data-settings-panel="users"` 由 `refreshUsers` / `userRow` / `patchUser` / `createUserFromForm` / `resetUserPassword` / `removeUser` 驱动（`L271–L276`）；创建与重置返回的一次性口令只写入 `#userSecret`，刷新列表即清空。
- **自助改口令**：页头「改口令」打开 `#passwordDialog`，提交到 `auth/password`；成功后服务端换发 Cookie，其他设备因 `sessionVersion` 变更失效。
- **登录页资源**：`login.js` 只使用 `SCRIPT_ROOT` / `API_ROOT` 相对路径；`styles.css?v=42` 同时服务两个页面，改样式要同时递增两处 `?v=`（0.3.1 之前 login.html 曾停在 `?v=40` 与 index.html 不一致，已统一）。

## 数据边界：SQLite 为真值，localStorage 仅缓存/迁移

| localStorage 键 | 用途 | 是否同步到 SQLite |
| --- | --- | --- |
| `worldforge-lore-entries-v1` | 资料条目缓存 | 是（`content.loreEntries`） |
| `worldforge-lore-groups-v1` | 作者自定义资料组 | 是（`content.loreGroups`） |
| `worldforge-card-drafts-v1` | 卡牌草案缓存 | 是 |
| `worldforge-keywords-v1` | 关键词缓存 | 是 |
| `worldforge-decisions-v1` | 条目备注 | 是（`content.notes`） |
| `worldforge-preferences-v1` | 主题/密度/默认世界等编辑偏好 | 否，仅本浏览器 |
| `worldforge-ui-state-v1` | AI 面板 open/min/closed | 否 |
| `worldforge-sqlite-migrated-v1` | 迁移完成标记 | 否 |
| `worldforge-pre-sqlite-backup-v1` | 迁移前本地快照 | 否 |

- 写入正文的路径是 `contentSnapshot()` → `PUT api/content`，携带 `expectedRevision`；服务端返回 `409` 时前端**停止同步**（`contentReady=false`）并提示先导出再刷新（`app.js L27`）。`localStorage` 只负责离线缓存与首次迁移（`app.js L28`）。保存成功后页头状态追加 `lastSavedBy`（服务端写入的账号名）。

## 横切约束

- **富文本白名单**：卡面描述只识别 `<b>`/`</b>`/`<i>`/`</i>`/`**`/`*`（`cards.js L34–L51`），其余字符按纯文本收进 run；DOM 侧一律 `createElement` + `textContent` 渲染（`app.js L147`），`app.js` 中唯一的 `innerHTML` 是 `L167` 的静态空状态串。`battle-ui.js`、`macro.js` 使用模板字符串 `innerHTML`，其内容来自内置测试卡牌/服务端模拟数据，源码中未见转义。
- **预览与 PNG 同源**：`renderCardKeywordPreview`（`app.js L147`）与 `compileCardPng`（`L129`，660×920 canvas，经 `drawCompiledDescription` L125）都消费 `WorldforgeCards.compileDescription()` 的 `runs`，因此排版随 run 列表变化，改其一必须同步改另一侧。
- **付费生图不自动重试**：`requestGeneratedAsset`（`app.js L7`）为每次请求生成 `clientRequestId` 并只 POST 一次；仅在响应为空/非 JSON/网络中断时，通过轮询 `art-assets`（最多 8 次、间隔 1.5s）按 `clientRequestId` 找回已生成的资产（`L6`），失败时把请求 ID 写进错误文案。
- **缓存版本耦合**：新增或改动任一脚本/样式后必须同步递增 `index.html`（以及登录页 `login.html`）中对应的 `?v=`（当前 `styles 45 / app 61 / cards 7 / macro 3 / geography 2 / battle 1 / battle-ui 1 / chronicle 1 / world-scope 2 / relation-picker 2 / lore-groups 1 / card-agent-apply 1 / login 1`），顺序不变，否则浏览器可能复用旧脚本并与新 DOM 契约错位。
- **没有默认世界**：`readLore()` 会滤掉早期 `seeded` 的默认世界条目，`normalizeLore` 不再把缺失的 `worldId` 改写成 `W01`；世界由作者新建，第一条取 `nextWorldId()` 的最小可用编号。
- **资料组驱动界面**：标签页、表单形态、AI 内容块与地理/编年史作用域全部来自资料组；固定组只有世界、世界信息、角色、编年史、背景故事五项。
- **状态分级由前端强制**：`cards.js L66` 把卡牌 `status` 固定为 `proposed`、`balanceStatus` 固定为 `untested`；资料条目的 `canon` 只能在 UI 中人工选择（`index.html L99`）。
