# `.github/workflows/acr-mirror.yml`

> 作用：把 CI 已经推送到 GHCR 的镜像复制一份到阿里云 ACR。它不构建镜像、不 checkout 代码、不跑测试，只做 registry → registry 的 manifest 复制；触发源是 **CI 工作流成功完成**，因此镜像一定已经存在，且与同一个 commit 对应。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `on.workflow_run` | `workflows: [CI]` + `types: [completed]`；不是 `push`。CI 成功才复制，避免 ACR 抢先拉取一个还没推送的镜像 | L13-L15 |
| `on.workflow_dispatch.inputs.tag` | 手动补镜像入口，默认 `latest`，可填 `sha-abc1234` 等任意 GHCR 标签 | L16-L21 |
| `permissions` | `contents: read` + `packages: read`：够拉私有 GHCR 包，不写任何仓库内容 | L23-L25 |
| `concurrency` | `group: publish-acr`、`cancel-in-progress: false`：串行执行，并发复制 `latest` 时不会让旧运行把标签覆盖回旧镜像 | L28-L30 |
| `env.ACR_NAMESPACE` / `env.IMAGE_NAME` | ACR 命名空间（`xs-www`）与镜像名（`worldforge`）。命名空间不保证与 GitHub owner 同名，故显式配置 | L32-L35 |
| `jobs.publish.if` | 手动触发直接跑；`workflow_run` 要求 `conclusion == 'success'` 且事件不是 `pull_request`（PR 的 CI 不产镜像） | L39-L44 |
| `检查 ACR 凭据`（`id: creds`） | 三个 secret 缺任一个就 `::notice::` 跳过并把 `configured=false` 写进 `GITHUB_OUTPUT`；配了才继续。忘加 secret 时流水线保持绿色，而不是每次推送都红 | L46-L58 |
| 登录 | 先 GHCR（`${{ github.actor }}` + `GITHUB_TOKEN`），再 ACR（`secrets.ACR_REGISTRY/USERNAME/PASSWORD`），最后 `docker/setup-buildx-action`；都带 `if: steps.creds.outputs.configured == 'true'` | L60-L78 |
| 复制步骤 | `copy_tag`：`imagetools inspect --raw` → `jq` 取 `linux/amd64`、`linux/arm64` 的 digest → `imagetools create -t <ACR> src@digest ...` 重建索引；`trap ERR` 把失败行号写成注解，`create` 失败时把末尾 4 行（去 ANSI）写成注解；缺标签只告警跳过，一个都没复制才失败 | L80-L126 |
| 标签推断 | 非手动触发时镜像 `sha-<7 位>`；`main` 额外镜像 `latest`；`v0.3.2` 这类发布标签额外镜像 `0.3.2`（CI 的 semver 规则去掉了 `v`）；其它分支说明「没有产出镜像」后直接成功退出 | L94-L105 |

## 重要约束
- **必须重建索引，跳过 attestation**：`docker/build-push-action` 默认会给镜像附加 provenance/SBOM 的 attestation manifest（索引里 `platform: unknown/unknown`）。GHCR 收得下，阿里云 ACR 会以 `403 denied: unknown manifest class` 拒绝，整个复制失败。因此 `copy_tag` 用 `imagetools inspect --raw` + `jq` 只挑 `linux/amd64`、`linux/arm64` 两个平台 manifest，再用 `imagetools create -t <ACR> src@digest ...` 重建索引；GHCR 侧的 attestation 原样保留，只是不镜像过去。实测（本地 registry 回归）重建后索引只剩这两个平台。
- **必须用 `imagetools` 而不是 `docker pull`/`docker push`**：pull/tag/push 只能搬运 runner 当前平台的单架构镜像，会把 GHCR 的 `linux/amd64,linux/arm64` manifest list 降级成 amd64；`imagetools create` 在 registry 之间直接复制 manifest，两个架构原样保留。
- **按不可变 `sha-` 标签复制，再顺带刷新 `latest`**：`latest` 会随后续推送移动，只看 `latest` 无法保证 ACR 拿到的是本次 CI 产出的那个 commit。
- **失败要能匿名定位**：Actions 的原始日志需要认证下载，所以复制步骤 `trap ... ERR` 把失败行号写成 `::error::`，`imagetools create` 失败时把 stderr 前三行写成注解；`inspect` 失败时把首行原因写进 `::warning::`。这套注解是被实测逼出来的：首轮失败只看到「exit code 1」，加上注解后才定位到大小写问题。
- **GHCR 名称必须小写**：`github.repository` 是 `xs-www/WorldForge`，而 GHCR 上的仓库名是 `ghcr.io/xs-www/worldforge`（`docker/metadata-action` 推送时已转小写）。脚本用 `tr` 归一，否则 `imagetools inspect` 全部因「repository name must be lowercase」失败、最后以「没有复制任何标签」收尾。
- **失败的 CI 不复制**：`workflow_run.conclusion` 不是 `success` 时 job 直接跳过，所以坏镜像不会进 ACR。
- **不 checkout 代码**：`workflow_run` 由默认分支的工作流文件驱动，本工作流没有任何 `run:` 使用仓库内脚本，ACR 凭据只暴露在两次 `login-action` 里。
- **ACR 秘密项**：`ACR_REGISTRY`（registry 主机，例如 `registry.cn-hangzhou.aliyuncs.com`）、`ACR_USERNAME`、`ACR_PASSWORD`。缺任一项时工作流以 `::notice::` 跳过而不是失败，避免未配置 ACR 的仓库每次推送都红；一旦配置齐全，下一次 CI 成功就会自动复制。
- 本工作流不负责 NAS 更新：NAS 仍按 `compose.nas.yaml` 拉取式部署，需要 ACR 或 GHCR 的镜像先就绪。
