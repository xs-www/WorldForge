# `agent-legacy.mjs`

> 作用：Sprint 5 的回滚基线（计划 §12.4、ADR-0029 §7）。`WORLDFORGE_AGENT_LEGACY_PROMPTS=1` 时让三个入口改用 `ai-harness.mjs` 的代码内固定 persona：只替换第 2 层 `preset_runtime`，第 1 层产品安全边界与第 3 层入口契约逐字保留。

> 篇幅说明：本模块承载回滚安全契约（开关语义、降级报告、对外视图），故略超 micro 预算。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `LEGACY_PROMPTS_ENV` / `LEGACY_PROMPT_SOURCE` | 开关名 `WORLDFORGE_AGENT_LEGACY_PROMPTS`；对外来源标记 `legacy-fixed-prompts` | `L13` / `L15` |
| `LEGACY_PRESET_ID` / `LEGACY_PRESET_VERSION` | 回显用的固定 id `legacy-fixed-prompt` 与版本 `0.0.0-legacy` | `L16` / `L17` |
| `legacyPromptsEnabled(env)` | 只认精确字符串 `1`；`true`、`TRUE`、`yes`、空白、带空格的值一律关闭 | `L19` |
| `legacyProfile(surface)` | 与 Registry profile 同形，`systemPrompt` 恒为空串、`legacy: true`；未登记 surface 抛 `AGENT_PROFILE_INCOMPATIBLE`（`status 400`） | `L46` |
| `legacyAgentSnapshot(surface)` | 响应回显的 `{ presetId, presetVersion, presetHash: '', mode }` | `L58` |
| `legacyDefaults()` | 三入口默认映射，全部指向 `legacy-fixed-prompt` | `L63` |
| `legacyRegistryHealth(failure)` | `/api/health` 降级报告：`degraded: true`、`diagnostics`、`promptSource` | `L71` |
| `legacyPresetsView()` | `/api/ai/presets` 的既有结构（`schemaVersion`/`presets`/`defaults`）+ `fallback` | `L87` |

## 重要约束

- `mode` / `outputContract` / `toolPolicy` / `statusPolicy` 全部取自 `AGENT_SURFACE_COMPATIBILITY`，回滚不放松任何一项：`free` 仍拿到 `free_lore_readonly` 白名单，`card` 仍无工具。
- `systemPrompt` 为空串是契约的一部分：调用方据此**不传** `presetPrompt`，让第 2 层自然退回固定 persona，而不是拼一个空层。
- 本模块不读磁盘、不缓存：开关与 profile 都在启动时求值一次，请求期不重算。
- `legacyRegistryHealth` 只在 Registry 不可用或开关打开时使用；默认路径的 `/api/health` 响应不得出现 `degraded` / `promptSource` 字段。
