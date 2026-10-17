# `compose.yaml`

> 作用：单机开发/自托管的默认编排——本地构建镜像、只绑回环端口、把全部可写状态收进一个命名卷 `/data`。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `build.context: .` + `dockerfile: Dockerfile` | 本地构建，镜像标签 `worldforge:local`；NAS 场景改用 `compose.nas.yaml` 只拉不建 | L3-L6 |
| `ports: 127.0.0.1:4173:8080` | 只绑回环。本应用**没有登录与权限控制**，设置页可改写 API Key，因此默认不暴露给局域网 | L8-L9 |
| `env_file: .env.local (required:false)` | 宿主机 `.env.local` 作为容器环境变量注入；缺失不报错（首启可空配置） | L10-L12 |
| `WORLDFORGE_CONFIG_PATH=/data/.env.local` | 配置的第二来源：服务启动时读该文件并覆盖 `process.env`（`server.mjs` L22、L26-L40）。放在卷里 → 容器重建后仍生效 | L14 |
| `WORLDFORGE_DB_PATH=/data/worldforge.sqlite` | 内容数据库；`WORLDFORGE_ASSETS_PATH` 缺省会推导成 `<db 同目录>/assets/cards`，此处显式写 `/data/assets/cards` 保持一致（`server.mjs` L41-L42） | L15-L16 |
| `WORLDFORGE_COMFY_WORKFLOW_PATH` / `WORLDFORGE_PROMPT_SETTINGS_PATH` | 界面里保存的 ComfyUI 工作流与提示词配置；都落在 `/data` 才在 `read_only` 下可写 | L17-L18 |
| `read_only: true` + `tmpfs: /tmp` | 根文件系统只读；`/tmp` 用 tmpfs 供临时文件。**任何新增写盘位置都会静默失败** | L20-L22 |
| `volumes: worldforge-data:/data` | 命名卷，唯一持久化面（SQLite 库、assets、settings） | L23-L24 |
| `security_opt: no-new-privileges:true` + `restart: unless-stopped` | 禁止 setuid 提权（与 `read_only` 一起构成容器侧全部加固，镜像本身没有 `USER`）；崩溃自动重启，手动 `stop` 后不复活 | L25-L26、L19 |

## 重要约束
- 本文件不传 `COMFYUI_BASE_URL`：需要在容器内出图时，要么在 `/data/.env.local` 或宿主 `.env.local` 里配，要么用 NAS 变体（它还额外补了 `host.docker.internal` 的解析）。
- 端口 4173 是 CI 冒烟脚本的默认目标（`scripts/ci/smoke-container.mjs` L17），改端口要同步该默认值。
