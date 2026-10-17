# ADR-0030：以本机账号体系支撑 Tailscale Funnel 公网发布

- 状态：accepted（2026-10-18，用户确认「共享工作区 + 应用内账号 + 管理员用户面板 + 每人每日配额」四项分叉）
- 关联：ADR-0004（SQLite 内容持久化）、ADR-0013（模拟台暂无鉴权）、ADR-0029（Agent Profile 运行时投影）
- 影响面：`server.mjs`、`storage.mjs`、`dist/`（新增 `login.html` / `login.js`）、`compose.nas.yaml`、`Dockerfile`、`.env.example`、静态文档

## 背景

0.2.2 之前，WorldForge 是**单用户本机应用**：35 个 API 中只有 4 个自定义请求标记头（`x-worldforge-*`）用于区分来源，它们不是鉴权；`GET/POST /api/settings` 可读写 `.env.local`（含 LLM 与 Seedream 的 API Key），`PUT /api/content` 可整库覆盖，`/api/health` 还被 Docker `HEALTHCHECK` 使用。README 与 `compose.nas.yaml` 都明确写着「不要映射到公网」。

作者现在要把实例放到 NAS，并用 Tailscale Funnel 暴露到公网，给 3–5 个协作者使用。Funnel 的约束（[Funnel 文档](https://tailscale.com/docs/features/tailscale-funnel)、[funnel 命令](https://tailscale.com/docs/reference/tailscale-cli/funnel)）：

1. 只能发布 `443 / 8443 / 10000`，URL 公网可达，任何人拿到地址就能请求；
2. TLS 由 Tailscale 终结，节点侧收到的是明文 HTTP，应用无法依赖网络位置做信任；
3. `--set-path` 可把子路径挂到同一监听，但不会替应用做任何鉴权。

因此「是否暴露」不再是部署文档能约束的事：必须在应用内建立**默认拒绝**的鉴权边界，并让「忘记配置账号」变成启动失败而不是匿名可用。

## 决策

### 1. 数据模型：共享工作区，账号只做身份与权限

3–5 个用户协作同一份世界观、卡牌与素材，因此**不做多租户隔离**：`worldforge.sqlite`、模拟库、`/data/assets` 仍然全局唯一；账号只决定「能否进入、能否改设置、能否管账号、每天能用多少 AI」。理由：

- 现有 `PUT /api/content` 是整库快照写入 + `expectedRevision` 乐观锁，多租户需要给四张表与资产、模拟实例全部加租户维度，并把整库快照改成按租户差分，工作量数倍且冲突语义要重写。
- 协作场景需要的是「谁改的」与「冲突提示」，不是彼此看不见；作者已确认共享工作区。

### 2. 账号：用户名 + scrypt 口令，`users.json` 持久化

- 口令用 `node:crypto` 的 scrypt（N=16384、r=8、p=1、keylen=64），16 字节随机盐，`timingSafeEqual` 比较；`users.json` 只存盐与派生密钥。
- 账号库默认与服务配置同目录（Docker 内 `/data/users.json`），临时文件 + `rename` 原子写入，权限 `0600`；永不打印或回传口令。
- 用户名归一为小写（2–32 位 `[a-z0-9._-]`，字母或数字开头）；口令 10–200 位。
- 角色只有两级：`admin`（设置、API Key、账号管理、内容）与 `member`（内容编辑、AI 与生图）。账号管理不做「谁能看哪个世界」这类细粒度授权。

### 3. 会话：HMAC 签名 Cookie，无服务端会话表

- Cookie `wf_session`（`HttpOnly; SameSite=Lax; Path=/`），值为 `v1.<payload>.<HMAC-SHA256>`，密钥来自 `users.json` 的 `sessionSecret`；有效期 30 天。
- 因为无状态，登出只能清除浏览器 Cookie；真正的全网失效靠 `sessionVersion`：改口令、重置口令、改角色、停用都会递增版本，旧令牌立刻失效。
- 跨站请求由 `SameSite=Lax` + 既有自定义标记头（`x-worldforge-*`，登录/账号接口用 `x-worldforge-auth`）共同挡住；不额外引入 CSRF token。
- `Secure` 属性：`WORLDFORGE_COOKIE_SECURE=1` 或请求带 `x-forwarded-proto: https` 时启用；Funnel 部署必须设为 `1`。

### 4. 门禁：fail-closed，匿名模式只留给本机

- 存在 `users.json` → 启用账号模式：除 `GET /api/health`、`GET /api/auth/session`、`POST /api/auth/login`、`POST /api/auth/logout` 外，所有 `/api/*` 都要求会话；`/api/settings` 与 `/api/users*` 另外要求 `admin`。
- 未登录的**无扩展名导航**（`/`、`/worldforge/`）直接返回 `login.html`，不把应用外壳发给匿名访客；`login.js` / `styles.css` 等静态资源可匿名取用。
- `WORLDFORGE_REQUIRE_AUTH=1` 时，`users.json` 缺失或损坏 → **拒绝启动**（`AUTH_USERS_MISSING` / `AUTH_USERS_INVALID`，退出码 1），与 Agent Registry 的 fail-fast 一致。未设置该变量且没有账号库时保留匿名模式（本机开发与既有测试），但启动时打印明确警告。
- 首个管理员只能由 CLI 创建（`node scripts/auth-cli.mjs add <用户名> --admin`）；网页端账号面板不允许把空账号库变成可用实例。

### 5. 费用边界：按人、按 UTC 自然日配额

- 成员默认每日 200 次 AI 调用、30 次生图；管理员默认不限；可在账号面板逐账号设为任意整数或「不限」。
- 计数落在 `worldforge-usage.json`（与 `users.json` 同目录，只保留最近 7 天），避免重启清零。
- 计数发生在模型调用之前，失败也计入；响应 429 `AUTH_QUOTA_EXCEEDED` 带 `kind / limit / used / resetAt`。
- 不实现并发上限与按字节计费：3–5 个受信用户下，配额的目标是「泄露口令后能止损」。

### 6. 可见性与审计

- 内容保存把 `session.username` 传给 `contentStore.replace`，写入 `metadata.last_saved_by`；`GET /api/content` 返回 `lastSavedBy`，页头状态显示「SQLite 已保存 · alice」。
- `worldforge-audit.jsonl` 只追加账号事件（登录成功/失败、创建、改角色、停用、重置、删除、配额超限）与内容/设置保存的 actor，不含口令、令牌或 API Key 值。
- `/api/health` 增加 `auth: { mode, users, requireAuth }`；不返回用户名列表，并从内容库/模拟 health 中去掉绝对路径（公开端点不应泄露 NAS 目录结构）。

### 7. 登录页与界面

- `dist/login.html` + `dist/login.js` 是独立页面，零依赖、零构建；用 `document.currentScript` 解析挂载路径，因此 `--set-path /worldforge` 不需要改任何 URL。
- 应用侧把 `window.fetch` 包一层：任何 401 都跳回登录页；`loadSession()` 决定页头显示（用户名/角色、改口令、退出）与设置入口是否可见，**服务端仍然是唯一权威**。
- 成员看不到设置与账号面板；自助改口令放在页头的「改口令」对话框（改完换发新 Cookie，其他设备失效）。

## 备选与取舍

| 方案 | 不采用的原因 |
| --- | --- |
| 外层反代 Basic Auth（Caddy/nginx） | 不改代码、最快，但只有一个共享口令，没有身份、署名、配额与账号级止损；设置页仍是所有持口令者可写 |
| 每人独立资料库（多租户） | 需要重写整库快照写入、资产与模拟归属，工作量约为本方案 3 倍，且与「协作同一世界观」的目标相反 |
| 无状态 JWT 放 localStorage | 令牌可被脚本读取，XSS 代价更高；Cookie + HttpOnly 更适合本应用 |
| 服务端会话表 | 可精确吊销，但需要新增表、清理逻辑与迁移；当前规模用 `sessionVersion` 已足够 |
| 自动生成首个管理员并打印到日志 | 容器日志可能被 NAS 面板长期留存；CLI 更可控，且能让「没有账号库」保持显式失败 |

## 已知限制（必须如实记录）

1. **登出不撤销令牌**：被复制的 Cookie 在 30 天有效期内仍可用；发现泄露应重置该账号口令（递增 `sessionVersion`）或停用账号。
2. **配额计数在模型调用前**：模型报错也计一次；管理员可在当日手工调高配额，不提供「退还」。
3. **登录限速在内存**：进程重启后失败计数清零；按用户名与来源 IP 双维度限速（5 次/15 分钟锁 15 分钟；IP 20 次/10 分钟）。
4. **Funnel 的 `X-Forwarded-For` 由 Tailscale 追加**，客户端 IP 只用于限速，不作为授权依据；如 NAS 上 Tailscale 跑在用户态容器里，需先在宿主安装官方包并确认 `tailscale funnel` 可用。
5. **成员没有「编辑偏好」入口**：主题/密度偏好仍保存在浏览器，但设置对话框对成员隐藏；后续可拆出「我的偏好」面板。
6. **没有邮箱找回口令**：忘记口令只能由管理员重置。

## 验证

- `tests/auth.test.mjs`（13 项）：scrypt 往返、结构校验、令牌篡改/过期、Cookie 属性、限速、账号 CRUD、最后一个 admin 保护、配额落盘、外部改写热重载、审计不含机密。
- `tests/auth-api.test.mjs`（10 项）：真实启动服务，覆盖 401/403、登录与未知账号同码、内容署名、成员配额 429、管理员账号操作、登出、自助改口令、`REQUIRE_AUTH=1` 缺账号库拒绝启动、匿名本机模式。
- `tests/auth-ui.test.mjs`（7 项）：登录页独立、401 回登录页、可见性、账号面板、改口令、署名显示、服务端门禁顺序。
- `npm run check` 全绿；本地以 `WORLDFORGE_REQUIRE_AUTH=1` + 临时账号库启动，手工验证登录、成员只读设置、改口令与配额。

## 未决问题

1. 是否需要「只读访客」角色（当前 member 即可写内容）。
2. 是否需要把审计日志做成可查询界面，而不是只落 JSONL。
3. 多实例部署（SQLite 单写）与备份/恢复流程尚未设计。
