# `simulation/scenarios/m1-energy-crisis.mjs`

> 作用：用内联数据合成 W99「M1 合成测试世界」World Package，只服务于纯规则 Tick 循环验证。**不是正史**：全部 entry 为 `status: 'proposed'` + `payload.synthetic: true`，且被归纳为 `experimental: true`，因此不写入作者资料库。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `createM1EnergyCrisisPackage({ reserve = 12 })` | 编译并冻结 W99 包；`reserve` 非正安全整数抛 `TypeError` | `L41` |
| `createM1EnergyCrisisMechanics()` | 返回 `[createEnergyCrisisMechanic({ resourceId: 'energy' })]`，供 `createSimulationRuntime` 使用 | `L74` |
| `entries` / `mechanicRegistry` | 4 条内联内容源条目（1 world + 1 location + 2 faction）与只含 `MEC-001` v1.1.0 的注册表 | `L4`、`L23` |

## 初态与 Action
- 初态：1 个地区 `LOC-W99-001`，`state.resources.energy = { reserve, consumed: 0 }`（`L58`–`L61`）；2 个实体同处该区——`FAC-W99-001`（`role: 'utility'`）与 `FAC-W99-002`（`role: 'council'`），各自 `resources.energy` 为 `0`（`L63`–`L64`）；`events` 为空。唯一参数化入口是 `reserve`，其余初值固定。
- manifest 把 4 条 `proposed` 条目全部列入 `selection.experimentalIncludes`（`L51`）；只读编译器 `selectEntries` 的选择集为 `canon ∪ 显式请求的 proposed`，这是 `proposed` 条目入包的唯一通道。
- 可发现 Action 不在本文件定义，来自机制契约 `ENERGY_CRISIS_CONTRACT`：`energy.request` / `energy.transfer` / `energy.consume`（`simulation/rules/energy-crisis-mechanic.mjs`）。
- 退出条件也不在本文件：由 `energyCrisisProgress` 判定 `reserve === 0 && held === 0`（`simulation/agents/rule-agent.mjs` `L32`），`dashboard-service.run` 以此为循环终止条件。
