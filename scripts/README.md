# Scripts

此目录包含离线校验、索引与导出脚本。HTML 创作工作台仍无需前端构建步骤。

- `compile-world-package.mjs`：读取 JSON 发布清单和相对路径内容源/机制注册表，完成校验并写出带 SHA-256 内容哈希的只读 World Package。
