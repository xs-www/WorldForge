# HTML 产品静态文档

## 1. 产品定位

Worldforge 是一个无前端构建依赖的单页写作资料工作台，分为“世界设定编辑器”和“卡牌设计”。设定编辑器覆盖 13 类资料，包括可挂载到人物、地点等条目的独立背景故事；AI 功能由零依赖 Node 服务代理，运行时创作内容由 SQLite 统一持久化；它不会自动修改仓库或把草案晋升为正史。

## 2. 文件入口

| 文件 | 职责 |
|---|---|
| `dist/index.html` | 页面语义结构、内容与交互入口 |
| `dist/styles.css` | 简约信息管理界面、双模块布局与响应式规则 |
| `dist/app.js` | 模块切换、资料/卡牌编辑、SQLite 同步、浏览器缓存、设置、搜索与导出 |
| `dist/cards.js` | 卡牌类型/稀有度规范化、旧类型迁移、来源去重与设定到卡牌默认映射 |
| `dist/geography.js` | 地理层级定义、父级规则、世界地图树构造、祖先搜索与旧地点隔离 |
| `dist/chronicle.js` | 编年史容器/节点规范化、父级校验、纪年排序、搜索与旧数据兼容 |
| `server.mjs` | 静态服务、内容 API、本机设置持久化、AI 状态与模型请求代理 |
| `storage.mjs` | SQLite Schema、输入校验、事务化快照读写、revision 冲突保护与健康检查 |
| `storage-migrations.mjs` | 内容域 Schema 的有序前向迁移、版本检测、逐步事务升级与未来版本拒绝 |
| `ai-harness.mjs` | AI 上下文排序与预算、提示边界、候选 Schema、解析和校验 |
| `prompt-settings.mjs` | 13 类默认提示词、个性化提示词规范化、分类白名单与长度校验 |
| `.env.example` | LLM 服务配置模板；实际密钥使用不入库的 `.env.local` |
| `.openai/hosting.json` | 静态站点发布目录声明 |
| `Dockerfile` | 基于 Node 22 Alpine 的本地生产镜像 |
| `compose.yaml` | 本地端口、可选 `.env.local`、重启、只读文件系统与临时目录配置 |
| `docker/nginx.conf` | 旧版 Nginx 配置存档；当前镜像不再使用 |
| `.dockerignore` | 限制镜像构建上下文，不打包设计源文档与托管配置 |

## 3. 静态函数

### `readStore(key, fallback): unknown`

- 位置：`dist/app.js`
- 从 `localStorage` 读取并解析指定数据。
- 数据损坏或不存在时返回调用方提供的回退值；内容键在联网模式下只是 SQLite 的浏览器缓存。

### `writeStore(key, value): void`

- 将内容序列化到浏览器缓存；设定、卡牌、关键词或备注变更会防抖触发 SQLite 保存。
- 编辑偏好继续只保存在当前浏览器，不写入 SQLite。

### `hydrateContent(): Promise<void>`

- 启动时读取 `GET /api/content`，以 SQLite 内容填充当前 Origin 的浏览器缓存。
- 数据库未初始化且浏览器存在旧内容时，自动将旧内容写入 SQLite。
- 后续 Origin 仍有旧内容时，按稳定 ID 与数据库合并，并在 `worldforge-pre-sqlite-backup-v1` 留存迁移前缓存。
- 无法连接服务端时保留浏览器离线缓存，不宣称已经写入数据库。

### `persistContent(): Promise<void>`

- 将当前设定、卡牌、关键词和备注作为一个事务快照写入 `PUT /api/content`。
- 携带当前 revision；服务端返回 409 时停止后续自动写入，防止旧页面静默覆盖新内容。
- 同步状态显示在顶栏，包括连接、保存、失败和版本冲突。

### `showToast(message: string): void`

- 位置：`dist/app.js`
- 显示短时状态提示；重复调用会重置隐藏计时。

### `switchModule(moduleName): void`

- 位置：`dist/app.js`
- 在“世界观架构”和“卡牌设计”页面之间切换。
- 同步顶部导航状态与文档标题。

### `openNote(key: string): void`

- 位置：`dist/app.js`
- 根据稳定键打开备注对话框并恢复本地内容。

### `refreshNotes(): void`

- 统计五个核心未决问题的已记录数量。
- 更新未决问题列表的状态点。

### `normalizeCard(card): CardDraft`

- 兼容旧版浏览器草案并补齐费用、攻击、血量、关键词和状态字段。
- 强制血量至少为 1，费用与攻击不得为负。

### `renderKeywords(): void`

- 渲染本地关键词定义，并同步当前卡牌的选择状态。

### `renderKeywordPreview(): void`

- 在可编辑卡面的描述区域显示当前关键词，并在右侧生成卡牌级附加说明输入框。

### `formatKeywordUsage(keyword, detail = ''): string`

- 将关键词引用格式化为独立名称，或“关键词：附加说明”。

### `renderCardKeywordPreview(): void`

- 根据当前关键词引用和附加说明更新卡面，不重建右侧输入框，避免输入焦点丢失。

### `renderCards(query = ''): void`

- 从本地存储渲染缩略卡面预览列表。
- 支持名称、类型、规则文本和关键词搜索，并同步草案数量与空状态。

### `resetCardEditor(): void`

- 将可编辑卡面恢复为费用 0、攻击 0、血量 1 的新卡牌状态。

### `loadCard(id): void`

- 将已保存草案重新载入可编辑卡面。

### `saveCurrentCard(): void`

- 保存卡面中的费用、攻击、血量、名称、描述、类型和关键词引用。
- 草案状态固定为 `proposed`，平衡状态固定为 `untested`。

### 设定资料函数

- `readLore()`：读取本地资料，并在缺少时注入只读 W01 基线。
- `normalizeLore(entry)`：规范 13 类资料的通用字段、类型属性、地图字段和编年史字段；地理条目保留标准化 `kind` 与稳定 `parentId`，旧时间线默认成为编年史容器；`story` 只保留标题、正文与关系，内部固定为 `proposed / unknown` 并清空摘要、约束、开放问题、标签和类型属性。
- `selectLoreType(type)` / `renderLoreList()`：切换分类、搜索并更新分类计数；世界地图使用嵌套地理树，编年史使用容器/节点树，不与普通资料列表共用平铺展示。
- `loadLore(id)` / `resetLoreEditor(type)`：载入条目或建立默认 `proposed` 草案。
- `collectLoreForm()` / `saveLore()` / `deleteLore()`：收集、保存或删除浏览器本地草案；删除会清理其他条目的失效引用。
- `populateLocationParents(selected)`：按地理层级和所属世界生成合法父级选项；大陆直接属于世界，国家及其他条目必须选择同世界的允许上级。
- `beginGeographyEntry(kind, parentId, worldId)`：从世界或现有地理节点内部建立子级草案，并预选层级、世界和父级。
- `renderGeographyTree(all, query)` / `geographyNode(entry, tree)`：按世界分组渲染国家及其后代；城市、地点不会与国家平铺，搜索时保留匹配条目的祖先路径。
- `prepareGeographyFramework()`：准备一个大陆级草案和 AI 作者要求，使现有候选流程可用于生成世界大地图的大陆框架。
- `populateRelations(selected)`：生成跨类型关联选项。
- `renderAttachedStories(id)`：根据故事的正向引用及故事间双向引用，为当前资料渲染挂载故事或相关故事；列表只显示标题与正文片段。
- `createAttachedStory()`：从当前已保存资料建立 `proposed / unknown` 的故事草案，并预选当前资料为关联。
- `refreshAiStatus()` / `runAi()`：读取服务端配置状态，提交当前草案、资料库、候选数量和作者要求。
- `renderAiVariants(data)`：把通过校验的结构化候选渲染为可多选方案卡。
- `updateAiSelection()`：同步已选数量，仅在至少选择一项时允许保存。
- `saveAiSelections()`：把最终选中的每份方案分别保存为独立 `proposed` 草案；背景故事模式只保存标题、正文和锚点关系，未选方案不写入存储。
- `readPreferences()` / `applyPreferences()`：读取主题、密度和新资料默认值并应用到界面。
- `openSettings()` / `saveSettings(event)`：载入安全的服务端配置摘要、13 类提示词及个性化风格，保存 AI 配置与浏览器编辑偏好。
- `captureTypePrompt()` / `showTypePrompt(type, capture)`：在设置页切换设定分类时保留尚未保存的编辑，并显示当前分类提示词。
- `updateAiExampleMeta()`：统计当前世界和类型可作为示例的 canon 条目，并在生成面板说明自动示例数量。

### 服务端函数

