# ADR-0010：发布清单与 World Package 使用 JSON 契约

- 状态：canon（技术边界）
- 日期：2026-10-13
- 决策者：作者
- 来源：作者明确指定发布清单使用 JSON

## 背景

ADR-0008 已确定由显式发布清单把已审核内容编译为只读 World Package，但保留了 JSON 或 YAML 的格式选择。M0B 需要稳定的机器接口、JSON Schema、确定性序列化和内容哈希。

## 决策

1. 发布清单、编译内容源、机制注册表与 World Package 均使用 UTF-8 JSON；对应契约位于 `simulation/schemas/`。
2. 发布清单固定声明 `worldId`、语义化 `definitionVersion`、源 Git commit、编译器版本、内容源、状态选择、机制配置和初始状态。
3. 默认只编译 `canon`。`proposed` 只能通过 `experimentalIncludes` 精确列出，且产物必须带 `experimental: true`；`deprecated` 不进入新包。
4. 编译器使用键排序后的规范 JSON 计算 SHA-256 `packageHash`。相同清单与内容必须得到相同哈希；实例化时重新校验哈希。
5. `truthScope` 决定输出分区：`objective`、`in_world_belief`、`unknown` 分别进入权威定义、信念种子和未决元数据。只有已发布的 `objective` 条目可作为初始地区、实体或事件的来源。
6. 首版通过仓库内零依赖校验器实施关键约束，同时发布标准 JSON Schema 供编辑器与后续工具使用。不能把“Schema 文件存在”误述为已经接入第三方完整 Schema 引擎。
7. 编译产物放入 `exports/` 或调用方指定路径，不作为内容源文件；世界实例会嵌入完整定义包与哈希，避免存档依赖可变工作区。

## 影响范围

- `simulation/compiler/`、`simulation/schemas/`、`simulation/manifests/`、`simulation/content/` 与 `simulation/registries/`。
- M0B 编译命令、实例存档、测试及未来 Definition 版本迁移。

## 未解决问题

- JSON Schema 当前只作为公开契约和编辑器提示；如需完整 Draft 2020-12 验证，后续再评估依赖或独立校验器。
- Markdown/YAML 正史到编译内容 JSON 的自动审核同步尚未实现；M0B 示例仅收录已有 W01 canon 的最小投影。
- World Package 签名、发布渠道和旧 Definition 的实例迁移策略尚未定义。
