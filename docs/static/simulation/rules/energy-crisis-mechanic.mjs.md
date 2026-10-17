# `simulation/rules/energy-crisis-mechanic.mjs`

> 作用：M1 的示例机制 `MEC-001@1.1.0`——把"申请 / 转交 / 消耗能源"三种 Action 声明为封闭契约，并全部结算为同一种 `resource.transfer` Effect。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `ENERGY_CRISIS_CONTRACT` | 冻结契约：3 个 Action、1 个 Effect、读写集、知识权限 `classifications:['restricted']` / `maxTtl:1` | `L17` |
| `createEnergyCrisisMechanic({resourceId = 'energy'})` | 构造冻结机制对象（`id`/`version`/`actionNamespace:'energy'`/`effectNamespace:'resource'`/`contract` + 四个方法） | `L84` |
| `getAvailableActions(context)` | 无 `context.actor` 时返回 `[]`；否则给出 3 个行动，`parameters.amount` 仅为提示字符串 `'positive_integer'` | `L92` |
| `validate(action, context)` | 业务校验，返回 `{ok:true}` 或 `{ok:false, code, message}`，不抛异常 | `L97` |
| `knowledgePolicy(action)` | 恒为 `restricted`；`energy.request` 追加 `ttl: 1` | `L130` |
| `resolve(action, context)` | 三种行动各产出一条 `resource.transfer` | `L137` |

## 重点逻辑
### 行动结算与守恒 `L137-158`
- `energy.request`：`region-reserve(actor.regionId)` → `entity(actorId)`。
- `energy.transfer`：`entity(actorId)` → `entity(targetId)`。
- `energy.consume`：`entity(actorId)` → `region-consumed(regionId)`。
- 三种行动都是端点间转移，故总量守恒；来源余额不足由 Resolver 以 `RESOURCE_CONFLICT` 拒绝，守恒由 `RESOURCE_CONSERVATION_VIOLATION` 兜底。

### `validate(action, context)` `L97`
- 先做与 runtime 重叠的自检：`actionId` 以 `ACT-` 开头、`actorId === context.actor.entityId`、`expectedTick === context.tick`、`amount` 为正安全整数、自身能源为非负安全整数（`L98-104`）。
- `request` / `consume` 只允许 `amount + regionId`，且 `regionId` 必须等于 actor 所在地区；`transfer` 只允许 `amount + targetId`，目标须同地区且非自身（`L106-126`）。
- `request` 额外要求该地区 `reserve >= amount`，否则 `ACTION_UNAVAILABLE`；`transfer`/`consume` 要求 actor 自身余额 `>= amount`，否则 `INSUFFICIENT_ACTOR_RESOURCE`（`L110`、`L117`、`L124`）。
- 失败码集合：`INVALID_ACTION`、`ACTOR_SCOPE_VIOLATION`、`STALE_TICK`、`INVALID_AMOUNT`、`INVALID_ACTOR_RESOURCE`、`INVALID_PARAMETERS`、`ACTION_UNAVAILABLE`、`INVALID_TARGET`、`INSUFFICIENT_ACTOR_RESOURCE`、`UNKNOWN_ACTION_TYPE`。

## 新增机制应复用的原语
- 契约四段式：`actions[].parametersSchema`、`effects[].schema`、`access.{reads,writes}`、`knowledge.{classifications,maxTtl}`（`L17-61`）。
- 所有参数 Schema 关闭额外字段（`additionalProperties: false`）；Effect 用 `const` 固定类型、用 `enum` 固定 `resourceId`（`L42-51`）。
- 端点仅三态 `region-reserve` / `region-consumed` / `entity`，是 Resolver 能识别的封闭集合（`L9-15`、`L141-157`）。
- 方法契约：`getAvailableActions`/`validate`/`resolve` 为 runtime 强制实现项，`knowledgePolicy` 可选；业务拒绝用返回值表达，异常仅用于契约违规。

## 重要约束
- 契约把 `resourceId` 的 `enum` 固定为 `['energy']`（`L47`），而 `resolve` 使用工厂参数 `resourceId`；传入非 `energy` 值产出的 Effect 无法通过契约 schema（`INVALID_EFFECT_CONTRACT`）。
- `resolve` 不复检余额与地区归属，假定 `validate` 已通过；调用方必须先 `validate`（成功）再 `resolve`。
- 本机制是合成测试规则，不定义 W01 的能源正史；其 `energy`/`MEC-001@1.1.0` 标识与注册表条目需保持一致。