- `loadLocalEnv()`：解析本机配置文件；持久化配置优先于启动时注入的同名 LLM 环境变量。
- `saveLocalEnv(values)`：保留无关配置并原子更新受管理的 LLM 字段；Docker 中写入持久化卷。
- `loadPromptSettings()` / `savePromptSettings(settings)`：读取、补齐默认值并原子保存 `prompt-settings.json`；Docker 中与其他本机设置共用持久化卷。
- `aiConfig()`：返回服务端 LLM 地址、模型与 API 风格；不向前端返回 Key。
- `validateSettings(payload)`：限制 URL、模型、Key 长度及换行字符，并委托提示词设置校验拒绝未知分类或超长文本。
- `normalizePromptSettings(value)` / `validatePromptSettings(value)`：保证 13 类提示词齐全，保留作者空值和精调内容，限制分类白名单与每段 8000 字符。
- `buildContextBundle(payload, budget)`：先抽取最多 4 条同世界、同类型 canon 条目作为独立示例，再按显式关联、同世界 canon、同世界、同类型和共享标签排序其他上下文，隔离无关世界并按预算裁剪。
- `buildPrompt(payload, bundle)`：分层组合固定任务、作者补充要求、分类提示、个性化风格、自动/临时示例和普通上下文包。
- `createModelBody(config, prompt, structured)`：为 Responses 或 Chat Completions 构造原生 JSON Schema 请求；兼容服务可降级。
- `validateAiResponse(value, allowedRelationIds)`：验证固定候选字段、数量、长度、唯一 key 和引用白名单。
- `parseAiResponse(raw, allowedRelationIds)`：解析 JSON 或兼容代码围栏，并统一执行严格校验。
- `callAi(payload)`：执行结构化请求、兼容降级、一次格式修复和候选数量复核。
- `serveStatic(req, res)`：安全解析路径并提供 `dist/` 静态文件。
- `createContentStore(databasePath)`：打开 SQLite、设置连接参数并执行内容域前向迁移；迁移失败时关闭连接，成功后返回快照读取、事务替换、健康检查和关闭接口。
- `contentSchemaVersion(database)`：读取 `PRAGMA user_version`，作为现有作者内容域的 Schema 版本。
- `applyContentMigrations(database)`：从当前版本顺序应用缺失迁移；每一步在独立事务中完成 DDL、索引和版本提交，并返回本次启动的迁移报告。
- `UnsupportedContentSchemaError`：数据库版本高于当前程序支持版本时抛出的明确错误，防止旧程序误写未来格式。
- `validateContentSnapshot(value)`：限制数组规模、备注长度、稳定 ID 和重复 ID，避免非法快照进入数据库。

### `apiUrl(path: string): URL`

- 位置：`dist/app.js`
- 以当前 `app.js` 的实际 URL 为基准构造同目录下的 `api/` 请求地址。
- 根路径部署时继续请求 `/api/...`；挂载于 `/worldforge` 时自动请求 `/worldforge/api/...`，无需维护两套镜像或占用站点根路径。

## 4. 本地数据契约

SQLite 是运行时内容的权威数据源。Docker 使用 `/data/worldforge.sqlite`；本机 `npm start` 默认使用 `.data/worldforge.sqlite`。数据库 Schema 版本 2 包含：

- `metadata`：初始化状态、revision 与更新时间；
- `lore_entries`：设定稳定 ID、名称、类型、状态、事实层次、世界 ID 和完整 JSON；
- `card_drafts`：卡牌稳定 ID、名称、类型、状态、世界 ID 和完整 JSON；
- `keywords`：关键词稳定 ID、名称、状态、定义和完整 JSON；
- `notes`：固定问题键、正文和更新时间。
- `art_assets`：AI 卡面候选元数据；图片本体保存在持久卷文件目录。

内容库从版本 0 按 `0 → 1 → 2` 顺序升级，版本号只在对应迁移事务成功后更新。版本 1 的既有内容会原位保留并补充版本 2 的美术资产表；高于版本 2 的数据库会被拒绝打开。`GET /api/health` 的数据库信息会返回本次启动的迁移起点、当前版本和已应用步骤。

`PRAGMA user_version` 只属于现有作者内容域。未来模拟状态使用 `sim_` 表名前缀、独立的 `sim_schema_migrations` 账本与 `simulation/storage/` 边界；M0A 没有创建任何模拟表，也没有把作者草案当作可运行世界状态。

浏览器缓存键 `worldforge-decisions-v1` 的数据结构为：

```json
{
  "medium": "作者对魔导介质的草案备注",
  "formula": "作者对术式工程的草案备注",
  "divinity": "作者对神性边界的草案备注",
  "faith": "作者对神迹可证性的草案备注",
  "combat": "作者对基础对战规则的草案备注"
}
```

统一导出当前 schemaVersion 为 9，包含 `project`、`exportedAt`、`loreEntries`（含 `story`、地理父级和编年史结构）、`notes`、`keywords`、`cardDrafts` 与 `artAssets`。每张卡牌草案自身固定带有 `proposed` 和 `untested` 状态，避免把运行时草案误认为正式内容。

卡牌草案存储键：`worldforge-card-drafts-v1`。每个条目包含本地草案 ID、名称、世界归属、三分类类型、稀有度、费用、攻击、血量、关键词引用、多个 `loreRefs` 来源、规则文本、`proposed` 状态与 `untested` 平衡状态。关键词引用使用 `keywordUsages: [{ keywordId, detail }]`；兼容字段 `keywordIds` 继续由规范化函数生成。

关键词存储键：`worldforge-keywords-v1`。每个条目包含本地关键词 ID、名称、规则说明和 `proposed` 状态。统一导出文件包含 `notes`、`keywords` 和 `cardDrafts`。

设定资料缓存键：`worldforge-lore-entries-v1`。普通条目包含 `id`、`type`、`name`、`status`、`truthScope`、`worldId`、摘要、正文、约束、开放问题、标签、关联 ID、三个类型专属属性和可选地图信息。地理信息使用 `location: { kind, parentId, x, y, environment }`；`kind` 支持 `country / region / area / city / site / route`，非国家条目通过 `parentId` 引用同一世界中的合法上级。背景故事使用 `type: story` 与 `STORY-W01-DRAFT-*` 本地 ID；创作内容仅使用 `name` 与 `details`，通过 `relationIds` 挂载普通资料并关联其他故事。兼容字段在存储中固定为空或内部默认值，不进入故事编辑界面。

编辑偏好存储键：`worldforge-preferences-v1`，包含 `theme`、`density`、`worldId`、`defaultStatus` 与 `truthScope`。该数据不进入统一内容导出。API Key 永不进入浏览器存储；`GET /api/settings` 只返回 `configured` 布尔值和非敏感配置。

提示词设置保存在本机服务端 `prompt-settings.json`；Docker 默认位于 `worldforge-data` 卷。结构为 `{ version, personalizedPrompt, typePrompts }`，其中 `typePrompts` 固定覆盖 13 类 lore。提示词不是 lore、不会进入 SQLite 内容快照或统一 JSON 导出，也不会自动晋升为正史；`GET /api/settings` 会把这些非敏感文本返回设置界面。

AI 固定返回 `{ variants: [...] }`。每个候选必须包含 `key`、`title`、`summary`、`details`、`constraints`、`openQuestions`、`relationSuggestions`、`conflicts` 和 `assumptions`。`relationSuggestions.id` 只能引用本次上下文中实际存在的条目。

## 14. 2026-10-12 AI 上下文工程与候选选择归档

- 上下文包包含当前草案、项目固定约束及按相关度挑选的资料条目；显式关联优先，其次为同世界 canon，再到同世界同类型或共享标签资料。
- 非显式关联的其他世界资料被隔离；单条正文和整体上下文均有限额，最多接收 500 个本地候选条目并在约 60000 字符预算内选择。
- 上下文被标记为不可信数据，模型不得执行资料正文中出现的指令。
- Responses API 与 Chat Completions 均优先使用原生 JSON Schema；不兼容服务仅在 400/404/422 时降级为 JSON 指令模式。
- 返回值经过服务端二次校验；格式、字段、候选数量或关联 ID 错误时最多发起一次修复请求，修复后仍失败则不向前端交付候选。
- 前端允许生成 2–5 份方案，逐份展示摘要、正文、约束、开放问题、冲突、假设和建议关联。
- 生成阶段不写 `localStorage`；用户可多选、单选或不选，只有点击保存时才为所选方案分配新 ID 并分别保存为 `proposed`。

验证：`node:test` 的 4 个 harness 测试覆盖上下文优先级与跨世界隔离、动态候选数量、非法引用拒绝、代码围栏解析及两类 API 的原生 Schema 请求；全部通过。`server.mjs`、`ai-harness.mjs` 与 `dist/app.js` 语法检查通过，108 个 HTML ID 唯一且脚本引用存在；Docker 镜像构建成功，交付首页返回 HTTP 200，容器状态为 `healthy`。未配置真实 Key，因此没有声称完成外部模型端到端调用。

## 15. 2026-10-12 Tailscale 子路径交付归档

本次修改不涉及世界观、正史、卡牌语义或公开内容数据接口，只调整部署路径兼容与本机交付：

- `dist/app.js` 新增 `API_ROOT` 与 `apiUrl(path)`，根据脚本自身地址生成设置和 AI API URL，消除写死的根路径 `/api/...`。
- `openSettings()`、`saveSettings()`、`refreshAiStatus()` 与 `runAi()` 全部改用子路径感知的 API URL。
- `dist/index.html` 将脚本版本查询参数更新为 `v=9`，避免浏览器继续使用不支持子路径的缓存脚本。
- `dist/index.html` 在加载相对资源前将无扩展名、无尾斜杠的挂载地址规范化为带 `/` 的地址；`/worldforge` 因此会进入 `/worldforge/`，而 `/` 与直接打开 `index.html` 保持不变。
- 新增 `tests/subpath-routing.test.mjs`，检查所有浏览器 API 请求均通过 `apiUrl()`，并禁止重新引入 `fetch('/api/...')`。
- `tests/README.md` 增加现有两组测试的职责说明。
- 本机 Tailscale Serve 新增 `/worldforge` 到 `http://127.0.0.1:4173` 的代理，保留原有 `/`、`/dsh`、`/agent`、`/calendar` 与 `/calendar.ics` 路由。
- Docker 端口继续只绑定本机回环地址；Tailscale 路由为 tailnet-only，没有启用 Funnel。

