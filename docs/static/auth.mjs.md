# `auth.mjs`

> 作用：WorldForge 的账号与会话层（ADR-0030）。零依赖，只用 `node:crypto` 与 `node:fs/promises`；把 `users.json` 变成「scrypt 口令 + HMAC 签名会话 + 角色 + 每日配额 + 审计」的单一服务对象。`server.mjs` 在启动时打开它，并在路由分发之前按 `sessionFromRequest` 的结果做 401/403 门禁。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `AUTH_USERS_ENV` / `AUTH_REQUIRE_ENV` / `AUTH_COOKIE_SECURE_ENV` | `WORLDFORGE_AUTH_USERS_PATH` / `WORLDFORGE_REQUIRE_AUTH`（只有精确 `1` 生效）/ `WORLDFORGE_COOKIE_SECURE`（`1`/`0`，未设置时按请求协议自动判断） | `L21` / `L22` / `L23` |
| `AUTH_COOKIE_NAME` / `AUTH_SESSION_TTL_MS` | `wf_session`；会话 30 天 | `L24` / `L27` |
| `AUTH_DEFAULT_QUOTA` | 成员默认 `{ ai: 200, image: 30 }`；管理员默认 `quota: null`（不限） | `L28` |
| `AuthError` | 稳定 `code` + HTTP `status`（401/403/409/429 等）+ `details`；`message` 仍带 `CODE: ` 前缀，服务端按既有契约原样回传 | `L45` |
| `validateUsername` / `validatePassword` / `validateRole` | 用户名归一为小写并匹配 `^[a-z0-9][a-z0-9._-]{1,31}$`；口令 10–200 位且不得全空白；角色只能是 `admin` / `member` | `L71` / `L77` / `L90` |
| `generatePassword()` | 24 位 base64url 一次性口令，仅由 `createUser`/`resetPassword` 返回一次 | `L86` |
| `normalizeQuota(value, fallback)` | `null` 表示不限；未提供的类型回落默认值；只接受 0–100000 整数 | `L96` |
| `hashPassword` / `verifyPassword` | scrypt（N=16384、r=8、p=1、keylen=64、16 字节盐）；`verifyPassword` 用 `timingSafeEqual`，参数非法返回 `false` 而不抛错 | `L112` / `L118` |
| `signSession` / `verifySession` | `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`，payload 为 `{u,v,e}`；校验签名、长度、过期时间，失败返回 `null` | `L134` / `L140` |
| `readSessionCookie` / `sessionCookie` / `clearSessionCookie` | 解析 `Cookie` 头；输出 `Path=/; HttpOnly; SameSite=Lax; Max-Age=…`（可选 `Secure`），清除用 `Max-Age=0` | `L157` / `L170` / `L176` |
| `cookieSecureMode` / `isSecureRequest` | 显式 `1`/`0` 优先；否则读 `x-forwarded-proto` / `req.socket.encrypted` | `L183` / `L189` |
| `validateAuthFile(value)` | 严格校验版本、`sessionSecret`（至少 32 字节）、用户数组（≤50）、用户名唯一、角色、`sessionVersion`、口令记录；丢弃未知字段；要求至少一个 `admin` | `L206` |
| `openAuthStore({usersPath, now, quotaDefaults, requireAuth})` | 读库并按 mtime 热重载；返回 `{sessionFromRequest, login, logout, sessionFor, changePassword, listUsers, createUser, updateUser, resetPassword, deleteUser, usageFor, consumeQuota, audit, userCount, health}` | `L277` |

## 重点逻辑

### 持久化与热重载（`saveState` `L307`、`reloadIfStale` `L314`）
- `users.json` 用临时文件 + `rename` 原子写、`0600`；只写 `{version, sessionSecret, users}`，未知字段不会回写。
- 登录与账号管理操作前按 `mtime` 比较，文件被 CLI 改写则重载；重载失败保留内存副本并 `console.warn`，不让运行中的实例因为半边文件而崩溃。
- 配额计数写同目录 `worldforge-usage.json`（只保留最近 7 天）；审计追加 `worldforge-audit.jsonl`，只记 `{at, actor, action, detail}`，不含口令、令牌或 API Key。

### 登录与限速（`login` `L363`）
- 用户名归一为小写；未知账号也走一次等价的 scrypt 校验（`dummyPasswordRecord` `L391`），避免响应时间枚举账号；错误统一为 `AUTH_INVALID_CREDENTIALS`（401）。
- 用户名维度：15 分钟内失败 5 次 → 锁 15 分钟；IP 维度：10 分钟内失败 20 次 → 锁 15 分钟。命中锁定返回 `AUTH_RATE_LIMITED`（429，带 `retryAfterSeconds`）。计数在内存中，进程重启清零。
- 成功登录写 `lastLoginAt`、重置失败计数、返回 `{user, token, expiresAt, cookie}`；`cookie` 已按 `secure` 参数生成。

### 会话与吊销（`sessionFor` `L336`、`sessionFromRequest` `L405`）
- `sessionVersion` 随改口令、重置口令、改角色、停用递增；旧 Cookie 因版本不匹配立即失效。
- 登出不撤销令牌：`logout` 只写审计并让服务端清 Cookie，签名令牌在到期前仍可用（ADR-0030 已列为已知限制）。

### 账号管理
- `createUser` `L447`：校验用户名/角色，未给口令时生成一次性口令；成员默认配额来自 `quotaDefaults`，管理员默认 `null`。
- `updateUser` `L471`：可改角色、停用、配额；把「唯一可用的 admin」降级或停用会抛 `AUTH_LAST_ADMIN`。
- `resetPassword` `L490`：重置并递增版本；`changePassword` `L502`：要求旧口令，成功后同样递增版本。
- `deleteUser` `L514`：禁止删除当前账号（`AUTH_SELF_TARGET`），并要求至少保留一个可用 admin。
- `consumeQuota` `L415`：在模型调用前计数，超限抛 `AUTH_QUOTA_EXCEEDED`（429，带 `kind/limit/used/resetAt`）；`quota` 为 `null` 的账号视为不限。

## 重要约束
- 账号模式只在 `users.json` 存在时启用；`server.mjs` 负责「`REQUIRE_AUTH=1` 时缺失/损坏即拒绝启动」的 fail-closed 语义，本模块只抛稳定错误码。
- 口令永不落盘明文、永不写日志；`listUsers` 只返回 `username/role/disabled/createdAt/createdBy/lastLoginAt/quota/usage`。
- 会话密钥来自 `users.json`；删除或替换该文件等于让所有会话失效。
- 本模块不做 HTTP、不读请求体；cookie 与 header 由 `server.mjs` 传入。
