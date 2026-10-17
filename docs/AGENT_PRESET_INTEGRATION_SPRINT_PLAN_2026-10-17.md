# WorldForge Agent Preset 集成 Sprint 开发计划

- 文档状态：`proposed`
- 计划日期：2026-10-17
- 适用范围：WorldForge 产品内文字 Agent、仓库级 DSH Agent preset、设置与部署
- 不涉及：世界观 canon 晋升、正式卡牌规则裁定、模拟规则数值调整
- 默认节奏：1 个 Sprint = 5 个开发日；以 1 名主开发者估算，共 6 个 Sprint / 约 27 人日
- 执行进度：Sprint 0–4 已签收；Sprint 5 已按 §12.0.1 的八条约束实现回滚开关、降级启动、四组启动模式与 S5-03 冻结测试，见 §12.5。真实付费模型三入口验收与浏览器点击流程仍未执行（未获外发授权），因此 Sprint 5 整体不标记为「已验收」。

## 1. 执行摘要

仓库已经包含三个可被 DSH 发现的 Agent preset：

| Preset | 当前定位 | 产品内对应入口 |
|---|---|---|
| `lore-writer` | 结构化设定写作 | AI 设定助手 `/api/ai` |
| `free-creator` | 自然语言自由创作 | 自由创作 `/api/ai/free` |
| `card-designer` | 卡牌、关键词与机制设计 | 尚无文字 Agent 入口 |

这些 preset 当前只定义 DSH 会话的 persona、工具组合和 skill。WorldForge 产品服务端仍直接拼装固定系统提示、调用模型 API，并不知道 `presetId`。因此当前产品界面**不能选择 preset**，也无法记录某次生成使用了哪一个 preset 版本。

本轮迭代的目标是建立一条安全、可追踪、向后兼容的产品内 Agent Profile 链路：

```text
.agent-presets/<id>/
    ├─ DSH 组装：agent.cordis.yml + skills/
    └─ 产品投影：worldforge.runtime.json + runtime/system.md
                         │
                         ▼
              Agent Profile Registry
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  lore-writer      free-creator      card-designer
  严格内容块         自然语言工具循环      严格卡牌补丁
```

推荐采用“**同一 preset 的受限产品投影**”，而不是让 WorldForge 服务执行 `agent.cordis.yml` 或为每次请求启动 DSH 进程。这样可以复用现有零第三方运行时依赖、结构化 Schema、SQLite 边界和本地部署方式，也不会把 DSH 插件装载权限引入产品服务。

## 2. 当前基线

### 2.1 已有产品 AI 入口

| 入口 | 当前系统提示/契约 | 当前工具或输出 | 是否适合选择创作 preset |
|---|---|---|---|
| AI 设定助手 | `SYSTEM_INSTRUCTIONS` + 动态内容块提示 | 严格 JSON Schema，1–5 个候选 | 是，只允许 `structured_lore` |
| 自由创作 | `FREE_AGENT_INSTRUCTIONS` + 工具指南 | 五个只读资料/美术工具，多轮对话 | 是，只允许 `free_chat` |
| 名称生成器 | 固定短提示 | `NAME_RESPONSE_SCHEMA` | 否；保持工具型任务 |
| 卡牌插画提示词优化 | 固定转换提示 | 返回一段提示词 | 否；保持转换型任务 |
| 设定视觉提示词优化 | 固定转换提示 | 返回一段提示词 | 否；保持转换型任务 |
| W98 局部提案 | 宏观局部上下文提示 | `MACRO_PROPOSAL_SCHEMA` + Validator | 否；保持模拟专用契约 |
| Seedream / ComfyUI | 图像生成提供方 | 图片候选 | 不属于文字 Agent preset |

### 2.2 已有配置边界

- `/api/settings` 只管理 Base URL、模型、API 风格、密钥、图像服务和提示词设置。
- `prompt-settings.json` 只保存分类提示词、个性化风格和视觉提示词。
- 前端没有 Agent preset 列表、选择器、当前 preset 标识或版本信息。
- Dockerfile 使用显式白名单复制模块；`.dockerignore` 排除 `docs/`、大部分设计目录和 Markdown。
- 产品内自由 Agent 的五个工具由服务端强制只读；DSH `tool-fs` 同时包含读取、写入和编辑，二者不是同一权限系统。

### 2.3 已验证的 preset 基线

- 三个 preset 均具有 `agent.cordis.yml`、`preset.yml` 和入口 `SKILL.md`。
- DSH `scanRoot` 可以发现三者，且没有 `broken` 原因。
- 仓库测试拒绝 preset 引入 Shell、后台任务、子代理、工作流或机器绝对路径。

## 3. 目标、非目标与成功指标

### 3.1 本轮目标

1. 产品服务能够安全发现仓库随附 preset 的产品投影。
2. 设定助手、自由创作和卡牌助手分别选择兼容 preset，不能跨契约误用。
3. 默认选择保持现有设定助手与自由创作行为，不破坏已有模型设置和提示词设置。
4. 每次 AI 响应记录 `presetId`、版本与内容哈希，前端能够显示。
5. 卡牌编辑器获得第一个文字设计 Agent，只返回可审查补丁，不直接保存。
6. Docker、本机服务和子路径部署使用相同 preset 集合。
7. 未知、损坏、不兼容或被篡改的 preset 默认拒绝，并提供可理解的错误。

### 3.2 非目标

- 不执行 `agent.cordis.yml`、`!!js` 或第三方 DSH 插件。
- 不从 `~/.dsh/.agent-presets` 自动加载用户自定义 preset。
- 不把 WorldForge 产品改造成 DSH Host，也不为每次请求启动 DSH CLI。
- 不允许 preset 改写数据库权限、HTTP 路由、模型密钥或文件系统权限。
- 不让名称生成、图像提示词优化或 W98 模拟提案任意切换创作 persona。
- 不自动保存 AI 生成结果，不自动晋升 `canon`，不把静态平衡评审写成已测试结论。

### 3.3 可量化成功指标

- 三个创作入口的请求和响应都能追踪到唯一 preset 版本与哈希。
- 兼容性错误在模型调用前失败，不产生外部 token 或费用。
- 默认配置下现有设定助手和自由创作回归测试全部通过。
- 卡牌 Agent 的非法字段、未知关键词、越界引用和直接 `canon` 输出全部被拒绝。
- Docker 镜像不包含整个设计仓库，只包含经过白名单的 runtime manifest 与提示文件。
- `npm run check` 全通过；不以 mock 测试声称真实模型已经端到端验收。

## 4. 必须先固定的架构决策

### 4.1 DSH 组装与产品投影分离

`agent.cordis.yml` 是 DSH 插件组装文件，可能含 `!!js`，并依赖 DSH Host 的 registry、sandbox、permission、session 和 tool 服务。WorldForge 不能将它当作普通 prompt 文件解析。

每个可供产品使用的 preset 增加：

```text
.agent-presets/<preset-id>/
├─ agent.cordis.yml
├─ preset.yml
├─ worldforge.runtime.json
├─ runtime/
│  └─ system.md
└─ skills/
```

`worldforge.runtime.json` 建议契约：

```json
{
  "schemaVersion": 1,
  "id": "lore-writer",
  "version": "1.0.0",
  "displayName": "WorldForge 设定写作",
  "surfaces": ["lore"],
  "mode": "structured_lore",
  "systemPrompt": "runtime/system.md",
  "toolPolicy": "none",
  "outputContract": "lore_blocks_v2",
  "statusPolicy": "proposed_only"
}
```

允许枚举：

- `surfaces`：`lore`、`free`、`card`。
- `mode`：`structured_lore`、`free_chat`、`structured_card`。
- `toolPolicy`：`none`、`free_lore_readonly`、`card_context_readonly`。
- `outputContract`：注册表中已有的显式名称，不接受文件路径或任意模块名。

### 4.2 产品只加载固定根目录

第一阶段只读取随仓库/镜像发布的 `.agent-presets` 根目录。拒绝：

- 绝对路径；
- `..` 路径穿越；
- 符号链接逃出 preset 根目录；
- manifest ID 与目录名不一致；
- 未知字段、未知枚举、重复 ID；
- 超过长度限制的 prompt；
- 不兼容 surface/mode/output contract 组合。