运行入口：<https://sisi-laptop.tail921448.ts.net/worldforge/>。

验证：`npm run check` 的语法检查和 6 项 Node 测试全部通过；Docker 镜像重新构建后容器进入 `healthy`；tailnet HTTPS 首页、静态资源与 `/worldforge/api/ai/status` 均返回 HTTP 200。未向外部模型发起生成请求。

## 16. 2026-10-13 SQLite 内容持久化归档

本次修改由作者明确要求，并由 [ADR-0004](../adr/ADR-0004-sqlite-content-persistence.md) 记录。它不改变世界观、正史层级、卡牌语义或作者审核边界。

### 存储与服务端

- 新增 `storage.mjs`，使用 Node 22 的 `node:sqlite` 创建 Schema 版本 1。
- `lore_entries`、`card_drafts`、`keywords` 和 `notes` 分表保存；常用筛选字段独立成列，完整条目同时保存为受 `json_valid` 约束的 JSON。
- 启用 WAL、`synchronous=NORMAL`、严格表与常用索引；一次内容保存由 `BEGIN IMMEDIATE` 事务整体提交或回滚。
- `metadata` 保存初始化状态、递增 revision 与最后更新时间；客户端写入旧 revision 时返回 HTTP 409，不静默覆盖。
- `validateContentSnapshot()` 限制每类最多 10000 项、备注最多 200 项，检查稳定 ID、重复 ID、备注类型与长度。
- 本机默认数据库为 `.data/worldforge.sqlite`；Compose 显式设置 `/data/worldforge.sqlite`，沿用 `worldforge-data` 持久化卷。
- Docker 镜像新增 `storage.mjs`，健康检查由 AI 状态改为 `/api/health` 的 SQLite `quick_check`。
- Node.js 最低版本由 20 提升为 22.5；没有新增 npm 依赖。

### HTTP 接口

- `GET /api/health`：返回服务状态、SQLite `quick_check`、数据库路径和 Schema 版本。
- `GET /api/content`：返回初始化状态、revision、更新时间及四类完整内容。
- `PUT /api/content`：要求 JSON 与 `X-Worldforge-Content: 1`，校验后事务替换完整快照；revision 不匹配时返回 409。
- 内容接口不返回 API Key，也不开放跨域；Tailscale 部署继续使用 `/worldforge/api/...` 子路径。

### 浏览器同步与迁移

- `hydrateContent()` 在界面渲染前读取 SQLite，并将结果写入当前 Origin 的 `localStorage` 缓存。
- `writeStore()` 对内容键继续立即写缓存，同时以 160ms 防抖调用 `persistContent()` 保存数据库。
- 数据库未初始化时，首个包含旧内容的浏览器自动迁移；空浏览器不会抢先初始化数据库。
- 数据库已经存在而新 Origin 仍有旧内容时，设定、卡牌和关键词按稳定 ID 合并，备注按键合并；同 ID 以正在迁移的浏览器版本为准。
- 合并前的浏览器快照保存在 `worldforge-pre-sqlite-backup-v1`，迁移完成标记为 `worldforge-sqlite-migrated-v1`。
- 顶栏显示“正在连接 SQLite”“SQLite 已连接/已保存”“保存失败”或“存在版本冲突”。服务不可用时继续显示浏览器缓存，但明确标记为离线。
- JSON 导出升级到 schemaVersion 3，文件名统一为 `worldforge-data.json`；编辑偏好仍不进入 SQLite 或导出。

### 修改文件

- 新增：`storage.mjs`、`tests/storage.test.mjs`、`docs/adr/ADR-0004-sqlite-content-persistence.md`。
- 修改：`server.mjs`、`Dockerfile`、`compose.yaml`、`package.json`、`.gitignore`。
- 修改：`dist/app.js`、`dist/index.html`、`dist/styles.css`。
- 更新：`README.md`、`CHANGELOG.md`、`todo.md`、`tests/README.md`、ADR 索引与本静态文档。

### 验证与限制

- `npm run check` 的语法检查和 8 项 Node 测试全部通过；SQLite 测试覆盖结构化内容往返、健康检查、重复 ID 拒绝与过期 revision 拒绝。
- 使用独立测试容器和临时内存数据库验证 HTTP 内容写入、读取与过期 revision 返回 409；测试容器随后已删除，未接触生产卷。
- `docker compose config` 解析通过；镜像重建后容器状态为 `healthy`。
- 本机与 Tailscale 的 `/api/health` 均确认数据库 `ok: true`、路径 `/data/worldforge.sqlite`、Schema 版本 1。
- 持久化卷内已创建 SQLite 主文件、WAL 与共享内存文件；只读检查确认生产数据库仍为 `initialized: false / revision: 0`，没有写入测试数据。
- 当前没有实时多人协作、自动 Git 正史同步、定时数据库备份或恢复 UI；这些项目已列入 TODO，不能宣称已经完成。

## 13. 2026-10-12 全局设置栏归档

- 顶栏新增“设置”，分为 AI 服务、编辑偏好和数据管理。
- AI 服务可编辑 API Key、Base URL、模型和 Responses / Chat Completions 类型，也可显式清除已保存 Key。
- 服务端新增 `GET/POST /api/settings`；写请求要求 JSON 和 `X-Worldforge-Settings: 1`，不开放跨域，也不回传 Key。
- 本机运行写入 `.env.local`；Docker 写入 `worldforge-data` 卷，并在当前进程立即生效。
- 编辑偏好支持浅色、深色、跟随系统、舒适/紧凑密度，以及新资料默认世界、状态和事实层次。
- 数据管理显示本地设定、卡牌、关键词数量，并复用完整 JSON 导出。
- Compose 继续使用只读根文件系统，仅 `/data` 持久化卷和 `/tmp` 可写。

验证：Node 语法、106 个唯一 DOM ID 与脚本引用、Compose 配置均通过；使用隔离文件验证配置保存与即时状态更新；使用虚拟 Key 验证 Docker 重启持久化并在测试后清除。未向外部模型发起测试请求。

## 12. 2026-10-12 设定编辑器与 AI 接入归档

- 原只读世界观面板升级为 12 类结构化资料库；新资料始终默认 `proposed`，宗教资料默认使用 `in_world_belief`。
- W01 现有基线作为不可删除的种子条目显示，编辑后保存会形成浏览器本地副本，不直接改仓库正史。
- 地图与地点具有区域类型、坐标、环境交通字段；其他类型分别显示三项常用专业属性。
- 条目支持约束、开放问题、标签与跨类型引用；删除草案时同步移除悬空引用。
- 新增服务端 AI 代理，Key 只从 `.env.local` / 进程环境读取；浏览器只获得是否已配置、模型名和输出文本。
- AI 系统提示强制区分事实层次、把新增内容保持为候选，并规避第三方 IP 复制。
- Docker 镜像改用 Node 22 Alpine；Compose 可选加载 `.env.local`，仍为只读容器和本机端口。

验证：`dist/app.js` 与 `server.mjs` 通过 Node 语法检查；86 个 HTML ID 唯一且脚本引用存在；Compose 配置解析与 Docker 镜像构建通过；在含中文的 Windows 路径上验证 `/api/ai/status` 返回未配置状态，首页返回 HTTP 200；交付容器为 `healthy`。真实浏览器自动化因工具无法可靠确认当前 Edge URL 而中止，未声称完成视觉验收。

## 5. 边界与验证

- 页面不依赖构建工具；可直接打开 `dist/index.html`。
- 界面只使用系统字体，不依赖外部字体或图片资源。
- 完整模式下，草案保存在 SQLite，清理浏览器数据不会删除数据库内容；直接打开 HTML 时只能使用当前浏览器缓存。
- 页面不读取或写入仓库内容；当前支持跨地址共享，不提供多人实时协作。
- 支持窄屏布局、键盘可达的按钮与对话框、减少动态效果偏好。

## 6. 2026-10-11 初始化归档

本次修改完成 M0 与 HTML 产品首版，变更范围如下：

- 产品：新增 `dist/index.html`、`dist/styles.css`、`dist/app.js`，包含响应式展示、状态筛选、裁定对话框、本地存储、JSON 导出与主题切换。
- 托管：新增 `.openai/hosting.json`，静态目录指向 `dist`；站点项目 ID 已持久化，但源码同步与部署需要作者明确授权。
- 宇宙：新增 `UNI-001` 至 `UNI-003` 的 `proposed`/`unknown` 占位条目及开放问题索引，没有建立宇宙正史。
- 世界：新增 W01 概述、物理、技术、社会、宗教、时间线及势力、角色、地点、事件索引；只确认项目文档已有的魔导工业方向。
- 机制与卡牌：新增待定规则文档、关键词索引、卡牌索引与最小 JSON Schema；没有生成正式卡池或宣称平衡结果。
- 模板：新增 lore、势力、角色、事件、关键词、卡牌与 ADR 模板。
- 项目管理：新增 `CHANGELOG.md`、`todo.md`、编辑风格、正史政策、ADR 索引以及 scripts/exports/tests 说明。
- 入口说明：更新 `README.md`，增加 HTML 产品的直接使用方式。

