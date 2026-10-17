# Changelog

本文件记录 Worldforge 的重要变更。日期采用 `YYYY-MM-DD`。

## [0.3.2] - 2026-10-21

设定导入（ADR-0033）与「卡牌 / 原画归属世界」（ADR-0034）：主界面可以把一篇长篇设定原文解析并改写为资料库条目，确认后建立一个新世界；卡牌必须属于世界，原画跟随它的绑定目标继承世界。

### Added
- **卡牌必须归属世界**：编辑器的 `#cardWorldId` 从自由文本改为世界下拉（列出全部世界 + 未归属占位），没有选择世界就拒绝保存并提示去世界观模块新建；进入世界后新建卡牌默认该世界；旧数据缺世界的卡牌显示为「未归属」，补选后才归属，编号仍复用 `CARD-W##-DRAFT-*`。
- **卡牌库按世界筛选**：`#cardLibraryWorld`（全部世界 / 未归属 / 具体世界），每张卡面左上角显示世界徽标，`aria-label` 与 `data-world` 都带世界信息；卡牌 Agent 的草案上下文新增 `worldId`（此前服务端校验了 `draft.worldId`，但前端从未发送）。
- **原画归属世界**：`GET /api/art-assets` 与 `GET /api/export` 按绑定目标现算 `worldId`（卡牌 → 卡牌世界，设定条目 → 条目世界，解除绑定 → 空），生成时也把 `worldId` 写进资产元数据；原画集新增 `#artworkWorld` 筛选与 `.artwork-world` 徽标，说明文案改为「跟随绑定目标归属世界」。
- **Beta 标记**：「测试对战」与「世界模拟」的导航标签加上 `.beta-tag`（`title` 说明实验性质），样式区分亮/暗主题。
- 版本号升到 **0.3.2**（`package.json`、`dist/index.html` 的 `worldforge-version`、README、导出包 `productVersion`）。
- `lore-import.mjs`：设定导入的纯变换层——原文规范化与确定性切分（9000 字/段、最多 10 段、按段落/句末断点）、记录格式字段契约与第 4–6 层提示词、模型输出收敛、跨段「类型 + 名称」合并、世界与条目编号分配、改写成 `values` / `location` / `chronicle` / `relationIds`，以及落库前复核（新建世界 / 并入已有世界两种语义）。
- `POST /api/lore-import/parse`：按段调用「设定助手」入口的 preset 解析原文，返回预览计划（世界编号、条目、告警、统计、Agent 快照、`mode`），**不写库**；每段计入一次 AI 配额，单段失败只告警，全部失败才报错。
- `POST /api/lore-import/commit`：沿用 `contentStore.replace` 与 `expectedRevision` 乐观锁，只**追加**资料；要求 `x-worldforge-lore-import: 1`，新建世界时编号冲突 409，审计动作 `content.import_lore`。
- 世界列表页的「导入设定文本」对话框：原文、文件读取、可选世界名与补充要求、字符/段数预算提示、解析结果的世界名与告警、逐条勾选与全选、保存后自动进入新世界。
- 世界详情页新增「导入设定」：把同一套解析结果**并入当前世界**（`mode:"existing"`），只追加条目、不改世界条目，条目编号按该世界已有资料避让；世界列表页入口仍然新建世界。解析带 `intoWorld` 时先校验目标世界存在（400 不产生模型费用）。
- 资料组「作用范围」修复：世界内新建组默认「仅当前世界」（此前显示为共享且被禁用、点不动），作用范围现在始终可改选共享；只有预置组固定为共享且只读，保存时按选择写入 `worldId`。
- **文件上传**：`lore-import-files.mjs` + `POST /api/lore-import/extract`——`.md`/`.txt`（UTF-8/UTF-16/GBK）、`.docx`（正文与脚注）、`.xlsx`（多工作表）、`.zip`（逐条校验内部格式、一层嵌套）、`.rtf`、旧版 `.doc`/`.xls`（OLE2 尽力抽取 + 告警）；`.rar`/`.pdf` 识别后明确拒绝。零依赖（只用 `node:zlib`），解压只在内存，预算为 8 文件 / 单文件 12 MB / 合计 24 MB / 文本 12 万字 / 压缩包 200 条目 / 单条 8 MB / 嵌套 2 层。对话框新增文件选择、逐文件摘要与告警区，抽取文本回填原文框后仍由作者确认再解析。
- **输出契约：解析 agent 不再负责 JSON**（ADR-0033 §10）：新增通用规范化层 `model-json-normalizer.mjs`，导入改为要求模型写「`@@ 段 + 字段：值`」记录格式，由规范化层转成结构化数据；导入入口**不再发送 `json_schema`**，每段一次调用（去掉原来的结构化降级重试）。规范化层只修语法：围栏/散文、字符串内未转义换行、尾逗号、注释、全角标点、输出截断（退回最后一个完整对象）、JSONL、字符串里套 JSON；记录格式支持多行正文与自然分行的列表。段级告警会带模型原文片段，截断恢复记 `OUTPUT_TRUNCATED`，预览头部显示「规范化 N 段」。
- **模型调用协议兼容层**：机械型入口（导入、设定候选、卡牌补丁、名称生成、宏观提案、提示词优化）默认发送 `thinking: {type: 'disabled'}`，避免思考型模型把输出预算耗在推理上、正文为空；供应商错误信息指向 thinking 时自动去掉重试并在进程内记住。响应解析一次覆盖 chat `choices[]`、responses `output_text`/`output[]`、顶层 `text`/`completion` 与网关 `data` 包装，**并跳过 `type:"reasoning"` 思考项**（否则会把英文思考当正文）；导入首段为空时换另一种 API 类型重试一次并记 `STYLE_FALLBACK`。空响应错误现在带 `style` / `finish_reason` / 实际返回字段 / `reasoning_content` 字数，只返回思考过程时明确写出这一点。导入提示词首行要求「不要输出思考过程、第一个字符必须是 `@`」。
- **「设定」固定组（第六项）**：所有世界新增 `misc` 资料组（标签「设定」、form `generic`、条目前缀 `SET`），承接所有未指定分组的条目；它没有专属提示词档位，AI 写作与生图走通用回落，随世界自动存在、不可删除。
- **分类自动建组**：记录格式新增可选字段 `分类`。导入按「已有组 id/标签 → 旧十三类稳定 id（势力/力量体系/技术体系/物品/事件/种族/文化/宗教）→ 按名字新建 `cat-<base36 哈希>` 世界内组」的顺序解析；组数达 40 上限时条目回落「设定」并告警 `GROUP_LIMIT_REACHED`。新建的组随预览回传，确认导入时一并落库。
- **重复导入跳过**：解析时按「目标世界内同类型 + 同名」跳过库里已有条目（`duplicates` + `DUPLICATES_SKIPPED`），确认导入时再判一次（跳过而非 409），因此长篇设定可以分多次补齐而不产生重复条目；同一批次内部重复编号仍 400。
- **逐条 / 批量改组**：资料列表每行带勾选框，底部批量条（`#loreBulkBar`）可一次「归入」目标组；编辑器新增「资料组」下拉，单条也能移到别的组，改类型会重新生成条目编号。
- 测试：`tests/lore-import.test.mjs`（21 项纯函数）、`tests/model-json-normalizer.test.mjs`（11 项）、`tests/lore-import-files.test.mjs`（13 项，真实 ZIP/OOXML 字节夹具）、`tests/lore-import-api.test.mjs`（24 项端到端 + 假模型，含响应形状兼容、API 类型回退、`thinking` 默认与拒绝回退、reasoning 空响应诊断、并入已有世界、分类建组、二次导入去重）、`tests/lore-groups.test.mjs`（六个固定组）、`tests/app-load.test.mjs`（新增资料组作用范围、世界内导入、单条改组与批量归入四项）、`tests/subpath-routing.test.mjs`（界面与请求契约）；`tests/helpers/document-fixtures.mjs` 提供文档夹具生成器。

