# `agent-runtime.schema.json`

> 作用：preset 运行时投影清单（`worldforge.runtime.json`）的 JSON Schema（draft 2020-12）。Registry 用它校验每个 preset；它是产品与 preset 之间的唯一结构契约，浏览器只能看到脱敏投影。

## 位置与两份副本

- 部署副本：仓库根 `agent-runtime.schema.json`，Registry 通过 `AGENT_RUNTIME_SCHEMA_PATH`（`agent-profile-registry.mjs` `L24`，相对模块解析）读取；镜像不含 `docs/`。
- 文档真值：`docs/schemas/agent-runtime.schema.json`。
- 两份必须逐字节一致：`tests/agent-profile-registry.test.mjs` `L89` 断言内容相等且 `$id` 相同；改 Schema 需同时改两份。

## 必填字段与约束

`additionalProperties: false`，11 个字段全部必填（`L8`）。

| 字段 | 约束 | 要点 |
| --- | --- | --- |
| `schemaVersion` | `const 1` | 结构不兼容变更时才递增；与契约常量 `AGENT_RUNTIME_SCHEMA_VERSION` 对齐 |
| `id` | 1–64，`^[a-z0-9]+(?:-[a-z0-9]+)*$` | 必须与 preset 目录名一致（由 Registry 另行断言） |
| `version` | 语义化版本 `pattern` | prompt 或契约变化须递增 |
| `displayName` / `description` | 1–60 / 1–200 | 浏览器可见，不得含路径或插件名 |
| `surfaces` | 数组 1–3 项、`uniqueItems`、元素 enum `lore/free/card` | 决定命中哪条兼容矩阵分支 |
| `mode` / `toolPolicy` / `outputContract` / `statusPolicy` | 各自 enum，取值与契约常量一一对应 | 单值字段 |
| `systemPrompt` | 1–200，`not(anyOf)` 禁 `/` 开头、盘符、`\` 开头、含 `..` 段 | 只接受 preset 根内的相对路径 |

## 条件分支（兼容矩阵）

三条并列的 `allOf` 条目，每条以 `if: surfaces contains <surface>` 触发，`then` 用 `const` 固定四个字段：

- `lore` ⇒ `structured_lore` / `lore_blocks_v2` / `none` / `proposed_only`（`L94`）
- `free` ⇒ `free_chat` / `free_chat_v1` / `free_lore_readonly` / `proposed_only`（`L105`）
- `card` ⇒ `structured_card` / `card_patch_v1` / `none` / `proposed_or_untested`（`L116`）

`mode` 等四个字段是单值 `const` 且三条分支取值互不相同，因此声明 ≥2 个 surface 的清单无法同时满足各 `then`；Registry 另有逐 surface 的运行时比对（`assertSurfaceCompatibility` `L275`），用于覆盖 Schema 分支表达不到的多行组合判断。

## 校验器实现约束

- Registry 自带最小校验器，只支持 `$schema/$id/title/description/type/const/enum/pattern/minLength/maxLength/minItems/maxItems/uniqueItems/items/required/properties/additionalProperties/allOf/if/then/contains/not/anyOf`；Schema 出现其它关键字会让 schema 加载本身失败（`AGENT_MANIFEST_INVALID`，`agent-profile-registry.mjs` `L171`/`L211`）。
- 校验分两遍：`evaluateBase` 只跑根 `properties` 的字段级关键字，错误按字段映射错误码；`evaluate` 中归为兼容性错误的 `const`/`contains` 单独汇总为 `AGENT_COMPAT_MISMATCH`（`L261`–`L264`）。
- `systemPrompt` 命中 `not` 被映射为 `AGENT_PROMPT_PATH_UNSAFE`，而非结构错误（`L144`）。
- 每个字段都显式声明 `type`（`surfaces` 为数组，其余为字符串）；`version` 为 `string` + 语义化版本 `pattern`（`L33`–`L37`）。

## 重要约束

- 枚举值、`schemaVersion.const` 与契约常量、ADR-0029 三处必须同步修改，否则契约一致性测试失败。
- `$id` 使用 `worldforge.local` 占位域名，不代表可解析地址。
- 产品永不解析或执行 `.agent-presets/<id>/agent.cordis.yml`；本 Schema 只约束投影清单与 `systemPrompt` 的相对路径。