### 4.3 提示词拼装顺序

固定优先级由高到低：

1. 产品不可编辑安全与能力边界；
2. preset `runtime/system.md`；
3. 当前入口的输出 Schema、工具协议和行为契约；
4. 作者保存的分类提示词与个性化提示词；
5. 当前任务要求；
6. 明确标为不可信的条目、示例、关联信息和图片说明。

任何 preset 都不能替换第 1、3 层。应在测试中检查同一约束只出现必要次数，延续 ADR-0025 的“约束放在真实监督点”原则。

### 4.4 选择作用域

推荐采用两层选择：

- 服务端保存每个 surface 的默认 preset；适合同一台作者工作站和 Docker 持久卷。
- 每次请求携带当前 `presetId` 快照；响应回显最终解析结果。

自由聊天切换 preset 时默认开启新对话。不得把新 persona 直接插入已有多轮历史，否则前后规则和语气不可追踪。

## 5. 目标 API 与数据契约

### 5.1 Preset 列表

`GET /api/ai/presets`

```json
{
  "schemaVersion": 1,
  "presets": [
    {
      "id": "lore-writer",
      "version": "1.0.0",
      "displayName": "WorldForge 设定写作",
      "description": "……",
      "surfaces": ["lore"],
      "mode": "structured_lore",
      "hash": "sha256:……"
    }
  ],
  "defaults": {
    "lore": "lore-writer",
    "free": "free-creator",
    "card": "card-designer"
  }
}
```

不得向浏览器返回系统提示全文、文件路径或 DSH 插件明细。

### 5.2 设置扩展

`GET /api/settings` 与受保护的 `POST /api/settings` 增加：

```json
{
  "agentPresets": {
    "lore": "lore-writer",
    "free": "free-creator",
    "card": "card-designer"
  }
}
```

建议单独持久化到 `agent-settings.json`，不要塞入 `.env.local`，也不要与作者可编辑的分类提示词混为一体。写入继续使用临时文件 + rename 原子替换。

### 5.3 通用响应元数据

三个 Agent 响应增加：

```json
{
  "agent": {
    "presetId": "lore-writer",
    "presetVersion": "1.0.0",
    "presetHash": "sha256:……",
    "mode": "structured_lore"
  }
}
```

日志只记录 ID、版本、哈希、模型、耗时、轮次与工具次数，不记录 API Key、完整正文或图片内容。

### 5.4 卡牌 Agent

新增 `POST /api/ai/card`，请求至少包含：

- `presetId`；
- 当前卡牌草案；
- 操作：`brainstorm`、`polish`、`rules_review`、`balance_review`、`lore_alignment`；
- 选中的字段；
- 允许引用的 lore ID、关键词 ID 与机制 ID；
- 作者本次补充要求；
- 候选数量 1–3。

响应只允许字段补丁：

```json
{
  "variants": [
    {
      "key": "candidate-a",
      "patch": {
        "name": "……",
        "cost": 3,
        "keywords": [],
        "effects": [],
        "rules_text": "……",
        "notes": ["数值未经测试"]
      },
      "review": {
        "legalTargets": "……",
        "timing": "……",
        "effectOrder": "……",
        "duration": "……",
        "counterplay": "……",
        "edgeCases": ["……"]
      }
    }
  ]
}
```

服务端必须在返回浏览器前再次验证：选中字段白名单、类型互斥、ID 白名单、关键词存在性、状态和数组上限。AI 不能直接调用保存接口。

## 6. Sprint 总览

| Sprint | 目标 | 估算 | 退出条件 |
|---|---|---:|---|
| Sprint 0 | 固化决策、契约和测试夹具 | 2 人日 | runtime manifest 与兼容矩阵经作者确认 |
| Sprint 1 | 实现安全 Registry、版本哈希和 Docker 打包 | 5 人日 | 三个 preset 可在本机与镜像中一致发现 |
| Sprint 2 | 接入设定助手与自由创作 | 5 人日 | 两个现有入口真正使用选定 preset，默认行为不回退 |
| Sprint 3 | 设置页选择、会话快照与可观测性 | 4 人日 | 用户可选择兼容 preset，切换语义明确 |
| Sprint 4 | 新增卡牌文字 Agent | 7 人日 | 可生成并应用受验证的 proposed/untested 卡牌补丁 |
| Sprint 5 | 安全加固、迁移、Docker 与真实验收 | 4 人日 | 自动化、容器、回滚和人工验收全部完成 |

总估算约 27 人日，不含真实模型故障排查、作者体验调整和未来自定义 preset 导入。

## 7. Sprint 0：契约固化与 ADR 门

### 7.1 目标

在修改运行时前，把“产品投影而非执行 DSH 组装”、兼容矩阵、选择作用域和卡牌输出边界固化为技术决策。

### 7.2 Backlog

| ID | 任务 | 产物 | 验收 |
|---|---|---|---|
| S0-01 | 起草 Agent Profile ADR | `docs/adr/ADR-####-agent-profile-runtime-projection.md` | 明确候选方案、拒绝执行 YAML/JS 的理由与未来扩展点 |
| S0-02 | 定义 `worldforge.runtime.json` Schema | `docs/schemas/agent-runtime.schema.json` | 能拒绝未知 mode、surface、tool policy 与额外字段 |
| S0-03 | 定义兼容矩阵 | ADR + 测试夹具 | lore/free/card 三类不能交叉误用 |
| S0-04 | 定义提示词层次 | ADR | 固定边界、preset、入口契约、作者提示、上下文顺序确定 |
| S0-05 | 建立三个 manifest/prompt 初稿 | 三个 preset runtime 文件 | 默认语义与现有提示相符，不改变产品行为 |

### 7.3 测试先行

- 合法 manifest fixture；
- 重复 ID、目录不符、未知字段、绝对路径、路径穿越、过大 prompt fixture；
- lore preset 被用于 free/card 时的拒绝 fixture；
- prompt 合并顺序 snapshot。

### 7.4 作者决策门

作者需要确认：

1. 是否接受产品只读取仓库随附 preset，不扫描用户 DSH 目录；
2. 是否接受自由聊天切换 preset 即新建对话；
3. 是否接受产品内 preset 选择按 surface 独立保存，而不是一个全局选择。

### 7.6 Sprint 0 执行记录（2026-10-17）

| 任务 | 产物 | 状态 |
|---|---|---|
| S0-01 | `docs/adr/ADR-0029-agent-profile-runtime-projection.md` | 完成（状态 `proposed`）：记录四个候选方案、拒绝执行 YAML/JS 的理由、兼容矩阵、提示词六层顺序、11 个稳定错误码、§10 作者签字门与未来扩展点 |
| S0-02 | `docs/schemas/agent-runtime.schema.json` | 完成：JSON Schema 2020-12，`additionalProperties: false`，未知 mode/surface/toolPolicy/outputContract/statusPolicy 与额外字段全部拒绝 |
| S0-03 | ADR §6 + `agent-profile-contract.mjs` + `tests/agent-profile-contract.test.mjs` | 完成：9 种 surface×mode×contract×toolPolicy 组合全量枚举，恰好 3 行合法；lore preset 用于 free/card 被拒绝；代码侧矩阵与 Schema、ADR 三重交叉校验 |
| S0-04 | ADR §7 + `tests/snapshots/agent-prompt-layers.json` | 完成：六层顺序 `product_boundary` → `preset_runtime` → `entry_contract` → `author_prompts` → `task_request` → `untrusted_context`；preset 只能贡献第 2 层；顺序由 snapshot 回归保护 |
| S0-05 | 三个 preset 的 `worldforge.runtime.json` + `runtime/system.md` | 完成：语义与 `SYSTEM_INSTRUCTIONS` / `FREE_AGENT_INSTRUCTIONS` 一致，未改动 `ai-harness.mjs`、`server.mjs` 或任何 API |
| 夹具 | `tests/fixtures/agent-profiles/` | 完成：2 个合法夹具 + 10 个拒绝夹具（未知字段、未知枚举、绝对路径、路径穿越、目录不符、非法组合、缺失 prompt、空 prompt、重复 ID 两目录、真实超长 prompt 文件） |

