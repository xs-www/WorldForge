# ADR-0032：作者资料库支持 PostgreSQL，并提供整库导入 / 导出

- 状态：accepted（2026-10-20，用户确认「不再维持零依赖」「PostgreSQL 只覆盖作者资料库」「导入导出为资料全量 + 美术元数据 + 可选内嵌图片」）
- 关联：ADR-0004（SQLite 内容持久化）、ADR-0009（内容 schema 迁移）、ADR-0030（本机账号与公网发布）、ADR-0031（资料组）
- 影响面：`storage.mjs`、`storage-migrations.mjs`、`storage-postgres.mjs`（新增）、`data-transfer.mjs`（新增）、`server.mjs`、`Dockerfile`、`compose*.yaml`、`.env.example`、`package.json`、`dist/`（数据面板）、`tests/`、静态文档

## 背景

ADR-0004 把作者资料库放在单个 SQLite 文件里，理由是零依赖、单进程、本机或 NAS 单卷。0.3.0 之后同一实例开始被多个账号同时使用，`PUT /api/content` 又是整库快照写入；SQLite 的写序列化在 NAS 的网络卷上曾出现锁等待，且作者希望把内容库放到已有的 PostgreSQL 实例里备份、监控。

同时，产品只有「导出完整 JSON」（浏览器侧拼一份），没有任何导入路径：换机、换库、把草稿从测试实例搬到正式实例都只能手改 SQLite 文件。

## 决策

### 1. 引入 `pg`，但只在需要时加载

`package.json` 增加唯一运行时依赖 `pg@^8`。`server.mjs` 只在 `WORLDFORGE_DB_DRIVER=postgres`（或存在 `WORLDFORGE_DATABASE_URL`）时 `await import('./storage-postgres.mjs')`，SQLite 路径完全不碰这个模块，因此纯 SQLite 部署仍然零第三方依赖、`npm run check` 也不需要联网。

### 2. 两个驱动同一套 API，路由层统一 `await`

`storage-postgres.mjs` 的 `read/replace/health/createArtAsset/listArtAssets/getArtAsset/setArtAssetTarget/close` 与 `storage.mjs` 同名同参，表名、列名、索引、迁移版本号逐个对齐，`payload_json` 一律存 TEXT 以保证 JSON 逐字节往返。Async 与 sync 的差异由调用方吸收：`server.mjs` 全部 `await`（对同步返回值无副作用）。

`replace` 额外在事务内取 `pg_advisory_xact_lock`：PostgreSQL 的 `BEGIN` 是延迟的，不加锁时两个并发保存会同时读到旧 `revision` 而都通过乐观检查，加上后才真正复刻 SQLite `BEGIN IMMEDIATE` 的写序列化。

### 3. 模拟存档不迁移

W98/W99 的实例库（`instance-store.mjs`）保留 SQLite：它们是确定性实验存档，生命周期与作者资料库不同，迁移收益低、回归风险高。`/api/health` 的 `database` 与 `simulation` 两块分别报告自己的状态，文档与 `.env.example` 明确写出这个边界。

### 4. 导入 / 导出由服务端负责

新增 `GET /api/export`（可 `?images=1` 内嵌 base64 图片）与 `POST /api/import`（`mode=merge|replace`、`dryRun`）。交换格式的构造与校验放进 `data-transfer.mjs`（纯函数、无 I/O）：

- 导出真值是服务端内容库，不是浏览器缓存；
- `dryRun` 与真实导入共用 `parseImportBundle` + `validateContentSnapshot`，因此预检结论可信；
- 顺序固定为「内容事务 → 图片落盘 → 登记美术元数据」，内容失败不会留下半套资产；
- 美术资产**只补不删**：导入别人的库不会解绑或删除本机画作；
- 导入要求管理员会话与 `x-worldforge-import: 1`，任何解析/校验问题返回 400（`ContentConflictError` 仍是 409）。

### 5. 部署形态

`Dockerfile` 增加 `COPY package.json package-lock.json /app/` + `RUN npm install --omit=dev`；`.dockerignore` 排除 `node_modules`。`compose*.yaml` 透传 `WORLDFORGE_DB_DRIVER` / `WORLDFORGE_DATABASE_URL`，默认留空即 SQLite。`/api/health` 只暴露脱敏后的 `host:port/database`，且公开端点仍会整体剔除。

## 后果

- **正面**：内容库可放到已有 PostgreSQL 实例，备份与监控沿用现有运维；导入导出让「换库 / 换机 / 实例间搬运」成为一等能力。
- **代价**：镜像不再零依赖，构建需要网络安装 `pg`；两份 DDL 必须手工保持同步，`tests/storage-postgres.test.mjs` 与 `tests/storage.test.mjs` 只覆盖各自驱动，跨驱动一致性依赖静态对齐。
- **未验证**：远端 PostgreSQL 的延迟与逐行 INSERT 的吞吐未压测；单表接近 10 000 项上限时应改为分块多行 INSERT。
