# `dist/index.html`

> 作用：单页外壳与全部静态 DOM 骨架。5 个模块页一次全量输出，靠 `hidden` + `data-*` 切换；脚本只负责填充，不动态创建主容器。无构建，直接被本地服务返回。

## 视图容器

| 容器 | 作用 | 位置 |
| --- | --- | --- |
| `header.app-header` + `nav.module-tabs` | 5 个 `[data-module]` 标签（world/cards/battle/free/simulation）、`#storageStatus`（SQLite 状态徽标）、`#openSettings`、`#exportData` | `L17–L27` |
| `section#worldModule[data-page=world]` | 内含两级视图：`#worldHub`（世界卡片网格）与 `#worldDetail`（资料工作区），二者用 `hidden` 互斥 | `L30–L183` |
| `#worldDetail` 三栏 | `lore-library-panel`（列表 + 地理/编年史入口）｜`lore-editor-panel`（`#loreForm`）｜`ai-panel`（AI 助手，含收起态 `#openAiPanel`） | `L74–L181` |
| `#loreTabs` | 13 个 `[data-lore-type]` 页签；每项带计数 `<em>`，类型与 `LORE_TYPES` 一一对应 | `L58–L72` |
| `section#cardsModule[data-page=cards]` | `[data-card-tab]` 二级页签 + 三块 `[data-card-panel]`：`library` / `editor` / `artwork`，同时只有一块可见 | `L185–L241` |
| `#cardPreview`（`.editable-card`） | 可编辑卡面预览；脚本写 `data-card-type` 供 CSS 按类型调整画框（`styles.css L56`），与 `compileCardPng` 输出保持同一排布 | `L213–L222` |
| `section#battleModule[data-page=battle]` | 对战台 + 侧栏（关键词说明、`#battleLog`） | `L243–L265` |
| `section#freeModule[data-page=free]` | 对话区 + 工具区（名称生成器） | `L267–L298` |
| `section#simulationModule[data-page=simulation]` | W98 宏观面板；底部 `<details class="simulation-diagnostics">` 折叠 W99 诊断区（默认折叠，减少主视图噪音） | `L300–L393` |
| `dialog` × 5 | `#noteDialog`、`#keywordDialog`、`#relationDialog`、`#settingsDialog`、`#imageViewer`，均为 `form method="dialog"` | `L396–L431` |
| `#toast` | 全局提示，`role="status" aria-live="polite"` | `L432` |

脚本与 DOM 的绑定契约集中在 `data-*`：`data-module`、`data-page`、`data-lore-type`、`data-card-tab`、`data-card-panel`、`data-settings-tab`、`data-settings-panel`、`data-simulation-preset`、`data-search-input="cards"`。新增同名元素会自动纳入对应批量绑定（`app.js L180–L183`），改名或删除则会静默失去 handler。

## 脚本装配顺序与缓存版本

`<head>`：`styles.css?v=36`（`L13`）。`</body>` 前（`L433–L441`）依次为
`geography.js?v=2` → `chronicle.js?v=1` → `world-scope.js?v=1` → `relation-picker.js?v=1` → `cards.js?v=6` → `battle.js?v=1` → `battle-ui.js?v=1` → `macro.js?v=3` → `app.js?v=44`。

- 顺序不可调整：`app.js` 末尾同步执行 `bootstrap()`，依赖前 5 个脚本暴露的 `Worldforge*` 全局；`battle-ui.js` 依赖 `battle.js`。
- 所有脚本都必须位于 `</body>` 前，因为 `battle-ui.js`、`macro.js`、`app.js` 在加载时就查询 DOM 并绑定事件。
- 修改任一脚本或样式后必须同步递增对应的 `?v=`，否则用户可能拿到旧脚本去操作新骨架（DOM 契约错位）。
- `L8–L11` 的内联脚本只做尾斜杠补全：`location.pathname` 末段不含 `.` 时 `location.replace` 到 `路径/`，保证 `./app.js`、`./styles.css` 等相对引用在子路径部署（如 `/worldforge`）下解析正确。

## 安全与富文本约束（有证据的部分）

- **富文本只到粗体/斜体**：`#cardRules` 的说明文字（`L229`）明确只支持 `<b>`/`<i>`/`**`/`*`；`#loreDetails` 等正文是纯 `<textarea>`，不是 `contenteditable`，渲染由脚本用 `textContent` 完成，因此 HTML 不会被执行。
- **密钥输入**：`#settingApiKey`、`#settingSeedreamApiKey` 为 `type="password" autocomplete="new-password"`，占位符写明“未修改时留空”，并各配一个“清除已经保存的密钥”复选框（`L425`、`L427`）；对话框文案声明密钥只由本地服务读取。
- **付费动作显式标注**：生图按钮文案含“（可能付费）”，并有“请勿重复提交”的运行态提示（`L157`、`L233`；状态文本由 `app.js` 写入）。
- **状态分级可见**：`proposed`/`unknown`/`canon`/`deprecated` 与 `objective`/`in_world_belief`/`unknown` 只能通过原生 `<select>` 人工选择（`L99–L100`），无隐藏默认提升为 `canon` 的路径。
- **共享上传口**：AI 助手的“＋ 添加图片”标签 `for="loreReferenceUpload"`（`L174`）复用视觉原型的同一个 file input；`app.js` 的 `renderReferenceAssets('lore')` 同时渲染 `#loreReferenceAssets` 与 `#aiVisionReferenceAssets`，两处显示同一选中集合。上传仅接受 8 MB 内的 PNG/JPEG/WebP，最多 10 张。
- **表单校验靠原生属性**：`required`、`maxlength`（如 `#loreName` 80、`#cardRules` 1000、`#loreArtPrompt` 3000）在 HTML 层生效，绕过 UI 直接提交时后端校验情况静态分析无法确认。