检查记录：HTML 已通过标准库解析；`dist/app.js` 已通过 Node 语法检查；新增文件已完成静态内容复核。由于隔离浏览器无法访问本机预览端口，尚未完成真实浏览器视觉 QA。

## 7. 2026-10-11 Docker 本地交付归档

本次修改未改变任何世界观、机制或卡牌语义，只增加本地运行能力：

- 新增 `Dockerfile`，使用 Nginx 提供 `dist/` 静态内容，容器端口为 `8080`。
- 新增 `compose.yaml`，将服务限制在 `127.0.0.1:4173`，配置 `unless-stopped`、只读根文件系统、临时写目录与 `no-new-privileges`。
- 新增 `docker/nginx.conf`，提供单页回退、gzip、静态缓存与基础安全响应头。
- 新增 `.dockerignore`，确保镜像不包含 `.git`、`.openai`、设计源文档、模板和测试目录。
- 更新 `README.md`、`CHANGELOG.md` 与 `todo.md`，记录启动、停止和完成状态。

### 运行接口

- 启动：`docker compose up -d --build`
- 访问：`http://127.0.0.1:4173`
- 停止：`docker compose down`
- 容器名：`worldforge`
- 镜像名：`worldforge:local`

### 运行约束

- `4173` 仅绑定本机回环地址，不对局域网公开。
- 浏览器草案仍保存在访问该地址的浏览器 `localStorage` 中。
- 容器重新创建不会清除浏览器本地草案。
- Docker 镜像不包含内容仓库的 Markdown/YAML 源文件。

### 验证记录

- `docker compose config` 解析通过。
- 镜像 `worldforge:local` 构建成功，容器 `worldforge` 状态为 `running / healthy`。
- `http://127.0.0.1:4173/` 返回 `HTTP 200` 与 `text/html; charset=utf-8`。
- 真实浏览器已验证首屏渲染、内容状态筛选、草案对话框、本地保存与计数更新；测试草案随后已清空。
- 初始版本页面标题与资源加载已通过浏览器验证。

## 8. 2026-10-11 双模块简约界面归档

本次根据作者反馈重构产品界面，不改变设定文件、规则或卡牌正史：

- 保留 `Worldforge` 作为产品名，不增加功能层面的主题化别名。
- 移除口号、锻造隐喻、巨幅标题、轨道图形、深色叙事区块与装饰性动效。
- 顶部导航固定为“世界观架构”和“卡牌设计”两个产品模块。
- 世界观模块新增目录、项目统计、基础设定列表、搜索、未决问题和本地备注。
- 卡牌模块新增规则准备度、卡牌字段说明、草案列表、搜索和本地草案表单。
- 卡牌草案固定标记为 `proposed / untested`；基础规则未确认时不生成正式卡池。
- 视觉改为中性色背景、白色面板、细边框、蓝色主操作和系统字体，优先保证信息层级与可读性。
- 为 CSS 与 JavaScript 入口增加版本查询参数，避免 Docker 重建后浏览器继续使用旧资源缓存。
- 卡牌草案对话框的关闭与取消操作跳过必填校验，保证空白表单可以直接退出。
- 保留 Docker 本地交付方式和 `127.0.0.1:4173` 端口，不执行 Sites 上传。
- 已在桌面与窄屏浏览器验证两个模块切换、备注入口、卡牌表单打开与空白取消；控制台未发现警告或错误。

## 9. 2026-10-11 卡面编辑与关键词系统归档

本次修改依据作者明确确认的卡牌基础信息要求，并由 `ADR-0001` 记录边界：

- 卡面左上角为可编辑费用，左下角为可编辑攻击，右下角为可编辑血量。
- 卡面中下部为可编辑描述，名称也可在卡面顶部直接修改。
- 关键词可通过独立对话框定义名称和规则说明，创建后自动加入当前卡牌。
- 点击关键词列表可切换当前卡牌引用；已选关键词显示在卡牌描述区域。
- 保存后的卡牌以相同的数值位置和描述结构显示在预览列表，点击可重新编辑。
- 旧版浏览器草案会自动补齐攻击 0、血量 1 和空关键词列表。
- JSON 导出新增 `keywords`，卡牌草案新增 `attack`、`health` 与 `keywordIds`。
- 卡牌 Schema 与模板同步要求 `stats.attack`、`stats.health`、`keywords` 和 `rules_text`。
- UI 采用 Worldforge 原创的简约卡面，不复制第三方卡框、图标、美术或现成关键词。
- CSS 与 JavaScript 资源版本均更新为 `v=3`，避免 Docker 重建后沿用旧卡牌样式缓存。
- 窄屏卡面宽度受容器约束；在侧栏级视口中仍保持费用、攻击、血量和描述的卡面布局。

### 验证记录

- `dist/app.js` 通过 Node 语法检查；HTML 与卡牌 JSON Schema 解析通过。
- 在隔离的 `localhost:4173` 浏览器源中创建“连锁”测试关键词并保存测试卡牌，确认费用 `3`、攻击 `4`、血量 `5`、描述和关键词均持久化到同布局预览。
- 交付地址 `127.0.0.1:4173` 仅测试未保存的直接编辑和关键词对话框，随后已恢复空白编辑器，未写入验收数据。
- 真实窄屏浏览器复核了新版样式和响应式卡面；隔离验收页已关闭。

## 10. 2026-10-11 关键词附加说明归档

本次修改由作者明确确认，并由 `ADR-0002` 记录：

- 关键词定义继续保存名称和通用规则说明。
- 选择关键词后，卡牌编辑区提供可选的“附加说明”输入框。
- 未填写附加说明时，卡面只显示关键词名称。
- 填写后，编辑卡面和已保存卡牌统一显示为“关键词：附加说明”。
- 卡牌草案使用 `keywordUsages` 保存关键词 ID 与卡牌级 `detail`；旧版 `keywordIds` 自动迁移为空说明。
- 搜索会同时匹配关键词名称和附加说明。
- 卡牌 YAML 模板、JSON Schema、机制词典、ADR 索引、README、CHANGELOG 与 TODO 已同步。
- CSS 与 JavaScript 资源版本更新为 `v=4`，本地 Docker 重建后不会沿用旧缓存。

### 验证记录

- `dist/app.js` 通过 Node 语法检查；HTML 与卡牌 JSON Schema 解析通过。
- 在隔离的 `localhost:4173` 浏览器源中载入旧版测试卡，确认原关键词可无说明显示。
- 为该关键词填写卡牌级说明并保存，确认编辑卡面、右侧输入框和保存预览均显示完整的“关键词：附加说明”。
- 验收使用的隔离标签页已关闭；交付地址 `127.0.0.1:4173` 未写入测试数据。

## 11. 2026-10-11 W01 V0.1 导入归档

本次根据作者提供的《W01 魔导工业世界设定集 V0.1》导入世界设定，并由 `ADR-0003` 记录状态升级：

- 原稿“已确定”映射为 `canon`，“推导 / 提案”映射为 `proposed`，“待定”映射为 `unknown`。
- 重写 `overview.md`、`physics.md`、`technology.md`、`society.md`、`religions.md` 与 `timeline.md`，新增 `magic.md`。
- 导入以太与魔力、蕴魔矿、蓄魔矿与蓄魔器、四级法师序列、十一魔法派系、施法信息结构、魔导器组件、能源经济和技术史。
- 保留魔法天赋来源、人工逆向转换、效果字段边界、产业细节和神性秩序为 `unknown`。
- 世界观页面将 W01 状态更新为 `canon`，展示六组核心设定和传统法师 / 魔导器两条执行路径。
- 世界观统计更新为 7 组正史基线、12 项未决问题；右栏显示其中 5 项重点问题。
- 本地备注键保持不变以兼容浏览器数据，但标题和提示语更新为 V0.1 的重点未决问题。
- CSS 与 JavaScript 资源版本更新为 `v=5`，新增 `canon` 状态样式和施法路径摘要布局。

### 冲突处理

- 旧版 W01 文档将以太、术式和魔导回路整体标为 `proposed`；作者提供的新稿明确区分已确定与待定，因此按新稿和 ADR-0003 更新，不保留旧的整体待定表述。
- 神性内容没有升级为正史；宗教观点继续与客观事实分离。
- 没有新增势力、角色、地点、正式事件或卡牌，也没有把推导内容提升为正史。

### 验证记录

- `dist/app.js` 通过 Node 语法检查，`dist/index.html` 通过 HTML 解析。
- 真实窄屏浏览器确认 W01 的 canon 状态、六组核心设定、两条施法路径与五项重点未决问题正常呈现。
- 世界观搜索使用“蓄魔”验证，非匹配条目正确隐藏，清空搜索后恢复。
- Docker Compose 配置解析通过；容器状态为 `running / healthy`。
- `http://127.0.0.1:4173/` 返回 `HTTP 200`，服务内容包含 W01 V0.1 与 `v=5` 资源入口。

## 12. 2026-10-13 双通道卡面生成归档

本次修改不改变世界观 canon、基础对战规则或既有卡牌语义。作者明确选择火山方舟 Seedream，并要求同时支持本地 ComfyUI 与生成前语言模型提示词优化。

