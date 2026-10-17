# `dist/login.js`

> 作用：登录页脚本。零构建、无依赖，用 `document.currentScript` 解析挂载路径，向 `<mount>/api/auth/login` 提交口令，成功后跳回 `<mount>/`。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `SCRIPT_ROOT` / `API_ROOT` | `new URL('./', currentScript.src)` 与 `new URL('./api/', currentScript.src)`；两者都相对挂载路径 | `L6` / `L7` |
| `stripCode(message)` | 去掉服务端错误文本的 `CODE: ` 前缀；`AUTH_*` 只用于诊断 | `L9` |
| `showError` / `clearError` / `setBusy` | 错误框、提交态切换 | `L13` |
| `redirectIfSignedIn()` | 先查 `auth/session`，已登录直接跳回应用，避免重复登录 | `L36` |
| `#togglePassword` 处理器 | 切换 `input.type` 与按钮文案 | `L45` |
| `#loginForm` 提交处理器 | 校验非空 → `POST auth/login`，带 `X-Worldforge-Auth: 1`；401 显示「用户名或口令不正确」，429 追加「请稍后再试」；成功后 `location.replace(SCRIPT_ROOT.href)` | `L53` |
| 主题读取 | 复用 `worldforge-preferences-v1` 的 `theme` / `density` | `L84` |
| 启动 | `redirectIfSignedIn()` + 聚焦用户名 | `L90` |

## 重要约束
- 不使用绝对路径 `/api/...`：Tailscale Funnel 子路径部署下会请求到错误位置。
- 失败时不重发请求、不缓存口令；提交中禁用输入，避免重复触发限速计数。
- 登录成功与否只由服务端 `Set-Cookie` 决定，脚本不保存任何令牌。
