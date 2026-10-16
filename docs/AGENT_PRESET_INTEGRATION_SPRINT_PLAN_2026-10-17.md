# WorldForge Agent Preset 集成 Sprint 开发计划

- 文档状态：`proposed`
- 计划日期：2026-10-17
- 适用范围：WorldForge 产品内文字 Agent、仓库级 DSH Agent preset、设置与部署
- 不涉及：世界观 canon 晋升、正式卡牌规则裁定、模拟规则数值调整
- 默认节奏：1 个 Sprint = 5 个开发日；以 1 名主开发者估算，共 6 个 Sprint / 约 27 人日
- 执行进度：Sprint 0 工程实现已完成（2026-10-17，见 §7.6），只读验收的测试偏差已修正（见 §7.7）；**正式验收未通过**，ADR-0029 保持 `proposed`，等待作者对 §10 五项签字。Sprint 1–5 未开始，`server.mjs` 仍使用固定提示常量。

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

## 9. Sprint 2：设定助手与自由创作接入

### 9.1 目标

让两个现有产品入口真正使用选中的产品投影，同时保持现有 Schema、工具预算、视觉降级和作者保存边界。

### 9.2 设定助手任务

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

