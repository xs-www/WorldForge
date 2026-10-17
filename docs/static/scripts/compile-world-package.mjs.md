# `scripts/compile-world-package.mjs`

> 作用：`npm run compile:world` 的 CLI 薄壳，把「清单路径 + 输出路径」转成一次 World Package 编译；本身不含任何校验逻辑。

- 参数：`argv[2]` 发布清单 JSON、`argv[3]` 输出文件；任一缺失即打印用法并置 `process.exitCode = 1`（L4-L6），不写文件。
- 成功：`writeWorldPackageFile()` 返回 `{ worldId, definitionVersion, packageHash }`，只在 stdout 打印这一行摘要（L9-L10）。
- 失败：打印 `${error.code ?? 'COMPILE_ERROR'}: ${message}` 并置 `exitCode = 1`（L11-L13）；异常不外抛，调用方只能靠退出码判断。
- 引用完整性、真值分层与 SHA-256 哈希全部在 `simulation/compiler/world-package.mjs`；`package.json` 的 `check` 只对本文件做语法检查（L8）。
