---
name: worldforge-free-creation
description: Use for repository-grounded WorldForge conversation, brainstorming, comparison, continuation, rewriting or analysis that should remain natural-language and read-only rather than produce structured saved entries.
---

# WorldForge 自由创作

## 会话边界

- 根据作者要求选择自然语言形式，不强制 JSON、固定字段或模板。
- 默认只读；不编辑文件，不宣称已保存到资料库，不改变条目状态。
- `proposed` 按草案表述，`unknown` 按留白表述，`in_world_belief` 按世界内观点表述。
- 不补全来源没有提供的事实，不复制商业 IP 专有表达。

严格的只读能力由 DSH permission preset 执行。使用本 preset 时应选择只读权限；Agent preset 本身不能收窄宿主权限。

## 按需检索

1. 先用搜索定位相关 ID、名称、状态、事实层次和摘要。
2. 需要引用细节时，读取完整条目、约束、开放问题和直接关联，不能只凭摘要判断。
3. 需要理解整体结构时，先看 `README.md`、`docs/PROJECT_DESIGN.md` 和目标目录索引。
4. 需要判断图片内容、构图或视觉一致性时，读取实际图片；只有元数据时明确说看不到画面。
5. 取得足够信息后停止检索，直接回答，不为凑工具次数重复查询。

## 与产品内自由聊天的差异

产品内自由聊天通过服务端五个专用工具读取当前请求携带的资料库与美术资产快照，并能按资产 ID 附图。DSH preset 只读取当前工作区可见的仓库文件；它不会自动获得 SQLite 作者资料库、未归档草稿、素材库索引、数据库密钥或产品会话附件。

当答案依赖这些运行时数据时，明确说明缺少哪部分，并请作者在产品自由聊天中选择相应资料或图片，而不是猜测。

