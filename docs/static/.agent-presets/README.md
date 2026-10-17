# `.agent-presets/` — 目录级汇总

> 作用：三个随仓库版本化的 DSH Agent preset。每个一级目录是一个自包含 preset：`agent.cordis.yml`（DSH 组装）+ `preset.yml`（显示名）+ `worldforge.runtime.json`（产品投影清单）+ `runtime/system.md`（提示词第 2 层）+ `skills/`。

## 三个 preset 的身份（`worldforge.runtime.json`）
| id | version | surfaces | mode | toolPolicy | outputContract | statusPolicy |
| --- | --- | --- | --- | --- | --- | --- |
| `card-designer` | `1.1.1` | `["card"]` | `structured_card` | `none` | `card_patch_v1` | `proposed_or_untested` |
| `free-creator` | `1.1.0` | `["free"]` | `free_chat` | `free_lore_readonly` | `free_chat_v1` | `proposed_only` |
| `lore-writer` | `1.1.0` | `["lore"]` | `structured_lore` | `none` | `lore_blocks_v2` | `proposed_only` |

- 一 preset 一 surface：三个入口 `lore`/`free`/`card` 各至少需要一个可用 preset，删任意一个服务即拒绝启动。
- 三个 preset 均已接入产品入口（Sprint 4 起卡牌由卡牌编辑器面板使用）：投影文本都已按「第 2 层只写 persona 与写作方式」裁剪。
- `card-designer` 的 persona 明确「评审与最终裁定由作者完成」，因此不再要求模型产出 `review`（2026-10-17 作者裁定；此前 `1.1.0` 要求「字段补丁与静态评审」）。
- DSH 侧（`agent.cordis.yml`）只授内容设计需要的文件读写、检索、skills、规划、goal/todo、web、present；**不给 shell、后台任务、子代理、workflow**。`free-creator` 连 goal/todo/plan-mode 都没有，只读性由 persona 约束（权限层强制需另选 DSH 只读 permission preset）。

## 产品读取边界
- 产品**只读** `worldforge.runtime.json` 与 `runtime/system.md`，永不解析 `agent.cordis.yml`（含 `!!js` 表达式与 DSH 插件装配，脱离 Host 无执行语义，且等于把插件装载权限变成配置来源）、`preset.yml`、`skills/`、本 README。
- `runtime/system.md` 只贡献提示词**第 2 层**；第 1 层产品边界与第 3 层入口契约由确定性代码拼装，preset 不可替换。夹带 `<product_boundary>`/`<agent_preset>`/`<entry_contract>` 等保留标记会被判 `AGENT_MANIFEST_INVALID`。
- 第 2 层不得复述第 1/3 层的纪律（IP 边界、不可信内容、canon 纪律、成本因果、工具协议）：重复会稀释权重，契约测试要求关键纪律恰好出现一次。

## 与 `agent-profile-registry.mjs` 的关系
- 启动时扫描 `WORLDFORGE_AGENT_PRESETS_DIR`（缺省本目录），逐个用 `agent-runtime.schema.json` 校验投影、解析并检查 `runtime/system.md` 路径不越 preset 根、计算 SHA-256 指纹，然后 `deepFreeze` 成只读快照，请求期不再读盘。
- 任何无效/损坏/重复/不兼容投影都让服务**拒绝启动**并打印稳定错误码（`AGENT_ENUM_UNKNOWN`、`AGENT_ID_MISMATCH`、`AGENT_PROMPT_TOO_LARGE` 等），不跳过、不换 persona。契约常量（枚举、兼容矩阵、层序、保留标记）在 `agent-profile-contract.mjs`，schema 部署副本为仓库根 `agent-runtime.schema.json`，与 `docs/schemas/` 版本由测试断言逐字节一致。
- preset 目录、清单文件与中间目录都不得是符号链接；解析后按真实路径复核仍在 preset 根内。
- 对外只暴露 `GET /api/ai/presets`（id/version/displayName/description/surfaces/mode/contract/statusPolicy/hash + 三入口 `defaults`）与 `GET /api/health` 的 `agentProfiles` 摘要；不返回提示词正文、文件路径或工具策略。
- 镜像只复制 6 个投影文件（每 preset 的 `worldforge.runtime.json` + `runtime/system.md`）；改投影后需重建镜像，容器内哈希才会与本机一致。
