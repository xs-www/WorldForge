# `.github/workflows/ci.yml`

> 作用：三关顺序固定的单一工作流——先跑全部语法检查与单元测试，再真建镜像并做容器冒烟，最后才多架构推送到 GHCR；坏镜像不进 NAS。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `on` | `push` 到 `main` 或 `v*` 标签、所有 `pull_request`、`workflow_dispatch` 手动触发 | L11-L16 |
| `permissions: contents: read` | 工作流级最小权限；只有 `publish` job 追加 `packages: write` | L18-L19、L95-L97 |
| `concurrency` | `${{ github.workflow }}-${{ github.ref }}` + `cancel-in-progress`，同一 ref 的新推送取消上一轮，避免排队堆积 | L22-L24 |
| `check` | `ubuntu-24.04`、10 分钟超时；Node 固定 `22.23.2`（与 `engines` 下限及开发机一致），先记录 `node -v`/`npm -v` 再 `npm run check` | L27-L43 |
| `image-smoke` | 20 分钟超时；buildx 构建 `worldforge:ci`（`load: true` 只本地加载、不推送），然后用与 compose **同款参数** `docker run`：`--read-only`、`--tmpfs /tmp`、`no-new-privileges`、五个 `WORLDFORGE_*`、临时 `/data` 卷、`127.0.0.1:4173:8080` | L45-L78 |
| 冒烟步骤 | `node scripts/ci/smoke-container.mjs http://127.0.0.1:4173`；`if: failure()` 导出 `docker logs`，`if: always()` 强制删容器 | L79-L86 |
| `publish` | `needs: [check, image-smoke]`；QEMU + buildx 出 `linux/amd64,linux/arm64`，登录 GHCR 用 `GITHUB_TOKEN`，并把镜像标签写进 job summary | L88-L144 |
| 标签策略 | `latest` 仅默认分支；`type=ref` 分支名；`type=sha,prefix=sha-`；`type=semver` 的 `version` 与 `major.minor`（故只有 `v*` 标签能产出语义化版本标签） | L116-L121 |
| 缓存 | `cache-from/to: type=gha,scope=worldforge`，构建与推送两处共用同一 scope | L60-L61、L130-L131 |

## 重要约束
- **发布闸门刻意后置**：`Dockerfile` 是显式白名单 `COPY`，漏登记模块或 preset 投影会让镜像「构建成功但启动即退出」，所以 `publish` 必须等前两关（L8-L10、L90）。
- `publish` 的 `if` 同时排除 PR 并限定 `refs/heads/main` 或 `refs/tags/v*`（L92）；PR 只跑前两关。
- `image-smoke` 里 `docker run` 的环境变量是 compose 的**手工副本**，改 `compose.yaml` 或 `server.mjs` 的 `WORLDFORGE_*` 键名时要同步此处，否则冒烟通过但真实部署失败。
- 工作流头注释里的「195 项单元测试」是当时的数字（L4），实际项数随 `tests/` 增长而变化。
