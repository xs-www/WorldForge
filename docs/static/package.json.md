# `package.json`

> 作用：零依赖 ESM 应用的唯一 manifest——三个脚本、Node 下限；没有 `dependencies`/`devDependencies`。

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `start` | `node server.mjs`；端口由 `PORT` 决定，缺省 8080（`server.mjs` L86），`.env.local` 由服务自己读 | L6 |
| `compile:world` | 转发到 `scripts/compile-world-package.mjs`，需自带 `<manifest.json> <output.json>` 两个位置参数 | L7 |
| `check` | 唯一一道关：先 36 条手写 `node --check <file>` 语法检查（根模块、`simulation/`、`dist/`、`scripts/`），再依次跑两道静态文档门禁 —— `node static-doc-anchors.mjs --check`（每个 `L###` 必须唯一命中锚点）与 `node static-doc-manifest.mjs --check`（清单哈希、文档路径与计数必须与磁盘一致），最后 `node --test tests/*.test.mjs` | L8 |
| `engines.node` | `>=22.5`——下限来自 `node:sqlite` 的 `DatabaseSync` 与内建测试运行器；CI 固定 22.23.2（`ci.yml` L37） | L10 |

## 重要约束
- `node --check` 列表是**手工维护**的白名单，新增模块不会自动纳入；镜像 `COPY` 闭包另有 `tests/docker-packaging.test.mjs` 兜底，但两者是独立口径。
- 两道文档门禁缺一不可：只校验锚点会让「文档过期但行号仍命中」的漂移变绿（Sprint 5 复核即发现 `package.json` 与卡牌 `runtime/system.md` 的真实哈希漂移未被测试发现）；只校验哈希则无法发现锚点失效。改源码后必须跑 `node static-doc-manifest.mjs --write` 重算哈希，否则 `check` 会以 `HASH_MISMATCH` 失败。
- 清单哈希按 **LF 归一化后的内容**计算：同一提交在 Linux（LF）与 Windows（CRLF）检出下都能通过；0.2.0 最初按原始字节计算，导致 GitHub Actions 的 `check` 在第一关就红，0.2.1 修复。
- `check` 是 CI 第一道关的全部内容（`ci.yml` L42-L43），因此它必须保持无网络、无密钥可跑。
