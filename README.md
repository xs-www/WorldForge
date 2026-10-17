# Worldforge

原创多世界神性宇宙与策略卡牌内容设计仓库。

当前版本：**0.2.1**（2026-10-17）。该版本把三个 DSH Agent preset 接入设定助手、自由创作与卡牌三个入口，并配套回滚开关、分入口设置、静态文档双门禁与容器化；世界设定与卡牌数值仍为草案 / `untested`，不代表规则定稿。

仓库级 DSH 智能体预设位于 [`.agent-presets/`](.agent-presets/README.md)。当前包含卡牌设计、结构化设定写作与自由创作聊天三种模式；它们以相对路径携带 persona、最小工具组合和专项技能，可作为 DSH Agent preset root 使用或复制到用户 preset 目录。每个 preset 额外携带 WorldForge 产品侧的只读投影：`worldforge.runtime.json`（契约见 [`docs/schemas/agent-runtime.schema.json`](docs/schemas/agent-runtime.schema.json)）与 `runtime/system.md`。产品只读这两个纯数据文件，永不解析或执行含 `!!js` 的 `agent.cordis.yml`，该边界由 [ADR-0029](docs/adr/ADR-0029-agent-profile-runtime-projection.md) 固定。

将这些 preset 接入 WorldForge 产品内 AI 入口的分阶段方案见 [`docs/AGENT_PRESET_INTEGRATION_SPRINT_PLAN_2026-10-17.md`](docs/AGENT_PRESET_INTEGRATION_SPRINT_PLAN_2026-10-17.md)。Sprint 0–5 已全部签收（Sprint 5 于 2026-10-17 正式签字），三个入口的选择器、回滚开关与降级启动均已上线；该文档保留为实施与验收记录。

Sprint 0–2 已完成：产品侧 `agent-profile-registry.mjs` 在启动时扫描固定根目录 `.agent-presets/`，用 [`agent-runtime.schema.json`](agent-runtime.schema.json)（`docs/schemas/` 的部署副本，两份由测试断言一致）严格校验每份投影，拒绝未知枚举、额外字段、目录名不符、重复 ID、绝对路径、路径穿越、符号链接逃逸与超长 prompt，并为每个 preset 计算确定性 SHA-256 指纹。`GET /api/ai/presets` 返回脱敏元数据与三个入口的默认映射，`GET /api/health` 增加 `agentProfiles` 摘要；投影损坏或任一入口缺少 preset 时服务拒绝启动并打印稳定错误码，不会静默改用其他 persona。

Sprint 2 起，设定助手与自由创作**真正使用** Registry 中的 preset：提示词按 ADR-0029 §7 拼成三层——产品固定的安全边界、preset 的 `runtime/system.md`、入口自身的输出契约（作者分类提示词、本次任务要求与不可信上下文随后附上）。preset 只能替换中间那一层，无法覆盖安全边界或输出契约；`runtime/system.md` 若伪造产品分隔标记会被拒绝加载。请求可选带 `presetId`，未知或不兼容的 preset 在调用模型前就返回 400；三个响应都会回显 `agent: { presetId, presetVersion, presetHash, mode }`，自由对话每轮与设定助手候选区都会显示本轮实际使用的 preset，客户端无法伪造版本或哈希。工具仍只由服务端白名单映射（`free_lore_readonly` → 现有五个只读工具），轮次、工具调用与单轮附图硬上限不受 preset 影响。Docker 镜像只复制 Registry 需要读取的 6 个投影文件，不含 `agent.cordis.yml`、`skills/` 或设计目录。

Sprint 3 起可以按入口选择 preset：设置页「Agent 模式」为设定助手、自由创作、卡牌设计各提供一个选择器，只列出与该入口兼容的 preset，选择保存在服务端的 `agent-settings.json`（与 `.env.local`、`prompt-settings.json` 分离，原子写入）。解析优先级是「请求快照 > 保存的默认值 > 随仓库默认值」；自由对话顶部可选择本次对话使用的 preset，有历史时会先确认并开启新对话，气泡会显示该轮实际使用的 Agent。preset 错误（未知、跨入口误用、设置文件不可用）与模型服务错误在界面上分开提示；已保存的 preset 若被删除，服务端保留该选择并返回明确错误，不会静默改选另一个 persona。