### Changed
- **ACR 镜像同步**：新增 `.github/workflows/acr-mirror.yml`，用 `workflow_run` 在 CI 成功后触发，把本次 commit 的 `sha-<短哈希>` 与 `latest`（发布标签则还有去掉 `v` 的版本号）从 GHCR **按 manifest list 原样复制**到阿里云 ACR。复制用 `docker buildx imagetools create` 而不是 `docker pull`/`push`，避免把 `amd64+arm64` 降级成单架构；按不可变 `sha-` 标签复制保证 ACR 拿到的是本次 CI 产出的镜像；并发串行、缺标签告警、一个都没复制才失败。凭据为 `ACR_REGISTRY` / `ACR_USERNAME` / `ACR_PASSWORD`。
- **CI 修复：`pg` 改为按需加载**。`storage-postgres.mjs` 不再顶层 `import pg`，只有 `createPostgresContentStore` 建池时才 `await import('pg')`；未安装时抛 `PG_PACKAGE_MISSING`。`tests/storage-postgres.test.mjs` 同样按需加载，缺包时纯函数断言照常跑、真库往返用例 `skip`。此前 GitHub Actions 的 check 任务（不装第三方依赖）会在该测试文件 import 阶段整体失败，本地因装有 `pg` 而看不到；容器镜像仍 `npm install --omit=dev`，生产 PG 不受影响。
- `Dockerfile` 的根模块 COPY 白名单加入 `lore-import.mjs`；`npm run check` 的语法检查加入该模块；`docs/static/anchors.json` 新增 6 个锚点并把两个随调用点重复的锚点改为 `count/nth`。
- 固定资料组由五项变为六项（新增「设定」）；`lore-groups.js` / `lore-groups.mjs` 的 `FIXED_IDS`、`deriveGroups` 与资料组对话框同步，版本号 `lore-groups.js?v=3`、`styles.css?v=49`、`app.js?v=66`。

### 未验证 / 未决
- 真实模型对长文的分段质量、真实导入后的地理树与年表渲染、多人并发导入同一世界编号的体验都需要作者实测；本文与 ADR 均未声称已验证。
- `.rar` / `.pdf` 明确不支持；真实 Word/WPS 导出的旧版 `.doc`、受密码保护或 ZIP64/分卷压缩包、含图片扫描件的文档都没有实机验证。
- ~~是否允许并入既有世界~~ —— 2026-10-21 按作者要求实现；~~`info` 之外的自定义资料组是否允许模型产出~~ —— 由 `分类` 自动建组实现。仍待裁定：是否把导入暴露给 DSH preset 侧入口、超过 9 万字是否分批续传。

## [0.3.1] - 2026-10-20

多世界化改造（0.3.x 增量，不单独发 0.4.0）：资料类型从固定十三类改为「五项固定资料组 + 作者自定义组」，删除内置默认世界与题材种子，新增服务端整库导入/导出，并让作者资料库支持 PostgreSQL（ADR-0031、ADR-0032）。

### Added
- `dist/lore-groups.js` + `lore-groups.mjs`：资料组的唯一真源。五项固定组（世界、世界信息、角色、编年史、背景故事）+ 作者自定义组，按 `form`（generic / story / chronicle / geography）决定表单与树视图；浏览器与服务端共用同一张表。
- `lore_groups` 表与内容库 schema v3：自定义组随整库一起读写；SQLite（`storage-migrations.mjs`）与 PostgreSQL（`storage-postgres.mjs`）两套 DDL 逐列对齐。
- 资料组管理对话框：新建、改名、改表单形态与三个属性名、删除空组；固定组不可修改。
- `storage-postgres.mjs`：PostgreSQL 驱动的作者资料库，与 SQLite 版本同一套 API（async）、同一套迁移版本号；写操作在事务内取 advisory lock，复刻 SQLite `BEGIN IMMEDIATE` 的并发语义；`health()` 只暴露脱敏后的 `host:port/database`。
- `data-transfer.mjs` + `GET /api/export` + `POST /api/import`：整库交换格式（资料组、资料、卡牌、关键词、备注、美术元数据，可选内嵌 base64 图片）；导入支持 `dryRun` 预检与 `merge` / `replace` 两种模式，美术资产只补不删。
- 设置页「数据管理」面板：导出完整 JSON、导出并内嵌图片、导入预检与确认导入。
- 启动时按 `WORLDFORGE_DB_DRIVER` / `WORLDFORGE_DATABASE_URL` 选择资料库后端；纯 SQLite 部署仍然不需要任何第三方依赖（`pg` 只在 postgres 驱动下动态加载）。
- 新增测试：`lore-groups`、`data-transfer`（纯函数）、`data-transfer-api`（端到端）、`storage-postgres`（含可选真库往返）、`frontend-dom-contract`（元素 id 与脚本加载顺序契约）。

### Changed
- 资料类型：删除 `LORE_TYPES`、`AI_CONTENT_BLOCKS` 两份静态表，改由资料组派生；旧九类（世界地图、势力、种族、文化、宗教、力量体系、技术体系、物品、事件）按原 ID 自动迁移成自定义组，不改写任何资料数据。
- 提示词：`PROMPT_TYPE_KEYS` 收敛到五个固定档位；旧十三类的作者提示词原样保留但不再参与生成；`ai-content-specs` 对未知类型不再回落到 `world`。
- 出厂提示词、入口契约与生图提示不再假设题材：移除「魔法 / 法术 / 蒸汽 / 工业 / 神力 / 以太」等世界专属词，`projectRules` 改为「禁止免费能量、无限储备或无条件万能能力」。
- 卡牌子类型：删除全局随从种族表与「W01 canon 的十一种魔法派系」，候选按当前世界的资料与已有卡牌派生，作者可自由输入；`normalizeSubtype` 不再清空不在词表里的值。
- 世界归属：删除浏览器端 `W01_SEED`；`worldIdOf` 不再把缺失的世界归属算进 `W01`，而是显示为「未归属资料」桶；`normalizeLore` 不再把空 `worldId` 改写为 `W01`；`readLore()` 会清掉历史 `seeded` 残留。
- 文案：界面与 `dist/index.html` 里的 `W01` 占位、题材示例（魔导工业、以太、工业感）与「不会修改 W01 正史」类表述全部改成中性说法；W98/W99 实验场不再以真实世界编号自居。
- `Dockerfile` 增加 `npm install --omit=dev`（仅为 `pg`），`.dockerignore` 排除 `node_modules`；`compose*.yaml` 透传两个数据库环境变量。
- 静态文档：新增 `data-transfer.mjs.md`、`lore-groups.mjs.md`、`storage-postgres.mjs.md`、`dist/lore-groups.js.md`，并更新受影响模块与清单计数（155 个条目）。

### Fixed
- 导入一份含「未使用原画」的库不再整批失败：`createArtAsset` 只在绑定态要求 `targetId`（SQLite 与 PostgreSQL 两版同步）。
- 生成请求的分类提示词改为「资料真实 type 精确命中 → 否则收敛到 info 档」，升级分组方式不会让作者已有提示词失效。

## [0.3.0] - 2026-10-18

为 Tailscale Funnel 公网发布增加本机账号体系（ADR-0030），应用从「无鉴权的单用户本机工具」变为「可公网部署的多人工作区」。

### Added
- `auth.mjs`：scrypt 口令（N=16384 / r=8 / p=1 / keylen=64）、HMAC-SHA256 签名会话 Cookie（`wf_session`，30 天）、`admin` / `member` 两级角色、`sessionVersion` 即时吊销、按用户名与来源 IP 双维度的登录限速、按 UTC 自然日的 AI/生图配额（落盘 `worldforge-usage.json`）与 `worldforge-audit.jsonl` 审计。
- `scripts/auth-cli.mjs` 与 `npm run auth`：`add` / `bootstrap` / `list` / `reset` / `role` / `quota` / `enable` / `disable` / `remove`，用于 NAS 上创建首个管理员与救急重置；首次口令只打印一次。
- `dist/login.html` + `dist/login.js`：独立登录页，用 `document.currentScript` 解析挂载路径，Funnel 的 `--set-path` 无需改 URL。
- 设置页「账号」面板（仅管理员）：创建账号、分配角色、调整每人每日配额、停用/启用、重置口令、删除；一次性口令只在生成时显示。
- 页头显示当前账号与角色，新「改口令」对话框支持自助换口令（换发新 Cookie，其他设备失效）。
- `GET /api/auth/session`、`POST /api/auth/login`、`POST /api/auth/logout`、`POST /api/auth/password`、`GET/POST /api/users`、`PATCH/DELETE /api/users/:name`、`POST /api/users/:name/password`。
- `/api/content` 返回 `lastSavedBy`，保存时写入 `metadata.last_saved_by`；页头状态显示「SQLite 已保存 · 用户名」。
- `/api/health` 增加 `auth: { mode, users, requireAuth }` 摘要（不含用户名）。
- `compose.nas.yaml` 开启 `WORLDFORGE_REQUIRE_AUTH=1` / `WORLDFORGE_COOKIE_SECURE=1`，端口默认只绑回环（`WORLDFORGE_BIND` 可改）；`Dockerfile` 复制 `auth.mjs` 与账号 CLI。
- 新测试 30 项：`tests/auth.test.mjs`（13）、`tests/auth-api.test.mjs`（10）、`tests/auth-ui.test.mjs`（7）。

### Changed
- 存在 `users.json` 即启用账号模式：除健康检查、会话查询、登录与登出外，所有 `/api/*` 要求会话；`/api/settings` 与 `/api/users*` 要求 `admin`。
- 未登录的页面导航直接返回登录页，不再把应用外壳发给匿名访客；带扩展名的静态资源仍可匿名取用（登录页需要样式与脚本）。
- `PUT /api/content` 与 `POST /api/settings` 写入审计，日志不记录口令、令牌或 API Key 值。
- 版本号升至 `0.3.0`（`package.json`、页面 meta、`README`）。

