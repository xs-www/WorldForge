# WorldForge 静态代码文档（L0 总索引）

WorldForge 是一个零依赖 Node 22 ESM 本地应用：`server.mjs` 提供 HTTP API 与静态服务，`dist/` 是手写并直接服务的前端，SQLite 保存作者资料库与模拟存档，`simulation/` 是确定性世界模拟内核；同一仓库还承载 Markdown/YAML 设定与卡牌内容。

> 生成基线：commit `2533c8b`（2026-10-17），规则版本 `code-static-documentation@2.0 / compact`。本目录只读源码产出，不修改任何源文件；增量更新依靠 [`manifest.json`](manifest.json) 中每个源文件的 SHA-256。

## 从哪开始

| 想了解 | 先读 |
| --- | --- |
| 服务端全部 HTTP 路由、启动顺序、AI 入口契约 | [`server.mjs.md`](server.mjs.md) |
| 提示词为什么分六层、不可信内容如何隔离 | [`ai-harness.mjs.md`](ai-harness.mjs.md) |
| 预设（preset）如何被发现、校验、拒绝启动 | [`agent-profile-registry.mjs.md`](agent-profile-registry.mjs.md) |
| 世界定义如何编译成带哈希的只读 World Package | [`simulation/compiler/world-package.mjs.md`](simulation/compiler/world-package.mjs.md) |
| 前端脚本装配、API 前缀与全局耦合 | [`dist/README.md`](dist/README.md) |
| 测试覆盖了哪些契约 | [`tests/README.md`](tests/README.md) |

## 模块索引