Sprint 4 起卡牌编辑器也接入 Agent：可收起的「卡牌 Agent」面板支持构思、润色、补全规则文本、调整数值与对齐设定五种操作，只返回勾选字段的补丁（**评审由作者完成**，不产出评审字段），可回填表单或另存为独立草案；数值固定 `untested`，未勾选字段保持作者原值，未提供的关键词、设定或脚本效果一律拒绝。卡牌上下文只包含当前草案、卡牌引用的 lore 内容与关键词定义，不读取数据库或模拟状态。

Sprint 5 提供回滚与降级：设置环境变量 `WORLDFORGE_AGENT_LEGACY_PROMPTS=1` 并重启后，三个入口改用代码内的固定 persona——只替换提示词第 2 层，产品安全边界、入口契约、Schema、工具白名单、轮次上限与 `canon`/`proposed` 纪律都不变，响应里的 Agent 快照固定为 `legacy-fixed-prompt` / `0.0.0-legacy` / 空哈希，前端与 `/api/settings` 显示「固定提示（回滚模式）」。该开关只接受精确值 `1`，且不在界面上暴露；移除后重启即恢复选中 preset 的行为。Registry 投影损坏时默认仍拒绝启动，只有该开关打开才降级启动，并由 `/api/health` 明确报告 `degraded`。

从 `docs/PROJECT_DESIGN.md` 开始阅读；使用 Codex 前请阅读 `AGENTS.md`。所有未明确批准的世界设定与卡牌均为草案。

当前聚焦：W01 魔导工业世界。作者提供的 V0.1 世界设定已按 `canon` / `proposed` / `unknown` 分层导入；此仓库不包含《武林戏》世界观及第三方 IP 内容。

当前实现基线、2.0 能力缺口与建议的增量迁移顺序见 `docs/PROJECT_PROGRESS_2026-10-13.md`；`docs/WorldForge_2.0_Design_Document_V1.0.md` 已按该基线校正为 V1.2 草案，并增加模拟机制注册、LLM 预算调度和内外 Agent 知识隔离。

WorldForge 2.0 第一阶段 V2.0-M0A 已完成：首次 `init` Git 基线、作者工作区到 World Package 的发布边界、SQLite 显式有序迁移，以及独立 `simulation/` 命名边界已建立；该阶段本身不包含模拟能力。

V2.0-M0B 已完成最小定义编译与实例基础：JSON 发布清单可编译为带版本和内容哈希的只读 World Package，默认排除未显式发布的 `proposed` 内容；机制注册表会校验版本、参数与依赖图；定义包可实例化到独立 SQLite 存档。该阶段本身不包含 Tick 和结算。

V2.0-M1 已完成纯规则纵切：W99 合成实验场景用一个城市、两个主体、一种守恒能源和三种行动验证确定性 Tick、状态版本、Validator/Resolver、事件日志、逐 Tick 快照、事件重放和主体 KnowledgeView。W99 不属于正史；当前没有 LLM 模拟或通用外部实例 API。

M1 后续契约加固已完成：Action/Effect Schema、机制资源读写集和知识权限随 World Package 发布并参与哈希；运行时在业务校验前拒绝非法 Action，在状态提交前拒绝未登记 Effect、越权资源写入和越权知识策略。该边界为后续 LLM Action 提案和外部实例 API 提供默认拒绝的安全入口。

V2.0-M2A 已提供首个可见模拟闭环：顶部“世界模拟”打开 W99 实验观察台，可查看 Tick、状态版本、城市/主体能源、行动审计、事件流和逐主体 KnowledgeView，并用四种预设手动推进。数据进入独立 `worldforge-simulation.sqlite`，不会修改作者资料库或 W01 正史。

M2A.1 已把该闭环扩展为可重复的完整自动推演：点击“运行完整模拟”后，两个确定性规则主体会自主申请、转交和消耗能源，系统逐 Tick 执行契约校验、结算、审计、知识写入与快照，直到能源危机结束，并自动从 Tick 0 重放验证最终状态；可用“重置实验”恢复相同初始条件。该路径不依赖 LLM，后续模型提案失败时也可降级到规则主体。

