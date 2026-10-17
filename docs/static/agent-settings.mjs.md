# `agent-settings.mjs`

> 作用：按 surface 保存服务端默认 preset（`agent-settings.json`），与 `prompt-settings.json`、`.env.local`、SQLite 完全分离。读取失败或文件损坏时回落到 Registry 默认值；已保存的 id 即使对应 preset 消失也**不自动替换**，由解析层报 `AGENT_PROFILE_UNKNOWN` 让界面给出可理解错误。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `AGENT_SETTINGS_SCHEMA_VERSION` / `AGENT_SETTINGS_FILENAME` | 文件结构版本 `1` 与默认文件名 `agent-settings.json` | `L16` / `L18` |
| `AGENT_SETTINGS_ENV` | 覆盖路径的环境变量 `WORLDFORGE_AGENT_SETTINGS_PATH` | `L17` |
| `AgentSettingsError(message)` | 结构类错误，`code = AGENT_SETTINGS_INVALID`、`status = 400` | `L20` |
| `defaultAgentSelections(registry)` | 从 `registry.defaults` 取三个入口的默认映射 | `L29` |
| `normalizeAgentSettings(value, {defaults})` | 过滤未知 surface/字段；空值与超长值回落默认；合法 id 原样保留 | `L41` |
| `publicAgentSelections(settings)` | 只读副本，供 `GET /api/settings` 与响应体使用 | `L58` |
| `validateAgentSelectionPatch(payload, {registry})` | 校验一次 POST 的 `agentPresets` 片段，允许只提交部分入口 | `L68` |
| `loadAgentSettings(path, {defaults})` | 返回 `{schemaVersion, selections, source, reason}`；`source` 为 `file`/`defaults`，`reason` 为 `missing`/`corrupt`/`null` | `L95` |
| `saveAgentSettings(path, settings)` | 临时文件 + `rename` 原子写入，权限 `0o600` | `L113` |

## 重点逻辑

### `validateAgentSelectionPatch(payload, {registry})`
- `payload === undefined` 返回 `{}`（不修改任何入口），因此「只保存模型设置」的旧请求仍然有效。
- 逐项校验：surface 必须属于 `AGENT_SURFACES`（否则 `AGENT_SETTINGS_INVALID`）；id 必须非空；必须能 `registry.resolve(id, surface)`——未知 id 抛 `AGENT_PROFILE_UNKNOWN`、跨入口误用抛 `AGENT_PROFILE_INCOMPATIBLE`，两种错误都带 `status = 400`。
- 只返回本次要写入的键，未提交的入口由调用方保持原值。

### `normalizeAgentSettings` / `loadAgentSettings`
- 规范化只处理 `selections`，忽略其它字段与未知 surface；`schemaVersion` 固定回写 `1`。
- 文件缺失返回 `reason: 'missing'`；JSON 解析失败返回 `reason: 'corrupt'`，两者都不抛错，也不改写磁盘。
- 不做「preset 是否存在」的校验：那是解析期的事，避免把「作者选过的 preset 暂时不可用」变成静默改选。

## 重要约束

- `selections` 中的 `null` 表示「该入口未保存选择」，由调用方回落到 Registry 默认值；不要把它当作合法 id。
- 该文件只存三个 id，不存密钥、提示词或创作内容；写入必须原子，避免请求期间读到半写入内容。