验证：`npm run check` 全通过（157 项测试，含新增 12 项契约测试）。尚未验证的部分属于 Sprint 1 及以后：Registry 加载、确定性哈希、`GET /api/ai/presets`、`agent-settings.json`、Docker 打包一致性、设置 UI 与卡牌 Agent。

§7.4 的三个决策门与 §17 的五个裁定项：**尚未关闭**。作者指示「实现 Sprint 0」只批准了实施动作，不构成对推荐项的裁定，因此 ADR-0029 保持 `proposed`，其契约内容属于提议值；`docs/adr/ADR-0029-agent-profile-runtime-projection.md` §10 逐条列出五项与改判后果，等待作者签署。Sprint 0 的退出条件「runtime manifest 与兼容矩阵经作者确认」在签字前不成立。

### 7.7 Sprint 0 只读验收（2026-10-17）

结论：工程实现通过，正式验收暂不通过。已修正的偏差：

1. 治理措辞：ADR-0029 由「canon 且作者已接受推荐项」降回 `proposed`，新增 §10 签字门，删除「作者指示即视为接受」的推论。
2. 重复 ID 与超长 prompt 改为真实磁盘夹具（`reject/duplicate-id/fixture-a|b`、`reject/oversized-prompt/runtime/system.md`，895 行 / 34017 字符），不再由测试临时构造。
3. 提示词合并顺序由「搜索 ADR 中名称出现顺序」改为 `agent-profile-contract.mjs` 的 `AGENT_PROMPT_LAYERS` 加 `tests/snapshots/agent-prompt-layers.json` 快照，对 Sprint 1/2 的拼装函数形成真实回归保护；同时新增代码侧枚举/矩阵/错误码与 Schema、ADR 的交叉校验测试。

### 7.8 作者签字（2026-10-17）

Sprint 0 的退出条件是「runtime manifest 与兼容矩阵经作者确认」。作者已逐条回复 §7.4 与 §17 的裁定项，**五项全部接受、无改判**：

1. 产品只读取仓库随附的只读投影，不扫描 DSH 用户目录；
2. lore / free / card 三个入口独立保存 preset；
3. 自由聊天切换 preset 时开启新对话；
4. 本轮不支持导入自定义 preset；
5. 卡牌 Agent 使用独立浮动面板，只复用设定助手的交互范式，只返回受验证字段补丁。

据此 ADR-0029 由 `proposed` 转为 `canon（技术边界）`，签字记录见该文件 §10；Schema、三个 manifest、契约模块、快照与夹具的内容未因签字改动。Sprint 0 据此正式签收，可进入 Sprint 1。

## 8. Sprint 1：Registry、哈希与部署闭包

### 8.1 目标

实现不依赖第三方 YAML 解析器的产品侧 Registry，并保证本机与 Docker 看到相同 preset。

### 8.2 Backlog

| ID | 任务 | 建议文件 | 验收 |
|---|---|---|---|
| S1-01 | 实现 manifest 校验与标准化 | `agent-profile-registry.mjs` | 无效 manifest 返回稳定错误码 |
| S1-02 | 实现安全路径解析 | 同上 | prompt 不能逃出 preset 目录；符号链接逃逸拒绝 |
| S1-03 | 实现确定性哈希 | 同上 | 同内容同哈希；prompt/manifest 改动必变 |
| S1-04 | 实现启动时加载与只读快照 | `server.mjs` | 请求期间不读取半写入文件 |
| S1-05 | 新增列表端点 | `server.mjs` | 只返回脱敏元数据与 defaults |
| S1-06 | 扩展 Docker 白名单 | `Dockerfile`、打包测试 | 镜像只含 runtime 所需文件，不含整个 docs/lore/cards |
| S1-07 | 健康检查增加 preset 摘要 | `/api/health` | 报告数量和错误，不泄露提示正文 |

### 8.3 关键函数建议

- `loadAgentProfiles(root)`：扫描固定根目录，返回冻结 Registry。
- `validateAgentRuntimeManifest(value, directoryId)`：严格校验。
- `resolveAgentProfile(id, surface)`：校验存在性与兼容性。
- `profileFingerprint(manifest, systemPrompt)`：生成 SHA-256。
- `publicAgentProfile(profile)`：生成浏览器安全投影。

### 8.4 验收

- 本机启动能列出三个 preset。
- Docker 容器列出的 ID、版本和哈希与本机一致。
- 删除默认 preset、损坏 JSON 或修改为路径穿越时，服务拒绝启动并给出明确诊断。
- 不执行 `agent.cordis.yml`，不引入 DSH 包作为生产依赖。

### 8.5 Sprint 1 执行记录（2026-10-17）

| ID | 产物 | 状态 |
|---|---|---|
| S1-01 | `agent-profile-registry.mjs` 的 `validateAgentRuntimeManifest` | 完成：内建最小 Schema 校验器（只实现 `agent-runtime.schema.json` 实际使用的关键字，遇到不支持的关键字直接失败），区分 `AGENT_MANIFEST_INVALID` 与 `AGENT_ENUM_UNKNOWN`，并核对 `id` 与目录名、`schemaVersion` |
| S1-02 | 同文件 `resolveAgentPromptPath` | 完成：拒绝根路径/Windows/UNC 绝对路径、`..` 穿越、目录组件与符号链接逃逸（`lstat` + `realpath` 双重检查）、非普通文件、无效 UTF-8、NUL 字节与超长 prompt |
| S1-03 | 同文件 `stableStringify` / `profileFingerprint` | 完成：对象键排序的稳定序列化 + SHA-256；返回 `manifestHash`、`systemPromptHash`、合成 `hash`。同内容同哈希，manifest 或 prompt 任一改动必变 |
| S1-04 | `server.mjs` 启动段 | 完成：启动时一次性加载并冻结 Registry，请求期间不再读盘；任何缺陷都会打印稳定错误码并拒绝启动，不静默换 persona |
| S1-05 | `GET /api/ai/presets` | 完成：只返回脱敏元数据与 `defaults`，不含 prompt 正文、路径、`toolPolicy` 或 DSH 明细 |
| S1-06 | `Dockerfile` | 完成：根目录 COPY 增加 `agent-runtime.schema.json`、`agent-profile-contract.mjs`、`agent-profile-registry.mjs`；另加 6 条逐文件 COPY，只把三个 preset 的 `worldforge.runtime.json` 与 `runtime/system.md` 放进镜像。`.dockerignore` 无需改动（现有规则不匹配 `.json` 或 `system.md`），由测试断言不会被排除 |
| S1-07 | `/api/health` 的 `agentProfiles` | 完成：数量、按 surface 数量、ID 列表与诊断码，不含提示正文 |

额外决策与偏差：

- **Schema 部署副本**：镜像不含 `docs/`，Registry 因此读取仓库根的 `agent-runtime.schema.json`；测试断言该副本与 `docs/schemas/agent-runtime.schema.json` 逐字节一致，改动 Schema 时两份必须同步。
- **接口与计划建议的差异**：计划 §8.3 建议 `resolveAgentProfile(id, surface)`，实现为 Registry 快照上的 `registry.resolve(id, surface)`；`loadAgentProfiles(root)`、`validateAgentRuntimeManifest(value, directoryId)`、`profileFingerprint(manifest, systemPrompt)`、`publicAgentProfile(profile)` 与建议一致。
- **多 surface 组合**：Schema 的三条 `if/then` 只约束单行组合，多行组合由 `assertSurfaceCompatibility` 按 `AGENT_SURFACE_COMPATIBILITY` 逐行复核，避免"Schema 通过但矩阵不符"。
- **符号链接夹具**：Windows 未开启开发者模式时无法创建符号链接，测试在该环境下跳过符号链接断言并明确记录为未验证，其余路径拒绝断言仍然执行。

验证：`npm run check` 全通过（173 项测试；新增 `agent-profile-registry.test.mjs` 12 项与 `agent-profile-api.test.mjs` 4 项）。**未验证**：Docker 镜像实际的 ID/版本/哈希与本机一致性（需要真实 `docker build` 与容器运行）、浏览器侧选择器（Sprint 3）、请求快照与卡牌 Agent（Sprint 2/4）。因此本机与容器一致的验收项目前只有打包闭包的静态证据，尚无容器运行证据。

### 8.6 Sprint 1 只读验收与修正（2026-10-17）