| 模块 | 文档 | 职责 |
| --- | --- | --- |
| HTTP 服务与持久化 | [`server.mjs.md`](server.mjs.md)、[`auth.mjs.md`](auth.mjs.md)、[`storage.mjs.md`](storage.mjs.md)、[`storage-migrations.mjs.md`](storage-migrations.mjs.md)、[`reference-assets.mjs.md`](reference-assets.mjs.md)、[`scripts/auth-cli.mjs.md`](scripts/auth-cli.mjs.md) | 路由与请求校验、账号/会话/配额/审计、设置读写、SQLite 内容库与整库快照、图片资产落盘、账号 CLI |
| Agent Profile 契约与注册表 | [`agent-profile-contract.mjs.md`](agent-profile-contract.mjs.md)、[`agent-profile-registry.mjs.md`](agent-profile-registry.mjs.md)、[`agent-legacy.mjs.md`](agent-legacy.mjs.md)、[`agent-runtime.schema.json.md`](agent-runtime.schema.json.md)、[`.agent-presets/README.md`](.agent-presets/README.md) | 只读发现产品投影，Schema 校验 + 确定性指纹 + 11 个稳定错误码，投影损坏即拒绝启动；`WORLDFORGE_AGENT_LEGACY_PROMPTS=1` 时只把第 2 层 persona 退回固定提示 |
| AI 生成栈 | [`ai-harness.mjs.md`](ai-harness.mjs.md)、[`ai-agent.mjs.md`](ai-agent.mjs.md)、[`ai-tools.mjs.md`](ai-tools.mjs.md)、[`ai-content-specs.mjs.md`](ai-content-specs.mjs.md)、[`prompt-settings.mjs.md`](prompt-settings.mjs.md)、[`image-context.mjs.md`](image-context.mjs.md) | 提示词分层与上下文预算、内容块 Schema、多轮只读工具循环与硬上限（6 轮 / 12 次调用 / 4 图） |
| 设定导入（ADR-0033） | [`lore-import.mjs.md`](lore-import.mjs.md)、[`lore-import-files.mjs.md`](lore-import-files.mjs.md)、[`model-json-normalizer.mjs.md`](model-json-normalizer.mjs.md) | 长篇原文切分、记录格式契约与第 4–6 层提示词、跨段确定性合并、改写为资料格式与落库前复核；文件输入层解析 docx/xlsx/md/txt/zip，旧版 doc/xls 尽力抽取，rar/pdf 明确拒绝；通用「模型输出 → JSON」规范化层只修语法、不猜内容 |
| 生图通道 | [`seedream.mjs.md`](seedream.mjs.md)、[`comfyui.mjs.md`](comfyui.mjs.md) | 外部生图 API 边界：固定参数、占位符替换、超时与失败上报 |
| 模拟内核 | [`world-package.mjs.md`](simulation/compiler/world-package.mjs.md)、[`instance-store.mjs.md`](simulation/storage/instance-store.mjs.md)、[`simulation-runtime.mjs.md`](simulation/runtime/simulation-runtime.mjs.md)、[`mechanic-runtime.mjs.md`](simulation/rules/mechanic-runtime.mjs.md)、[`schemas/README.md`](simulation/schemas/README.md) | 编译 → 实例化 → 确定性 Tick → 快照/重放；规则权威、LLM 只提案 |
| 前端 | [`dist/README.md`](dist/README.md)、[`dist/login.html.md`](dist/login.html.md)、[`dist/login.js.md`](dist/login.js.md) | 零构建的全局脚本装配、视图渲染、浏览器侧缓存与首次迁移；登录页是独立文档，未登录时不加载应用外壳 |
| 数据搬运与资料组 | [`data-transfer.mjs.md`](data-transfer.mjs.md)、[`lore-groups.mjs.md`](lore-groups.mjs.md)、[`dist/lore-groups.js.md`](dist/lore-groups.js.md)、[`storage-postgres.mjs.md`](storage-postgres.mjs.md) | 导出/导入交换格式与合并策略；五项固定组 + 作者自定义组（跨端同一份表）；PostgreSQL 驱动的迁移、事务写锁与连接脱敏 |
| 交付与验证 | [`Dockerfile.md`](Dockerfile.md)、[`compose.yaml.md`](compose.yaml.md)、[`compose.nas.yaml.md`](compose.nas.yaml.md)、[`.github/workflows/ci.yml.md`](.github/workflows/ci.yml.md)、[`.github/workflows/acr-mirror.yml.md`](.github/workflows/acr-mirror.yml.md)、[`scripts/ci/smoke-container.mjs.md`](scripts/ci/smoke-container.mjs.md)、[`static-doc-anchors.mjs.md`](static-doc-anchors.mjs.md)、[`static-doc-manifest.mjs.md`](static-doc-manifest.mjs.md) | 镜像白名单 COPY 闭包、CI 三道关、容器冒烟、CI 成功后把 GHCR manifest 原样镜像到 ACR；两道静态文档门禁（`L###` 锚点唯一命中、清单哈希与磁盘一致） |

## 主要数据流

