# `cards/schema/card.schema.json`

> 作用：卡牌 YAML/JSON 条目的**设计契约**（JSON Schema 2020-12），供作者、模板与 ADR 对照；运行时没有校验器加载它。

- 必填 13 项（L6）：`id`、`name`、`status`、`world_id`、`card_type`、`rarity`、`cost`、`stats`、`keywords`、`rules_text`、`balance_status`、`effects`、`lore_refs`。
- 核心枚举：`status` = `canon|proposed|deprecated`；`card_type` = `minion|spell|equipment`；`rarity` = `common|rare|epic|legendary`（L10-L13）；`id` 必须匹配 `^CARD-W[0-9]{2}-[0-9]{4}$`，`world_id` 为 `^W[0-9]{2}$`（L8、L11）。
- 三个按类型的条件约束（`allOf`，L56-L60）：随从要有 `attack`+`health` 且不得有 `durability`、`spell_school` 必须为 `null`；法术的 `stats` 必须为空对象且 `tribe` 为 `null`；武器要有 `attack`+`durability`、不得有 `health`，`tribe` 与 `spell_school` 均为 `null`。
- `tribe` 词表（`human|construct|machine|undead|beast`）标注为 **proposed 待裁定**；`spell_school` 十一项对应 W01 canon 的咒语派系（L14-L23）。
- 宽松点：`additionalProperties: true`（L61），未知字段不报错；`effects` 只是 `array`，元素结构由运行时/机制注册表约束，不在此处。
- 消费方：`templates/card.yaml` 与 `cards/` 条目按此填字段，ADR-0001/0002/0007/0016/0017 记录字段演进。注意运行时 `dist/cards.js` 用的是 camelCase（`tribeId`/`spellSchoolId`）且自建白名单校验，**与本文件的 snake_case 字段是两个口径**。