只读验收结论：暂不通过。Registry 主体已实现，但存在 4 个代码问题与 1 个错误码分类问题，且 Docker 一致性未完成。逐项修正：

| # | 验收问题 | 修正 |
|---|---|---|
| 1 | 删除默认 preset 后服务仍启动，`defaults` 被写成 `null` | `loadAgentProfiles` 增加完整性门：按契约登记的 surface 列表检查，缺少任一入口即抛 `AGENT_PROFILE_UNKNOWN` 并拒绝启动。实测删除 `lore-writer` 后 `STARTUP_ACCEPTED: false`，诊断指出缺失入口 `lore` |
| 2 | 本机/镜像一致性未完成 | 已真实 `docker compose up -d --build` 重建并逐项比对，见下方结论 |
| 3 | preset 目录与 manifest 符号链接可绕过根目录 | `listPresetDirectories` 拒绝符号链接目录；`loadManifestFile` 对 preset 目录与 manifest 文件做 `realpath` 复核；`resolveAgentPromptPath` 逐段检查 prompt 路径的每一段（含中间目录）都不是符号链接 |
| 4 | Registry 快照只浅冻结 `manifest` | 新增 `deepFreeze`，profile 及其 `manifest`、嵌套数组全部冻结 |
| 5 | 非法组合、绝对路径、`schemaVersion` 都被归为 `AGENT_ENUM_UNKNOWN` | 校验器改为两遍并携带 `path`/`keyword`：字段级缺陷按字段映射错误码（各枚举字段→`AGENT_ENUM_UNKNOWN`）；`allOf/if/then` 分支命中→`AGENT_COMPAT_MISMATCH`；`schemaVersion` 的 `const`→`AGENT_MANIFEST_INVALID`。另修正 `AGENT_MANIFEST_UNREADABLE` 的分工（JSON 解析失败） |
| 7 | 复审：`systemPrompt` 的绝对路径与 `..` 穿越被归为 `AGENT_MANIFEST_INVALID`，而 ADR §9 冻结为 `AGENT_PROMPT_PATH_UNSAFE`；Schema 先于解析层执行，导致约定错误码在真实加载路径上不可达 | 把 `systemPrompt` 命中 Schema `not` 路径约束映射为 `AGENT_PROMPT_PATH_UNSAFE`；空值/类型/长度仍为 `AGENT_MANIFEST_INVALID`。`pickErrorCode` 优先级调整为「兼容矩阵 > 路径不安全 > 枚举 > 结构」。测试改为从真实加载路径触发该错误码（`reject/traversal` 与符号链接两条独立路径），并补齐 Unix 根路径、UNC、中间段穿越用例 |
| 6 | 「所有错误码可达」只比较手写集合 | 测试改为逐个真实触发：11 个错误码全部由真实路径产生，断言的是实际抛出的 `error.code` |

顺带修正的一个真实缺陷：`server.mjs` 启动失败时只 `throw`，而数据库与模拟服务此时已打开，事件循环不会退出，表现为「启动失败但不退出」并在本机留下锁定的 SQLite 文件。改为打印诊断后 `process.exit(1)`。

Docker 真实比对结论（2026-10-17，本机 `docker compose up -d --build`）：

| 项目 | 本机 | 容器 | 一致 |
|---|---|---|---|
| `card-designer` | `1.0.0` / `sha256:aa6718ec…` | 同 | 是 |
| `free-creator` | `1.0.0` / `sha256:d6d58ae3…` | 同 | 是 |
| `lore-writer` | `1.0.0` / `sha256:b62e4de1…` | 同 | 是 |
| `GET /api/ai/presets` | HTTP 200 JSON | HTTP 200 `application/json`，`defaults` 三项齐全 | 是 |
| `GET /api/health` | 含 `agentProfiles` | `count: 3`、`countBySurface` 各 1、`diagnostics: []` | 是 |
| 容器状态 | — | `Up (healthy)` | — |
| 镜像内 `.agent-presets` | — | 恰好 6 个投影文件，无 `agent.cordis.yml` / `preset.yml` / `SKILL.md` | 是 |
| 残缺根目录 | 拒绝启动 | 挂载只含两个入口的目录后退出码 1，`AGENT_PROFILE_UNKNOWN` 指出缺失 `card` | 是 |

因此计划 §8.4 的第 2 条「Docker 容器列出的 ID、版本和哈希与本机一致」现在有真实容器证据。仍未验证：浏览器侧选择器（Sprint 3）、请求快照与卡牌 Agent（Sprint 2/4）、真实模型端到端。

## 9. Sprint 2：设定助手与自由创作接入

### 9.1 目标

让两个现有产品入口真正使用选中的产品投影，同时保持现有 Schema、工具预算、视觉降级和作者保存边界。### 9.2 设定助手任务

| ID | 任务 | 验收 |
|---|---|---|
| S2-01 | `callAi` 解析 `lore` preset | 不兼容 preset 在模型调用前返回 400 |
| S2-02 | 将固定安全层与 preset prompt 分离 | canon、原创性、成本与可回填纪律不丢失 |
| S2-03 | 保留动态内容块 Schema | 未选字段不能出现在候选中 |
| S2-04 | 差额补生成沿用同一 preset 快照 | 初次与补充响应的 preset hash 相同 |
| S2-05 | 视觉输入沿用现有降级 | 不支持图片时仍明确错误，不静默伪装已看图 |

### 9.3 自由创作任务

| ID | 任务 | 验收 |
|---|---|---|
| S2-06 | `callFreeAgent` 解析 `free` preset | 只接受 `free_chat` |
| S2-07 | 工具策略由 Registry 映射 | `free_lore_readonly` 只能映射现有五个工具 |
| S2-08 | 保持 6 轮 / 12 次 / 4 图上限 | preset 不得扩大服务器硬上限 |
| S2-09 | 工具不支持时的单轮降级保留 preset | fallback 回显相同 preset 元数据 |
| S2-10 | 每轮响应保存 Agent 快照 | 前端能显示该轮实际 preset，而非当前设置值 |

### 9.4 回归重点

- `proposed` 与 `unknown` 不被写成定论；
- 工具仍然不访问请求快照之外的数据；
- 模型工具调用不获得文件、数据库或密钥访问；
- 现有部分合法候选保留与差额补齐行为不变；
- 未配置模型时仍使用现有错误语义。

### 9.5 Sprint 2 执行记录（2026-10-17）

