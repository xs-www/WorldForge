# `Dockerfile`

> 作用：把「Node 服务 + 运行时依赖 + 预构建 `dist/` + 六个 preset 投影文件」装配成单层运行时镜像；不用 Nginx，前端也没有构建步骤。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `FROM node:22-alpine` | 与 `engines.node >=22.5` 对齐（`node:sqlite` 必需）；alpine 决定健康检查只能用 `wget` 而非 `curl` | L1 |
| `COPY package.json package-lock.json /app/` + `RUN npm install --omit=dev` | 只为 PostgreSQL 驱动（`pg`）安装运行时依赖；SQLite 路径本身零依赖。目标写 `/app/` 而不是 `./`，因为 `tests/agent-profile-api.test.mjs` 用「第一个 `./` COPY 行」代表根模块白名单 | L3-L5 |
| `COPY … ./`（根模块白名单） | 只登记服务端真正 import 的根模块：`server.mjs`、`auth.mjs`、`agent-runtime.schema.json`、registry/contract、`agent-legacy.mjs`（回滚基线）、`storage*`、`storage-postgres.mjs`、`data-transfer.mjs`、`lore-import.mjs`、`lore-import-files.mjs` 与 `model-json-normalizer.mjs`（设定导入，ADR-0033）、`lore-groups.mjs`、生图与 AI 相关模块。漏登记一个 → 容器启动即 `ERR_MODULE_NOT_FOUND` | L6 |
| `COPY scripts/compile-world-package.mjs`、`COPY scripts/auth-cli.mjs` | `scripts/` 在 `.dockerignore` 中整体排除，这两个文件单独放行：前者供世界包编译，后者让 NAS 上能 `docker compose exec worldforge node scripts/auth-cli.mjs …` 建首个管理员/重置口令 | L4-L7 |
| `COPY simulation/`、`COPY dist/` | 整目录复制：模拟存档子系统与签入的前端产物。仓库**没有前端构建步骤**（`scripts/README.md` L3），`dist/` 即最终产物，改前端就是直接改 `dist/` | L5-L6 |
| 6 条 preset `COPY` | 每个 preset 只拷 `worldforge.runtime.json` + `runtime/system.md`；镜像内**不含** `agent.cordis.yml`、`preset.yml`、`skills/`、`.agent-presets/README.md` | L10-L15 |
| `EXPOSE 8080` | 与 `server.mjs` 中 `PORT` 缺省 8080 一致；宿主机映射成 4173 是 compose 层的选择 | L17 |
| `HEALTHCHECK` | 30s 间隔 / 3s 超时 / 5s 启动宽限 / 3 次重试，`wget -qO- /api/health`。`--start-period=5s` 偏短——冷启动要跑迁移与 preset 校验，首次探测可能被判失败，靠 `retries` 吸收（`compose.nas.yaml` 直接复用本条，不再自定义） | L19-L20 |
| `CMD ["node","server.mjs"]` | 无 `ENTRYPOINT`、无 supervisor；进程即服务 | L22 |

## 重要约束
- **白名单而非 `COPY . .`**：设计源（`cards/`、`worlds/`、`docs/`、`tests/`）、`.env.local` 都不该进镜像，`.dockerignore` 是第二道保险。这条一致性由 `tests/docker-packaging.test.mjs` 自动核对——它遍历 `server.mjs` 的 `from './x.mjs'` 闭包，与 COPY 行集合比对。
- **运行用户**：本文件未声明 `USER`，容器以镜像默认的 root 运行；唯一的加固来自编排层（`read_only: true` + `no-new-privileges` + 仅 `/data` 卷与 `/tmp` tmpfs 可写）。不要把「只读」误解为镜像属性。
- **只读布局的前提**：服务只往 `WORLDFORGE_DB_PATH`/`WORLDFORGE_ASSETS_PATH` 指向的 `/data` 与 `os.tmpdir()` 写；若新增写盘路径，必须同时改 compose 的卷或 tmpfs。
- 镜像不安装 Nginx；`docker/nginx.conf` 是存档配置，不参与装配。