### 服务端接口

- `GET /api/images/status`：返回 Seedream 密钥与 ComfyUI 工作流的配置状态，不返回密钥。
- `POST /api/images/optimize-prompt`：使用现有 LLM Responses / Chat Completions 配置优化卡面提示词，只返回文本供作者确认。
- `POST /api/images/generate`：按 `provider` 分派到 `seedream` 或 `comfyui`，请求必须带 `X-Worldforge-Image: 1`。
- `GET /api/art-assets`：列出 SQLite 中的卡面候选元数据。
- `GET /api/art-assets/:id/file`：从持久卷读取候选图片，并按记录的 MIME 类型返回。

### `seedream.mjs`

- `validateSeedreamSettings(payload)`：限制火山方舟中国区 API v3 地址、Seedream 模型 ID 与密钥格式。
- `validateImageRequest(payload)`：校验提示词、尺寸和卡牌 ID；支持 `2K`、`1872x1248` 与 `1248x1872`。
- `buildSeedreamBody(config, request)`：按作者提供的格式生成 `response_format: url`、`stream: false`、`watermark: true` 请求体。
- `generateSeedreamImage(config, payload, fetchImpl)`：调用 `/images/generations`，立即下载临时 URL，并限制图片为 30 MB。

### `comfyui.mjs`

- `validateComfyUiSettings(payload)`：校验 HTTP(S) 地址、API Format JSON 和必需的 `{{PROMPT}}` 占位符。
- `fillComfyWorkflow(template, request)`：深拷贝工作流并替换 `{{PROMPT}}`、`{{NEGATIVE_PROMPT}}`、`{{WIDTH}}`、`{{HEIGHT}}`、`{{SEED}}`；数值占位符保持数值类型。
- `generateComfyUiImage(config, template, request, fetchImpl, waitImpl)`：调用 `/prompt` 入队，轮询 `/history/{prompt_id}`，从首个图片输出构造 `/view` 请求并下载文件。

### 持久化与前端

- SQLite schema 升级为 2，新增 `art_assets` 表；图片本体位于 `/data/assets/cards`，ComfyUI 工作流位于 `/data/comfyui-workflow.json`。
- 卡牌草案新增可选 `artAssetId`，YAML 模板 / Schema 对应 `art_asset_id`。
- 设置页新增“图像生成”分区，分别配置 Seedream 和 ComfyUI；Docker 内本地 ComfyUI 默认地址为 `http://host.docker.internal:8188`。
- 卡牌编辑器可填写或由语言模型优化提示词、选择生成通道与尺寸、生成一张候选图、在候选间切换并保存卡牌绑定。
- 生成图记录 `provider`、模型、尺寸、提示词、MIME 与 provider 元数据，固定为 `proposed / ai_generated`，不会自动晋升正史。
- 完整 JSON 导出升级到 schemaVersion 4，包含美术资产元数据但不嵌入图片二进制或 API Key。

### 检查与未验证项

- 单元测试使用 mock 覆盖 Seedream 请求/下载与 ComfyUI 入队/轮询/下载，不产生付费调用。
- `npm run check` 通过 13/13 项；HTML 的 128 个 `id` 无重复。
- Docker 镜像重建并复用原 `worldforge-data` 卷；`GET /api/health` 返回数据库 `ok` 且 schemaVersion 为 2。
- 本机与 Tailscale `/worldforge/` 均返回新版界面；设置接口不返回 Seedream 密钥字段。
- 在未配置状态下分别提交 Seedream 与 ComfyUI 生成请求，两者均在外部调用前按预期拒绝，没有产生图片或费用。
- 未调用真实 Seedream API；需要作者在设置页提供自己的密钥后才能生成。
- 未假定或验证作者本地 ComfyUI 的 checkpoint、自定义节点或工作流；必须粘贴已经能在本机运行且包含输出图片节点的 API Format JSON。
- 后续事项已记录到 `todo.md`：资产删除/重新绑定、参考图/图生图、ComfyUI 队列进度与中断。

## 17. 2026-10-13 背景故事与渐进式世界构建归档

本次修改由作者明确要求，并由 [ADR-0006](../adr/ADR-0006-background-stories.md) 记录。它新增叙事资料能力，但没有创建故事内容、改变世界观 canon 或把叙事自动视为客观事实。

### 数据与语义

- 资料类型由 12 类扩展为 13 类，新增 `story`；稳定 ID 约定为 `STORY-W##-####`，界面本地草案使用 `STORY-W01-DRAFT-*`。
- 背景故事是独立文本，创作内容仅包含标题与正文，不提供摘要、约束、开放问题、标签、类型属性或可编辑状态；ID、世界、固定状态和 `relationIds` 只用于内部管理。
- 一个普通条目可被多篇故事引用；一篇故事可引用多个普通条目和其他故事。普通条目的“挂载故事”由故事的反向引用计算，故事的“相关故事”同时识别正向和反向显式关系。
- 手工故事与 AI 故事内部固定为 `proposed / unknown`，界面不显示这些技术字段。故事叙述不会自动晋升为 `objective canon`。
- 继续复用 SQLite `lore_entries`，不升级数据库物理 Schema，现有数据库无需迁移；完整 JSON 导出升级到 schemaVersion 5。

### 前端函数与交互

- `LORE_TYPES` 保留“背景故事”用于分类与 ID 分配，但故事编辑器只显示标题、正文和关联。
- `renderAttachedStories(id)` 在资料编辑器底部展示当前人物、地点等条目的挂载故事；打开故事时展示显式相关故事。
- `createAttachedStory()` 从当前已保存条目建立新故事，自动预选当前条目为关联；未保存条目不会产生悬空挂载。
- AI 协助方式新增 `background_story`。`runAi()` 要求锚点条目已经保存，并锁定生成时的动作、锚点 ID 与表单快照；候选区只显示标题与正文，`saveAiSelections()` 也只保存故事文本和原始锚点关系。
- 设置页分别统计普通设定与背景故事；背景故事仍包含在统一资料缓存、SQLite 快照、搜索和导出中。

### AI 提示边界

- `buildPrompt()` 对背景故事要求从传记、轶事或局部事件切入，直接写具体行动、场景与因果，而不是百科式改写；Schema 中的分析数组必须为空。
- 模型返回仍使用原有严格候选 Schema；新增故事只在作者勾选并保存后落盘。
- 自动测试只验证提示边界和结构，没有调用真实模型或评价故事文学质量。

### 修改文件