1. **作者编辑**：`dist/*.js` 从 `document.currentScript` 解析出 `api/` 前缀 → `fetch` 到 `server.mjs` 的 `/api/content` → `storage.mjs`（SQLite）或 `storage-postgres.mjs`（PostgreSQL）写入内容库。浏览器 `localStorage` 只作缓存与旧数据迁移来源，不是真值。资料组（含自定义组）随整库一起读写。
2. **账号与访问控制**：存在 `users.json` 时，`server.mjs` 在所有 API 之前校验 `wf_session` 会话；登录页（`dist/login.html` + `login.js`）提交到 `/api/auth/login`，`auth.mjs` 用 scrypt 校验口令并签发 HMAC 会话；`admin` 才能改设置与账号，成员按 UTC 日配额调用 AI/生图，内容保存记录 `lastSavedBy`。
3. **AI 生成**：入口（设定助手 / 自由创作 / 卡牌 Agent）→ `server.mjs` 解析 preset 并拼三层指令 + 用户侧 `<untrusted_context>` → `ai-agent.mjs` 调用外部模型（轮次与工具硬上限）→ 逐候选校验 → 回填表单；候选不会自动晋升 `canon`。
4. **生图**：卡牌/设定页 → `/api/images/generate` → `seedream.mjs` 或 `comfyui.mjs` → 结果图落盘为美术资产并记录参考资源 ID，同时按目标所在世界写入 `worldId`（ADR-0034）；连接中断只按请求 ID 找回，不自动重发付费请求。
5. **数据搬运**：`GET /api/export`（可选内嵌图片）→ 交换格式 JSON；`POST /api/import` → `data-transfer.mjs` 解析/合并 → 同一个内容库 → 图片落盘并登记美术元数据。预检与真实导入共用校验。
6. **模拟**：JSON 发布清单 → `scripts/compile-world-package.mjs` → 带内容哈希的只读 World Package → `simulation/storage/instance-store.mjs` 实例化到独立 SQLite（`worldforge-simulation.sqlite`）→ `simulation/runtime/` 确定性 Tick → `dashboard-service.mjs` / `macro-simulation-service.mjs` 投影为 `/api/simulation`、`/api/macro`。
7. **设定导入**：主界面粘贴长篇原文或上传文档 → `POST /api/lore-import/extract`（`lore-import-files.mjs`：docx/xlsx/md/txt/zip 读成文本，压缩包逐条校验内部格式；不写库、不计配额）→ `POST /api/lore-import/parse`（`lore-import.mjs` 切分 + 设定入口 preset 分段抽取 + 确定性合并 + 分类落组 + 跳过重复 → 预览计划，不写库、按段计费）→ 作者逐条勾选 → `POST /api/lore-import/commit`（复核后追加一个新世界或并入当前世界，`expectedRevision` 乐观锁）。导入结果全部 `proposed`。

## 全局不变量（跨模块）

- **没有默认世界**：新装实例不含任何世界或题材种子；缺失的世界归属显示为「未归属资料」桶，而不是算进某个默认世界。
- **卡牌与原画按世界归属（ADR-0034）**：卡牌草案必须带 `worldId`（编辑器下拉必选，旧数据缺世界时显示「未归属」等待补选）；原画不存独立世界字段，而是在 `GET /api/art-assets` 与导出时按绑定目标（卡牌 / 设定条目）从内容库现算，解除绑定即清空。卡牌库与原画集都提供世界筛选，跨世界引用设定只提示、不阻止。
- **作者主权**：`canon` / `proposed` / `deprecated` 与 `objective` / `in_world_belief` / `unknown` 由作者裁定；代码只在 `proposed` 一侧生成候选。
- **导入只追加且不重复**：设定导入（`/api/lore-import/commit`）只写入一个新世界（或并入目标世界）及其 `proposed` 条目，不改动任何既有条目、不写 canon、不写回仓库；解析阶段（`/api/lore-import/parse`）不写库，只在作者确认后才落盘。解析与确认各做一次「目标世界内同类型 + 同名」去重，因此同一份设定可以分多次导入补齐。
- **模拟域隔离**：模拟只读 Git 投影出的 JSON 发布清单，不写作者内容表；W97/W98/W99 是合成实验，不是正史。
- **不可信内容不上指令层**：作者笔记、资料库正文、示例只能出现在用户消息侧；preset 伪造分层标记会被注册表拒绝加载。
- **输出外壳不依赖供应商支持**：`response_format` / `text.format` 只是加固，不是外壳的唯一来源。设定与卡牌入口都必须把 `{"variants":[…]}`、`key`、已勾选键写进 prompt 第 5 层，解析侧再宽松收敛（裸候选对象、顶层数组、夹带围栏）+ 候选缺 `key` 时补 `candidate-N`；只支持 `json_object` 的兼容接口不得让整次生成失败，降级原因由响应里的 `fallbackReason` 如实回显。
- **解析 agent 不负责 JSON**：设定导入把内容契约写成人类可读的记录格式（`@@ 段` + `字段：值`），不发送 `json_schema`；模型输出由 [`model-json-normalizer.mjs`](model-json-normalizer.mjs.md) 统一规范化（先修 JSON、再解析记录格式），只修语法、不猜内容。其它入口若也遇到「模型写不好 JSON」，优先复用这一层，而不是在各自入口里再写一套修复。
- **付费请求不自动重试**：生图长连接中断时前端只查询同一次请求已落盘的结果。
- **启动 fail-fast**：preset 投影或 Registry 有缺陷时服务拒绝启动并打印稳定错误码，不静默换 persona。唯一例外是显式回滚开关：只有 `WORLDFORGE_AGENT_LEGACY_PROMPTS` 精确等于 `1` 才降级启动，并由 `/api/health` 明确报告 `degraded`。
- **账号 fail-closed**：存在 `users.json` 即要求会话；`WORLDFORGE_REQUIRE_AUTH=1` 时账号库缺失或损坏一律拒绝启动。匿名模式只是本机开发路径，启动日志会明确警告；未登录的页面导航返回登录页。
- **回滚只换 persona**：回滚模式下第 1 层安全边界、第 3 层入口契约、Schema、工具白名单、轮次上限与 canon 纪律全部不变；`presetHash` 回显为空串、版本固定为 `0.0.0-legacy`。
- **`dist/` 是源码而非构建产物**：文件被手工维护成少量超长行，没有打包步骤；改动后需同步 `index.html`（与 `login.html`）的 `?v=` 缓存版本。

