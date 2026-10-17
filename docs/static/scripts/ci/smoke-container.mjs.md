# `scripts/ci/smoke-container.mjs`

> 作用：对**已启动的真实容器**做 HTTP 断言，CI 的 `image-smoke` 与手工排查共用。存在理由是 `Dockerfile` 用显式白名单 `COPY`——漏登记模块镜像照样能构建，但容器启动即抛 `ERR_MODULE_NOT_FOUND`；preset 投影漏拷则会以 `[agent-profiles] ...` 拒绝启动（L2-L15）。

## 入参 / 超时 / 退出码
- 目标地址优先级：`argv[2]` → `SMOKE_BASE_URL` → `http://127.0.0.1:4173`，末尾斜杠被剥掉（L17）。
- `SMOKE_TIMEOUT_MS` 默认 `90000`（L18）。`waitForHealth()` 每 1s 轮询 `/api/health` 直到 deadline 才抛错（L54-L66）——容器冷启动要跑完 SQLite 迁移与 preset 加载，单次请求不可靠。
- 退出码只有 `0`（全通过）/ `1`（有失败项或健康等待超时）（L104-L116）。注意断言失败**不中断**后续断言：`record()` 只累加 `failed`（L30-L34），只有 `waitForHealth` 抛错才走 `main().catch` 提前收尾。
- 断言刻意不触碰模型与生图服务：CI 无密钥，也不该产生付费请求（L14）。

## 断言分组
| 分组 | 断言要点 | 位置 |
| --- | --- | --- |
| 健康 / 数据库 | `status=ok`；`database.ok` 通过即说明 SQLite 已打开、迁移完成且 `/data` 可写（`--read-only` 下的关键验证）；带本次启动的迁移记录 | L70-L75 |
| preset 装载 | `count===3`、`diagnostics` 为空、ID 与 `EXPECTED_PRESETS` 一致、`countBySurface` 每个入口 ≥1 | L77-L81 |
| 浏览器投影 | `/api/ai/presets` 恰好三份；`defaults` 能解析到已发布投影；不含 `FORBIDDEN_LEAKS` 任一子串；每份 `hash` 匹配 `^sha256:[0-9a-f]{64}$` | L83-L91 |
| 运行时可用 | `/` 返回 `text/html` 且含 `Worldforge`（静态界面从镜像内提供）；`/api/content` 的 `revision`/`initialized` 类型正确；`/api/simulation` 有 `instance.currentTick` | L93-L100 |

## 重要约束
- `EXPECTED_PRESETS`/`EXPECTED_SURFACES`/`FORBIDDEN_LEAKS` 是与仓库发布清单硬编码对齐的三份常量（L21-L25）：新增或删除 preset、改名 surface、给投影加字段，都必须同步这里，否则 CI 假失败或漏检泄露。
- 指纹格式冻结为 `sha256:` + 64 位十六进制；镜像若混入不同版本的投影，哈希与仓库对不上，此处即报警（L89-L91）。