### Security
- `WORLDFORGE_REQUIRE_AUTH=1` 且 `users.json` 缺失或损坏时**拒绝启动**（`AUTH_USERS_MISSING` / `AUTH_USERS_INVALID`），避免“忘了建账号就暴露公网”。
- 登录失败对未知账号与错误口令返回同一错误码；未知账号也执行一次等价的 scrypt 校验，避免用时间枚举账号。
- 错误响应不回显堆栈；`AuthError` 只暴露稳定 `code` 与可读文本。
- `.gitignore` 排除 `users.json`、`worldforge-usage.json`、`worldforge-audit.jsonl`。

### Known limitations
- 登出只清除浏览器 Cookie，签名令牌在 30 天有效期内仍可用；泄露时应重置口令或停用账号。
- 配额在模型调用前计数，模型失败也计一次；登录失败计数在内存中，进程重启后清零。
- 成员没有「编辑偏好」入口（设置对话框对成员隐藏）；仍无「只读访客」角色与邮箱找回口令。

## [0.2.2] - 2026-10-17

修复 0.2.1 之后 CI 仍红的第二个原因：测试里有一条**只在 Windows 成立**的断言。

### Fixed
- `tests/agent-profile-registry.test.mjs` 的「presets root 解析」用例原先把 `AGENT_RUNTIME_SCHEMA_PATH` 断言成 Windows 盘符形式（`/[A-Za-z]:\\/`），在 ubuntu-24.04 上必然失败（路径是 `/home/runner/…`）。改为平台中立的断言：路径必须是 `isAbsolute`，且对外视图不得泄露 schema 绝对路径或本机仓库根路径。
- `IMAGE`/审阅链路补强：CI 的 `check` 关此前失败时无法在未登录状态下诊断（日志下载 403），现在把失败用例与错误上下文写成 check-run 注解，可直接经 API 读取；这条能力保留在 0.2.2。
- 版本号升至 `0.2.2`（`package.json`、页面 meta、`README`、`PROJECT_DESIGN` 同步）。0.2.1 的内容（跨平台内容哈希）不变。

## [0.2.1] - 2026-10-17

修复 0.2.0 的首个 CI：静文档门禁在 GitHub Actions（Linux 检出 LF）上必然变红。

### Fixed
- 清单哈希改为**内容哈希**（先归一化 CRLF/CR 为 LF 再求 SHA-256）。0.2.0 按原始字节计算，而本地 Windows 工作树是「部分 LF、部分 CRLF」的混合状态，同一个提交在 Linux 与 Windows 检出下会得到不同哈希：`npm run check` 在本地绿、在 CI 红（`HASH_MISMATCH` 118 处）。现在两种检出都通过；行尾差异交由 Git 规范化负责。用「整树转 LF 的副本」与真实克隆分别复跑 `npm run check` 验证。
- `docs/static/static-doc-manifest.mjs.md` 记录该取舍（内容哈希 vs 字节哈希）与 0.2.0 的事故；`package.json.md` 补一条跨平台说明；版本号升至 `0.2.1`（`package.json`、页面 `<meta name="worldforge-version">`、`README`、`PROJECT_DESIGN` 同步）。

## [0.2.0] - 2026-10-17

首个带产品版本号的发布：把仓库内三个 DSH Agent preset 接入 WorldForge 的设定助手、自由创作与卡牌 Agent 三个入口，并配套回滚基线、分入口设置、静态文档双门禁与容器化。规则与卡牌数值仍为 `untested`，世界设定与卡牌均为草案——0.2.0 声明的是**能力可交付**，不是规则定稿。

