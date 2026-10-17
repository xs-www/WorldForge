# `scripts/auth-cli.mjs`

> 作用：账号运维 CLI（ADR-0030）。在 NAS / 容器里创建首个管理员、加人、重置口令、调角色与配额。默认操作与服务端同一份 `users.json`（`WORLDFORGE_AUTH_USERS_PATH`，未设置时取 `.env.local` 同目录），因此 `node scripts/auth-cli.mjs add alice --admin` 与随后 `npm start` 看到的账号一致。

## 命令

| 命令 | 行为 |
| --- | --- |
| `add <用户名> [--admin] [--password <口令>]` | 账号库不存在时只有 `--admin` 可用（首个账号必须是管理员）；否则调用 `createUser`。未给口令则生成一次性口令并打印 |
| `bootstrap <用户名>` | 等价于 `add <用户名> --admin` |
| `list` | 打印用户名、角色、状态、配额与今日用量 |
| `reset <用户名> [--password <口令>]` | 重置口令并让该账号现有会话失效 |
| `role <用户名> <admin\|member>` | 改角色；降级唯一可用管理员会被拒绝 |
| `quota <用户名> <ai\|image> <次数\|unlimited>` | 只改指定类型，另一类型保持原值 |
| `enable` / `disable <用户名>` | 停用后登录与既有会话立即失效 |
| `remove <用户名>` | 删除账号；`admin` 只能由另一个管理员删除 |
| `--users <path>` | 覆盖账号库路径，便于在宿主上操作容器数据目录 |

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `defaultUsersPath` | `WORLDFORGE_AUTH_USERS_PATH` → 否则 `join(dirname(WORLDFORGE_CONFIG_PATH \|\| <repo>/.env.local), 'users.json')` | `L35` |
| `parseArgs` | 支持 `--admin` / `--password` / `--users`，其余为命令与位置参数 | `L42` |
| `writeNewStore` | 账号库不存在时原子写入首个管理员（tmp + rename，`0600`），随机 32 字节会话密钥 | `L57` |
| `openOrBootstrap` | 账号库缺失返回 `store: null`，让 `add --admin` 走建库分支，其余命令提示先建管理员 | `L79` |
| `printUsers` / `announcePassword` | 列表输出与一次性口令提示（口令只打印一次） | `L88` / `L99` |
| `main` | 命令分发；所有错误以 `[auth-cli] CODE: message` 打到 stderr 并置退出码 1 | `L109` |

## 重要约束
- CLI 与服务端共用 `auth.mjs`：校验、哈希、角色与「最后一个 admin」保护不会出现两套实现。
- 服务运行期间改文件是安全的：服务端在登录/管理操作前按 mtime 重载；无需重启容器。
- 不要用 `--password` 在可留存历史的环境里传口令；默认生成并当面转交更安全。
