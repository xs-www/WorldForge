# `dist/login.html`

> 作用：未登录时由 `server.mjs` 的 `serveStatic` 直接返回的独立登录页（ADR-0030）。它只加载 `styles.css` 与 `login.js`，不加载 `app.js`，因此匿名访客拿不到任何应用外壳或数据视图。

## 关键元素

| 元素 | 契约 |
| --- | --- |
| `<meta name="robots" content="noindex, nofollow">` | Funnel 公网地址不应被搜索引擎收录 |
| `#loginForm` / `#loginUsername` / `#loginPassword` | 浏览器原生 `required`、`minlength=10`；`autocomplete="username"` / `"current-password"` 让密码管理器可用 |
| `#loginError` | `role="alert"`，登录失败与限速提示都在这里显示 |
| `#loginSubmit` | 提交期间禁用并显示「正在登录…」 |
| `#togglePassword` | 显示/隐藏口令，`aria-pressed` 同步 |
| `styles.css?v=42` / `login.js?v=1` | 改样式或脚本必须同步递增 `?v=`（index.html 与 login.html 两处都要改），否则再次登录会拿到旧资源 |

## 重要约束
- 全部资源使用相对路径，Funnel 的 `--set-path /worldforge` 无需修改页面。
- 页面本身不含任何服务端数据；是否显示登录页由 `server.mjs` 决定（存在 `users.json` 即要求登录）。
- 主题偏好从 `localStorage` 的 `worldforge-preferences-v1` 读取，只影响观感，不参与鉴权。