- 修改：`dist/index.html`、`dist/styles.css`、`dist/app.js`、`ai-harness.mjs`。
- 修改：`tests/ai-harness.test.mjs`、`tests/storage.test.mjs`、`tests/subpath-routing.test.mjs`、`tests/README.md`。
- 新增：`templates/story.md`、`docs/adr/ADR-0006-background-stories.md`。
- 更新：`README.md`、`docs/PROJECT_DESIGN.md`、`docs/adr/README.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 的语法检查和 14 项 Node 测试全部通过；新增测试覆盖背景故事提示边界与故事关联的 SQLite 往返。
- HTML 唯一 ID、脚本引用和故事交互所需元素已做静态检查。
- Docker 镜像已重新构建为 `worldforge:local`，现有 `worldforge-data` 持久卷保持挂载；容器重建后状态为 `healthy`。
- 本机 `/api/health` 返回数据库 `ok: true`、Schema 版本 2；本机 `127.0.0.1:4173` 与 tailnet `/worldforge/` 页面均确认包含纯文本背景故事表单并加载 `app.js?v=13`。
- 当前未调用真实语言模型，也未向生产数据库写入验收故事。
- 尚未实现关系类型、章节排序、版本分支、长篇章节管理或故事专用时间线视图；这些扩展已记录在 TODO。

### 2026-10-13 纯文本故事修订

- 根据作者反馈，故事不再沿用普通设定表单；编辑界面只保留标题、正文和关联人物/地点/故事。
- 故事列表与挂载列表移除状态、事实层次、ID 和摘要展示，改为正文片段。
- `normalizeLore()` 对故事强制清空 `summary`、`constraints`、`openQuestions`、`tags` 与类型属性；`readLore()`、统一内容快照和 JSON 导出都会经过该规范化，旧故事在下一次任意内容保存时写回精简结构。
- AI 故事候选不展示或保存约束、开放问题、冲突、假设、摘要和建议关联，只保存作者选择的故事文本并挂载原始锚点。
- Docker 镜像已再次重建；容器为 `healthy`，本机与 tailnet 页面均确认加载 `app.js?v=13` 和精简故事表单，现有持久卷未删除。

## 18. 2026-10-13 世界地图层级框架归档

本次修改由作者明确要求。它改变运行时地理资料的组织方式和导出结构，但没有新增国家、城市或地点内容，也没有修改世界观 canon。地图图像与边界绘制不在本次范围内。

### 数据模型与兼容

- `location.kind` 扩展并规范为 `country / region / area / city / site / route`，分别对应国家、地区、区域、城市、地点与路线/通道。
- `location.parentId` 保存稳定父级 ID。国家直接属于 `worldId`；地区必须属于国家；区域可属于国家或地区；城市、地点和路线可挂载到同世界中的合法上级，但始终沿祖先链显示在国家内部。
- 保存时拒绝缺少合法父级或跨世界挂载；若修改层级或世界会使已有子级失去有效归属，同样停止保存。删除仍有子级的条目时也会停止操作，避免新建悬空层级。
- 旧地点没有有效 `parentId` 时不自动猜测归属，而是进入“待整理的旧地点”；作者打开条目并选择父级后即可归位。
- SQLite 继续保存完整 lore JSON，无需升级物理 Schema；完整 JSON 导出升级到 schemaVersion 6。

### 地理树与入口

- 原“地图与地点”分类更名为“世界地图”，左侧列表改为按世界分组的嵌套地理树。
- 世界构成是可视根节点，根节点下只显示国家；地区、区域、城市与地点只显示在所属上级内部，不再与国家一级平铺。
- 每个节点提供默认的下一级创建入口：国家 → 地区 → 区域 → 城市 → 地点。编辑器中的父级选择仍允许省略不适用的中间行政层，但城市和地点必须位于某个国家的祖先树中。
- 地理搜索命中子级时同时保留祖先路径，使结果仍能表达该城市或地点属于哪个国家。
- “AI 生成国家框架”会建立国家级草稿并预填作者要求，随后复用现有 2–5 个候选、作者勾选后保存的审核流程；它不会自动创建正史或一次写入完整世界。
- 当前地图坐标仍为可选文本数据，没有实现地图画布、边界几何、拖拽定位或地形生成。

### 静态地理函数

- `WorldforgeGeography.normalizeKind(kind)`：将旧值规范到受支持地理层级。
- `WorldforgeGeography.allowedParentKinds(kind)` / `canParent(parent, childKind, worldId)`：返回允许父级并验证类型、世界和父子关系。
- `WorldforgeGeography.buildTree(entries, query)`：构造国家根节点、子级索引、待整理条目和搜索可见 ID；匹配子级时向上补齐祖先。
- `populateLocationParents(selected)`：将纯规则映射到当前编辑表单，排除自身、跨世界条目和不允许的父级类型。
- `renderGeographyTree(all, query)`：按世界创建地理树及旧数据待整理区域。
- `beginGeographyEntry(kind, parentId, worldId)`：从世界或父节点建立预填子级草案。
- `prepareGeographyFramework()`：建立国家草案并准备国家级 AI 框架提示。

### 修改文件

- 新增：`dist/geography.js`、`tests/geography.test.mjs`。
- 修改：`dist/index.html`、`dist/styles.css`、`dist/app.js`、`package.json`。
- 修改：`tests/subpath-routing.test.mjs`、`tests/README.md`。
- 更新：`README.md`、`docs/PROJECT_DESIGN.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 的语法检查和 16 项 Node 测试全部通过。
- 地理测试覆盖完整国家到地点路径、子级搜索时保留祖先、无效父级隔离和跨世界父级拒绝。
- HTML 的 78 个 ID 已检查为唯一；新脚本由 `dist/index.html` 在主应用之前加载。
- Docker 镜像已重建并复用现有 `worldforge-data` 卷；容器为 `healthy`，`GET /api/health` 返回数据库 `ok: true`、Schema 版本 2。
- 本机 `127.0.0.1:4173` 与 tailnet `/worldforge/` 均已加载 `geography.js?v=1` 和 `app.js?v=14`；真实浏览器验收确认世界构成、建立国家、AI 生成国家框架、旧地点待整理区和父级表单可见，控制台无警告或错误。
- 本次没有调用真实语言模型，没有生成地理内容，也没有修改生产 SQLite 数据；现有两个旧地点只读显示在待整理区。
- 可视化地图画布仍在 TODO；后续画布必须复用 `location.parentId` 地理树，不能建立与资料库分离的第二套地点数据。

## 19. 2026-10-13 可编辑提示词工程归档

本次修改由作者明确要求。它只改变 AI 请求的提示词配置与示例选择，不创建世界观内容、不修改 canon，也不触碰卡牌规则。卡牌—世界观联动、卡牌稀有度和随从/法术/装备类型已追加到 TODO，本次没有提前实现。

### 提示词分层

- 固定 `SYSTEM_INSTRUCTIONS` 继续负责原创性、canon 不可静默覆盖、事实层次、能量边界和 JSON Schema 等不可被设置替换的项目规则。
- `prompt-settings.mjs` 为世界、世界地图、势力、角色、种族、文化、宗教、魔法、科技、物品、事件、时间线和背景故事提供 13 份默认类型提示词。
- 设置页新增“提示词工程”分区。作者可在分类间切换并精调提示词、恢复当前分类默认值，以及维护应用于全部生成的统一个性化提示词。
- 分类提示和个性化提示各自最多 8000 字符；服务端拒绝未知类型和超长设置。浏览器切换分类时先缓存当前未保存编辑，最终由“保存设置”统一提交。
- 配置原子写入 `prompt-settings.json`。本机默认与 `.env.local` 同目录；Docker 默认进入 `/data` 持久卷。提示词不进入 SQLite 内容、浏览器存储或 JSON 内容导出。

### 示例层

- `buildContextBundle()` 从请求资料库前 500 个候选中筛选与当前草稿同世界、同类型且为 `canon` 的条目，按 ID 稳定排序，最多纳入 4 条并受 16000 字符示例预算限制。
- 被选为示例的条目从普通相关上下文中移除，避免同一内容重复拼接；其他条目继续使用原相关度和总上下文预算。
- 生成面板新增“本次补充示例”，最多 6000 字符，只发送给本次 AI 请求，不保存到提示词设置或资料库。
- 最终请求按任务与作者要求、`author_type_prompt`、`author_personalized_style`、`worldforge_examples`、`worldforge_context` 分层排列；自动示例和临时示例不会绕过固定系统边界。
- 返回的 `contextMeta` 新增 `exampleIds` 与 `omittedExampleCount`，候选面板分别显示自动示例和其他上下文数量。

### HTTP 与界面

- `GET /api/settings` 返回当前 `promptSettings` 及只用于恢复默认值的 `promptDefaults`，不返回 API Key。
- `POST /api/settings` 接受完整 `promptSettings`，在原 AI、Seedream 与 ComfyUI 设置保存成功时同步原子写入提示词文件。
- `callAi()` 每次请求都从服务端读取最新提示词设置，根据 `draft.type` 选择分类提示，避免由浏览器伪造持久配置。
- AI 生成面板会根据当前条目类型、世界和状态实时说明可用 canon 示例数量；更改所属世界时立即刷新。

### 修改文件

- 新增：`prompt-settings.mjs`、`tests/prompt-settings.test.mjs`。
- 修改：`server.mjs`、`ai-harness.mjs`、`Dockerfile`、`package.json`。
- 修改：`dist/index.html`、`dist/styles.css`、`dist/app.js`。
- 修改：`tests/ai-harness.test.mjs`、`tests/subpath-routing.test.mjs`、`tests/README.md`。
- 更新：`README.md`、`docs/PROJECT_DESIGN.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 的语法检查和 20 项 Node 测试全部通过，覆盖提示词分类默认值、个性化微调、非法分类/长度拒绝、canon 示例筛选及完整分层提示组合。
- HTML 的 80 个 ID 已检查为唯一；浏览器验收确认“提示词工程”设置分区可见、13 个分类可切换并载入各自提示词、“本次补充示例”可见，控制台无警告或错误。
- Docker 镜像已重建并复用现有 `worldforge-data` 卷；容器为 `healthy`，`GET /api/health` 返回数据库 `ok: true`、Schema 版本 2。
- 生产式 `GET /api/settings` 已确认返回 13 个分类提示与默认值；使用原值进行的幂等 `POST /api/settings` 成功，并将配置写入 `/data/prompt-settings.json`，未清除已有 API Key。
- 没有调用真实语言模型或评价生成质量；示例层只验证选择与拼接规则。
- 自动示例目前使用确定性 ID 排序和预算截断，不是语义检索；后续渐进式检索 Agent 仍按 TODO 单独实现。

## 20. 2026-10-13 大陆层级归档

本次修改由作者明确要求。它扩展地理资料结构，不创建大陆或国家内容，不修改任何 canon。此前世界下直接建立的国家不会被自动归入某个大陆。

### 层级与兼容

- `location.kind` 新增 `continent`，完整层级为“世界构成 → 大陆 → 国家 → 地区 → 区域 → 城市 → 地点”。大陆是世界下唯一允许无 `parentId` 的地理条目。
- 国家现在必须以同世界大陆为父级；地区及更深层级继续遵守既有允许父级规则。`nextKinds` 增加“大陆 → 国家”的默认创建路径。
- 旧国家如果没有 `parentId`，会和其他缺少合法父级的旧资料一起进入“待整理的地理条目”，不会被自动猜测或静默迁移。选择大陆并保存后即可进入新树。
- 搜索命中深层地点时会保留城市、地区、国家和大陆的完整祖先路径。完整 JSON 导出升级到 schemaVersion 7；SQLite 物理 Schema 无需变化。

### 界面与生成入口

- 世界地图说明、快捷新建、世界根节点按钮和空状态统一改为从“大陆”开始；地理编辑器默认新建大陆。
- 地理层级选择新增“大陆”。编辑大陆时父级控件显示“直接属于当前世界”并禁用；编辑国家时只能选择同世界大陆。
- 大陆节点自动提供“＋国家”，国家节点继续提供“＋地区”，后续层级保持原有逐层创建方式。
- 原“AI 生成国家框架”调整为“AI 生成大陆框架”，候选提示聚焦大陆边界、地貌、气候带、资源、跨区域交通以及承载多个国家的能力。
- 地理分类默认提示同步加入大陆与国家归属要求；旧版原封未改的默认提示会自动迁移，自定义提示不会被新版默认值覆盖。提示词配置规范版本升至 2。

### 修改文件

- 修改：`dist/geography.js`、`dist/index.html`、`dist/app.js`、`prompt-settings.mjs`。
- 修改：`tests/geography.test.mjs`、`tests/subpath-routing.test.mjs`、`tests/README.md`。
- 更新：`README.md`、`docs/PROJECT_DESIGN.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 的语法检查和 20 项 Node 测试全部通过；地理测试覆盖大陆根节点、国家父级、完整祖先搜索、旧国家隔离与跨世界拒绝。
- HTML 的 80 个 ID 已检查为唯一；真实浏览器验收确认建立大陆、世界根节点“＋大陆”、大陆级 AI 框架、国家缺少大陆时的阻止提示及旧数据待整理区均可见，控制台无警告或错误。
- Docker 镜像已重建为 `worldforge:local` 并复用现有持久卷；容器为 `healthy`，`GET /api/health` 返回数据库 `ok: true`、Schema 版本 2。
- Docker 中的 `GET /api/settings` 曾确认旧版默认地理提示被升级为包含“大陆 → 国家”的新默认内容；后续编年史提示迁移将配置规范继续升至版本 3。
- 本次没有创建大陆资料、自动迁移旧国家、调用真实语言模型或修改现有 canon。