### Changed
- 2026-10-17：修正 `static-doc-manifest.mjs` 对**空白 `sha256`** 的处理（上一轮只用 `typeof === 'string'` 判定）。现在停止条件与结构校验统一为新增的 `nonEmptyString`（非空且去空白后仍非空）：空串与纯空白只报 `MANIFEST_INVALID`，不再冒出误导性的 `HASH_MISMATCH`，`--write` 也不再自动补写。补 3 项用例（空串 / 纯空白 / 制表换行，及 `nonEmptyString` 本身），并用真实清单清空一条 `sha256` 实测：`--check` 只出结构诊断、`--write` 不修复该项。`npm run check` 261 项全绿；`todo.md` 里的测试数由 256 更正为实际值。
- 2026-10-17：修正 `static-doc-manifest.mjs` 在清单条目缺少或非字符串 `sha256` 时的 `TypeError`（此前已记 `MANIFEST_INVALID` 却继续执行 `entry.sha256.slice()`）。现在结构非法即停止该条目的哈希比较，`--write` 也不补写缺失字段（缺失属于需人工确认的问题）；诊断改用新增的 `shortHash` 安全格式化。新增 3 项回归用例（缺失 `sha256`、非字符串 `sha256`、`shortHash` 混淆安全），并用真实清单删去一条 `sha256` 实测：只输出 1 条 `MANIFEST_INVALID`、退出码 1、无异常。`npm run check` 259 项全绿；计划风险表「静态评审措辞」同步改为「作者评审提示」。
- 2026-10-17：Sprint 5 签字复核的两项收口阻断已修复（正式签字仍待作者确认）。P1（投影层仍要求评审）：`.agent-presets/card-designer/runtime/system.md` 与 `worldforge.runtime.json` 改为只返回字段补丁、明写「评审与最终裁定由作者完成」，`card-designer` 升到 `1.1.1`（投影内容变化必须升版）；此前两处位于第 2 层系统提示，会继续诱导真实模型产出已废弃的 `review`。P2（静态文档归档与门禁缺口）：新增 `static-doc-manifest.mjs`（`--check`/`--write`，校验 139 个条目的 SHA-256、文档路径存在性、`counts`/状态统计、重复条目与越界路径）并接入 `npm run check`；据此重算清单哈希，修掉 `package.json` 与卡牌 `runtime/system.md` 两处真实漂移；`package.json.md` 补记两道门禁步骤、`.agent-presets`（含仓库根 README）不再称卡牌 preset 为 `1.0.0`/未接入、计划顶部与 §12.5 状态统一为「验收证据齐备、签字待作者确认」。新增 8 项清单门禁测试，`npm run check` 256 项全绿；镜像重建（`f0c8bd8f029b`），容器内卡牌投影哈希与工作树一致、`card-designer` 报告 `1.1.1`。
- 2026-10-17：**Sprint 5 验收证据齐备（正式签字待作者确认）**。§12.3 发布验收六项均有结果：第 1–3 项为机器可复现证据（当时 `npm run check` 248 项 + 100 处锚点；镜像 `1e72877f` 容器 `healthy`；本机与容器 preset 元数据及改动文件哈希逐字一致），第 4–6 项由作者实测确认为可用（浏览器三入口 smoke、真实配置模型三入口各一次、真实 Seedream 生图；证据级别为作者确认，未保留机器日志）。Sprint 5 期间由该轮实测暴露并修复的两处缺陷（响应外壳只写在 `json_schema` 里、评审字段冗余）一并进入待签字的验收包。卡牌 Agent ↔ W97 联动不在 §12.3 范围内，因评审字段移除需先重定联动输入，转入待办。
- 2026-10-17：按作者裁定「评审没必要，评审是作者的事」移除卡牌 Agent 的评审字段（撤销 Sprint 4 的 S4-06）。候选形状由 `{key, patch, review}` 改为 `{key, patch}`：`CARD_ENTRY_CONTRACT` 明写「评审由作者完成，不要输出评审」，`createCardResponseSchema` / `validateCardVariant` 不再校验六项评审，`POST /api/ai/card` 与面板不再返回或渲染评审（模型多返回的 `review` 被忽略而不是判为非法）；面板从 8 行评审块收缩为补丁字段。原先只产出评审的三个操作改为产出补丁并改名：规则审查→补全规则文本（`close_rules`）、静态平衡评审→调整数值（`tune_stats`）、设定一致性→对齐设定（`align_lore`）。不变的部分：只回填不保存、`proposed`/`untested`、禁止「已平衡/已验证」声明、字段白名单、类型互斥、引用白名单、脚本拒绝、差额补生成与诊断。ADR-0029 §5 与计划 §11.2/§12 已记录改判依据；`dist/styles.css` 删除失去引用的 `.card-agent-review` 规则；缓存版本升到 `app.js?v=51`。`npm run check` 248 项全绿。
- 2026-10-17：修正作者实测报出的卡牌 Agent「用不成」。作者使用 `deepseek-flash` + `responses` 风格端点时，`POST /api/ai/card` 反复以「返回值缺少 variants 数组」+「第 1 条：key 必须是非空字符串」验收 0/1——原因是响应外壳只写在 strict `json_schema` 里，而该端点不支持 `json_schema`（被 400 拒绝后降级），降级 prompt 只说了「严格只返回 JSON 对象」，模型于是把 Schema 的 `items` 当根对象返回、补生成时又漏写 `key`。修复分四处：①两个入口（`buildCardPrompt` 与 `lorePromptSections`）都**始终**在第 5 层写出响应外壳与键要求，卡牌示例值取安全占位（`"新卡名"`、`3`、`keywordIds: []`），避免模型照抄未提供的 ID；②`ai-harness.mjs` 新增 `parseLooseJson` / `coerceVariants` / `withFallbackKey` / `previewOf`，解析侧接受裸候选对象、顶层数组、夹带说明或围栏的 JSON，候选缺 `key` 时补 `candidate-N`（`key` 只是客户端标识）；③`inspectCardResponse` / `inspectAiResponse` 的 `INVALID_JSON` / `INVALID_ENVELOPE` 诊断带上模型原文片段（≤240 字符），不再只有一句无法复现的提示；④`callCardAgent` 降级时写 `console.warn` 并在响应里回传 `fallbackReason` + `structured:false`，卡牌面板以一条 chip 如实显示「模型未接受结构化约束」。`card-agent.mjs` 因此 import `ai-harness.mjs`（此前零依赖）。新增 4 项测试（真实服务 + 假模型：忽略 schema 的返回端到端可用、provider 400 降级并回显原因、外壳在第 5 层且示例值安全）；`npm run check` 248 项全绿。缓存版本升到 `app.js?v=50`。
- 2026-10-17：Sprint 5 落地回滚基线与降级启动。新增 `agent-legacy.mjs`：`WORLDFORGE_AGENT_LEGACY_PROMPTS` 仅当精确等于 `1` 时启用，三个入口改用 `ai-harness.mjs` 的代码内固定 persona——只替换第 2 层，第 1 层产品安全边界、第 3 层入口契约、Schema、工具白名单、轮次上限与 canon 纪律不变；响应快照固定为 `legacy-fixed-prompt / 0.0.0-legacy / ''`，客户端伪造值仍不被采信。Registry 加载失败时默认仍 `process.exit(1)`，只有显式开关才降级启动：`/api/health` 保持 200 并带 `degraded` + `diagnostics`，`/api/ai/presets` 保持既有结构并带 `fallback: legacy-fixed-prompts`，`/api/settings` 显示 legacy 并拒绝带 `agentPresets` 的写入。前端按 `fallback` 显示「固定提示（回滚模式）」而不是误报配置丢失（`app.js?v=49`）。`Dockerfile` COPY 闭包加入新模块。新增 `tests/agent-legacy-rollback.test.mjs`（9 项，含四组启动模式与 S5-03 冻结），`npm run check` 244 项全绿；镜像重建后容器 `healthy`，本机与容器预设 ID/版本/哈希一致，容器内故障注入验证了「默认拒绝启动 / 开关下降级启动」。
- 2026-10-17：Sprint 4 新增卡牌文字 Agent。新增 `card-agent.mjs`（字段白名单、三类型互斥、关键词/设定 ID 白名单、效果操作白名单与脚本拒绝、评审六项完整性、禁平衡声明、自动 untested 标记、差额补生成与诊断）与 `POST /api/ai/card`（只返回补丁与静态评审，不保存、不生成图片、不改 canon）；`ai-harness.mjs` 新增 `CARD_ENTRY_CONTRACT` 与 `buildCardPrompt`，card-designer 投影裁到 1.1.0 只留 persona；卡牌编辑器新增可收起的「卡牌 Agent」面板（五种操作、字段勾选、候选差异与诊断、应用到表单、保存为独立草案，固定 proposed/untested）。新增 `tests/card-agent.test.mjs` 与 1 项 UI 静态断言。
- 2026-10-17：修正 Sprint 3 复审发现的 4 个界面阻断项。`#saveSettings` 的实际绑定是 `saveSettingsWithVisuals`，而提交 `agentPresets` 的旧 `saveSettings` 早已被覆盖成死代码，导致选择器存在但保存不生效——现在 Agent 提交逻辑移入被绑定的处理器并删除旧实现与残留绑定；`bootstrap` 改为先 `refreshAgentCatalog()` 再 `refreshAgentSettings()`，修掉自由创作选择器首屏显示「没有兼容的 preset」并被禁用；自由对话首次响应后把服务端返回的 `agent.presetId` 冻结为本次会话 preset，设置变化不再中途换 persona；`fillPresetSelect` 对已保存但失效的 preset 显示「（已不可用）」并保持选中，保存时只提交有效选择。静态 UI 测试改为解析最终事件绑定后检查处理器正文，并断言不存在同名旧实现。缓存版本升到 `app.js?v=46`。
- 2026-10-17：Sprint 3 提供按入口独立的 Agent preset 选择。新增 `agent-settings.mjs`（默认映射、部分更新、原子写入、缺失/损坏回落并回传原因），`GET/POST /api/settings` 增加 `agentPresets`、`agentPresetDefaults`、`agentSettingsSource`；解析优先级改为「请求快照 > 保存的默认值 > Registry 默认」，服务端只回显权威版本与哈希。设置页新增「Agent 模式」面板，三个选择器按 `surfaces` 过滤；自由对话新增 preset 选择器与「本轮 Agent」chip，有历史时切换先确认并开新对话；设定助手与自由创作都发送 `presetId` 快照。preset 错误（`AGENT_PROFILE_*`/`AGENT_SETTINGS_INVALID`）与模型服务错误在界面上分开呈现。保存的 preset 消失时保留原值并报错，不自动改选。`Dockerfile` 加入 `agent-settings.mjs`。新增 `tests/agent-settings-api.test.mjs`（5 项）与 `tests/agent-settings-ui.test.mjs`（5 项）。
- 2026-10-17：修正 Sprint 2 复审的第五个阻断项（非结构化降级重新破坏层序）。三条降级分支曾把「严格只返回 JSON 对象」追加到以第 6 层结尾的 prompt 之后，形成 4→5→6→5：初次非结构化降级、初次已降级后的补生成、补生成结构化请求再次降级。现在 `buildPrompt` / `buildSupplementPrompt` 接受 `requireJson` 选项，把该指令并入第 5 层任务段；`callAi` 三条分支全部改用该选项，不再拼接尾部文本。新增单元断言（指令恰好一次、早于所有第 6 层块、prompt 以第 6 层结尾）与两条集成断言（假模型对带 `response_format` 的请求返回 400，覆盖降级初次 + 降级补生成，以及补生成结构化失败后的降级）。
- 2026-10-17：修正 Sprint 2 复审的第四个阻断项（补生成未沿用完整请求快照）。`callAi` 现在先构造含服务端作者提示的 `promptPayload`，初次请求用 `buildPrompt(promptPayload)`，补生成用 `supplementPayload = { ...promptPayload, variantCount: missingCount }` 同时驱动 prompt、Schema 与 `expectedCount`；此前补生成传原始 `payload`，导致第 4 层退回「无额外分类提示/无额外统一风格要求」，且 prompt 出现「严格返回 2 份」与「只补 1 份」并存的矛盾指令。测试新增第 4 层逐字一致断言与数量口径一致性断言（含补生成 Schema 的 `minItems/maxItems`）。
- 2026-10-17：修正 Sprint 2 复审的第三个阻断项（差额补生成层序）。原 `buildSupplementPrompt` 把 `<accepted_variants>`、校验问题摘要与「现在只补充……」追加到已含第 6 层的初次 prompt 之后，形成 4→5→6→6→5。现在抽出 `lorePromptSections(payload, bundle)` 供初次与补生成共用，`buildSupplementPrompt(payload, bundle, { missingCount, acceptedVariants, issues })` 按层重排：补生成指令并入第 5 层，已验收候选与校验问题作为第 6 层最后区块。新增单元断言与第二次真实出站请求的完整层序断言。
- 2026-10-17：修正 Sprint 2 复审的两个阻断项（不改动运行时边界）。P1：不可信内容不再进入 system 指令层——`composeAgentSystemPrompt` 移除 `authorNotes` 参数并新增 `assertInstructionLayerClean`（指令层出现 `<author_notes>` / `<library_context>` 等标记即抛 `AGENT_UNTRUSTED_LEAK`），新增 `attachUntrustedContext` 把作者笔记与工具降级时的条目索引附到最后一条用户消息；`server.mjs` 的主路径与降级路径都改走该函数。P2：`buildPrompt` 的第 4、5 层顺序改为 ADR-0029 §7 冻结的 `author_prompts → task_request → untrusted_context`（此前任务要求排在作者分类提示与个性化提示之前）。新增断言分别检查 system 内 1→2→3、user prompt 内 4→5→6、两条通道互不串层，以及 system 不含任何不可信正文。
- 2026-10-17：Sprint 2 让设定助手与自由创作真正使用 Registry 中的 preset。提示词按 ADR-0029 §7 拼成三层：`ai-harness.mjs` 新增 `PRODUCT_BOUNDARY_INSTRUCTIONS`（第 1 层）、`LORE_ENTRY_CONTRACT` / `FREE_ENTRY_CONTRACT`（第 3 层）与 `composeAgentSystemPrompt`，`FREE_AGENT_TOOL_GUIDE` 移入同一模块并作为第 3 层的一部分；`SYSTEM_INSTRUCTIONS` / `FREE_AGENT_INSTRUCTIONS` 保留为「无 preset 时的默认拼装」，作为回滚基线。`lore-writer` 与 `free-creator` 的投影按分工裁剪到 `1.1.0`（IP、canon、元话语、status 表述等移到第 1/3 层，关键纪律恰好出现一次，符合 ADR-0025）。`server.mjs` 新增 `resolveSurfaceProfile` / `agentSnapshot` / `toolsForPolicy`：未知或不兼容 preset 在模型调用前 400；`/api/ai` 与 `/api/ai/free` 响应增加 `agent: { presetId, presetVersion, presetHash, mode }`；差额补生成与工具不可用降级均沿用同一快照；工具仍只映射白名单，6 轮 / 12 次 / 4 图硬上限不变。前端在自由对话每轮与设定助手候选区显示本轮实际 preset。Registry 新增拒绝：`runtime/system.md` 含产品保留标记时以 `AGENT_MANIFEST_INVALID` 拒绝加载。新增 `tests/agent-prompt-layers.test.mjs` 与 `tests/agent-surface-integration.test.mjs`（本地假模型 + 真实服务进程）。
- 2026-10-17：修正复审提出的路径错误码契约偏离。ADR-0029 §9 冻结「绝对路径、`..` 穿越、符号链接逃逸或非相对路径 → `AGENT_PROMPT_PATH_UNSAFE`」，但 Schema 校验先于路径解析，且上一轮把 `systemPrompt` 的路径形态问题归为 `AGENT_MANIFEST_INVALID`，导致该约定错误码在真实加载路径上不可达。现在 `systemPrompt` 命中 Schema `not` 路径约束即报 `AGENT_PROMPT_PATH_UNSAFE`，空值/类型/长度仍为 `AGENT_MANIFEST_INVALID`；`pickErrorCode` 优先级改为「兼容矩阵 > 路径不安全 > 枚举 > 结构」。测试从真实加载路径触发该错误码（穿越夹具与符号链接两条独立路径），并补齐 Unix 根路径、UNC 与中间段穿越用例。
- 2026-10-17：修正 Sprint 1 只读验收提出的 4 个代码问题与 1 个错误码分类问题。Registry 增加**完整性门**：`lore`/`free`/`card` 任一入口缺少可用 preset 时抛 `AGENT_PROFILE_UNKNOWN` 并拒绝启动，不再把 `defaults` 写成 `null`；preset 目录、manifest 文件、prompt 文件及其**中间目录**都拒绝符号链接，并对 preset 目录与 manifest 做 `realpath` 根目录复核；Registry 快照改为**深度冻结**（原先只冻结 `manifest` 顶层，`manifest.surfaces` 仍可改写）；清单校验改为两遍并携带 `path`/`keyword`，非法组合归 `AGENT_COMPAT_MISMATCH`，不再一律报 `AGENT_ENUM_UNKNOWN`；「所有错误码可达」测试改为逐个真实触发。另修正 `server.mjs` 启动失败时仅 `throw` 导致进程不退出、留下锁定 SQLite 文件的问题，改为打印诊断后 `process.exit(1)`。真实 `docker compose up -d --build` 比对确认本机与容器的 ID、版本与 SHA-256 哈希完全一致。
- 2026-10-17：Sprint 0 正式签收。作者逐条签署 ADR-0029 §10 五项（只读仓库随附投影、按 surface 独立保存、自由聊天切换即新对话、本轮不接受自定义 preset、卡牌 Agent 独立浮动面板且只返回受验证补丁），五项全部接受、无改判；ADR-0029 由 `proposed` 转为 `canon（技术边界）`，签字记录写入该文件 §10，契约内容未因签字改动。签名随后进入 Sprint 1。
- 2026-10-17：修正 Sprint 0 只读验收提出的治理与测试问题，不改动运行时。ADR-0029 由误标的 `canon` 降回 `proposed` 并新增 §10 作者签字门（作者指示实现 Sprint 0 不等于接受五项推荐项，签字前 Schema 与三个 manifest 是提议契约）；重复 ID 与超长 prompt 改为真实磁盘夹具（`reject/duplicate-id/fixture-a|b`、`reject/oversized-prompt` 34017 字符），不再由测试临时构造；新增 `agent-profile-contract.mjs` 代码侧契约真值与 `tests/snapshots/agent-prompt-layers.json` 顺序快照，替换原先只搜索 ADR 文本的伪 snapshot，并新增代码常量与 Schema/ADR 的交叉校验测试。
- 收敛「正史」相关约束：Agent 的五个工具全部只读，原本「不要擅自把候选晋升为 canon」禁止的是一件不可能发生的事，因此在提示词里删除，改写为一次输出纪律（按 `status`/`truthScope` 表述，不把草案写成定论、不补全资料没写的内容）。界面从四处重复收敛为一处，并改为说明作者该做什么。由 ADR-0025 固化。

