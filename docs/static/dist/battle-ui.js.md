# `dist/battle-ui.js`

> 作用：对战引擎（`WorldforgeBattle`）的 DOM 呈现层。加载时立即绑定按钮，之后每次操作重渲染整棵对战区；所有 UI 状态只有一个 `selectedAttacker`。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| 入口守卫 | `globalThis.WorldforgeBattle` 缺失或无 `document` 时直接 return（不抛错） | `L3` |
| `state` / `selectedAttacker` | 当前对局与已选攻击者 `instanceId`；`selectedAttacker` 是唯一的交互态 | `L4` |
| `cardNode(card,options)` | 手牌/场上卡节点；`options.action/label/disabled/selected` 决定按钮语义 | `L5` |
| `heroNode(playerId)` | 英雄按钮；仅在 `legalAttackTargets` 命中 `<id>-hero` 时可点 | `L6` |
| `boardNode(playerId)` | 场上行；己方随从按 `canAttack` 可点（切换选中），敌方随从按合法性点选为目标 | `L7` |
| `perform(action)` | 执行引擎调用；捕获引擎抛错后写 `#battleNotice`，成功后清空选中并重渲染 | `L8` |
| `render()` | 全量重渲染：回合/法力/牌库/提示语/双英雄/双方场地/手牌/结束回合按钮/日志 | `L9` |
| `reset()` | 以固定 seed `worldforge-browser-battle-v1` 新开一局 | `L10` |
| `endTurn()` | 结束我方回合并立刻驱动规则对手行动 | `L11` |
| `WorldforgeBattleUI.refresh()` / `.reset()` | 对 `app.js` 暴露的唯一接口；未初始化则先 `reset`，否则只 `render` | `L13` |

## 重点逻辑

- 手牌“打出”按钮的禁用条件是四者之一：非我方回合、对局已结束、费用不足、随从且场面已满（`L9`），与引擎 `playCard` 的校验一一对应；引擎仍会二次校验。
- 交互模型是“先选中攻击者，再看目标”：选中后 `#battleNotice` 变为“请选择攻击目标”，非法目标按钮被禁用而非隐藏。

## 重要约束

- `#battleReset`/`#battleEndTurn` 在**脚本加载时**绑定（`L12`），因此必须放在 `</body>` 前且在 `battle.js` 之后加载。
- 对战区完全独立于资料库与存档：不读写 `localStorage`、不发网络请求，刷新页面即丢失对局。