V2.0-M2B 已交付首个地图式宏观 MVP：W98 合成群陆包含 12 个地区与 3 个政体，确定性季度规则推进人口、粮食、工业、财政、稳定度、迁徙、贸易、关系与边界；地图可按多种指标观察。选择地区后，LLM 只读取局部有限上下文并提出一个结构化行动，行动只有经规则校验且由作者采纳才会进入下一季度；模型失败会降级为规则建议。W98 与 W99 都是非正史实验。

## HTML 产品

产品现在包含一个独立的“测试对战”模块。它使用 W97 合成套牌和固定种子，提供本地玩家对确定性规则对手的最小闭环，并实现疾启、护持、隔绝和余响四类受控关键词。整个对战器仍为 `experimental / untested`，不读取或修改 W01 正史、作者卡牌草案与世界模拟存档。

Worldforge 提供“世界设定编辑器”“卡牌设计”和“自由创作”三个模块。设定资料库覆盖世界、世界地图、势力、角色、种族、文化、宗教、魔法、科技、物品、事件、编年史和背景故事，支持类型专属字段、状态/事实层次、双向可追踪的条目引用、搜索、SQLite 持久化与完整 JSON 导出。关联资料通过可搜索、可按类型/世界/状态过滤的分栏选择窗口挑选，窗口内同时显示全量资料池与已选关联，失效引用会单独标出；同一个窗口也用于卡牌编辑器的「设定来源」与自由创作的「参考资料」，自由创作在已选条目时只把所选条目作为资料库索引发送。世界观架构分为两级：进入模块先看到世界面板，点进某个世界后才显示该世界的全部资料；列表、标签计数、地理树、编年史与关联都按世界隔离，没有对应世界条目的资料会显示为可一键归入的未归属面板。世界地图以“世界构成 → 大陆 → 国家 → 地区/区域 → 城市 → 地点”的地理树组织，国家、城市和地点只显示在所属上级内部；编年史由容器和按纪年排序的节点组成；每个设定条目还可挂载多篇独立背景故事。运行时记录不会自动写入仓库或晋升为正史。

卡牌草案分为随从、法术、武器（内部兼容类型仍为 `equipment`），并记录普通、稀有、史诗、传说四档稀有度。三类卡共用统一底板、尺寸与主色，只通过蛋形、长方形和圆形原画窗区分；随从显示攻击/生命数值，法术不显示底部属性，武器显示攻击/耐久数值，卡面不再额外标注属性名称。随从可标注种族、法术可标注派系，两者都显示在卡面底部中央；编辑器预览与保存后编译的卡面使用同一排布，即预览所见即最终卡面。卡牌库、原画集与创建/编辑器是互斥的独立视图；原画集覆盖素材库全部原画，默认显示已使用素材，可切换到未使用或全部；卡牌库提供搜索、类型/稀有度筛选和分页，点击卡牌进入编辑器。关键词按添加顺序逐行编辑，保存与展示时编译为“独立关键词 → 带附加描述关键词 → 普通文本”；关键词名加粗并在同一规则框内连续排版、自动换行。关键词附加说明和普通文本支持有限富文本：`<b>...</b>` / `**...**` 表示粗体，`<i>...</i>` / `*...*` 表示斜体；其他 HTML 不执行。卡牌库不再拼装 HTML 缩略图，而是展示由同一数据和裁剪参数生成的 PNG 卡面。原画支持在卡面上直接拖动、滚轮缩放及滑杆精调，每张卡还会保存默认不显示在卡面的趣闻信息。原画下载使用稳定美术资产 ID 作为文件名。人物、物品、魔法、事件等设定条目可预填一张带来源引用的未保存卡牌草案；一张卡可引用多个设定条目，联动不会自动生成规则文本、保存卡牌或改变任何正史状态。旧 `unit / action / asset` 草案会在读取时兼容为新三分类。

AI 设定助手会根据当前条目、显式关联、同世界 canon 以及同类型/共享标签资料构造受限上下文。助手是浮动子窗口，可最小化成竖条或关闭后从边缘重开，因此不占用资料工作区的横向空间；候选可只生成 1 份，也可用「覆盖当前条目」一步替换已勾选内容块并保存。作者还可从当前设定、关联卡牌和上传资源中选择图片，让支持视觉输入的模型同时参考文字与画面；不支持视觉的模型或兼容接口会返回明确错误。13 类资料各自拥有专门的内容块契约；作者可勾选只生成名称、正文、纪年、限制等需要的部分，服务端只为选中内容块建立动态 JSON Schema，未选字段原样保留。生成文字要求可直接回填，不输出“本候选”“层次位置”或 Schema 说明。返回内容会逐候选验收：合法候选立即保留，数量不足时只请求缺少的份数；未通过校验的原因和模型原始片段可在结果区展开查看。每份候选既可应用到当前表单并由作者确认后保存，也可多选保存为独立 `proposed` 草案；两种操作都不会自动晋升正史。