### Added
- 2026-10-17（0.2.0）：页头新增版本徽标，用来区分「页面打包版本」与「运行实例版本」。`/api/health` 返回 `version`（启动时读 `package.json`）与 `harnessVersion`；`dist/index.html` 用 `<meta name="worldforge-version">` 记录打包版本并在 `#appVersion` 显示；两者不一致时徽标变黄提示「页面已过期，请刷新」——此前只能靠肉眼分辨强刷是否生效，这个提示把 stale 缓存变成可见状态。`title` 里附带页面版本、harness 版本、persona 来源与 Registry 是否降级。
- 2026-10-17：新增 GitHub Actions 流水线与 NAS 拉取式部署，把「构建」和「运行」分开。`.github/workflows/ci.yml` 分三关：`check` 跑 `npm run check`（语法检查 + 195 项单元测试）；`image-smoke` 真实构建镜像后用 compose 同款参数（`--read-only`、`/data` 挂载、`tmpfs /tmp`）启动容器，再由新增的 `scripts/ci/smoke-container.mjs` 对 `/api/health`、`/api/ai/presets`、`/api/content`、`/api/simulation` 与静态界面做 HTTP 断言；`publish` 仅在 `main` 推送与 `v*` 标签且前两关通过时构建 `linux/amd64` + `linux/arm64` 并推送 `ghcr.io/<repo>`（`latest` / 分支 / `sha-<短哈希>` / semver）。新增 `compose.nas.yaml`：只有 `image:`、没有 `build:`，NAS 只拉不建；绑定全部网卡以支持局域网与 tailnet 访问，数据目录由 `WORLDFORGE_DATA_DIR` 指定并须落在本地磁盘卷（SQLite 依赖 POSIX 文件锁），ComfyUI 通道与 `host.docker.internal:host-gateway` 按作者要求保留。`npm run check` 增加冒烟脚本的语法检查；`.dockerignore` 排除 `.github` 与 `compose.nas.yaml`，冒烟脚本本身不进镜像（它只在 runner 上通过 HTTP 断言容器）。未改动服务端接口、提示词契约、SQLite Schema 或任何正史内容。
- 2026-10-17：Sprint 1 交付产品侧 Agent Profile Registry。新增 `agent-profile-registry.mjs`（严格清单校验、安全 prompt 路径解析、确定性 SHA-256 指纹、冻结只读快照）与仓库根 `agent-runtime.schema.json`（`docs/schemas/` 真值的部署副本，镜像不含 `docs/`）；`server.mjs` 在启动时一次性加载，任何无效、损坏、重复或不兼容的投影都会打印稳定错误码并拒绝启动，而不是跳过或静默改用其他 persona；新增 `GET /api/ai/presets`（脱敏元数据与三个入口默认映射）与 `/api/health` 的 `agentProfiles` 摘要；`Dockerfile` 逐文件复制 6 个投影文件并加入三个新模块，仍不包含 `agent.cordis.yml`、`preset.yml`、`skills/` 或设计目录。此时设定助手与自由创作仍使用固定系统提示常量，选择的 `presetId` 尚不影响生成结果（Sprint 2 接入）。
- 2026-10-17：完成 Agent preset 产品接入计划的 Sprint 0（契约固化，不改动运行时）。新增 `docs/adr/ADR-0029-agent-profile-runtime-projection.md`：产品只读 preset 目录内的投影文件，永不解析或执行含 `!!js` 的 `agent.cordis.yml`；冻结 surface/mode/outputContract/toolPolicy 兼容矩阵（恰好三行合法）、提示词六层顺序与 11 个稳定错误码。新增 `docs/schemas/agent-runtime.schema.json`（JSON Schema 2020-12，拒绝未知枚举与额外字段）；三个 preset 各新增 `worldforge.runtime.json` 与 `runtime/system.md`；新增 `tests/agent-profile-contract.test.mjs`（11 项）与 `tests/fixtures/agent-profiles/`（2 个合法、8 个拒绝夹具）。`server.mjs`、`ai-harness.mjs`、API、SQLite、Dockerfile 与前端均未修改。
- 2026-10-17：新增 `docs/AGENT_PRESET_INTEGRATION_SPRINT_PLAN_2026-10-17.md`，详细规划仓库级 DSH preset 接入产品 AI 入口的 6 个 Sprint：运行时投影与 Registry、现有设定/自由入口接入、分入口选择 UI、卡牌文字 Agent，以及安全、Docker、迁移与真实验收。该计划为 `proposed`，本次未修改产品运行时。
- 2026-10-17：把产品现有的结构化设定写作契约与自由创作聊天契约分别抽离为 `.agent-presets/lore-writer` 和 `.agent-presets/free-creator`。前者携带类型内容块与冲突检查技能；后者保持自然语言、按需检索和默认只读行为，并明确 DSH preset 不会自动获得产品 SQLite 资料库或素材库快照，权限强制只读需搭配 DSH permission preset。
- 2026-10-17：新增仓库级 `.agent-presets/card-designer`。该 DSH preset 将 WorldForge 卡牌设计 persona、最小文件/检索能力和自包含设计技能一并版本化；移除技能对本机绝对路径的依赖，明确不授予 Shell、后台任务、子代理或工作流，并增加结构与能力边界测试。
- 新增 W97 `experimental / untested` 卡牌对战纵切：20 生命、固定种子 10 张测试套牌、递增资源、5 随从栏位、随从交战、疲劳伤害、三种结构化法术和确定性规则对手。对战状态只在页面内存中存活，不读写 W01、作者卡牌库或世界模拟存档。由 ADR-0028 固化技术边界。
- 新增四个 `proposed / experimental` 关键词：`KEY-001` 疾启、`KEY-002` 护持、`KEY-003` 隔绝、`KEY-004` 余响，分别通过权限、目标约束、伤害替换与死亡后触发钩子执行。未知 ID、非白名单效果和任意脚本默认不执行。
- AI 设定助手改为浮动子窗口：默认展开在右侧，可最小化成竖条，也可关闭后从边缘重开；窄屏改为底部抽屉。宽度不再占用资料工作区的一列。由 ADR-0027 固化。
- AI 候选新增「覆盖当前条目」：一步用候选覆盖已勾选内容块并立即保存，仍走完整字段校验；只对已保存条目出现。候选数量新增「1 份」（服务端本就支持 1–5）。由 ADR-0027 固化。
- 设定视觉原型新增「解除绑定」、卡牌编辑器新增「不使用原画」：`art_assets` 增加 `unbound` 语义，新增 `POST /api/art-assets/:id/unbind`，解除只清空绑定关系、保留图片文件与资产记录，画作会回到素材库的「未使用原画」。由 ADR-0026 固化。
- 自由对话的每条用户消息下方新增上下文预览：显示这一轮带进去的参考资料条目（超过 6 条折叠）、「整个资料库」模式、可检索原画数量，以及附加图片的缩略图。预览是发送时的快照，之后修改选择不会改写历史消息。
- 自由对话支持从素材库添加图片附件：可搜索的缩略图托盘、单条消息最多 4 张、发送后自动清空。附件与消息绑定，只上传资产编号，服务端按编号读图；即使模型接口不支持工具调用，附图也会保留。由 ADR-0024 固化。
- 自由创作 Agent 现在可以看到美术资产：新增 `list_art_assets` 与 `get_art_asset` 两个只读工具。图像无法放进工具结果消息，因此工具只返回需要附图的资产编号，由服务端从资产目录读出并作为紧随其后的用户消息附到会话里，单轮最多 4 张。模型接口拒绝图片时会移除附图并继续对话，返回值如实标注 `vision: 'unavailable'`；前端显示「附图 N 张」。卡牌草案与模拟状态仍不可见。由 ADR-0023 固化。
- 自由创作 Agent 获得多轮只读资料工具：它可以在回答前调用 `search_lore`、`get_lore_entry`、`list_lore` 按需读取词条正文、约束与开放问题，最多 6 轮 / 12 次调用，工具轨迹在对话气泡下可见。工具在服务端执行，只读取随请求传入的资料库快照，不触碰文件、数据库或密钥；每条结果都带 `status` 与 `truthScope`，`proposed` 草案不会被当作正史。模型服务不支持工具调用时降级为单轮问答并如实标注。由 ADR-0022 固化。
- 修正 Dockerfile 的模块白名单缺少 `ai-tools.mjs` 与 `ai-agent.mjs` 导致容器启动即 `ERR_MODULE_NOT_FOUND`；新增 `tests/docker-packaging.test.mjs` 校验服务端模块传递闭包都在镜像 COPY 列表内。
- 关联资料的选择窗口复用到卡牌「设定来源」与自由创作「参考资料」：选择窗口改为按目标驱动的 `pickerTargets` 注册表，三处共用同一份过滤、草稿与已选区，互不串档。卡牌设定来源不再使用多选下拉；自由创作在已选条目时把发送给 `/api/ai/free` 的资料库索引收窄为所选条目（未选则维持原有全量行为），服务端契约不变。由 ADR-0021 固化。
- 「关联资料」由全量拼接的多选下拉改为可过滤的分栏选择窗口：资料池支持搜索（名称、编号、摘要、正文、标签）与类型/世界/状态/显示四个过滤器，另一侧是实时更新的已选关联；当前编辑中的条目不会出现在池中，取消会丢弃草稿，只有「应用关联」才写回。过滤与选择逻辑抽成 `dist/relation-picker.js` 纯函数模块并配独立测试。由 ADR-0020 固化。
- 修复 AI 候选「应用到当前表单」会因向已移除的 `#loreWorldId` 写值而抛错；`loadLore` 与 `fillLoreForm` 的「id → 值」映射表现在由测试校验每个键都存在对应元素。
- 世界观模块改为「世界列表 → 世界内资料」两级结构：一级只显示世界面板（含状态、事实层次、各类型计数与资料总数），进入某个世界后才显示该世界的资料。列表、标签页计数、地理树、编年史树与关联下拉全部按世界过滤；关联下拉保留「其他世界（跨世界引用）」分组。由 ADR-0019 固化。
- 新增 `dist/world-scope.js` 纯函数模块（分组、按世界取资料、下一世界编号、世界搜索、资料归属搬运）并配独立 Node 测试；新增「新建世界」，自动分配 `W01`、`W02`… 编号。没有对应世界条目的资料会显示为未归属面板，可一键归入某个世界，而不是消失。
- 编辑器里的「所属世界」由自由文本输入改为只读展示，避免打错字产生孤儿资料。
- 卡牌新增随从种族与法术派系：随从种族使用代码内 `proposed` 候选词表（人类、构装体、蒸汽机械、亡灵、野兽），法术派系直接采用 W01 canon 的十一种魔法派系（基础火水土风电、高阶光明黑暗生命死亡、更高层时间空间）。两者都显示在卡面底部中央的同一行；武器均不适用，切换类型会清空不适用字段。由 ADR-0017 固化，种族最终分类仍待作者裁定。
- 编辑器预览改为与编译卡面同构：预览固定 330×460，即编译 PNG 660×920 的一半，原画窗、名称横幅、规则框与属性圆章共用同一几何，并由测试交叉锁定两侧常量。由 ADR-0018 固化。
- 原画集改为覆盖素材库全部原画，新增“已使用原画 / 未使用原画 / 全部原画”分类，默认只显示已使用素材；未使用素材以虚线边框与去饱和缩略图区分，仍可点开大图查看。由 ADR-0018 固化。
- Seedream 生图请求改为 `watermark: false`。卡牌关键词附加说明和普通文本新增安全的有限富文本，支持 `<b>` / `<i>` 与 Markdown 粗体/斜体标记，并同步进入编辑器预览和编译 PNG；属性圆章只保留数值，不再显示下方名称。
- 卡牌描述改为同一规则框内的富文本流：独立关键词优先、带说明关键词其次、普通文本最后，关键词名加粗并自动换行。保存时使用原画裁剪、类型属性和统一底板编译 PNG，卡牌库只展示编译结果；编辑器原画支持直接拖动和滚轮缩放。原画查看器新增下载入口，服务端按稳定美术资产 ID 返回文件名与真实扩展名。
- 卡牌库、原画集与创建/编辑器改为三个独立视图；卡牌库新增搜索、类型/稀有度筛选和分页，点击卡牌可直接进入编辑器。随从固定为攻击/生命，法术不再携带攻击或生命，武器固定为攻击/耐久；旧武器草案的 `health` 会一次性兼容为耐久。关键词按添加顺序逐行编辑，并按“独立关键词 → 带附加描述关键词 → 普通文本”编译显示。完整 JSON 导出升级到 schemaVersion 10。
- 卡牌模块新增“卡牌库 / 原画集”子 Tab、统一卡牌底板、随从蛋形/法术长方形/武器圆形原画窗、非破坏性原画焦点与缩放裁剪，以及默认不展示但始终持久化的趣闻信息。第三类内部仍使用兼容类型 `equipment`。
- 设定—卡牌关联现在可从世界观条目中解除，解除只移除该卡的当前 `loreRef`，卡牌与其他来源保持不变且可重新绑定。
- AI 设定助手新增图片参考区：可选择当前设定、关联卡牌或上传资源的画作，并按 Responses / Chat Completions 的多模态格式发送；不支持视觉输入的模型会显示明确错误。
- 世界观架构接入视觉资产闭环：设定条目可反向绑定已有卡牌、查看关联卡面与视觉原型，并从设定侧直接生图；卡牌和设定候选图均支持大图查看。
- 新增本地参考图资源上传与 Seedream 图生图：支持 PNG/JPEG/WebP、单图 8 MB、单次最多 10 张，可复用关联卡牌或设定的既有画作，生成资产记录参考资源 ID；卡牌会保存参考图组合用于系列卡面。ComfyUI 未配置参考图工作流时返回明确提示。测试总数增至 61。
- 修复生图接口空响应导致浏览器只显示 `Unexpected end of JSON input`：前端现在安全解析响应并显示 HTTP 状态与请求 ID；连接中断后只按请求 ID轮询本地资产库找回已完成图片，绝不自动重复调用可能付费的生图服务。服务端新增不含提示词的请求起止日志和请求 ID资产追踪。
- AI 候选生成新增逐条验收与可见诊断：格式错误、字段越界或补充失败会在结果区展示校验原因，并可展开查看截断后的模型原始片段；合法候选不再随整包失败而消失。
- 候选数量不足时只请求并合并缺少的份数，初次已验收候选保持不变；动态 JSON Schema 的数组长度同步锁定到本次实际请求数量。新增 3 项 Harness 测试，Node 测试总数增至 57。
- 完成 V2.0-M2B 宏观地图 MVP：新增非正史 W98 合成群陆（12 地区、3 政体）、确定性季度规则，以及人口、粮食、工业、财政、稳定度、迁徙、贸易、外交与年度边界变化。
- 新增地图主界面、政体/人口/粮食/稳定图层、季度趋势、局部地区详情与事件流；W99 能源危机保留为折叠开发诊断区。
- 新增局部 LLM 提案 API：只发送选中地区的有限上下文，结构化行动必须经规则预校验和作者采纳；模型失败时使用规则回退。新增 4 项宏观服务/UI 测试，Node 测试总数增至 54。
- 完成 W99 全量自动推演闭环：新增确定性规则主体、最多 50 Tick 的有界运行、完成条件、事务重置、最终事件重放校验，以及“一键运行完整模拟”UI；初始 12 能源可在 7 Tick 后全部进入消耗池，重置后得到相同状态哈希。
- 新增 `POST /api/simulation/run` 与 `POST /api/simulation/reset`，通过 ADR-0014 固化“规则主体为可靠基线、LLM 为可降级提案器”的边界；新增 1 项服务测试，Node 测试总数增至 50。
- 完成 V2.0-M2A 实验模拟观察台：新增独立 W99 模拟服务与 SQLite 存档、`GET /api/simulation`、受控 `POST /api/simulation/advance`，并在单页产品中显示 Tick、状态版本、能源、主体 KnowledgeView、Action 审计与事件流。
- 新增竞争申请、主体转交、能源消耗和空 Tick 四种手动实验；浏览器实测竞争申请后保持总能源 12、一项接受一项拒绝且主体视野隔离。新增 3 项服务/UI 测试，Node 测试总数增至 49。
- 完成 ADR-0012 Action/Effect 契约加固：新增通用 Schema，机制注册表与 World Package 携带具体 Action/Effect、资源读写集和知识权限；运行时默认拒绝非法 Action、未登记 Effect、越权资源写入和越权知识策略。
- `MEC-001` 升至 `1.1.0`，W99 三种能源 Action 的参数契约、`resource.transfer` Effect 和权限声明参与定义包哈希；新增 2 项契约测试，Node 测试总数增至 46。
- AI 候选卡新增“应用到当前表单”：只覆盖模型本次返回的内容块且不立即落盘；背景故事候选会打开未保存的故事表单。世界地图生成契约明确加入与编辑器对应的“详细设定”。
- 新增独立“自由创作 Agent”，支持作者需求、关联信息、可选资料库索引与当前页面内的连续非结构化对话；不会自动保存资料或晋升正史。
- 新增常用工具区与名称生成器，可按命名对象、数量、要求和关联信息返回带说明的候选，并支持复制或回填当前资料名称。
- 新增 13 类资料的内容块契约与动态 JSON Schema；作者可只生成勾选的名称、正文、纪年、环境、类型属性、限制或开放问题，未选字段保持当前值。
- 完成 WorldForge 2.0 M1 纯规则最小纵切，并由 ADR-0011 固化确定性 Tick、统一效果结算、状态版本、快照重放与主体知识日志边界。
- 新增 W99 合成能源危机场景：一个城市、两个组织、一种守恒能源，以及申请、转交、消耗三种 Action；该场景显式为 experimental，不属于正史。
- 新增运行时机制注册、冻结读取上下文、确定性 PRNG 冲突排序、白名单 `resource.transfer` Resolver、非负余额和资源守恒检查。
- 模拟 SQLite Schema 升至版本 2，新增 Action、KnowledgeRecord、Snapshot、状态版本与实例状态；每 Tick 原子提交并为旧 M0B 实例回填快照。
- 新增 5 项 M1/迁移测试，覆盖三种行动、同 seed 冲突复现、资源守恒、过期写入拒绝、无隐藏值拒绝原因、知识隔离/过期、Tick 0 事件重放和 M0B 存档快照回填；Node 测试总数增至 43。
- 完成 WorldForge 2.0 V2.0-M0B：新增 JSON 发布清单、内容源、机制注册表与 World Package Schema，并由 ADR-0010 固化 JSON 契约。
- 新增确定性 World Package 编译器和 CLI：默认只发布 `canon`，显式隔离实验 `proposed`，按事实层次分区，校验 ID、引用、世界边界、机制版本/参数/依赖，并计算 SHA-256 内容哈希。
- 新增独立模拟 SQLite 存档：`sim_schema_migrations`、实例、地区、实体和事件基础表；实例嵌入完整定义包、定义哈希、随机种子与当前 Tick 0。
- 新增 W01 0.1.0 最小 JSON 发布清单及现有 canon 的机器投影；新增 8 项编译、依赖图和实例化测试，Node 测试总数增至 38。
- 完成 WorldForge 2.0 第一阶段 V2.0-M0A：新增 ADR-0008 定义作者工作区、Git 审核内容与 World Package 的发布边界，新增 ADR-0009 定义内容库迁移和未来 `sim_` 模拟命名边界。
- 新增 `storage-migrations.mjs`，按版本顺序、逐步事务化执行内容库 `0 → 1 → 2` 迁移，并拒绝打开高于当前服务支持版本的数据库。
- 新增迁移测试，覆盖新建库的有序迁移报告、v1 内容无损升级和未来版本拒绝；Node 测试总数增至 30。
- 新增 `simulation/` 和 `simulation/storage/` 边界文档，M0A 不创建任何模拟表或宣称模拟能力已实现。
- 建立首个 `init` Git 基线提交；提交前已核对忽略规则，`.data/`、`.env.local`、本机 SQLite 数据库和密钥不进入版本库。
- WorldForge 2.0 设计草案新增可版本化的模拟机制注册系统、按任务能力与多维配额路由的 LLM 模拟预算调度器，以及同时适用内外 Agent 的 `KnowledgeView` 模拟知识隔离。
- 新增 2026-10-13 项目进展报告，核对当前产品形态、27 项自动化检查、早期里程碑进度、2.0 能力缺口、Git 基线风险和建议优先级。
- 卡牌编辑器新增随从 / 法术 / 装备三分类、普通 / 稀有 / 史诗 / 传说稀有度，以及可多选的设定来源；人物、物品等实体化条目可直接预填待作者保存的卡牌草案。
- 新增旧 `unit / action / asset` 类型兼容迁移、卡牌来源与默认类型映射测试、ADR-0007；完整 JSON 导出升级到 schemaVersion 9。
- 时间线升级为编年史结构：一部编年史可挂载多个带纪年文本和数值排序的节点，支持同世界父级校验、按年代展示、搜索保留容器与旧时间线兼容；完整 JSON 导出升级到 schemaVersion 8。
- 世界地图层级新增“大陆”：大陆直接属于世界，国家必须归属大陆；创建入口与 AI 框架入口同步提升为大陆级，完整 JSON 导出升级到 schemaVersion 7。
- 新增提示词工程设置：13 类设定分别拥有可编辑提示词，支持恢复分类默认值，并提供作用于全部世界观生成的统一个性化风格提示。
- 新增独立示例层：每次生成自动选取最多 4 条同世界、同类型 canon 条目，作者还可添加只用于本次请求的临时示例。
- 新增“世界地图框架”入口，以世界、国家、地区、区域、城市、地点和路线的父子树组织地理资料；子级只显示在所属上级内部。
- 新增稳定 `location.parentId`、层级父级校验、旧地点待整理区、保留祖先路径的地理搜索，以及国家级 AI 框架准备入口；完整 JSON 导出升级到 schemaVersion 6。
- 新增第 13 类“背景故事”资料；人物、地点及其他条目可通过反向关联挂载多篇独立故事，故事也可显式关联其他故事。
- 新增“为当前条目新建故事”和 AI“生成背景故事”流程；AI 候选仅在作者勾选后保存为 `STORY-*` 的 `proposed / unknown` 草案。
- 新增背景故事模板、ADR-0006、故事提示边界测试，并将完整 JSON 导出升级到 schemaVersion 5。
- 新增火山方舟 Seedream 与本地 ComfyUI 双文生图通道；Seedream 采用 URL 返回并即时下载，ComfyUI 采用 API Format 工作流、队列轮询和输出下载。
- 新增卡面提示词语言模型优化、候选图选择与卡牌绑定，所有图片保持 `proposed` 且记录 provider、模型、尺寸、提示词和生成元数据。
- 新增 SQLite `art_assets` 表与持久卷图片目录，并将完整 JSON 导出升级到 schemaVersion 4。
- 新增 Seedream/ComfyUI 单元测试与 ADR-0005。
- 新增 SQLite 内容数据库，分表持久化设定、卡牌、关键词与备注，并通过 Docker `worldforge-data` 卷保存。
- 新增 `GET /api/health`、`GET /api/content` 与 `PUT /api/content`，包含输入校验、事务写入、revision 冲突保护和数据库健康检查。
- 新增旧 `localStorage` 数据自动迁移、跨 Origin 合并与迁移前浏览器缓存备份。
- 新增 SQLite 存储测试与 ADR-0004。
- 新增 tailnet-only 的 `/worldforge` HTTPS 访问入口，并增加子路径 API 路由回归测试。
- 新增独立 `ai-harness.mjs`，实现上下文筛选、字符预算、提示边界、原生 JSON Schema 请求、响应校验及兼容模型降级。
- AI 可为当前条目生成 2–5 份完整候选，支持多选、单选或不选；只有最终选择才保存为独立 `proposed` 草案。
- 新增 harness 单元测试，覆盖上下文优先级、跨世界隔离、候选数量提示、非法关联拒绝和双 API 结构化请求。
- 新增全局设置栏，包含 AI 服务、编辑偏好与数据管理三个分区。
- 新增服务端安全设置接口，可保存、更新或清除 API Key，并支持 Docker 持久化卷。
- 新增浅色、深色、跟随系统主题，舒适/紧凑密度，以及新资料默认世界、状态和事实层次。
- 新增 12 类写作设定资料编辑器，覆盖世界、地点、势力、角色、种族、文化、宗教、魔法、科技、物品、事件和时间线。
- 新增统一的状态、事实层次、类型专属属性、约束、开放问题、标签、关联、搜索、本地持久化及 JSON 导出。
- 新增零依赖 `server.mjs` 与 `.env.example`，从 `.env.local` 读取 LLM 配置并在服务端代理 OpenAI Responses API 或兼容 Chat Completions API。
- 初始化内容设计仓库的 M0 目录、模板与索引。
- 新增 W01 魔导工业世界概述草案，保持 `proposed` 状态。
- 新增可直接使用的静态 HTML 世界设计工作台，支持筛选、主题切换、本地草案保存与 JSON 导出。
- 新增静态函数文档与后续任务清单。
- 新增本地 Docker/Nginx 运行配置，固定使用 `127.0.0.1:4173`，包含健康检查、只读文件系统与自动重启策略。
- 导入作者提供的 W01 世界设定 V0.1，拆分归档至概述、物理、魔法、技术、社会、宗教与时间线文档。
- 新增 ADR-0003，记录 V0.1 中“已确定 / 推导 / 提案 / 待定”向仓库状态的映射。

