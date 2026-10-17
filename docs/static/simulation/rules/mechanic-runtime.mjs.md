# `simulation/rules/mechanic-runtime.mjs`

> 作用：把机制定义包进受信运行时——校验 Action/Effect 契约、按契约收窄可见状态、拒绝越权的知识策略，并提供确定性采样、白名单 Effect Resolver 与资源守恒检查。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `SimulationRuleError` | 规则层错误，携带 `code` 与 `details` | `L3` |
| `deterministicSample(seed, tick, scope)` | `sha256(seed\0tick\0scope)` 前 4 字节按大端读出后除以 2^32，返回 `[0,1)` | `L164` |
| `createMechanicRuntime(mechanics)` | 注册机制（要求 `getAvailableActions`/`validate`/`resolve` 为函数），返回四个受信入口 | `L169` |
| `resourceTotal(state, resourceId)` | 全区 `reserve + consumed` 加全部实体资源之和 | `L262` |
| `applyWorldEffects(inputState, effects)` | 纯函数 Effect Resolver：克隆入参、逐条转移资源并校验守恒 | `L273` |
| `validateContract(mechanic)` | 运行时侧契约校验（Action/Effect 命名空间前缀、访问路径格式、知识权限） | `L85` |
| `validateSchema(schema, value, path, code)` | Schema keyword 子集：`oneOf` 唯一匹配、`const`、object/required/additionalProperties、pattern/minLength、enum/minimum/maximum | `L24` |
| `scopedContext(contract, context)` / `effectWritePaths(effect)` | 依 `access.reads` 收窄上下文；由 `resource.transfer` 端点推导写入路径 | `L128`、`L118` |

## 重点逻辑
### 三处越权拒绝的执行位置
- `validate`：先按 `ACTION_ENVELOPE_SCHEMA` 校验 action 外壳，再按契约 `parametersSchema` 校验参数，**之后**才调用机制自身的 `validate`（`L200-204`）——业务 Validator 不会看到形态非法的 action。
- `resolve`：机制返回的每一项先在契约中登记过，否则 `UNAUTHORIZED_EFFECT`；再逐条过 `effects[].schema`（`INVALID_EFFECT_CONTRACT`）；`resource.transfer` 由 from/to 端点推导出的写路径必须落在 `access.writes` 内，否则 `UNAUTHORIZED_EFFECT_WRITE`（`L209-219`）。
- `knowledgePolicy`：机制未实现该方法时默认 `{classification:'restricted'}`；分类必须在 `contract.knowledge.classifications` 内，`ttl` 缺省或为 `<= maxTtl` 的正整数，否则 `UNAUTHORIZED_KNOWLEDGE_POLICY`（`L221-230`、`L234-238`）。
- 三个入口都由调用方在状态落库前调用（`simulation/runtime/simulation-runtime.mjs` 的推进流程），即拒绝发生在状态提交之前，而不在业务校验之前。

### `scopedContext(contract, context)` `L128`
- 只暴露 `access.reads` 声明过的字段：`tick`/`actor`/`knowledge` 白名单式克隆。
- 只要出现 `regions.*` 或 `entities.*` 读路径，就重建仅含这些 resourceId 与字段的 `state` 投影；未声明读路径时 `context.state` 不存在（`L136`）。读集同时是数据可见范围。
- 路径按 `.` 拆段取 resourceId 与字段名，声明与投影共用同一 `ACCESS_PATH_PATTERN`（`L83`、`L142`、`L153`）。

### `applyWorldEffects(inputState, effects)` `L273`
- 只接受 `resource.transfer`（其他类型 `UNSUPPORTED_EFFECT`），`amount` 必须是正安全整数（`L276-279`）。
- 每条 effect 执行前后各算一次 `resourceTotal`，若不等则 `RESOURCE_CONSERVATION_VIOLATION`；来源余额不足报 `RESOURCE_CONFLICT`（`L280-288`）。
- 端点必须存在（`MISSING_EFFECT_TARGET`）、地区资源必须是对象（`MISSING_RESOURCE`）、状态值必须是非负安全整数（`INVALID_RESOURCE_STATE`）（`L240-260`）。
- 入参不被修改，返回新状态（先 `structuredClone`，`L274`）。

## 重要约束
- 冲突解决顺序不在本模块：调用方以 `deterministicSample(randomSeed, nextTick, actionId)` 排序、以采样值相同则按 `actionId` 字典序决定顺序，同 Tick 竞争失败者由 Resolver 的 `RESOURCE_CONFLICT` 判定。
- `ACCESS_PATH_PATTERN` 把机制可读写状态限制为封闭集合：读根仅 `actor`/`knowledge`/`tick` 与资源路径，写路径仅地区 `reserve`/`consumed` 与实体资源。
- 只有 `resource.transfer` 会推导写入路径，其他 Effect 类型仅做登记与 schema 校验、没有写集检查（`L118-119`）—— 新增 Effect 类型必须同步扩充 `effectWritePaths`。
