# 卡牌索引

基础对战规则未确认前，不批量生成正式卡池。候选卡必须标记 `proposed` 与 `untested`。

当前类型固定为 `minion / spell / equipment`，稀有度固定为 `common / rare / epic / legendary`。卡牌可通过 `lore_refs` 引用多个设定来源；来源引用不改变设定条目的状态。