### Changed
- 重做自由创作页面的响应式布局、对话输入区、可折叠参考资料和名称生成器表单，并更新 CSS/脚本缓存版本，修复部署后回落为裸原生控件的问题。
- Docker 构建上下文恢复纳入 World Package 编译 CLI，并把 `ai-content-specs.mjs`、`image-context.mjs` 加入运行时镜像；已重建 `worldforge:local`，保留 `worldforge-data` 卷并通过本机与 tailnet 健康检查。
- AI Harness 升级到 2.0.0，候选响应改为 `{ key, content }`，严格禁止返回未选内容块，并要求正文避开“本候选”“层次位置”“设计说明”等元话语。
- `storage.mjs` 不再无条件执行最终 Schema 并直接覆盖 `user_version`，而是委托显式迁移模块；健康信息增加本次启动的迁移起点与已应用步骤。
- Docker 镜像纳入 `storage-migrations.mjs`，`npm run check` 新增存储与迁移模块语法检查。
- WorldForge 2.0 设计草案升级为 V1.2：机制模块只返回效果候选并由统一 Resolver 提交；LLM 调度纳入模型能力、延迟、并发、费用和本地/云端数据策略；国家和组织 Agent 禁止读取未获得的隐藏真值。
- WorldForge 2.0 设计草案升级为 V1.1：补入现有单页工作台、Node 22、SQLite、AI/图像通道的实际基线；将 React/NestJS/PostgreSQL 改为指标触发的条件式迁移；增加 M0A 基线固化阶段，并将 M1 收窄为单城市、单资源纵切切片。
- AI Harness 升级到 1.1.0，将固定项目边界、分类提示、个性化风格、canon 示例、本次示例和相关上下文分层组合；分类与风格配置持久化到本机服务文件。
- 原“地图与地点”平铺列表改为世界分组的嵌套地理树；删除含子级的地理条目会被阻止，避免产生新的悬空地点。
- 背景故事编辑器收敛为“标题 + 正文 + 关联”：不再显示或保存摘要、约束、开放问题、标签、类型属性及状态/事实层次；AI 故事候选也只展示故事文本。
- 运行时内容的权威数据源从浏览器 `localStorage` 改为 SQLite；浏览器存储保留为缓存，编辑偏好仍只保存在当前浏览器。
- Docker 健康检查改为验证 SQLite 的 `/api/health`，Node.js 最低版本提升至 22.5。
- 浏览器设置与 AI 请求改为根据 `app.js` 的实际挂载目录构造 API URL，使根路径和 `/worldforge` 子路径部署使用同一镜像。
- AI 上下文从单一当前表单扩展为当前条目、显式关联、同世界 canon、同类型和共享标签资料，并按预算去重裁剪。
- AI 返回值从自由文本改为固定 `variants` JSON Schema；格式或数量错误最多触发一次修复请求。
- AI 配置从手工编辑 `.env.local` 改为优先通过界面完成；`.env.local` 保留为兼容入口。
- 将原只读世界观摘要改为可创建、编辑、删除本地草案的资料库；W01 基线继续作为只读种子资料展示。
- Docker 运行时由 Nginx 静态服务调整为 Node 静态服务与 AI API，同样只绑定 `127.0.0.1:4173`。
- 将 HTML 产品重构为简约的信息管理界面，明确拆分“世界观架构”和“卡牌设计”两个模块。
- 移除主题化的锻造文案、装饰性口号和深色叙事视觉，改为中性状态、目录、列表与规则准备度表达。
- 卡牌设计改为所见即所得卡面编辑：费用、攻击、血量和描述可直接修改并保存。
- 新增关键词定义、选择、卡面描述显示和随卡保存功能。
- 通过 ADR-0001 确认卡牌基础字段与显示位置，同时保留其他对战规则为待定。
- 关键词引用支持可选的卡牌级附加说明，并以“关键词：附加说明”显示和保存；旧版关键词 ID 引用保持兼容。
- 世界观模块更新为 W01 V0.1 摘要，展示能量、矿物、魔法体系、施法工程、神性边界和两条施法路径。