“自由创作 Agent”独立于各模块助手，不要求 JSON 或固定格式，可由作者提供需求、关联信息和可选资料库索引进行连续对话；它具备多轮只读工具调用能力，可以在回答前按需检索并读取词条正文、约束与开放问题，也可以直接查看美术资产的实际画面（视觉原型、卡牌原画），检索与附图轨迹在对话中可见，每条消息下方还会显示这一轮实际携带的参考资料与图片附件预览；作者可以从素材库挑选图片作为附件（单条消息最多 4 张，发送后自动清空）。工具只读，不会把 `proposed` 草案当作正史，也不会读取卡牌草案或模拟状态。对话不自动写入资料库。常用工具区首批提供名称生成器，候选可复制或回填当前资料名称，后续可继续扩展其他轻量工具。

世界观条目与卡牌编辑器共用视觉资产库和大图查看器。设定侧可绑定或解除绑定已经存在的卡牌、查看卡牌画作并生成世界、人物、地点或物品视觉原型；两侧均可上传 PNG、JPEG、WebP 参考图，或复用关联对象的既有画作。Seedream 每次最多接收 10 张参考图，所用资源 ID 会随生成资产保存；本地上传单图限制为 8 MB。卡牌会保存当前参考图组合，便于连续生成同系列插画。ComfyUI 参考图输入尚未形成通用工作流契约，选择参考图时会明确要求切换 Seedream 或取消参考图。

卡牌编辑器支持两种生图通道：火山方舟 Seedream API Key，以及本地 ComfyUI。Seedream 使用 `/api/v3/images/generations`、`response_format: url`、`size: 2K`、`watermark: false`；服务端会立即下载临时结果 URL。ComfyUI 需要粘贴“API Format”工作流，并在正向提示词处使用 `{{PROMPT}}` 占位符；还可使用 `{{NEGATIVE_PROMPT}}`、`{{WIDTH}}`、`{{HEIGHT}}` 和 `{{SEED}}`。每次生图带唯一请求 ID；若长耗时连接中断，前端只查询本地资源库找回同一次请求已完成的图片，不会自动再次发起可能付费的生成。空响应或非 JSON 响应会显示 HTTP 状态和请求 ID供排查。生成前可调用已配置的语言模型优化提示词，优化结果会先回填供作者确认。所有生成图均为 `proposed` 候选，不会自动成为正式卡面或正史素材。

直接打开 `dist/index.html` 可使用除 AI 和服务端设置外的编辑功能。完整模式使用：

```powershell
npm start
```

访问 <http://127.0.0.1:8080>，点击右上角“设置”即可填写语言模型与 Seedream API Key、服务地址、模型、ComfyUI 地址和 API Format 工作流，精调分类/个性化提示词，并配置主题、界面密度与新资料默认值。API Key 仅写入本机服务配置，不会进入浏览器存储或导出文件。`.env.local` 仍作为高级用户的兼容配置方式。

### Docker 运行（推荐）

```powershell
docker compose up -d --build
```

启动后访问 <http://127.0.0.1:4173>。服务只绑定本机地址；停止服务使用：

```powershell
docker compose down
```

Docker 会运行同一个零依赖 Node 服务；模型设置、ComfyUI 工作流、`worldforge.sqlite` 数据库与生成图片进入专用 `worldforge-data` 持久化卷，容器重建后仍保留。设定、卡牌、关键词和备注由 SQLite 统一保存，因此本机与 Tailscale 地址读取同一份内容；浏览器存储只作为缓存及旧数据迁移来源。Docker 内访问宿主机 ComfyUI 默认使用 `http://host.docker.internal:8188`。若存在 `.env.local`，Compose 也会将其作为初始配置注入容器。镜像不包含 `.env.local`、世界观源文档或 Git 数据。

