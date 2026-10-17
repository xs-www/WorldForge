# `simulation/rules/macro-world-engine.mjs`

> 作用：W98 多地区"季度"引擎——校验并结算政体局部行动，再按固定阶段推进粮食产出、邻区赈济/贸易、消耗、迁移、财政、外交与边境易主，产出待提交的状态与事件流。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `MACRO_ACTIONS` | 冻结的行动目录与固定成本：`macro.relief` 12、`macro.invest` 15、`macro.mobilize` 10、`macro.negotiate` 8 | `L3` |
| `validateMacroAction(action, state)` | 只读校验，返回 `{ok:true, cost}` 或 `{ok:false, code, message}` | `L39` |
| `macroSummary(instanceOrState)` | 只读投影：全图 totals + 逐政体聚合（地区数、人口、粮食、工业、驻军、财政、合法性） | `L99` |
| `advanceMacroWorld(instance, proposals = [])` | 一次季度推进，返回 `{state, actions, events, summary}` | `L118` |

## 重点逻辑
### `advanceMacroWorld(instance, proposals)` `L118`
- 先 `structuredClone` 出 `state`，输入 `instance` 不被修改；`nextTick = currentTick + 1`，即一个 tick 代表一个季度（`L119-120`）。
- 阶段顺序固定（`L124-235`）：① 提案结算 → ② 粮食产出 → ③ 邻区赈济/贸易 → ④ 消耗与人口/稳定度 → ⑤ 人口迁移 → ⑥ 政体财政与合法性 → ⑦ 政体两两关系 → ⑧ 每 4 tick 的边境易主 → ⑨ 季度 summary 事件。
- ① 提案按入参数组顺序逐条结算，成本在生效时立刻从 `treasury` 扣除；失败提案只记 `{status:'rejected', validation}` 且不产生事件（`L124-128`、`L63`）。
- ② 每地区 `variance = floor(sample*3) - 1 ∈ {-1,0,1}`，粮食增量 `max(0, foodOutput + infrastructure + variance)`（`L130-133`）。
- ③ 仅 `food < 16` 的地区受援；捐赠者须是邻居、`food > 30`、且同属主或双方属主关系 `> 15`；转移量 `min(6, donor.food-30, 16-receiver.food)`；跨境额外 `+2` 关系（关系值 `clamp` 到 `[-100,100]`）（`L136-155`、`L19`）。
- ④ `consumption = max(1, ceil(population/12))`；短缺时人口减 `ceil(shortage/2)`（下限 10）、稳定度减 `min(8, shortage*2)`；不短缺时 `food > 22 && stability >= 55` 人口 +1、`food > 12` 稳定度 +1；稳定度 `>= 65` 且工业采样 `> 0.55` 时 `industry +1`（`L157-170`）。
- ⑤ `stability < 50` 且 `population > 20` 的地区迁出 1 人，目标为稳定度高出 `>= 15` 的最高邻居；每个迁出地区每 tick 至多一次（`L172-183`）。
- ⑥ 收入 `Σ(floor(industry/4) + floor(population/60))`、维持费 `floor(Σgarrison/18)`，`treasury` 不低于 0；合法性在均稳定度 `>= 65` 时 +1、`< 45` 时 -2（`L185-192`）。
- ⑧ 仅 `nextTick % 4 === 0` 触发：候选要求攻击方与目标相邻且不同属主、双方关系 `<= -30`、兵力差 `> 20`、目标稳定度 `< 55`；排序为目标稳定度升序 → 兵力差降序 → `regionId`，只执行第一名；易主后稳定度 `clamp(-12, 20, 100)`、驻军 `max(6, floor(garrison/2))`、攻击方合法性 +2、防守方 -4（`L204-232`）。

### `validateMacroAction(action, state)` `L39`
- 行动类型必须命中 `MACRO_ACTIONS`；actor 必须是 `state.role === 'polity'` 的实体且持有目标地区（`ownerId`），否则 `ACTOR_SCOPE_VIOLATION`（`L40-44`）。
- 参数键必须精确匹配：一般行动 `['regionId']`，`macro.negotiate` 为 `['regionId','targetPolityId']`，否则 `INVALID_PARAMETERS`（`L45-46`）。
- 谈判对象必须存在、非自身，且"当前相邻"——任一方地区 `neighbors` 指向对方属主控制的地区（`L49-53`、`L26-30`）。
- `macro.invest` 在 `infrastructure >= 8` 时直接拒绝 `INFRASTRUCTURE_LIMIT`；财政不足报 `INSUFFICIENT_TREASURY`（`L47-48`）。

## 重要约束
- 可复现性来源：全模块只有两处随机抽样，均由 `deterministicSample(instance.randomSeed, nextTick, scope)` 以 `${regionId}:food` / `${regionId}:industry` 为 scope 生成；不使用时间与 `Math.random`（`L131`、`L169`）。
- 可复现性依赖遍历顺序：②–⑤ 按 `regionId` 排序遍历，但 ⑥⑦ 按 `state.entities` 原序、⑧ 的候选扫描按 `state.regions` 原序；因此事件顺序也对输入数组顺序敏感。
- `advanceMacroWorld` 只返回待提交数据：不做 Tick/状态版本一致性校验、不检查 Action 重复、不写存储（模块只从 `mechanic-runtime.mjs` 导入采样函数）。
- `stateTotals` / `macroSummary` 直接除以 `regions.length`，调用方需保证地区集合非空。
