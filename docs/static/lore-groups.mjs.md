# `lore-groups.mjs`

> 作用：服务端访问资料组模型的唯一入口。真正的表与逻辑在浏览器侧的 `dist/lore-groups.js`，本文件通过副作用导入把它挂到 `globalThis` 再以具名绑定导出，避免服务端与前端各维护一份分组表。

## 与 `dist/lore-groups.js` 的关系
- 唯一真源是 `dist/lore-groups.js`；本文件只做三件事：`import './dist/lore-groups.js'`（副作用注册 `WorldforgeLoreGroups`）、取出 `globalThis.WorldforgeLoreGroups`、转成 ESM 具名导出。
- 因此 Node 与浏览器看到的是同一张 `FIXED_GROUPS` / `LEGACY_GROUPS` 表与同一套字段规则；改分组模型只需改 `dist/` 那一份。
- 部署要求：`dist/` 必须随服务端一起发布（`Dockerfile` 已 `COPY dist/`）。缺失时本模块在导入阶段抛错，属于 fail-fast。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `FIXED_GROUPS` / `LEGACY_GROUPS` | 五个固定组（world/location/character/timeline/story）与旧类型迁移声明（含各自的默认字段） | `L7` / `L8` |
| `MINIMAL_FIELDS` / `DEFAULT_FIELDS` | 默认字段只有「详细设定」；名称是条目身份，不在字段里 | `L10` / `L9` |
| `LEGACY_FIELD_LABELS` / `FIELD_KINDS` | 旧字段标签表与四种字段类型 | `L12` / `L11` |
| `PROMPT_GROUP_KEYS` / `IMAGE_PROMPT_GROUP_KEYS` | 提示词档位键（五个固定组）与生图档位键（card + 五组 + other） | `L13` / `L14` |
| `normalizeLoreGroups` / `normalizeStoredLoreGroups` | 视图规范化（丢固定组）与落库规范化（保留固定组覆盖行） | `L19` / `L20` |
| `allLoreGroups` / `deriveLoreGroups` / `groupsForWorld` / `migrateLegacyGroups` | 合并固定组、按世界派生、取某世界的组、旧组迁移 | `L21`–`L24` |
| `promptKeyOf` / `fieldSchema` / `groupResponseSchema` | 提示词档位、字段 Schema、由字段生成的整组返回约束 | `L26`–`L28` |
| `sanitizeLoreGroup(value)` | 清洗客户端提交的组（字段列表与提示都保留），非法返回 `null` | `L30` |
| `fallbackGroup(type)` | 请求没带组时按 type 回落到固定组/旧组的默认字段 | `L35` |
| `imageKeyForId(type)` | 资料类型 → 生图档位（地理→location、编年史→timeline、其余→other） | `L44` |
