# `.openai/hosting.json`

> 作用：静态站点托管描述——把 `dist/` 目录作为发布内容，并声明所属托管项目。

- `static.directory: "dist"`（L2-L4）：发布时整目录上传，`dist/` 必须保持已构建状态（仓库直接签入产物，无前端构建步骤）。
- `project_id`（L5）：托管项目标识，公开元数据、非密钥；改动它等于把发布指向另一个项目。
- 本文件不参与容器镜像（`.dockerignore` L5 排除 `.openai`），与 Node 服务的 `WORLDFORGE_*` 配置无关。