## 覆盖与清单

- 当前 71 篇文件级文档（镜像路径，如 `server.mjs` → [`server.mjs.md`](server.mjs.md)）+ 4 篇目录级汇档（`dist/`、`tests/`、`simulation/schemas/`、`.agent-presets/`）。
- [`manifest.json`](manifest.json) 记录 163 个源/配置/清单文件：71 个 `documented`、91 个 `aggregated`（指向所属目录级文档）、1 个 `config`，并列出 7 类跳过规则的排除理由。
- 清单哈希由 `node static-doc-manifest.mjs --check` 强制（已接入 `npm run check`）：任何条目与磁盘不一致都会以 `HASH_MISMATCH` 失败，改源码后必须 `--write` 重算。
- 未收录（只在本文引用）：设计/ADR 文档 [`../../docs/PROJECT_DESIGN.md`](../../docs/PROJECT_DESIGN.md)、[`../../docs/WorldForge_2.0_Design_Document_V1.0.md`](../../docs/WorldForge_2.0_Design_Document_V1.0.md)、[`../../docs/adr/README.md`](../../docs/adr/README.md)；模拟模块关系 [`../../simulation/README.md`](../../simulation/README.md)；设定内容目录 `universe/`、`worlds/`、`mechanics/`、`cards/`、`templates/`；运行时数据库 `.data/*.sqlite*`；二进制素材 `dist/assets/`。
- [`html-product.md`](html-product.md) 是 2026-10-17 之前逐次交付的追加式归档（含当时的验证/未验证结论），保留原貌，不作为当前实现索引。

## 更新方式

1. 改源码后重跑对应文件文档；文件名变更时同步改文档名。新增源码文件要同时补 `manifest.json` 条目（`documented` 或 `aggregated`）与 `counts`，否则 `static-doc-manifest.mjs --check` 会以 `COUNT_MISMATCH` 失败。
2. 用 `manifest.json` 比对源码 SHA-256：哈希未变且规则版本未变则跳过；新增文件补记录，删除或改名文件删文档。
3. 行号随源码变化，更新时必须重新解析；符号覆盖不等于符号详情，只为复杂/关键函数写 L2。
4. 目录级汇档（`tests/`、`simulation/schemas/`、`.agent-presets/`）在 manifest 中标记为 `aggregated`，新增成员只需补一行，不必新建文件。