| ID | 产物 | 状态 |
|---|---|---|
| S2-01 | `server.mjs` 的 `resolveSurfaceProfile('lore', presetId)` | 完成：请求未带 `presetId` 时取服务端默认值；未知或不兼容在模型调用前抛 400，实测不会产生任何模型请求 |
| S2-02 | `ai-harness.mjs` 的 `PRODUCT_BOUNDARY_INSTRUCTIONS`、`LORE_ENTRY_CONTRACT`、`FREE_ENTRY_CONTRACT`、`composeAgentSystemPrompt` | 完成：第 1、3 层由代码固定，preset 只能贡献第 2 层；原两个固定常量改为「无 preset 时的默认拼装」，保留一个发布周期作回滚基线 |
| S2-03 | 保留 `createLoreResponseSchema` 与 `validateAiResponse` | 完成：未选字段仍由动态 Schema 拒绝，行为未变 |
| S2-04 | 差额补生成沿用同一 `modelOptions.system` | 完成：初次与补充请求的 system 逐字相同，响应回显同一 `presetHash` |
| S2-05 | 视觉降级路径保留 `system` | 完成：不支持图片时仍走原有 400/404/422 降级，不伪装已看图 |
| S2-06 | `resolveSurfaceProfile('free', presetId)` | 完成：只接受 `free_chat` 入口的 preset，其它 surface 一律 400 |
| S2-07 | `toolsForPolicy(profile)` | 完成：`free_lore_readonly` → 现有五个只读工具；`none` → 不提供工具；未实现策略抛 400 而不是降级 |
| S2-08 | 硬上限不变 | 完成：仍用 `runAgentLoop` 默认 6 轮 / 12 次与 `AGENT_LIMITS.maxImages = 4`；实测模型无限请求工具时被截断在 12 次并标记 `tool_budget` |
| S2-09 | 工具不可用的单轮降级 | 完成：降级请求仍带同一 preset 正文与 `<library_context>`，响应 `agent` 与成功路径完全一致 |
| S2-10 | 三个响应增加 `agent` 快照；前端显示 | 完成：`/api/ai`、`/api/ai/free` 返回 `{ presetId, presetVersion, presetHash, mode }`；自由对话每轮显示 `Agent <id> v<version>`，设定助手候选区顶部显示同名 chip |
| S2-11 | 复审 P1：不可信内容被提升到 system | 完成：`composeAgentSystemPrompt` 移除 `authorNotes` 参数，新增 `assertInstructionLayerClean`（命中不可信标记抛 `AGENT_UNTRUSTED_LEAK`，错误码 `AGENT_UNTRUSTED_LEAK` 只用于内部断言，不外露给浏览器）；新增 `attachUntrustedContext` 把作者笔记与降级索引附到最后一条用户消息。集成测试断言 system 不含 `author_notes`/`library_context` 与其正文，用户侧含 `<untrusted_context>` |
| S2-12 | 复审 P2：第 4、5 层顺序反转 | 完成：`buildPrompt` 重排为 `author_type_prompt` → `author_personalized_style` → 任务要求 → `worldforge_examples` → `worldforge_context`。新增测试分别断言 system 内 1→2→3 与 user prompt 内 4→5→6，并断言两条通道互不串层；另有完整六层顺序断言 |
| S2-13 | 复审 P2：差额补生成再次破坏层序 | 完成：抽出 `lorePromptSections(payload, bundle)` 供初次与补生成共用；`buildSupplementPrompt(payload, bundle, { missingCount, acceptedVariants, issues })` 改为按层重排——补生成指令并入第 5 层，`<accepted_variants>` 与 `<validation_issues>` 作为第 6 层最后区块，不再追加到初次 prompt 尾部。新增单元断言与**第二次真实出站请求**的完整层序断言 |
| S2-14 | 复审 P2：补生成未沿用完整请求快照 | 完成：`callAi` 先构造 `promptPayload = { ...payload, typePrompt, personalizedPrompt }`，初次与补生成共用；`supplementPayload = { ...promptPayload, variantCount: missingCount }` 同时驱动 prompt、Schema 与 `expectedCount`。测试断言两次请求第 4 层逐字一致且含作者分类/个性化提示，补生成数量要求为 missingCount 且与 Schema 的 `minItems/maxItems` 一致 |
| S2-15 | 复审 P2：JSON 降级指令追加在第 6 层之后 | 完成：`buildPrompt` / `buildSupplementPrompt` 新增 `requireJson` 选项，把「严格只返回 JSON 对象」并入第 5 层任务段；`callAi` 的三条降级分支（初次非结构化、初次已降级后的补生成、补生成结构化失败）全部改用该选项，不再拼接 `${prompt}\n…`。新增单元断言（指令只出现一次、早于所有第 6 层块、prompt 以第 6 层结尾）与两条集成断言（假模型对带 `response_format` 的请求返回 400，覆盖降级初次 + 降级补生成、以及补生成结构化失败后的降级） |

分层重构的取舍：

- 第 2 层（preset）与其原本重复的第 1、3 层内容被移除，`lore-writer` 与 `free-creator` 的投影改为纯 persona/写作方式，版本升至 `1.1.0`（契约要求投影内容变化必须递增版本）。
- 纪律没有丢失：IP 与不可信内容在第 1 层，canon、成本因果、元话语、status 表述在第 3 层；测试按「每条纪律恰好出现一次」断言，符合 ADR-0025 的「约束放在真实监督点」原则。
- `card-designer`（`1.0.0`）本轮未接入产品入口（Sprint 4），因此暂不按新分工裁剪；契约测试对它保持原有断言。
- 新增安全加固：preset 的 `runtime/system.md` 若包含产品保留标记（`<product_boundary>`、`<agent_preset>`、`<entry_contract>`）会被 Registry 以 `AGENT_MANIFEST_INVALID` 拒绝，防止投影伪造更高优先级的层。

验证：`npm run check` 全通过（195 项测试；新增 `agent-prompt-layers.test.mjs` 10 项与 `agent-surface-integration.test.mjs` 8 项）。集成测试用本地假模型 + 真实 `server.mjs` 子进程，断言服务端实际发出的提示层次、工具白名单、硬上限与响应快照。**未验证**：真实模型端到端（本轮没有也无需调用付费接口）、设置页选择器与请求携带快照的 UI（Sprint 3）、卡牌 Agent（Sprint 4）。

## 10. Sprint 3：设置 UI、选择语义与可观测性

### 10.1 目标

提供真实可理解的选择器，而不是一个允许任意错误组合的全局下拉框。

### 10.2 Backlog

| ID | 任务 | 验收 |
|---|---|---|
| S3-01 | 设置页新增“Agent 模式”面板 | 分别显示设定、自由创作、卡牌三个选择器 |
| S3-02 | 选择器按 `surfaces` 过滤 | 不出现不兼容 preset |
| S3-03 | 保存服务端默认映射 | 重启服务后保留；旧安装自动得到默认值 |
| S3-04 | 各入口显示当前 preset chip | 显示名称、版本；可查看简短描述 |
| S3-05 | 请求携带 preset 快照 | 响应以服务端解析值为准，客户端不能伪造版本/hash |
| S3-06 | 自由聊天切换确认 | 有历史时提示“开启新对话”；不混合 persona |
| S3-07 | 错误与降级 UI | preset 损坏、消失、不兼容时区分于模型服务错误 |

### 10.3 交互约定

- 空白自由聊天可直接切换。
- 已有消息时切换会清空当前页面对话，或由作者取消切换。
- 设定助手每次点击生成都读取当前选择；已有候选卡保留其原 preset 元数据。
- preset 设置是服务端工作站级默认值；当前请求仍携带快照，避免多标签页在请求中途读取到另一选择。

### 10.4 无障碍与子路径

- 每个选择器有明确 label、说明和错误区域。
- preset chip 不只用颜色表达状态。
- API 请求继续通过脚本挂载路径计算，兼容 `/worldforge` 子路径。
- 缓存版本升级并增加静态 UI 测试。

### 10.5 Sprint 3 执行记录（2026-10-17）

| ID | 产物 | 状态 |
|---|---|---|
| S3-01 | 设置页新增「Agent 模式」面板（`data-settings-tab="agent"`） | 完成：三个选择器 + 说明 + 状态行 + `role="alert"` 错误区 |
| S3-02 | `fillPresetSelect(select, surface, selectedId)` | 完成：只列 `surfaces` 包含该入口的 preset；没有兼容项时禁用并显示「没有兼容的 preset」 |
| S3-03 | `agent-settings.mjs` + `GET/POST /api/settings` | 完成：默认映射、部分更新、原子写入 `agent-settings.json`；旧安装 `source=missing`、损坏文件 `reason=corrupt` 都回落默认值并把原因回传界面 |
| S3-04 | 入口 chip | 完成：自由对话顶部选择器 + 「本轮 Agent：名称 v版本」，悬停显示描述；设定助手候选区显示 `Agent <id> v<version> · <mode>`；chip 用文字而非颜色表达状态 |
| S3-05 | 请求携带快照 | 完成：两个入口都发送 `presetId`；服务端按「请求 > 保存的默认值 > Registry 默认」解析，并只回显服务端结果；测试用伪造的 `presetVersion`/`presetHash` 断言不被采信 |
| S3-06 | 自由聊天切换确认 | 完成：有历史时 `confirm('切换 Agent preset 会开启新对话…')`，取消则回滚选择；确认后清空对话并提示新对话已开始 |
| S3-07 | 错误区分 | 完成：`agentErrorIsPreset` 识别 `AGENT_PROFILE_*`/`AGENT_SETTINGS_INVALID`，界面显示「Agent preset 不可用：…」而不是「请求失败」；设置页保存错误显示在专门的 `role="alert"` 区域 |

补充决策：

