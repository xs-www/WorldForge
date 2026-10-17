# `storage.mjs`

> 作用：内容库的 **SQLite 驱动**持久化层。用内置 `node:sqlite` 的 `DatabaseSync` 打开单个 SQLite 文件，提供整库快照读取、全量替换写入、健康检查与美术资产元数据读写。PostgreSQL 驱动见 `storage-postgres.mjs`，两者暴露同一套 store API（详见该文档）。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `ContentConflictError` | 版本冲突错误，`status = 409`；PostgreSQL 驱动复用同一个类 | `L9` |
| `validateContentSnapshot(value)` | 校验 `{loreEntries, cardDrafts, keywords, loreGroups, notes}`，返回只含这五个字段的新对象 | `L43` |
| `createContentStore(databasePath)` | 打开库、跑迁移、预编译语句；返回 `{ read, replace, health, createArtAsset, listArtAssets, getArtAsset, setArtAssetTarget, close }` | `L61` |
| `normalizeArtAsset(value)`（内部） | 推导 `unbound / targetType / targetId / worldId / cardId / purpose` 的规范形态 | `L167` |

## 重点逻辑

### `createContentStore(databasePath)`（`L61`）
- `mkdirSync(dirname)` 后 `new DatabaseSync`；接着执行 `journal_mode=WAL`、`synchronous=NORMAL`、`foreign_keys=ON`，再 `applyContentMigrations(db)`；此段任一步抛错都会先 `db.close()` 再重抛（`L72`–`L75`）。
- 迁移在 `prepare` 之前完成，因此所有预编译语句都基于迁移后的表结构。
- `read()`（`L94`）的 `schemaVersion` 取自常量 `CONTENT_SCHEMA_VERSION`，不是数据库内读到的值；`initialized` 为 `metadata.initialized === '1'`，`revision` 为 `Number(meta('revision','0'))`，`lastSavedBy` 为 `metadata.last_saved_by`（旧库无该键时为 `null`），另返回 `loreGroups`（自定义资料组，按 `position, id` 排序）。

### `replace(value, { actor })`（`L109`）
- 先 `validateContentSnapshot`：每张表 ≤ `MAX_ITEMS`（10 000）项、ID 非空且 ≤160 字符并唯一、`notes` ≤200 项且每项正文 ≤200 000 字符；`loreGroups` 另有 `MAX_GROUPS`（40）上限，随后 `BEGIN IMMEDIATE`。
- 仅在调用方提供 `expectedRevision` 时才做比较，不相等抛 `ContentConflictError`（`L116`）；未提供则无条件覆盖。
- 事务内 `DELETE` 五张内容表（含 `lore_groups`，**不含** `art_assets`）后按数组下标重写 `position` 重新插入，再写 `initialized=1`、`revision+1`、`updated_at`、`last_saved_by`（ADR-0030 的保存者署名，`actor` 为空记 `anonymous`），最后 `COMMIT`；任何异常 `ROLLBACK` 并重抛。
- 成功后返回 `read()`，即提交后的最新快照（含 `lastSavedBy`）。

### 美术资产（`createArtAsset` `L162`、`setArtAssetTarget` `L172`）
- 写入前要求 `id / prompt / model / size / mimeType / fileName / status / createdAt` 均非空；`targetId` 只在**绑定态**要求非空（`unbound` 资产本来就没有目标，导入一份含「未使用原画」的库不能整批失败）。`id` 必须匹配 `^ART-[A-F0-9-]+$`、`fileName` 匹配 `^[A-Za-z0-9._-]+$`；失败抛普通 `Error`（无 `status`）。
- 同一 `id` 或 `fileName` 由 SQLite 主键与 `file_name UNIQUE` 约束拒绝，本模块不做去重或幂等判断。
- `setArtAssetTarget(id, target)`：目标缺少 `targetId` 即置 `unbound = true` 并清空 `targetType / targetId / cardId / worldId`，资产仍留在库中；绑定态写入目标传来的 `worldId`（缺省保留原值）。资产不存在返回 `null`。
- `normalizeArtAsset` 的 `unbound` 也接受存量数据的 `targetType === ''`，因此旧记录读取时会被重新归类。
- `worldId` 只做归一化（`stringField(...).trim()`，`unbound` 时为空），**不校验世界是否存在**：原画归属由 `server.mjs` 按内容库现算（ADR-0034），存储层不引入第二份真相。

## 重要约束
- `replace` 是「清空内容表 + 重建」而非增量 diff：每次保存都重写全部行，`position` 完全由数组顺序决定。
- 并发保护只依赖可选的 `expectedRevision`；没有其它锁或版本通道（PostgreSQL 驱动另加事务级 advisory lock 以复刻 `BEGIN IMMEDIATE` 的语义）。
- `node:sqlite` 是同步 API，所有读写都在调用线程上阻塞；`server.mjs` 仍统一 `await` 调用，以便同一份路由代码同时跑异步的 PostgreSQL 驱动。
