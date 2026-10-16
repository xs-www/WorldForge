---
name: worldforge-card-design
description: Use when designing, drafting, reviewing or balancing cards, keywords or reusable mechanics for the WorldForge repository, including checking IDs, status layers, field contracts, timing, counterplay and edge cases.
---

# WorldForge 卡牌设计

本技能约束如何产出一份可由作者审查的卡牌、关键词或机制草案。所有路径均相对当前 WorldForge 仓库根目录；若当前目录不是该仓库，先定位仓库，不能凭空假定文件内容。

## 1. 先读取真实契约

按顺序读取：

1. `README.md`、`docs/PROJECT_DESIGN.md`、`AGENTS.md`；
2. `mechanics/combat-rules.md` 与 `docs/adr/README.md`；
3. 与任务直接相关的 ADR、卡牌、关键词和设定条目；
4. `cards/schema/card.schema.json`、`templates/card.yaml`、`templates/keyword.md`；
5. `mechanics/keywords/README.md`。

先检索再创作。模板与 JSON Schema 冲突时以 Schema 为机器契约，并把冲突明确报告给作者。不要一开始通读整个仓库。

## 2. 权限与状态边界

- 作者拥有 canon 决定权。未获明确批准的新条目保持 `proposed`。
- 没有真实测试数据时，数值保持 `untested`，结论只能称为静态假设。
- `objective`、`in_world_belief`、`unknown` 必须分开；宗教观点不会自动成为宇宙事实。
- 最高神、宇宙起源、万法同源等未裁定问题保持开放。
- 不复制商业 IP 的专有名称、角色、地点、卡牌文本或标志性规则组合。
- 不引入无来源能量、无限神力或无条件万能效果。
- 不引用不存在的 ID；确需新增依赖时，将其列为待创建项而不是伪造现存引用。
- 变更既有 canon、公开接口、核心规则或既有卡牌语义时，先提交 ADR 提案并等待作者批准。

## 3. 当前规则边界

已确认的卡牌基础字段包括随从、法术、装备三类与费用/攻击/生命/耐久的相应结构。费用获取、卡组、场位、完整回合结构、攻击规则、伤害结算和胜负条件仍以 `mechanics/combat-rules.md` 的当前内容为准。

W97、W98、W99 都是隔离的实验纵切，不得当作 W01 正史或正式平衡基线。在基础战斗规则获批前，可以制作少量 `proposed` 样卡，但不能批量宣称正式卡池。

## 4. 卡牌字段检查

每张卡至少检查：

- 稳定 ID、名称、状态、世界、派系、类型、费用与稀有度；
- 合法目标与无目标时的明确说明；
- 触发时机、效果顺序、持续时间与离场后的行为；
- 对手可用的反制；
- 目标消失、栏位已满、重复触发、同时触发等边界情况；
- 随机池、随机顺序与可复现规则；
- `balance_status: untested`，除非仓库中存在本次可引用的真实测试结果。

卡牌字段速查见 [reference/card-fields.md](reference/card-fields.md)。真实写入前仍需重新读取当前 Schema。

## 5. 关键词与机制

新关键词必须说明：规则定义、钩子类型、至少两个典型用例、至少一种反制和至少一个边界测试。先证明现有机制原语不能表达需求，再新增特殊语义。

关键词的卡牌级 `detail` 只补充该卡用法，不能偷偷改写关键词的通用定义。关键词字段和判定标准见 [reference/keyword-fields.md](reference/keyword-fields.md)。

## 6. 执行与交付

保持改动小而可审查。写入后重新读取修改文件，检查 ID、链接、状态、事实层次、效果顺序和未知项。若当前任务只要求评审，不修改文件。

交付必须列出：

- 修改摘要与准确路径；
- 待作者裁定项；
- 与既有 canon 的冲突检查结果；
- 已做和未做的验证；
- 所有仍为 `untested` 的数值判断。

