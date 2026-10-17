# `storage-postgres.mjs`

> 作用：作者资料库的 PostgreSQL 驱动。与 `storage.mjs`（SQLite）暴露**同一套** store API，但每个方法都是 async，表 / 列 / 索引名与 SQLite 版本逐个相同，`payload_json` 一律存 TEXT 以保证 JSON 逐字节往返。写操作按 `BEGIN` + 事务级 advisory lock 复刻 SQLite `BEGIN IMMEDIATE` 的写序列化。`pg` 是**可选依赖**：只在 `createPostgresContentStore` 真正建池时按需加载，SQLite 部署与不装第三方包的单元测试不受影响。

> 篇幅说明：事务、迁移与脱敏三处都是外部边界，故略超常规长度预算。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `describePostgresTarget(connectionString)` | 脱敏连接目标，只保留 `host:port/database`；口令、用户名与查询参数一律不出现 | `L123` |
| `loadPg()`（内部） | 按需 `await import('pg')`：未安装时抛 `PG_PACKAGE_MISSING`，因此本模块与「无第三方依赖」的测试可在没有 `pg` 的机器上加载 | `L16` |
| `POSTGRES_MIGRATIONS` | 有序迁移：v1 `content-core`、v2 `art-assets`、v3 `lore-groups`，与 SQLite 版本号一致 | `L27` |
| `applyPostgresMigrations(client)` | 逐版本事务执行，返回 `{startingVersion,currentVersion,applied}` | `L161` |
| `createPostgresContentStore({connectionString})` | 建池 → 迁移 → 返回 `{driver,read,replace,health,createArtAsset,listArtAssets,getArtAsset,setArtAssetTarget,close}` | `L207` |
| `read()` | 返回与 SQLite `read()` 完全相同的 10 个键，含 `loreGroups` | `L245` |
| `replace(value,{actor})` | 校验 → BEGIN → `pg_advisory_xact_lock` → 乐观锁 → 清 5 张内容表 → 按 position 插入 → 写 metadata → COMMIT | `L269` |
| `health()` | `SELECT 1` 真实往返决定 `ok`；返回 `{ok,driver,target,schemaVersion,migration}`，**不含连接串** | `L328` |

## 重点逻辑

### 迁移游标
- 版本存在 `metadata.schema_version`（文本），而不是 SQLite 的 `PRAGMA user_version`；`metadata` 表本身由 v1 建立，因此读取版本前先用 `to_regclass('metadata')` 探测。
- 建表用 `MIGRATION_LOCK_KEY` advisory lock 串行化，避免多实例同时启动时并发建表。
- 库版本高于 `CONTENT_SCHEMA_VERSION` 时抛 `UnsupportedContentSchemaError`（直接从 `storage-migrations.mjs` 导入，不重复定义）。

### `replace` 的并发语义
- PostgreSQL 的 `BEGIN` 是延迟的，两个并发保存会同时读到旧 `revision` 都通过乐观检查；因此事务内先取 `pg_advisory_xact_lock(CONTENT_WRITE_LOCK_KEY)` 再读 revision。
- 乐观锁失败复用 `storage.mjs` 的同一个 `ContentConflictError`（`status = 409`、`instanceof` 一致），路由层无需区分驱动。
- 整库重写走单条连接，`finally` 必须 `release()`，否则连接池会被慢慢耗尽。
- `art_assets` 不在清空列表里：素材库不随整库保存被清空（与 SQLite 一致）。

### 与 SQLite 的刻意差异
- 只加了并发写锁，其余行为对齐；`unbound` 资产允许空 `targetId`，与 SQLite 版本同步。
- 连接池 `pool.on('error')` 必须挂空处理器，否则空闲连接被服务端断开会让进程直接退出；可用性一律由 `health()` 的 `SELECT 1` 表示。

## 重要约束
- 导入期零副作用：没有 `connectionString` 时立即抛错，不建池、不连库。
- 所有方法都是 async；`server.mjs` 侧统一 `await`，同一份路由代码因此能同时跑 SQLite 与 PostgreSQL。
- 不得把 `connectionString` 写进 `health()`、日志或错误信息；对外只暴露脱敏后的 `target`，且 `/api/health` 还会把它整体剔除。
- 当前部署约定：仅作者资料库可切到 PostgreSQL，W98/W99 模拟存档仍固定使用独立 SQLite 文件。
