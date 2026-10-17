# `compose.nas.yaml`

> 作用：NAS 专用编排——只拉取 CI 已发布的多架构镜像（amd64 + arm64），不构建、不需要把源码放到 NAS。相对 `compose.yaml` 的差异集中在下表三处。

## 与 `compose.yaml` 的三处差异
| 维度 | `compose.yaml` | `compose.nas.yaml` |
| --- | --- | --- |
| 镜像来源 | `build:` 本地构建，标签 `worldforge:local`（L3-L6） | `image: ${WORLDFORGE_IMAGE:-ghcr.io/xs-www/worldforge:latest}`，纯拉取，无 `build`（L16） |
| 端口绑定 | 仅回环 `127.0.0.1:4173:8080`（L9） | `${WORLDFORGE_PORT:-4173}:8080`，绑全部网卡以便局域网访问（L21-L22） |
| 数据卷 | 命名卷 `worldforge-data:/data`（L24） | 宿主目录 `${WORLDFORGE_DATA_DIR:-./data}:/data`，首次启动前需手工创建（L43） |

## 注意事项
- **无鉴权**：本应用没有登录与权限，设置页可直接改写 API Key；绑全网卡后不要映射到公网，只让 tailnet 访问时应改回 `127.0.0.1:4173:8080` 并走 `tailscale serve`（L18-L20）。
- **数据目录必须是本地盘**：SQLite 依赖 POSIX 文件锁，指向 SMB/NFS 或 CloudSync 类同步目录会锁坏并损坏数据库（L40-L42）。
- 比 `compose.yaml` 多两处配置：`COMFYUI_BASE_URL` 默认 `http://host.docker.internal:8188`，并加 `extra_hosts: host.docker.internal:host-gateway`——Linux Docker 默认不解析该名，缺这行默认地址直接连不上（L29-L34）。
- 健康检查刻意不重复定义，沿用镜像内 `HEALTHCHECK`（L46）；升级靠手动 `pull && up -d` 或 NAS 任务计划，**不预置 Watchtower**，因为它要挂 `docker.sock`，会扩大攻击面（L48-L51）。
- GHCR 包若为私有，需先用带 `read:packages` 的 PAT `docker login ghcr.io`（L12-L13）。
