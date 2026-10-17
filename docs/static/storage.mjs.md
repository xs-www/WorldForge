# `storage.mjs`

> 作用：内容库的唯一持久化层。用内置 `node:sqlite` 的 `DatabaseSync` 打开单个 SQLite 文件，提供整库快照读取、全量替换写入、健康检查与美术资产元数据读写。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `ContentConflictError` | 版本冲突错误，`status = 409` | `L8` |
| `validateContentSnapshot(value)` | 校验 `{loreEntries, cardDrafts, keywords, notes}`，返回只含这四个字段的新对象 | `L36` |
| `createContentStore(databasePath)` | 打开库、跑迁移、预编译语句；返回 `{ read, replace, health, createArtAsset, listArtAssets, getArtAsset, setArtAssetTarget, close }` | `L54` |
| `normalizeArtAsset(value)`（内部） | 推导 `unbound / targetType / targetId / cardId / purpose` 的规范形态 | `L136` |

## 重点逻辑

### `createContentStore(databasePath)`（`L54`）
- `mkdirSync(dirname)` 后 `new DatabaseSync`；接着执行 `journal_mode=WAL`、`synchronous=NORMAL`、`foreign_keys=ON`，再 `applyContentMigrations(db)`；此段任一步抛错都会先 `db.close()` 再重抛（`L65`–`L68`）。
- 迁移在 `prepare` 之前完成，因此所有预编译语句都基于迁移后的表结构。
- `read()`（`L87`）的 `schemaVersion` 取自常量 `CONTENT_SCHEMA_VERSION`，不是数据库内读到的值；`initialized` 为 `metadata.initialized === '1'`，`revision` 为 `Number(meta('revision','0'))`，`lastSavedBy` 为 `metadata.last_saved_by`（旧库无该键时为 `null`）。

### `replace(value, { actor })`（`L102`）
- 先 `validateContentSnapshot`：每张表 ≤ `MAX_ITEMS`（10 000）项、ID 非空且 ≤160 字符并唯一、`notes` ≤200 项且每项正文 ≤200 000 字符；随后 `BEGIN IMMEDIATE`。
- 仅在调用方提供 `expectedRevision` 时才做比较，不相等抛 `ContentConflictError`（`L109`）；未提供则无条件覆盖。
- 事务内 `DELETE` 四张表后按数组下标重写 `position` 重新插入，再写 `initialized=1`、`revision+1`、`updated_at`、`last_saved_by`（ADR-0030 的保存者署名，`actor` 为空记 `anonymous`），最后 `COMMIT`；任何异常 `ROLLBACK` 并重抛。
- 成功后返回 `read()`，即提交后的最新快照（含 `lastSavedBy`）。

### 美术资产（`createArtAsset` `L155`、`setArtAssetTarget` `L146`）
- 写入前要求 `id / targetId / prompt / model / size / mimeType / fileName / status / createdAt` 均非空，且 `id` 匹配 `^ART-[A-F0-9-]+$`、`fileName` 匹配 `^[A-Za-z0-9._-]+$`；失败抛普通 `Error`（无 `status`）。
- 同一 `id` 或 `fileName` 由 SQLite 主键与 `file_name UNIQUE` 约束拒绝，本模块不做去重或幂等判断。
- `setArtAssetTarget(id, target)`：目标缺少 `targetId` 即置 `unbound = true` 并清空 `targetType / targetId / cardId`，资产仍留在库中；资产不存在返回 `null`。
- `normalizeArtAsset` 的 `unbound` 也接受存量数据的 `targetType === ''`，因此旧记录读取时会被重新归类。

## 重要约束
- `replace` 是「清空四表 + 重建」而非增量 diff：每次保存都重写全部行，`position` 完全由数组顺序决定。
- 并发保护只依赖可选的 `expectedRevision`；没有其它锁或版本通道。
- `node:sqlite` 是同步 API，所有读写都在调用线程上阻塞。
