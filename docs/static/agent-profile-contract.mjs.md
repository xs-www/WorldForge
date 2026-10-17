# `agent-profile-contract.mjs`

> 作用：Agent Profile 契约的代码侧真值。纯常量、无文件系统/网络访问，供 Registry、harness 与测试共用同一套枚举、错误码与提示词层序；产品侧真值是 `agent-runtime.schema.json`，两侧由测试比对。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `AGENT_RUNTIME_SCHEMA_VERSION` | 投影清单结构版本，必须等于 Schema 的 `schemaVersion.const` | `L11` |
| `AGENT_RUNTIME_MANIFEST` | 产品只读的清单文件名 `worldforge.runtime.json` | `L14` |
| `AGENT_PRESETS_DIRECTORY` | 随仓库/镜像发布的 preset 根目录 `.agent-presets` | `L17` |
| `AGENT_PROMPT_MAX_CHARS` | prompt 字符上限 32768；Registry 另用它推出 4 倍字节上限 | `L20` |
| `AGENT_SURFACES` / `AGENT_MODES` / `AGENT_TOOL_POLICIES` / `AGENT_OUTPUT_CONTRACTS` / `AGENT_STATUS_POLICIES` | 各枚举白名单（冻结数组） | `L23`–`L35` |
| `AGENT_SURFACE_COMPATIBILITY` | surface → 唯一合法的 `mode / outputContract / toolPolicy / statusPolicy` | `L41` |
| `AGENT_PROFILE_ERROR_CODES` | 11 个冻结错误码，Registry 必须原样使用 | `L51` |
| `AGENT_PROMPT_LAYERS` / `AGENT_PRESET_REPLACEABLE_LAYER` | 6 层提示词顺序（priority 1–6）与唯一可被 preset 替换的层 `preset_runtime` | `L71` / `L81` |
| `AGENT_PROMPT_RESERVED_TAGS` | preset 正文禁止包含的产品标记（绕过即冒充产品边界/入口契约） | `L87` |
| `AGENT_UNTRUSTED_TAGS` | 只允许出现在用户侧上下文的不可信内容标记 | `L93` |

## 消费关系与改动影响

- `agent-profile-registry.mjs`（`L19`）import 其中 7 个：`AGENT_PRESETS_DIRECTORY`、`AGENT_RUNTIME_MANIFEST`、`AGENT_PROMPT_MAX_CHARS`、`AGENT_PROMPT_RESERVED_TAGS`、`AGENT_RUNTIME_SCHEMA_VERSION`、`AGENT_SURFACES`、`AGENT_SURFACE_COMPATIBILITY`。改枚举值或兼容矩阵会同时影响启动期清单校验、错误码分类与 Schema 一致性测试。
- `ai-harness.mjs`（`L2`）import `AGENT_PROMPT_RESERVED_TAGS` 与 `AGENT_UNTRUSTED_TAGS`，用于 `assertPresetPromptPortable`（预设层）与 `assertInstructionLayerClean`（第 1/3 层）的字符串扫描；增删标记会改变哪些 prompt 被拒、错误码为 `AGENT_MANIFEST_INVALID` 还是 `AGENT_UNTRUSTED_LEAK`。
- `AGENT_SURFACES` 定义启动完整性门的范围：`loadAgentProfiles` 要求每个 surface 至少有一个 preset，新增 surface 会让没有对应 preset 的部署拒绝启动。
- `AGENT_MODES`、`AGENT_OUTPUT_CONTRACTS`、`AGENT_TOOL_POLICIES`、`AGENT_STATUS_POLICIES`、`AGENT_PROFILE_ERROR_CODES`、`AGENT_PROMPT_LAYERS`、`AGENT_PRESET_REPLACEABLE_LAYER` 在本仓库产品代码里没有 import，只被 `tests/agent-profile-contract.test.mjs` 与 `tests/agent-profile-registry.test.mjs` 断言：分别与 Schema 枚举、ADR-0029 §9 错误码清单、`tests/snapshots/agent-prompt-layers.json` 逐项比对。
- 本模块不解析、不读取也不执行 `.agent-presets/<id>/agent.cordis.yml`；边界注释明确禁止把 IO 引入此文件。
