# 卡牌字段速查

本文件帮助审查，不替代 `cards/schema/card.schema.json`。写入前必须读取当前 Schema。

```yaml
id: CARD-W##-####
name: 候选卡名
status: proposed
world_id: W##
set_id: null
faction_ids: []
card_type: minion
cost: 0
stats:
  attack: 0
  health: 1
rarity: common
tribe: null
spell_school: null
keywords: []
effects: []
rules_text: ""
flavor_text: ""
balance_status: untested
lore_refs: []
notes: []
```

类型约束：

- `minion`：`attack` 与 `health`，其中 `health >= 1`；`spell_school` 为空。
- `spell`：`stats` 为空；`tribe` 为空；可使用 `spell_school`。
- `equipment`：`attack` 与 `durability`；`tribe`、`spell_school` 为空。

稳定 ID：卡牌 `CARD-W##-####`，关键词 `KEY-###`，机制 `MEC-###`，提案 `ADR-####`。改名不改 ID，废弃条目保留替代指向。

