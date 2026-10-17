# `docker/nginx.conf`

> 作用：**存档**的 Nginx 站点配置，当前镜像不装配、不安装 Nginx（`Dockerfile` 直接用 `node server.mjs` 提供 `dist/` 静态文件）。保留它是旧版「Nginx 反代 + 单页回退」部署方式的参考。

- 结构：监听 8080（IPv4 + IPv6，L2-L3）、`root /usr/share/nginx/html`、SPA 回退 `try_files $uri $uri/ /index.html`（L20-L22）。
- 安全头：`nosniff`、`Referrer-Policy`、`X-Frame-Options: SAMEORIGIN`、`Permissions-Policy` 全关（L12-L15），并在 L10 用 `server_tokens off` 隐藏版本号。
- 静态策略：`gzip` 仅对 css/js/json/svg（L17-L18）；图片与脚本按扩展名缓存 1 小时并 `try_files $uri =404`（L24-L28）。
- 静态分析无法确认这些头是否与 `server.mjs` 当前实际下发的响应头一致——它不参与运行时，改动它不会影响容器行为。