## 21. 2026-10-13 编年史结构归档

本次修改由作者明确要求。实现采用“保留原 `timeline` 类型、增加编年史容器与节点子结构”的方式，没有增加新的顶层资料类型，也没有修改现有世界观内容或 canon。

### 数据结构与兼容

- `timeline.chronicle.kind` 为 `chronicle` 或 `entry`；前者表示一部编年史容器，后者表示容器内的编年节点。
- 节点使用 `parentId` 指向同世界的编年史容器；`dateLabel` 保存展示用的虚构纪年文本，`order` 保存可为空、可为负数或小数的数值排序键。
- 旧时间线没有 `chronicle` 字段时规范化为 `chronicle` 容器，不拆分正文、不猜测节点日期，也不修改 canon。
- 转换仍含节点的容器或删除仍含节点的编年史会被阻止；缺少有效父级的节点进入“待整理的编年节点”。
- 完整 JSON 导出升级到 schemaVersion 8；SQLite 继续保存 lore JSON，无需升级物理 Schema。

### 界面与排序

- 顶层“时间线”标签改为“编年史”，编辑器新增“编年史 / 编年史节点”、所属编年史、纪年文本和排序值字段。
- 编年史列表按容器展示，每个容器提供“＋节点”；节点优先按数值 `order` 升序排列，缺少排序值时再按纪年文本或标题稳定排列。
- 纪年文本和排序值分离，允许显示“炉历 112 年”“第三潮汐纪末”等虚构纪年，同时保持可靠的先后顺序。
- 搜索节点时保留所属编年史；节点仍可通过普通关联字段连接人物、地点、势力、事件和故事。
- `timeline` 默认提示改为编年史写作要求；旧版未改动的默认提示自动迁移，自定义提示保持不变，提示词配置规范升至版本 3。

### 静态函数

- `WorldforgeChronicle.normalize(value, enabled)`：规范容器/节点、父级、纪年文本和排序值，并将旧时间线兼容为容器。
- `WorldforgeChronicle.canParent(parent, child, worldId)`：验证节点只能挂到同世界的编年史容器。
- `WorldforgeChronicle.sortEntries(entries)`：优先按数值排序键、再按纪年文本或标题排序。
- `WorldforgeChronicle.build(entries, query)`：建立容器、节点、待整理节点和搜索可见集合。
- `populateChronicleParents(selected)`：为节点生成同世界的合法编年史选项，并控制纪年字段启用状态。
- `beginChronicleEntry(kind, parentId, worldId)` / `renderChronicleTree(all, query)`：建立容器或节点草案，并渲染编年史树。

### 修改文件

- 新增：`dist/chronicle.js`、`tests/chronicle.test.mjs`。
- 修改：`dist/index.html`、`dist/styles.css`、`dist/app.js`、`prompt-settings.mjs`、`package.json`。
- 修改：`tests/prompt-settings.test.mjs`、`tests/subpath-routing.test.mjs`、`tests/README.md`。
- 更新：`README.md`、`docs/PROJECT_DESIGN.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 的语法检查和 22 项 Node 测试全部通过；新增测试覆盖节点分组、数值排序、祖先搜索、无效父级隔离、跨世界拒绝和旧提示迁移。
- HTML 的 87 个 ID 已检查为唯一；真实浏览器验收确认“编年史”标签、容器入口、节点类型切换、父级缺失提示、纪年文本与排序值启用状态均正确，控制台无警告或错误。
- Docker 镜像已重建并复用现有持久卷；容器为 `healthy`，健康接口返回数据库 `ok: true`、Schema 版本 2。
- Docker 中 `GET /api/settings` 已确认提示词配置规范为版本 3，旧默认时间线提示已迁移为编年史写作提示。
- 本次没有创建编年史内容、调用真实语言模型或修改现有 canon。

## 22. 2026-10-13 卡牌 TODO 实现归档

本次修改由作者明确要求，并由 [ADR-0007](../adr/ADR-0007-card-types-rarity-lore-linkage.md) 记录。它确认卡牌分类、稀有度枚举与设定来源联动，但没有生成任何正式卡牌，也没有确认基础对战流程。

### 数据结构与兼容

- 卡牌类型统一为 `minion / spell / equipment`，界面显示“随从 / 法术 / 装备”。旧 `unit / action / asset` 在读取、同步与导出时分别迁移为新类型，未知类型回落为随从。
- 卡牌新增 `rarity`，取值为 `common / rare / epic / legendary`，界面显示“普通 / 稀有 / 史诗 / 传说”；旧数据和非法值安全回落为普通。
- 卡牌新增去重后的 `loreRefs`；YAML 与 JSON Schema 对应 `lore_refs`，允许一张卡保留多个设定来源。
- 所属世界改为可编辑字段，卡牌草案 ID 使用该世界 ID。完整 JSON 导出升级到 schemaVersion 9；SQLite 保存完整卡牌 JSON，无需升级物理 Schema。

### 世界观联动与审核边界

- 已保存的角色、种族、势力、物品、科技、地点、魔法和事件显示“生成卡牌草案”入口。世界、文化、宗教、编年史与背景故事不显示直接入口，但仍可在卡牌编辑器中作为补充来源选择。
- 联动只预填名称、所属世界、建议类型和来源引用，不自动编写规则文本，不自动保存，也不改变来源设定状态。
- 默认映射为“角色 / 种族 / 势力 → 随从”“物品 / 科技 / 地点 → 装备”“魔法 / 事件 → 法术”；作者可在保存前修改。
- 保存卡牌后，右侧预览显示类型、稀有度及可读来源名称；搜索同时覆盖中英文类型、稀有度、来源 ID 与规则文本。
- 所有界面卡牌继续固定为 `proposed / untested`。法术和装备暂时保留攻击与血量字段，等待基础对战规则决定其最终语义。

### 静态函数

- `WorldforgeCards.normalizeType(value)` / `normalizeRarity(value)`：规范新枚举，并处理旧类型或非法稀有度。
- `WorldforgeCards.normalizeLoreRefs(value)`：清理空值并按首次出现顺序去重来源 ID。
- `WorldforgeCards.isCardableLore(entry)` / `defaultTypeForLore(entry)`：判断直接联动资格并给出可修改的默认卡牌类型。
- `WorldforgeCards.normalize(card)`：统一规范卡牌字段、旧关键词引用、来源引用与固定审核状态。
- `beginCardFromLore()`：从当前已保存设定建立未保存卡牌草案并切换到卡牌页。
- `populateCardLoreRefs(selected)`：列出设定库中的可引用来源并恢复多选状态。

### 修改文件

- 新增：`dist/cards.js`、`tests/cards.test.mjs`、`docs/adr/ADR-0007-card-types-rarity-lore-linkage.md`。
- 修改：`dist/index.html`、`dist/styles.css`、`dist/app.js`、`package.json`。
- 修改：`cards/schema/card.schema.json`、`templates/card.yaml`、`cards/README.md`、`mechanics/combat-rules.md`。
- 修改：`tests/subpath-routing.test.mjs`、`tests/README.md`。
- 更新：`README.md`、`docs/PROJECT_DESIGN.md`、`docs/adr/README.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 的语法检查和 25 项 Node 测试全部通过；新增测试覆盖三种旧类型迁移、稀有度回落、多来源去重、实体条目资格及默认类型映射。
- HTML 的 163 个 ID 已检查为唯一，卡牌 JSON Schema 可解析。真实浏览器验收确认人物条目显示联动入口，跳转后正确预填名称、世界、随从类型与来源；类型可改为装备、稀有度可改为传说、来源可同时选择人物与背景故事，控制台无警告或错误。验收未保存测试草案。
- Docker 镜像已重建为 `worldforge:local` 并复用现有 `worldforge-data` 卷；容器为 `healthy`，健康接口返回数据库 `ok: true`、Schema 版本 2。
- 本次尚未确认费用系统、回合时序、场位、构筑规则、稀有度概率，以及法术 / 装备的攻击和血量语义；因此没有生成正式卡池或宣称平衡完成。