- **保存的 preset 消失时不自动改选**：`loadAgentSettings` 保留原 id，解析层报 `AGENT_PROFILE_UNKNOWN`（400），界面显示为 preset 问题。这符合计划 §12.1 S5-07「不静默换 persona」。
- **会话内切换不等于改默认值**：自由聊天里的选择器只改本次对话的 `presetId` 快照；服务端默认值仍由设置页维护。因此多标签页不会互相改选。
- **`agentPresets` 允许部分提交**：只提交的入口会被写入，其余保持不变，兼容「只保存模型设置」的旧客户端。

验证：`npm run check` 全通过（210 项测试；新增 `agent-settings-api.test.mjs` 5 项与 `agent-settings-ui.test.mjs` 5 项）。Docker 白名单测试自动捕获了遗漏的 `agent-settings.mjs` 并已加入镜像。**未验证**：真实浏览器点击流程（本轮为静态 UI 断言 + 真实服务端 API 断言，未做浏览器 DOM 演练）、真实付费模型端到端、Sprint 4 卡牌 Agent。

### 10.6 Sprint 3 复审修正（2026-10-17）

复审在真实浏览器里发现 4 个阻断项，均已修正：

| # | 问题 | 修正 |
|---|---|---|
| 1 | 最终「保存设置」绑定到 `saveSettingsWithVisuals`，而提交 `agentPresets` 的旧 `saveSettings` 已被覆盖成死代码，选择实际不会保存 | Agent 提交逻辑移入被绑定的 `saveSettingsWithVisuals`；删除旧 `saveSettings` 与其残留绑定；新增 `agentSettingsPatchFromForm` / `applyAgentSettingsAfterSave` / `showAgentSaveError` 辅助函数 |
| 2 | `bootstrap` 只调 `refreshAgentSettings`，未先加载 preset 目录，自由创作选择器显示「没有兼容的 preset」并被禁用 | 启动顺序改为 `refreshAgentCatalog()` → `refreshAgentSettings()`；打开设置后也 `syncFreePresetBar()` |
| 3 | 首次发送后未把服务端返回的 `agent.presetId` 冻结到 `freeConversationPreset`，设置变化会让同一对话中途换 persona | 首次成功后写入 `freeConversationPreset=data.agent.presetId`，后续轮次固定该快照 |
| 4 | `fillPresetSelect` 在已保存 preset 失效时不显示失效项，视觉上选中第一个兼容项，造成无提示替换 | 失效时插入 `<option value=原 id>（已不可用）</option>` 并保持选中；chip 用文字标注「已不可用」；保存时 `agentSettingsPatchFromForm` 只提交有效选择，避免失效项阻塞其他设置 |

测试改为**解析最终事件绑定**再检查处理器正文（`lastBoundHandler` + `functionBody`），并断言不存在同名旧实现、启动顺序、首轮冻结、失效项标记；这直接针对「测试只匹配到死代码」的教训。

验证：`npm run check` 全通过（213 项测试；`agent-settings-ui.test.mjs` 5 → 8 项）。缓存版本升到 `app.js?v=46`。

## 11. Sprint 4：卡牌文字 Agent 纵切

### 11.1 目标

让 `card-designer` 成为真正的产品入口，而不是只有 DSH persona。首版只做少量候选和静态评审，不声明已平衡，不批量生成正式卡池。

### 11.2 服务端 Backlog

| ID | 任务 | 验收 |
|---|---|---|
| S4-01 | 定义卡牌候选 JSON Schema | 只允许选中字段；1–3 个候选 |
| S4-02 | 构建受限卡牌上下文 | 当前卡、引用 lore、已有关键词、必要规则摘要 |
| S4-03 | 实现 `callCardAgent` | 使用 `structured_card` 与 `card_context_readonly` |
| S4-04 | 校验类型互斥 | 随从/法术/装备 stats、tribe、spell_school 不串型 |
| S4-05 | 校验引用白名单 | 未提供的 lore/keyword/mechanic ID 拒绝 |
| S4-06 | 生成评审字段 | 目标、时机、顺序、持续、反制、边界案例齐全 |
| S4-07 | 差额补生成 | 只补缺失合法候选；保留诊断 |
| S4-08 | 新增 `/api/ai/card` | 不直接保存，不调用图像生成，不改变 canon |

### 11.3 前端 Backlog

| ID | 任务 | 验收 |
|---|---|---|
| S4-09 | 卡牌编辑器增加可收起 Agent 面板 | 不挤压核心编辑区；窄屏可用 |
| S4-10 | 提供五种操作 | 构思、润色、规则审查、静态平衡、设定一致性 |
| S4-11 | 字段选择 | 只覆盖作者勾选字段 |
| S4-12 | 候选差异与诊断 | 合法候选可用，非法原因可展开 |
| S4-13 | 应用到表单 | 只回填，不自动保存 |
| S4-14 | 保存为独立草案 | 仍固定 `proposed / untested`，由作者点击触发 |

### 11.4 测试矩阵

- 三种卡牌类型各一组合法候选；
- 法术返回 stats、装备返回 health、随从返回 durability 时拒绝；
- 未知关键词与任意脚本效果拒绝；
- 目标、时机或持续时间缺失时进入诊断；
- 规则尚未裁定时要求写入依赖/开放问题，不伪造正式规则；
- W97 参数只标作 `experimental / untested`；
- 没有真实仿真时不得输出“已平衡”。

### 11.5 Sprint 4 执行记录（2026-10-17）

| ID | 实现 |
|---|---|
| S4-01 | `card-agent.mjs` 的 `createCardResponseSchema({selectedFields, variantCount})`：patch 只含勾选字段，1–3 个候选，review 六项必填 |
| S4-02 | `buildCardContext(payload)`：当前草案、卡牌引用的 lore 内容（摘要/约束/状态/事实层次）、关键词定义与 W97 experimental 规则摘要；白名单收窄为这些引用，不读取数据库 |
| S4-03 | `callCardAgent`：`structured_card` + `toolPolicy=none`（按 ADR-0029 §6；卡牌上下文由请求体携带，未启用 `card_context_readonly`） |
| S4-04 | 三类型互斥：法术无 attack/health/durability、武器无 health/tribeId/spellSchoolId、随从无 durability/spellSchoolId |
| S4-05 | 关键词与设定 ID 白名单；效果只允许 `deal_damage`/`heal`/`draw_card`，`params` 出现脚本表达式即拒绝 |
| S4-06 | review 的 legalTargets/timing/effectOrder/duration/counterplay/edgeCases 缺失即诊断 |
| S4-07 | `completeCardVariants` 只补缺失数量并保留诊断；补生成沿用同一 system 与数量口径 |
| S4-08 | `POST /api/ai/card`：不保存、不调用图像生成、不改 canon；响应含 `agent` 快照与 `diagnostics` |
| S4-09–14 | 卡牌编辑器可收起面板：五种操作、字段勾选、候选补丁与评审、诊断展开、应用到表单（不保存，按目标类型回填 health/durability）、保存为独立草案（固定 proposed/untested） |

复审修正（2026-10-17）：关键词定义字段由不存在的 `k.text` 改为 `k.definition`；卡牌专用上下文改为只带 `draft.loreRefs` 引用条目的摘要与约束，并在第 6 层新增 `<card_lore>`；`allowedLoreIds` 由「整个资料库」收窄为当前引用；跨类型回填改为先算 `targetType = patch.type || currentType` 再回填专属数值，并补双向回归测试。

复审修正（第二轮）：服务端关键词映射改读 `item.definition`，并按 `draft.keywordIds` ∪ `allowedKeywordIds` 过滤；`loreEntries` 与 `sanitized.loreRefs` 求交集，请求体无法注入未被当前卡牌引用的条目。前端把回填判断抽到 `dist/card-agent-apply.js`，浏览器与测试共用；测试用 `node:vm` 真实执行该文件，断言 minion→equipment 写 durability、反向写 health、类型不变时不写入，并断言关键词定义正文进入上下文、额外 lore 不进入 `<card_lore>`。

验证：`npm run check` 全通过（225 项测试；`tests/card-agent.test.mjs` 11 项 + UI 静态断言）。未验证：真实付费模型端到端、浏览器点击流程、卡牌 Agent 与 W97 参数的实际联动。

### 12.0 静态文档可验证化（Sprint 5 第一项，已完成）

问题：`docs/static/server.mjs.md` 的位置索引曾多次漂移，人工刷新又引入语义错配。

