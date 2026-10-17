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
| HTTP 服务与持久化 | [`server.mjs.md`](server.mjs.md)、[`storage.mjs.md`](storage.mjs.md)、[`storage-migrations.mjs.md`](storage-migrations.mjs.md)、[`reference-assets.mjs.md`](reference-assets.mjs.md) | 路由与请求校验、设置读写、SQLite 内容库与整库快照、图片资产落盘 |
| Agent Profile 契约与注册表 | [`agent-profile-contract.mjs.md`](agent-profile-contract.mjs.md)、[`agent-profile-registry.mjs.md`](agent-profile-registry.mjs.md)、[`agent-runtime.schema.json.md`](agent-runtime.schema.json.md)、[`.agent-presets/README.md`](.agent-presets/README.md) | 只读发现产品投影，Schema 校验 + 确定性指纹 + 11 个稳定错误码，投影损坏即拒绝启动 |
| AI 生成栈 | [`ai-harness.mjs.md`](ai-harness.mjs.md)、[`ai-agent.mjs.md`](ai-agent.mjs.md)、[`ai-tools.mjs.md`](ai-tools.mjs.md)、[`ai-content-specs.mjs.md`](ai-content-specs.mjs.md)、[`prompt-settings.mjs.md`](prompt-settings.mjs.md)、[`image-context.mjs.md`](image-context.mjs.md) | 提示词分层与上下文预算、内容块 Schema、多轮只读工具循环与硬上限（6 轮 / 12 次调用 / 4 图） |
| 生图通道 | [`seedream.mjs.md`](seedream.mjs.md)、[`comfyui.mjs.md`](comfyui.mjs.md) | 外部生图 API 边界：固定参数、占位符替换、超时与失败上报 |
| 模拟内核 | [`world-package.mjs.md`](simulation/compiler/world-package.mjs.md)、[`instance-store.mjs.md`](simulation/storage/instance-store.mjs.md)、[`simulation-runtime.mjs.md`](simulation/runtime/simulation-runtime.mjs.md)、[`mechanic-runtime.mjs.md`](simulation/rules/mechanic-runtime.mjs.md)、[`schemas/README.md`](simulation/schemas/README.md) | 编译 → 实例化 → 确定性 Tick → 快照/重放；规则权威、LLM 只提案 |
| 前端 | [`dist/README.md`](dist/README.md) | 零构建的全局脚本装配、视图渲染、浏览器侧缓存与首次迁移 |
| 交付与验证 | [`Dockerfile.md`](Dockerfile.md)、[`compose.yaml.md`](compose.yaml.md)、[`compose.nas.yaml.md`](compose.nas.yaml.md)、[`.github/workflows/ci.yml.md`](.github/workflows/ci.yml.md)、[`scripts/ci/smoke-container.mjs.md`](scripts/ci/smoke-container.mjs.md) | 镜像白名单 COPY 闭包、CI 三道关、容器冒烟 |

## 主要数据流

1. **作者编辑**：`dist/*.js` 从 `document.currentScript` 解析出 `api/` 前缀 → `fetch` 到 `server.mjs` 的 `/api/content` → `storage.mjs` 写入 SQLite（`WORLDFORGE_DATA_DIR`，默认 `.data/`）。浏览器 `localStorage` 只作缓存与旧数据迁移来源，不是真值。
2. **AI 生成**：入口（设定助手 / 自由创作）→ `server.mjs` 解析 preset 并拼三层指令 + 用户侧 `<untrusted_context>` → `ai-agent.mjs` 调用外部模型（轮次与工具硬上限）→ 逐候选校验 → 回填表单；候选不会自动晋升 `canon`。
3. **生图**：卡牌/设定页 → `/api/images/generate` → `seedream.mjs` 或 `comfyui.mjs` → 结果图落盘为美术资产并记录参考资源 ID；连接中断只按请求 ID 找回，不自动重发付费请求。
4. **模拟**：JSON 发布清单 → `scripts/compile-world-package.mjs` → 带内容哈希的只读 World Package → `simulation/storage/instance-store.mjs` 实例化到独立 SQLite（`worldforge-simulation.sqlite`）→ `simulation/runtime/` 确定性 Tick → `dashboard-service.mjs` / `macro-simulation-service.mjs` 投影为 `/api/simulation`、`/api/macro`。

## 全局不变量（跨模块）

- **作者主权**：`canon` / `proposed` / `deprecated` 与 `objective` / `in_world_belief` / `unknown` 由作者裁定；代码只在 `proposed` 一侧生成候选。
- **模拟域隔离**：模拟只读 Git 投影出的 JSON 发布清单，不写作者内容表；W97/W98/W99 是合成实验，不是正史。
- **不可信内容不上指令层**：作者笔记、资料库正文、示例只能出现在用户消息侧；preset 伪造分层标记会被注册表拒绝加载。
- **付费请求不自动重试**：生图长连接中断时前端只查询同一次请求已落盘的结果。
- **启动 fail-fast**：preset 投影或 Registry 有缺陷时服务拒绝启动并打印稳定错误码，不静默换 persona。
- **`dist/` 是源码而非构建产物**：文件被手工维护成少量超长行，没有打包步骤；改动后需同步 `index.html` 的 `?v=` 缓存版本。

## 覆盖与清单

- 当前 58 篇文档：54 篇文件级（镜像路径，如 `server.mjs` → [`server.mjs.md`](server.mjs.md)）+ 4 篇目录级汇档（`dist/`、`tests/`、`simulation/schemas/`、`.agent-presets/`）。
- [`manifest.json`](manifest.json) 记录 128 个源/配置/清单文件：54 个 `documented`、74 个 `aggregated`（指向所属目录级文档），并列出 7 类跳过规则的排除理由。
- 未收录（只在本文引用）：设计/ADR 文档 [`../../docs/PROJECT_DESIGN.md`](../../docs/PROJECT_DESIGN.md)、[`../../docs/WorldForge_2.0_Design_Document_V1.0.md`](../../docs/WorldForge_2.0_Design_Document_V1.0.md)、[`../../docs/adr/README.md`](../../docs/adr/README.md)；模拟模块关系 [`../../simulation/README.md`](../../simulation/README.md)；设定内容目录 `universe/`、`worlds/`、`mechanics/`、`cards/`、`templates/`；运行时数据库 `.data/*.sqlite*`；二进制素材 `dist/assets/`。
- [`html-product.md`](html-product.md) 是 2026-10-17 之前逐次交付的追加式归档（含当时的验证/未验证结论），保留原貌，不作为当前实现索引。

## 更新方式

1. 改源码后重跑对应文件文档；文件名变更时同步改文档名。
2. 用 `manifest.json` 比对源码 SHA-256：哈希未变且规则版本未变则跳过；新增文件补记录，删除或改名文件删文档。
3. 行号随源码变化，更新时必须重新解析；符号覆盖不等于符号详情，只为复杂/关键函数写 L2。
4. 目录级汇档（`tests/`、`simulation/schemas/`、`.agent-presets/`）在 manifest 中标记为 `aggregated`，新增成员只需补一行，不必新建文件。
