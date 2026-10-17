# WorldForge Agent Presets

本目录保存可随仓库版本化的 DSH Agent preset。每个一级子目录都是一个完整 preset：

```text
.agent-presets/
└─ <preset-id>/
   ├─ agent.cordis.yml          # DSH 组装；产品永不读取
   ├─ preset.yml                # DSH 显示名；产品永不读取
   ├─ worldforge.runtime.json   # WorldForge 产品投影清单（纯数据）
   ├─ runtime/
   │  └─ system.md              # WorldForge 产品投影系统提示
   └─ skills/                   # DSH 技能；产品永不读取
```

当前提供：

- `card-designer`：只面向 WorldForge 卡牌、关键词与机制草案的内容设计模式。
- `lore-writer`：对应产品内结构化设定写作助手，按条目类型与内容块产出可回填候选。
- `free-creator`：对应产品内自由创作聊天，以自然语言讨论并按需只读检索仓库。

`free-creator` 的只读行为由 persona 约束；若需要权限层面的强制只读，请同时选择 DSH 的只读 permission preset。DSH preset 不会自动连接 WorldForge 产品运行时的 SQLite 资料库、美术资产索引或聊天附件。

## 产品投影（`worldforge.runtime.json`）

WorldForge 产品服务不解析 `agent.cordis.yml`：它含 `!!js` 表达式与 DSH 插件组装结构，脱离 DSH Host 解析既没有可执行语义，又会把插件装载权限变成配置来源。产品只读同目录的两个纯数据文件：

- `worldforge.runtime.json`：冻结契约见 `docs/schemas/agent-runtime.schema.json`；真值决策见 [ADR-0029](../docs/adr/ADR-0029-agent-profile-runtime-projection.md)。
- `runtime/system.md`：只贡献提示词第 2 层（preset 层）。产品安全边界（第 1 层）与入口输出契约（第 3 层）由确定性代码拼装，preset 不能替换。
- `runtime/system.md` **不得**包含 `<product_boundary>`、`<agent_preset>`、`<entry_contract>` 等产品保留标记；伪造这些标记会被 Registry 以 `AGENT_MANIFEST_INVALID` 拒绝，因为那等于冒充更高优先级的层。
- 第 2 层只写 persona 与写作方式。IP 边界、不可信内容处理在第 1 层；canon 纪律、成本因果、元话语与 `status` 表述、工具协议在第 3 层。不要把同一条约束写进两层——ADR-0025 的教训是重复会稀释权重，契约测试会检查关键纪律恰好出现一次。
- `card-designer`（`1.0.0`）尚未接入产品入口（Sprint 4），因此仍保留较完整的投影文本；`lore-writer` 与 `free-creator` 已按上述分工裁剪到 `1.1.0`。

因此修改产品侧 persona 时必须同时改 DSH 的 `agent.cordis.yml` 与产品投影；两者用途不同，但语义漂移会由 `tests/agent-profile-contract.test.mjs` 的兼容矩阵与提示词层次测试暴露。`agent.cordis.yml`、`preset.yml` 与 `skills/` 的产品侧副本不存在，也不需要复制。

## 产品如何加载

`agent-profile-registry.mjs` 在服务启动时扫描 `WORLDFORGE_AGENT_PRESETS_DIR`（缺省为本目录），逐个校验投影、解析 `runtime/system.md` 并计算 SHA-256 指纹，然后把结果冻结成只读快照；请求期间不再读取磁盘。校验规则由仓库根的 `agent-runtime.schema.json` 决定，该文件是 `docs/schemas/agent-runtime.schema.json` 的部署副本（镜像不含 `docs/`），两份由测试断言完全一致。

- `GET /api/ai/presets`：返回 `id`、`version`、`displayName`、`description`、`surfaces`、`mode`、`outputContract`、`statusPolicy`、`hash` 与三个入口的默认映射。不返回系统提示正文、文件路径或工具策略。
- `GET /api/health`：`agentProfiles` 给出数量、按 surface 的数量、ID 列表与诊断码。
- 任何无效、损坏、重复或不兼容的投影都会让服务**拒绝启动**并打印稳定错误码（如 `AGENT_ENUM_UNKNOWN`、`AGENT_ID_MISMATCH`、`AGENT_PROMPT_TOO_LARGE`）；不会跳过该 preset，也不会自动改用其他 persona。
- `lore`、`free`、`card` 三个入口必须各自至少有一个可用 preset（删除其中一个 preset 服务即拒绝启动，并指出缺失入口），因此不要删除本目录下的任何 preset。
- preset 目录、`worldforge.runtime.json`、`runtime/system.md` 及其中间目录都不得是符号链接；解析后会用真实路径复核仍在 preset 根目录内。
- Docker 镜像只复制 6 个投影文件（每个 preset 的 `worldforge.runtime.json` 与 `runtime/system.md`），不包含本 README、`agent.cordis.yml`、`preset.yml` 或 `skills/`。改投影文件后需要重建镜像，容器内哈希才会与本机一致。

## 在 DSH 中使用

DSH 默认扫描用户目录下的 `<dshHome>/.agent-presets`。若要直接使用仓库中的版本，应把本目录配置为受信任的 preset root；也可以从 DSH 的 Agent preset 设置中复制该 preset 到用户目录。不要维护两个互相漂移的手工副本。

启动会话时应把工作目录设为 WorldForge 仓库根目录。preset 的 persona 使用运行时 `{{cwd}}`，技能中的文件路径全部相对仓库根目录，因此仓库移动后无需改写绝对路径。

修改 `skills/` 后，已经运行的 DSH 会话不会自动取得新版本；请重启 Profile 或同时触碰 `agent.cordis.yml` 后新建会话。

