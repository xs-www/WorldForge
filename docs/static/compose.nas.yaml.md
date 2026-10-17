# `compose.nas.yaml`

> 作用：NAS 专用编排——只拉取 CI 已发布的多架构镜像（amd64 + arm64），不构建、不需要把源码放到 NAS。相对 `compose.yaml` 的差异集中在下表三处。

## 与 `compose.yaml` 的三处差异
| 维度 | `compose.yaml` | `compose.nas.yaml` |
| --- | --- | --- |
| 镜像来源 | `build:` 本地构建，标签 `worldforge:local`（L3-L6） | `image: ${WORLDFORGE_IMAGE:-ghcr.io/xs-www/worldforge:latest}`，纯拉取，无 `build`（L16） |
| 端口绑定 | 仅回环 `127.0.0.1:4173:8080`（L9） | `${WORLDFORGE_BIND:-127.0.0.1}:${WORLDFORGE_PORT:-4173}:8080`，默认只绑回环；公网经 `tailscale funnel --set-path` 进入（L21-L23） |
| 数据卷 | 命名卷 `worldforge-data:/data`（L24） | 宿主目录 `${WORLDFORGE_DATA_DIR:-./data}:/data`，首次启动前需手工创建（L48-L51） |
| 账号门禁 | 未设置（本机匿名开发） | `WORLDFORGE_REQUIRE_AUTH=1`、`WORLDFORGE_AUTH_USERS_PATH=/data/users.json`、`WORLDFORGE_COOKIE_SECURE=1`；缺账号库即拒绝启动（L29-L34） |

## 注意事项
- **账号是公网发布的前提**：`REQUIRE_AUTH=1` 且 `/data/users.json` 缺失/损坏时容器直接退出（`AUTH_USERS_MISSING` / `AUTH_USERS_INVALID`）。建首个管理员：`docker compose -f compose.nas.yaml exec worldforge node scripts/auth-cli.mjs add <用户名> --admin`。
- **默认不监听局域网**：端口默认绑定 `127.0.0.1`；需要局域网直连时显式设 `WORLDFORGE_BIND=0.0.0.0`，并确认所有账号口令足够强。
- **数据目录必须是本地盘**：SQLite 依赖 POSIX 文件锁，指向 SMB/NFS 或 CloudSync 类同步目录会锁坏并损坏数据库（L45-L47）。
- 比 `compose.yaml` 多两处配置：`COMFYUI_BASE_URL` 默认 `http://host.docker.internal:8188`，并加 `extra_hosts: host.docker.internal:host-gateway`——Linux Docker 默认不解析该名，缺这行默认地址直接连不上（L34-L39）。
- 健康检查刻意不重复定义，沿用镜像内 `HEALTHCHECK`（L51）；升级靠手动 `pull && up -d` 或 NAS 任务计划，**不预置 Watchtower**，因为它要挂 `docker.sock`，会扩大攻击面（L53-L56）。
- GHCR 包若为私有，需先用带 `read:packages` 的 PAT `docker login ghcr.io`（L12-L13）。