方案：把「行号」变成可执行契约。每个 `L###` 必须归属一个锚点，锚点由**期望源码子串**组成并必须唯一命中；`static-doc-anchors.mjs` 负责校验或重写（`--write`），已接入 `npm run check`。锚点表在 `docs/static/anchors.json`，与文档一起评审。

验收对应：

| 验收项 | 实现 |
|---|---|
| 校验器入库并接入 `npm run check` | `static-doc-anchors.mjs` + `package.json` 的 `--check` |
| 每个锚点唯一匹配，零/多匹配都失败 | `resolveAnchor` 的 `ANCHOR_MISSING`/`ANCHOR_AMBIGUOUS`；重复构造用 `count`/`nth` |
| 单行引用验证全部期望子串 | `anchor.lines` 全部 `includes` |
| 区间分别验证起止且起点早于终点 | 破折号连接的引用才视为区间；`区间倒置` 报错 |
| `L###` 由校验器生成或核对 | `--write` 重写；`--check` 不一致即失败；无法归属即失败 |
| 错误夹具 | `tests/static-doc-anchors.test.mjs` 9 项：错误子串、歧义、倒置区间、源码漂移 |
| 重新生成并验证 server.mjs.md | `--write` 后 `--check` 通过：83 处引用全部命中唯一锚点 |

`npm run check` 现在会在测试前运行该校验器，文档行号漂移会直接使检查失败。

### 12.0.1 Sprint 5 落地验收约束（作者裁定，2026-10-17）

在产物（diff、测试、文档）出现前，Sprint 5 状态为「未开始交付」。实现必须满足：

1. 环境开关只接受精确值 `1`；默认路径行为必须完全不变。
2. legacy 快照仍完整返回 `presetId / presetVersion / presetHash / mode`；哈希保持空串，版本明确标为 legacy。
3. 三个入口继续保留第 1 层产品安全边界与各自入口契约；回滚只替换 persona 来源，不得绕过字段、工具或 canon 约束。
4. Registry 损坏时只有显式开启开关才允许启动；健康检查保持 HTTP 200，但必须明确报告降级状态。
5. `/api/ai/presets` 的空目录响应保持既有结构；前端显示 legacy 状态，不得误报「配置丢失」。
6. 四组启动测试：默认模式、显式 legacy、Registry 损坏且未开启（拒绝启动）、Registry 损坏且已开启（降级启动）。
7. S5-03 验证启动后修改 manifest 与 prompt 两种情况：当前进程快照不变，重启后才读取新值。
8. Docker 重建与本地浏览器 smoke 不产生模型费用，可独立验收；只有真实模型调用需另行确认成本。

## 12. Sprint 5：加固、迁移与发布

### 12.1 安全与故障注入

| ID | 场景 | 预期 |
|---|---|---|
| S5-01 | manifest 路径穿越 | 服务启动失败或跳过并健康降级，绝不读取根外文件 |
| S5-02 | prompt 超长/非 UTF-8 | 明确诊断，不把损坏文本交给模型 |
| S5-03 | preset 在请求期间变化 | 当前请求使用冻结快照；新请求使用新哈希 |
| S5-04 | 客户端伪造 hash/version | 服务端忽略并返回权威解析值 |
| S5-05 | 不兼容 preset | 模型调用前 400，不产生费用 |
| S5-06 | 模型不支持 Schema/工具/图片 | 沿用受控降级并准确标注 |
| S5-07 | 默认 preset 文件缺失 | 保留最后有效配置或启动失败；不静默换 persona |

### 12.2 迁移

旧安装没有 `agent-settings.json` 时，自动使用：

```json
{
  "schemaVersion": 1,
  "selections": {
    "lore": "lore-writer",
    "free": "free-creator",
    "card": "card-designer"
  }
}
```

迁移不修改 `prompt-settings.json`、`.env.local`、SQLite 内容或浏览器编辑偏好。

### 12.3 发布验收

1. 本机 `npm run check` 全通过。
2. Docker 使用既有持久卷重建并达到 `healthy`。
3. 本机与容器 `GET /api/ai/presets` 的 ID、版本和哈希一致。
4. 浏览器在根路径和 `/worldforge` 子路径完成三入口 smoke test。
5. 使用真实配置模型分别完成一次设定候选、自由工具检索和卡牌候选；如审批未授权外发，明确记录为未执行，不能以 mock 替代。
6. 不调用真实 Seedream，除非作者明确要求并接受可能费用。

### 12.4 回滚

- 保留旧固定提示常量一个发布周期，并由内部 feature flag 控制，不在 UI 暴露。
- Registry 初始化失败时不得自动选取任意其他 persona；运维可切回固定提示路径。
- `agent-settings.json` 是附加配置，删除后回到三个默认映射。
- 卡牌 Agent 是新增入口；关闭不会影响现有卡牌编辑、原画或对战纵切。

### 12.5 Sprint 5 执行记录（2026-10-17）

#### 实现

| 项 | 落地 |
|---|---|
| 回滚开关 | 新增 `agent-legacy.mjs`；`server.mjs` 在 `loadLocalEnv()` 之后读取 `WORLDFORGE_AGENT_LEGACY_PROMPTS`，只有精确字符串 `1` 才启用 |
| legacy profile | 三个入口各一份；`mode` / `outputContract` / `toolPolicy` / `statusPolicy` 取自 `AGENT_SURFACE_COMPATIBILITY`，`systemPrompt` 恒为空串、`legacy: true`，因此调用方**不传** `presetPrompt` |
| 快照回显 | `presetId: legacy-fixed-prompt`、`presetVersion: 0.0.0-legacy`、`presetHash: ''`、`mode` 保留；请求里伪造的版本与哈希仍被忽略 |
| 启动降级 | Registry 失败时默认仍 `process.exit(1)`；只有开关打开才记录 `agentRegistryFailure` 并降级启动，日志明确写「已按显式回滚开关降级启动」 |
| `/api/health` | 保持 HTTP 200；降级时 `degraded: true` + `diagnostics`（含稳定错误码），回滚时 `promptSource: legacy-fixed-prompts` |
| `/api/ai/presets` | 保持 `schemaVersion` / `presets` / `defaults` 结构；回滚时 `presets: []`、`defaults` 为 legacy id，并带 `fallback: legacy-fixed-prompts` |
| `/api/settings` | 回滚时 `agentPresets` / `agentPresetDefaults` 显示 legacy 并新增 `agentPromptSource`；携带 `agentPresets` 的写入返回 400（`AGENT_SETTINGS_INVALID`），不写盘 |
| 前端 | `agentCatalogFallback` 记住 `fallback`；`fillPresetSelect` 显示单个 disabled 的「固定提示（回滚模式）」，自由对话 chip 与设置状态行同步；`app.js?v=49` |
| 迁移 | 未新增迁移代码：旧安装缺 `agent-settings.json` 时由 `loadAgentSettings` 回落到 Registry 默认映射（§12.2 的三个 id），不触碰 `prompt-settings.json`、`.env.local`、SQLite 或浏览器偏好 |
| Docker | `Dockerfile` 的 COPY 闭包加入 `agent-legacy.mjs`；镜像重建并沿用持久卷 |
| 测试 | 新增 `tests/agent-legacy-rollback.test.mjs`（9 项）：开关精确性、legacy profile 契约、四组启动模式、只换 persona、降级响应、S5-03 冻结 |

#### S5 矩阵证据

