---
name: worldforge-lore-writing
description: Use when drafting, rewriting, reviewing or conflict-checking WorldForge lore entries or background stories, especially when output must fit the repository's structured content blocks and status/truth-scope rules.
---

# WorldForge 设定写作

## 读取顺序

1. 读取 `README.md`、`docs/PROJECT_DESIGN.md`、`AGENTS.md`。
2. 读取 `docs/canon-policy.md`、`docs/editorial-style.md` 与 `docs/adr/README.md`。
3. 搜索目标 ID、关联 ID、同世界 canon 和直接相关提案；只读取任务所需条目。
4. 按目标类型读取模板和相关索引，不要一开始通读整个仓库。

## 写作流程

1. 确认目标类型、稳定 ID、状态、事实层次和作者选中的内容块。
2. 把上下文分为：已批准事实、候选草案、世界内观点、刻意留白。
3. 检查现有依赖、关联与潜在冲突；不存在的 ID 不得伪造为已存在条目。
4. 只写被要求的内容块，未选择字段保持不变。
5. 输出可直接回填的成品文字；开放问题只保留确实需要作者裁定的事项。
6. 写入仓库时保持 `proposed`，除非作者已明确批准其他状态。

内容块及各类型重点见 [reference/content-blocks.md](reference/content-blocks.md)。

## 通用质量标准

- 世界：先处理能源、自然法则、生产、运输通信、社会分化与神性边界。
- 组织：必须有利益、资源、组织方式、内部矛盾、外部关系和弱点。
- 人物：必须能作出选择，有欲望、关系、能力边界和当前冲突。
- 宗教：信徒观点与作者层事实分开。
- 魔法：写清来源、流程、成本、失败方式与反制。
- 科技：能力与材料、能源、制造维护、基础设施相匹配。
- 事件：保持前因、行动、直接结果和长期影响的因果链。
- 故事：用行动、场景、感官、对话和因果推进，不以设定分析代替叙事。

## 交付检查

- canon 是否被静默覆盖或补完；
- `objective / in_world_belief / unknown` 是否混淆；
- 是否出现免费能量、无限神力或万能能力；
- 是否使用不存在的 ID 或第三方 IP 专有表达；
- 哪些问题仍需作者裁定；
- 实际做了哪些检查，哪些没有做。

