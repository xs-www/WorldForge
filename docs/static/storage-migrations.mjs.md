# `storage-migrations.mjs`

> 作用：内容库 schema 的唯一真值。定义当前版本号、两条迁移（v1 内容核心表、v2 美术资产表）以及按 `PRAGMA user_version` 门控的迁移执行器。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `CONTENT_SCHEMA_VERSION` | 当前支持的 schema 版本 `2` | `L1` |
| `UnsupportedContentSchemaError` | 库版本高于支持版本时抛出，携带 `foundVersion` / `supportedVersion` | `L3` |
| `CONTENT_MIGRATIONS` | 迁移数组，每项 `{ version, name, up(db) }`；v1 = `content-core`，v2 = `art-assets` | `L12` |
| `contentSchemaVersion(db)` | 读 `PRAGMA user_version` 并转 `Number` | `L86` |
| `applyContentMigrations(db)` | 执行未应用的迁移，返回 `{ startingVersion, currentVersion, applied }` | `L90` |

## 重点逻辑

### `applyContentMigrations(db)`（`L90`）
- 先读 `user_version`；大于 `CONTENT_SCHEMA_VERSION` 时立刻抛 `UnsupportedContentSchemaError`，此时尚未执行任何 DDL。
- 只跳过 `migration.version <= startingVersion`，即严格大于才执行；重复调用不会重放已应用版本。
- 每条迁移单独 `BEGIN IMMEDIATE` → `up(db)` → `PRAGMA user_version = <version>` → `COMMIT`；异常时 `ROLLBACK` 后原样抛出，因此一条失败即中止后续版本。
- 版本号用字符串插值写入，值来自模块内常量数组，不接受外部输入。
- `applied` 只记录本次真正执行的迁移，已是最新版本时为空数组。

### 迁移内容
- v1 建 `metadata`、`lore_entries`、`card_drafts`、`keywords`、`notes`，以及 `lore_world_type_idx`、`lore_status_idx`、`cards_world_type_idx` 三个索引。
- v2 建 `art_assets`（`file_name UNIQUE`）与 `art_assets_card_idx`（`card_id, created_at`）。
- 所有表为 `STRICT`，`payload_json` / `metadata_json` 带 `json_valid(...)` CHECK，写入非 JSON 文本会被 SQLite 拒绝。

## 重要约束
- 全部 DDL 使用 `CREATE TABLE/INDEX IF NOT EXISTS`：即使 `user_version` 落后于实际表结构，也能补建而不会因已存在的表失败。
- 新增迁移只能追加 `version` 更大的条目，并同步递增 `CONTENT_SCHEMA_VERSION`；`storage.mjs` 在迁移之后才准备语句，依赖该顺序。
- 迁移游标是 `PRAGMA user_version`，与业务表 `metadata`（key/value）互不相关，后者不记录 schema 版本。
