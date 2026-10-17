# `dist/battle.js`

> 作用：确定性对战规则引擎（无 DOM、无存储）。输入一个 seed 即可复现同一局对战；非法操作以抛错拒绝，所有状态变化集中在少数纯函数里。同时以 `module.exports` 暴露。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `RULES` | 冻结常量：`heroHealth:20`、`startingHand:3`、`maxMana:10`、`maxBoard:5`、`maxResolutionSteps:32` | `L3` |
| `KEYWORDS` / `KEYWORD_BY_ID` | 四个实验关键词 `KEY-001..004`：疾启/护持/隔绝/余响，各带 `kind` 与 `hook` 名 | `L4`–`L10` |
| `hashSeed` / `randomFactory` / `shuffle` | FNV-1a 散列 + LCG 伪随机；洗牌先深拷贝，保证不修改入参牌组 | `L13`–`L15` |
| `normalizeEffect(effect)` | 只接受 `deal_damage`/`heal`/`draw_card`；伤害/治疗目标限于 `enemy_hero`/`self_hero`；数值截断到 0–20（抽牌 1–3） | `L18` |
| `normalizeCard(card,index)` | 卡牌归一：类型限 `minion`/`spell`；费用 0–10、攻击 0–20、生命 1–30；未知关键词丢弃；缺省 ID `CARD-W97-9xxx` | `L19` |
| `createDeck(start)` / `SAMPLE_DECKS` | 内置 10 张测试牌（W97 系列），player/opponent 各一套，ID 段 `0001` / `0101` | `L21`–`L33` |
| `playerState(id,deck,seed)` | 每侧状态：生命、法力、洗好的牌库、手牌、场上、疲劳计数 | `L34` |
| `createGame(options)` | 入口：seed 默认 `worldforge-battle-v1`；双方各抽 3 张，先手 1/1 法力 | `L37` |
| `fail(message)` / `assertTurn(state,playerId)` | 抛 `code='ILLEGAL_BATTLE_ACTION'` 的错误；回合/结束态校验 | `L38`–`L39` |
| `drawCard` / `damageHero` / `healHero` / `damageMinion` / `resolveEffect` | 基础结算原语；`damageMinion` 是“隔绝”唯一消费点（首次伤害归零并移除护盾） | `L36`, `L40`–`L43` |
| `cleanupDeaths(state)` | 循环清理 0 血随从并结算“余响”，带步数上限防死循环 | `L44` |
| `checkWinner(state)` | 双方同时归零记为 `draw` | `L45` |
| `playCard` / `canAttack` / `legalAttackTargets` / `attack` | 出牌与攻击；目标是“打出的当回合不可攻击（除非疾启）”、“敌方有护持时只能打护持” | `L46`–`L49` |
| `startTurn` / `endTurn` / `runRuleOpponent` | 回合推进：法力上限 +1 并回满、清 `attacked` 标记、抽 1 张；规则对手按“能出就出、能打就打”贪心行动后结束回合 | `L50`–`L52` |
| `snapshot(state)` | 深拷贝快照 | `L53` |

## 重点逻辑

- **可复现性**：所有随机性来自 `randomFactory(seed)`，牌库按 `` `${seed}:${playerId}` `` 派生，因此同一 seed + 同一操作序列必然同一结局；`BATTLE_UI` 固定传 `worldforge-browser-battle-v1`。
- **护持优先级**：`legalAttackTargets`（`L48`）先筛敌方 `guard` 随从，存在即返回这些随从，英雄与其它随从一并不可选；调用方（UI）据此禁用按钮，`attack` 再校验一次。
- **结算循环**：`cleanupDeaths` 每轮重扫双方场地，余响效果可能造成新的死亡；超过 `maxResolutionSteps`（32）直接抛错而不是继续结算。
- **疲劳**：牌库耗尽时累计 `fatigue` 并对自身英雄造成等量递增伤害（`L36`）。

## 重要约束

- `build`/`normalize` 系列的钳制值与 UI 输入框范围无强制联动：引擎会接受并截断越界值，因此“保存成功”不代表数值未被改动。
- 关键词效果在引擎内是**硬编码分支**（`surge`/`guard`/`isolate`/`echo` 分别对应 4 处判断），`KEYWORDS` 表的 `hook` 字段目前只是标注，静态分析未发现按 `hook` 派发的通用机制；新增关键词需要改写引擎函数。
- 引擎不持久化、不访问网络；`createGame` 之后的任何非法操作都会抛错而非静默修正。