SQLite 使用 Node 22 内置驱动，本机运行需要 Node.js 22.5 或更高版本。数据库不会自动同步到仓库；需要长期归档时仍应使用完整 JSON 导出或后续的数据库备份功能。

### GitHub Actions 构建镜像，NAS 只拉取运行

`.github/workflows/ci.yml` 把「构建」和「运行」分开：镜像由 GitHub 的 runner 构建并推送到 GHCR，NAS 不需要源码，也不需要在那里编译。

流水线分三道关，顺序固定：

| 任务 | 触发条件 | 内容 |
| --- | --- | --- |
| `check` | 所有 push 与 PR | `npm run check`：全部源码语法检查 + 195 项单元测试 |
| `image-smoke` | 所有 push 与 PR | 真实构建镜像，用 compose 同款参数（`--read-only` + `/data` 挂载）启动容器，再由 `scripts/ci/smoke-container.mjs` 断言健康端点、三个 preset 投影、静态界面、SQLite 与模拟存档 |
| `publish` | 仅 `main` 推送与 `v*` 标签，且前两关已通过 | 构建 `linux/amd64` + `linux/arm64`，推送 `ghcr.io/xs-www/worldforge` |

`image-smoke` 存在的理由：`Dockerfile` 用显式白名单 `COPY` 服务端模块，漏登记时镜像仍能构建成功，但容器启动即 `ERR_MODULE_NOT_FOUND`；Preset 投影漏拷则会被 Registry 的完整性门拒绝启动。只检查「构建成功」会把这两类问题留到 NAS 上才暴露。

标签策略：`main` 分支产出 `latest`、`main` 和 `sha-<短哈希>`；`v1.2.3` 标签额外产出 `1.2.3` 与 `1.2`。PR 不推送镜像。

启用步骤：

1. 仓库推到 GitHub（`origin`）后，在 Settings → Actions → General 允许 Actions 运行；Workflow permissions 保持默认的 `GITHUB_TOKEN` 即可，`publish` 用 job 级 `packages: write` 推送镜像。
2. 首次发布后 Packages 里会出现 `worldforge`。要免登录拉取就在包设置中改为 public；保持私有则在 NAS 上先 `docker login ghcr.io`（PAT 勾选 `read:packages`）。
3. NAS 上使用只含 `image:` 的 `compose.nas.yaml`：

```powershell
docker compose -f compose.nas.yaml pull
docker compose -f compose.nas.yaml up -d
```

群晖 Container Manager / QNAP Container Station 新建「项目」时，把 `compose.nas.yaml` 的内容粘贴进 YAML 编辑框即可，拉取与重启语义相同。数据目录通过 `WORLDFORGE_DATA_DIR` 指向 NAS 本地磁盘卷上的目录；不要用 SMB/NFS 共享或 CloudSync 之类的同步目录，SQLite 依赖 POSIX 文件锁。

`compose.nas.yaml` 与 `compose.yaml` 的差异只在部署形态：前者拉取 GHCR 镜像并绑定全部网卡，后者从本地源码构建并绑定 `127.0.0.1`。两者共用同一套环境变量契约。ComfyUI 通道保留，`COMFYUI_BASE_URL` 与 `extra_hosts: host.docker.internal:host-gateway` 都在，真要在这台机器上出图时改成能访问到 ComfyUI 主机的地址即可。注意 `compose.nas.yaml` 绑定全部网卡是为了局域网与 tailnet 访问；本应用没有登录与权限控制，设置页可直接改写 API Key，不要把它映射到公网。

升级：CI 推完新的 `latest` 后在 NAS 上重跑上面两条命令，或用 NAS 自带的任务计划定时执行。镜像内已带 `HEALTHCHECK`，健康端点异常时 `docker ps` 会显示 `unhealthy`。

### Tailscale 访问

当前开发机已将 Docker 服务以 tailnet-only HTTPS 路由发布到：

<https://sisi-laptop.tail921448.ts.net/worldforge/>

该地址只对已获准加入当前 tailnet 的设备开放，不是公网 Funnel。Docker 端口仍只绑定 `127.0.0.1:4173`。在本机重新配置该子路径可使用：

```powershell
tailscale serve --bg --set-path /worldforge http://127.0.0.1:4173
```