| ID | 覆盖 |
|---|---|
| S5-01 | `agent-profile-registry.test.mjs`：`prompt path resolution refuses escapes that bypass the schema`、`preset directories, manifests and intermediate directories cannot be symlinks`、`startup refuses a broken root instead of silently switching persona`；`agent-profile-api.test.mjs`：`startup refuses a corrupted projection instead of degrading silently`、`startup refuses symlinked preset directories and manifests`；新增回滚测试的「损坏根目录」两组；容器内实测（见下） |
| S5-02 | `agent-profile-registry.test.mjs` 的 prompt 路径用例：超长 → `AGENT_PROMPT_TOO_LARGE`；`Buffer.from([0xff,0xfe,0x00,0x41])` 非 UTF-8 与 NUL → 明确诊断并拒绝，不把损坏文本交给模型 |
| S5-03 | 新增 `S5-03: a booted process keeps its frozen snapshot until restart`：同一进程内改 manifest + prompt 后版本与哈希不变；重启后读到新值；只改 prompt 时版本不变但哈希改变 |
| S5-04 | `agent-settings-api.test.mjs` 的伪造 `presetVersion` / `presetHash` 用例；新增回滚用例断言 legacy 下哈希恒为空串 |
| S5-05 | `agent-surface-integration.test.mjs`：`an incompatible or unknown preset fails before any model call`；`agent-profile-registry.test.mjs`：`resolve enforces surface compatibility before any model call`；`agent-settings-api.test.mjs` 的 400 且不写盘用例 |
| S5-06 | `agent-loop.test.mjs`：`a model that rejects images degrades once and still answers`、工具预算与轮次上限强制收尾；`agent-surface-integration.test.mjs`：`tool-unavailable degradation keeps the same preset snapshot`、两条第 5 层 JSON 降级用例；`card-agent.test.mjs`：Schema 与诊断 |
| S5-07 | `agent-profile-registry.test.mjs`：`startup refuses when any entry point loses its preset`；新增回滚测试的四组启动模式（默认 / 显式回滚 / 损坏且未开启 → 拒绝启动 / 损坏且已开启 → 降级启动） |

#### 发布验收（对应 §12.3）

| 项 | 结果 |
|---|---|
| 1. 本机 `npm run check` | 通过：244 项测试全绿，`static-doc-anchors` 100 处引用全部命中唯一锚点 |
| 2. Docker 重建 + `healthy` | 通过：`docker build -t worldforge:local .`（镜像 `6ebc4c3455bf`），沿用 `worldforge_worldforge-data` 持久卷重建容器，状态 `Up (healthy)`，`http://127.0.0.1:4173` |
| 3. 本机与容器预设元数据一致 | 通过：`card-designer` / `free-creator` / `lore-writer` 均为 `1.1.0`，哈希分别为 `2dcf9d23…`、`d84b7e3d…`、`0a2bf933…`，两端逐字相同 |
| 4. 浏览器三入口 smoke | **部分**：容器内 `GET /` 与 `GET /worldforge/` 均 200，页面引用 `app.js?v=49`，脚本含回滚标记；真实浏览器点击流程仍未执行 |
| 5. 真实模型三入口 | **未执行**：未获外发/付费授权，未发起任何真实模型调用；不以 mock 代替记录 |
| 6. Seedream | 未调用 |

容器内故障注入（不计费）：`WORLDFORGE_AGENT_PRESETS_DIR=/nope` 时，默认启动 `exit 1` 并打印 `AGENT_ROOT_UNREADABLE` + 「拒绝启动」；加 `WORLDFORGE_AGENT_LEGACY_PROMPTS=1` 后降级启动，`/api/health` 返回 `degraded: true`、`promptSource: legacy-fixed-prompts`、`diagnostics[0].code = AGENT_ROOT_UNREADABLE`，`/api/ai/presets` 返回 `fallback: legacy-fixed-prompts` 且 `presets` 为空，`/api/settings` 的 `agentPromptSource` 为 `legacy-fixed-prompts`。

#### 仍未验证

- 真实付费模型的设定候选 / 自由工具检索 / 卡牌候选各一次（§12.3 第 5 项）；
- 浏览器（桌面与窄屏）实际点击三个入口、切换自由对话 preset、应用卡牌候选；
- 卡牌 Agent 与 W97 参数的实际联动；
- 真实 Seedream 生图。

## 13. 全量测试矩阵

| 层次 | 必测内容 |
|---|---|
| 单元 | manifest 校验、路径、哈希、兼容矩阵、设置标准化、prompt 顺序 |
| Agent Harness | 设定 Schema、自由工具循环、卡牌 Schema、补生成与诊断 |
| API | 列表、设置、三入口选择、错误码、响应 Agent 元数据 |
| 前端静态 | 三选择器、preset chip、切换确认、子路径请求、缓存版本 |
| 存储 | 原子写入、旧配置默认值、损坏配置、重启保留 |
| Docker | runtime 文件闭包、禁止复制密钥/全仓设计源、本机/容器哈希一致 |
| 安全 | 路径穿越、未知字段、额外参数、提示注入、工具越权、非法 ID |
| 人工 | 桌面/窄屏、自由对话切换、卡牌候选回填、错误文案 |

所有测试必须区分：结构验证、mock 模型、真实模型、真实图像服务。没有执行的层次要明确列为未验证。

## 14. 预计文件影响

### 新增

- `agent-profile-registry.mjs`
- `agent-settings.mjs`
- `card-agent.mjs` 或等价的卡牌 Schema/Harness 模块
- `docs/schemas/agent-runtime.schema.json`
- 三个 preset 的 `worldforge.runtime.json`
- 三个 preset 的 `runtime/system.md`
- Registry、设置、API、卡牌 Agent 测试文件
- Agent Profile ADR

### 修改

- `server.mjs`：Registry、设置、三个入口与响应元数据。
- `ai-harness.mjs`：拆分固定安全层与 preset 层，但保持结构化验证。
- `ai-agent.mjs` / `ai-tools.mjs`：只在需要通用化工具策略时做最小改动。
- `prompt-settings.mjs`：不保存 preset，只保持提示词层。
- `dist/index.html`、`dist/app.js`、`dist/styles.css`：设置选择、状态 chip、卡牌 Agent。
- `Dockerfile`、`.dockerignore`：显式加入 runtime 投影文件。
- `README.md`、`CHANGELOG.md`、`todo.md`、静态函数文档和相关 ADR 索引。

## 15. Definition of Done

每个 Sprint 完成必须同时满足：

- 实现和文档与本计划及已批准 ADR 一致；
- 变更保持最小、无无关重构；
- 新增公开字段和错误行为有自动测试；
- `npm run check` 通过；
- 修改内容按静态文档格式归档；
- `todo.md` 更新；
- 不把未执行的真实模型/图像测试写成已验证；
- 不改变 canon、W01 世界设定或正式卡牌规则；
- 创建一次 Git 提交，不自动推送。

## 16. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| DSH persona 与产品 prompt 漂移 | 同名 preset 行为不同 | 同目录版本化、哈希、语义测试；后续考虑生成器 |
| 直接解析 DSH YAML | 执行 `!!js` 或引入插件权限 | 产品只读 JSON/Markdown 投影 |
| 全局选择污染不同入口 | 严格 JSON 与自由聊天契约混用 | 按 surface 兼容矩阵和独立选择 |
| 自由聊天中途换 persona | 历史语义不可追踪 | 切换即新会话；逐轮保存快照 |
| preset 扩大工具权限 | 数据越界或写入 | 工具策略只映射服务端白名单；硬上限不可由 preset 修改 |
| Docker 与本机 preset 不一致 | 部署行为漂移 | 显式打包 + 哈希一致性测试 |
| 约束重复膨胀提示词 | 降低有效指令权重 | 固定分层，测试关键约束出现次数 |
| 卡牌 Agent 被误解为已平衡 | 设计决策失真 | 强制 `untested`、静态评审措辞和 UI 提示 |

## 17. 作者裁定项

实施 Sprint 0 前需要作者确认：

1. **集成方式**：采用推荐的产品投影，不直接启动或嵌入 DSH。
2. **选择作用域**：按 lore/free/card 三个入口独立选择，服务端保存默认值。
3. **自由聊天切换**：有历史时切换 preset 会开启新对话。
4. **自定义 preset**：本轮只允许仓库随附 preset；用户目录导入延后。
5. **卡牌 Agent UI**：复用设定助手的浮动/可收起交互范式，但作为卡牌编辑器独立实例。

若作者没有另行裁定，计划默认采用以上推荐项。

## 18. 后续候选，不进入本轮

- 允许作者从 DSH 用户目录显式导入经过校验的产品投影，但仍不执行组装 YAML。
- 用生成脚本从共享 persona 源产生 DSH prefix 与产品 system prompt，减少漂移。
- 多模型路由、按 preset 的 token/费用预算、并发限制与审计。
- 长对话摘要、会话持久化与分支。
- 为运行时模拟主体设计独立 preset 类别；不得复用作者创作 persona。
- Agent 效果评测集：事实层次准确率、引用命中率、非法字段率、作者采纳率和成本。