## 23. 2026-10-13 项目进展与 2.0 设计校正归档

本次只修改项目管理与设计文档，没有修改 HTML 产品函数、运行时数据约定、世界观 canon、卡牌规则或外部 API。

### 核查结论

- 新增 `docs/PROJECT_PROGRESS_2026-10-13.md`，将当前已实现的 13 类设定编辑、地理树、编年史、背景故事、卡牌联动、AI 候选、双图像通道、SQLite 持久化和 Docker 形态归档为 2.0 基线。
- 明确尚未实现 World Package、世界实例、Tick、规则引擎、Action Validator、模拟事件日志、快照回放、多尺度精度和外部 World API。
- 核查时 `main` 分支尚无提交；随后已按 M0A 要求通过 `init` 首次提交建立可追溯基线。

### 2.0 设计调整

- `docs/WorldForge_2.0_Design_Document_V1.0.md` 的文档版本升为 V1.1，保留原文件名以避免破坏已有引用。
- 将“Git 定义 / 模拟存档”两层调整为“作者工作区 / 已编译定义 / 模拟实例 / 主体认知”四层，禁止将 SQLite 中的 `proposed` 草案默认当作实例真值。
- 将首版技术路线改为基于现有 JavaScript/Node 22/SQLite 的增量实现；React、NestJS、PostgreSQL、Prisma、PostGIS 和外部队列改为经实测瓶颈或团队需求触发的 ADR 决策。
- 新增 V2.0-M0A 基线固化阶段，并将 M1 首个验收收窄为单城市、单资源、少量行动、可重放事件的纯规则纵切切片。

### 修改文件

- 新增：`docs/PROJECT_PROGRESS_2026-10-13.md`。
- 更新：`docs/WorldForge_2.0_Design_Document_V1.0.md`、`README.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 验证与限制

- `npm run check` 的脚本语法检查与 27 项 Node 测试全部通过。
- 本次未调用真实 LLM、Seedream 或 ComfyUI，也未重复 Docker、Tailscale 或真实浏览器验收；报告区分了本次测试与历史文档记录。
- 此轮文档校正完成后，已通过 `init` 提交建立 Git 基线；仍未批准 2.0 技术 ADR，未实现任何模拟能力。

## 24. 2026-10-13 2.0 机制注册、LLM 调度与知识隔离归档

本次修改由作者提出的三项 2.0 架构建议驱动，只更新提案性设计、进展缺口、变更记录和待办项；没有实现模拟代码、修改现有 HTML 产品函数、调用外部模型或变更世界观 canon。

### 模拟机制注册系统

- `SimulationMechanic` 使用稳定 ID、精确版本、参数 Schema、依赖、可用 Action、校验和解算接口。
- 机制只通过只读 `MechanicReadContext` 观察状态，`initialize` / `resolve` 只返回 `WorldEffect` 候选，不直接写数据库。
- 统一 Resolver 负责 Schema、读写集、资源守恒、互斥、状态版本和权限校验。World Package 锁定机制注册表，机制升级必须显式迁移或分支。
- 首版只允许仓库内受信任代码；任意第三方脚本需要后续安全 ADR。

### LLM 模拟预算调度器

- 预算维度包含 token、调用次数、并发、延迟、上下文、云端费用和可选能耗，不再只限制 token。
- 按任务能力标签在本地小模型、本地主力模型和经显式允许的更强本地/云端模型间路由；结构化校验优先使用程序。
- 调度器实施实例/区域/任务/全局多层配额、`local_only` 硬边界和可审计降级链，以支持 NAS + Mac Studio 等家庭服务器环境。

### 模拟知识隔离

- 内部国家、组织和人物 Agent 与外部 Actor 共用 `KnowledgeView` 过滤管线，禁止直接读取全局权威状态。
- `KnowledgeRecord` 记录来源事件、观测 Tick、置信度、保密等级、过期时间和观测/推断/转述/欺骗状态。
- Validator 可使用客观状态判定动作不可行，但向 Actor 返回的理由也必须经过知识过滤，不能通过拒绝消息泄露敌方秘密。
- 知识日志随快照、分支和重放保留，不从后来已知的客观状态反向补全过去的 Agent 视野。

### 里程碑与风险调整

- M0B 增加机制注册表与依赖校验；M1 增加规则 Agent 知识隔离；M2 增加 LLM 预算调度、数据策略和“无上帝视角”验收。
- 新增机制模块直写/冲突、Agent 全知和模型路由隐私/费用失控三类风险与缓解策略。

### 修改文件与检查边界

- 更新：`docs/WorldForge_2.0_Design_Document_V1.0.md`、`docs/PROJECT_PROGRESS_2026-10-13.md`、`README.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。
- 本次是设计文档修订，不声称上述机制已实现或经压测。当前自动化检查仍只覆盖现有内容工作台。

## 25. 2026-10-13 W0 首次 Git 基线归档

本次操作响应作者“开始开发 W0，先提交一个 init”的要求，将当前项目状态固化为首个可追溯基线。没有新增模拟功能、修改世界观 canon 或导入本机运行时数据。

### 提交边界

- 提交信息固定为 `init`，作为后续 W0/M0 实现的差异起点。
- `.gitignore` 排除 `.env.local`、`node_modules/`、`*.log` 和 `.data/`；已确认本机 `.data/worldforge.sqlite` 受忽略规则保护。
- `.env.example` 仅包含空密钥占位符；提交前密钥模式检查未发现实际凭据。
- `.openai/hosting.json` 作为静态托管配置进入基线；运行时数据、生成资产和本地设置不进入基线。

### 文档同步

- `docs/PROJECT_PROGRESS_2026-10-13.md` 从“Git 基线尚未建立”更新为“已由 `init` 提交建立”，并从后续建议中移除已完成的基线任务。
- `docs/WorldForge_2.0_Design_Document_V1.0.md` 的 M0A 与风险表改为持续维护基线、防止本地数据或密钥进入提交。
- `todo.md` 将首次 Git 基线任务标记为完成，`CHANGELOG.md` 记录首次提交及安全边界。

### 检查

- 提交前重新执行 `npm run check`；核心脚本语法检查和 27 项 Node 测试必须全部通过后才创建提交。
- 提交后检查 `git status`，确认基线工作区清洁。

## 26. 2026-10-13 V2.0-M0A 第一阶段归档

本阶段完成“基线固化与数据边界”的最小实现：把作者工作区、可发布定义和未来模拟状态分开，并将现有 SQLite 从隐式建表改为可验证的前向迁移。没有实现 Definition 编译器、世界实例、Tick、规则结算或 Agent，也没有改变任何世界观 canon。

### 发布与模拟边界

- 新增 `ADR-0008`：SQLite 是作者工作区，不是模拟 Definition 的直接来源；默认发布只接纳 `canon`，`proposed` 只能通过显式实验清单进入带实验标记的包。
- `objective`、`in_world_belief` 与 `unknown` 在未来编译中分别进入权威初始定义、知识/信念种子和未决元数据；`unknown` 不得成为可执行规则或确定初值。
- 新增 `simulation/README.md` 与 `simulation/storage/README.md`，预留编译、机制、运行时和模拟存储边界。模拟表未来使用 `sim_` 前缀和独立迁移账本，不共享内容库版本号。

### 内容库迁移

- 新增 `storage-migrations.mjs`，将原有内容 Schema 拆成版本 1（核心内容）和版本 2（美术资产）的有序迁移。
- 新库从版本 0 依次应用两个迁移；版本 1 数据库原位升级并保留内容；高于当前支持版本的数据库通过 `UnsupportedContentSchemaError` 拒绝打开。
- 每个迁移步骤使用独立 `BEGIN IMMEDIATE` 事务，`PRAGMA user_version` 与该步结构变更共同提交，避免失败后留下虚假版本。
- `storage.mjs` 启动时委托迁移模块，失败会关闭数据库；健康信息增加本次启动的迁移报告。Docker 镜像与语法检查入口同步纳入新模块。

### 修改文件

- 新增：`storage-migrations.mjs`、`docs/adr/ADR-0008-authoring-definition-boundary.md`、`docs/adr/ADR-0009-content-schema-migrations.md`、`simulation/README.md`、`simulation/storage/README.md`。
- 更新：`storage.mjs`、`tests/storage.test.mjs`、`tests/README.md`、`Dockerfile`、`package.json`、`README.md`、`docs/PROJECT_DESIGN.md`、`docs/WorldForge_2.0_Design_Document_V1.0.md`、`docs/PROJECT_PROGRESS_2026-10-13.md`、`docs/adr/README.md`、`CHANGELOG.md`、`todo.md` 与本静态文档。

### 检查与未实现项

- `npm run check` 通过：核心脚本语法检查及 30 项 Node 测试全部成功；新增覆盖新库有序迁移、v1 数据无损升级与未来版本拒绝。
- `docker compose config` 通过；本阶段未重建或启动容器，也未调用真实 LLM 或图像服务。
- 本机 `.data/worldforge.sqlite` 未纳入版本库，测试均使用临时数据库；尚未实现 World Package Schema、编译器、模拟状态迁移或运行时。
