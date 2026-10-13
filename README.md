# Worldforge

原创多世界神性宇宙与策略卡牌内容设计仓库。

从 `docs/PROJECT_DESIGN.md` 开始阅读；使用 Codex 前请阅读 `AGENTS.md`。所有未明确批准的世界设定与卡牌均为草案。

当前聚焦：W01 魔导工业世界。作者提供的 V0.1 世界设定已按 `canon` / `proposed` / `unknown` 分层导入；此仓库不包含《武林戏》世界观及第三方 IP 内容。

当前实现基线、2.0 能力缺口与建议的增量迁移顺序见 `docs/PROJECT_PROGRESS_2026-10-13.md`；`docs/WorldForge_2.0_Design_Document_V1.0.md` 已按该基线校正为 V1.2 草案，并增加模拟机制注册、LLM 预算调度和内外 Agent 知识隔离。

WorldForge 2.0 第一阶段 V2.0-M0A 已完成：首次 `init` Git 基线、作者工作区到 World Package 的发布边界、SQLite 显式有序迁移，以及独立 `simulation/` 命名边界已建立。当前尚未实现 World Package 编译器或任何模拟能力。

## HTML 产品

Worldforge 提供“世界设定编辑器”和“卡牌设计”两个模块。设定资料库覆盖世界、世界地图、势力、角色、种族、文化、宗教、魔法、科技、物品、事件、编年史和背景故事，支持类型专属字段、状态/事实层次、双向可追踪的条目引用、搜索、SQLite 持久化与完整 JSON 导出。世界地图以“世界构成 → 大陆 → 国家 → 地区/区域 → 城市 → 地点”的地理树组织，国家、城市和地点只显示在所属上级内部；编年史由容器和按纪年排序的节点组成；每个设定条目还可挂载多篇独立背景故事。运行时记录不会自动写入仓库或晋升为正史。

卡牌草案分为随从、法术、装备，并记录普通、稀有、史诗、传说四档稀有度。人物、物品、魔法、事件等设定条目可预填一张带来源引用的未保存卡牌草案；一张卡可引用多个设定条目，联动不会自动生成规则文本、保存卡牌或改变任何正史状态。旧 `unit / action / asset` 草案会在读取时兼容为新三分类。

AI 设定助手会根据当前条目、显式关联、同世界 canon 以及同类型/共享标签资料构造受限上下文，并按固定 JSON Schema 返回 2–5 份独立候选。设置页可分别精调 13 类设定提示词，并配置作用于全部生成的个性化风格；生成时会把同世界、同类型的 canon 条目放入独立示例层，作者也可临时追加本次示例。候选生成后不会自动落盘；作者可多选、单选或全部不选，只有点击“保存所选为独立草案”后，选中的方案才会分别以 `proposed` 条目保存。“生成背景故事”只展示并保存故事标题与正文，随后挂载到当前条目；故事不带摘要、约束、开放问题或标签，也不自动视为客观正史。

卡牌编辑器支持两种文生图通道：火山方舟 Seedream API Key，以及本地 ComfyUI。Seedream 使用 `/api/v3/images/generations`、`response_format: url`、`size: 2K`、`watermark: true`；服务端会立即下载临时结果 URL。ComfyUI 需要粘贴“API Format”工作流，并在正向提示词处使用 `{{PROMPT}}` 占位符；还可使用 `{{NEGATIVE_PROMPT}}`、`{{WIDTH}}`、`{{HEIGHT}}` 和 `{{SEED}}`。生成前可调用已配置的语言模型优化提示词，优化结果会先回填供作者确认。所有生成图均为 `proposed` 候选，不会自动成为正式卡面或正史素材。

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

### Tailscale 访问

当前开发机已将 Docker 服务以 tailnet-only HTTPS 路由发布到：

<https://sisi-laptop.tail921448.ts.net/worldforge/>

该地址只对已获准加入当前 tailnet 的设备开放，不是公网 Funnel。Docker 端口仍只绑定 `127.0.0.1:4173`。在本机重新配置该子路径可使用：

```powershell
tailscale serve --bg --set-path /worldforge http://127.0.0.1:4173
```
