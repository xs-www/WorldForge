# `package.json`

> 作用：零依赖 ESM 应用的唯一 manifest——三个脚本、Node 下限；没有 `dependencies`/`devDependencies`。

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `start` | `node server.mjs`；端口由 `PORT` 决定，缺省 8080（`server.mjs` L86），`.env.local` 由服务自己读 | L6 |
| `compile:world` | 转发到 `scripts/compile-world-package.mjs`，需自带 `<manifest.json> <output.json>` 两个位置参数 | L7 |
| `check` | 唯一一道关：先 36 条手写 `node --check <file>` 语法检查（根模块、`simulation/`、`dist/`、`scripts/`），再 `node --test tests/*.test.mjs` | L8 |
| `engines.node` | `>=22.5`——下限来自 `node:sqlite` 的 `DatabaseSync` 与内建测试运行器；CI 固定 22.23.2（`ci.yml` L37） | L10 |

## 重要约束
- `node --check` 列表是**手工维护**的白名单，新增模块不会自动纳入；镜像 `COPY` 闭包另有 `tests/docker-packaging.test.mjs` 兜底，但两者是独立口径。
- `check` 是 CI 第一道关的全部内容（`ci.yml` L42-L43），因此它必须保持无网络、无密钥可跑。
