# `simulation/scenarios/m2-macro-continent.mjs`

> 作用：合成 W98「群陆演化实验世界」World Package，提供宏观地图与政体初态用于局部精细化实验。**不是正史**：全部 entry 为 `status: 'proposed'` + `payload.synthetic: true`，不写入作者资料库。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `createMacroContinentPackage()` | 编译并冻结 W98 包 | `L44` |
| `polityDefinitions` | 3 个政体：`FAC-W98-001` 岚脊盟约、`FAC-W98-002` 澄河公国、`FAC-W98-003` 赤曜议会 | `L3` |
| `regionDefinitions` | 12 个地区；列序 `[id, 标题, q, r, ownerId, terrain, population, food, foodOutput, industry, infrastructure, stability, garrison]` | `L9` |
| `neighborsFor(q, r)` | 由 4×3 偏移网格推导邻居 ID | `L37` |

## 初态构成
- 地区 `state` 含 `map{ q, r }`、`ownerId`、`terrain`、`neighbors`、`population`、`food`、`foodOutput`、`industry`、`infrastructure`、`stability`、`garrison`（`L56`–`L60`）。
- `neighborsFor` 按行号奇偶切换两组偏移表（`r % 2` 为真取 odd，否则 even），只保留落在 12 条定义内的 ID 并排序；这是屏幕坐标式的行偏移规则，不是六边形轴向坐标公式（`L37`–`L42`）。
- 政体 `state` 含 `role: 'polity'`、`treasury`、`legitimacy` 与成对 `relations`：岚脊↔澄河 `15`、岚脊↔赤曜 `-38`、澄河↔赤曜 `20`（`L62`–`L64`）；`events` 为空。内容源由 world + 3 faction + 12 location 生成，`selection.experimentalIncludes` 列出全部条目（`L53`），`proposed` 据此入包。

## Action 与退出条件
- 本包 `mechanics.modules` 为空（`L54`、`L70`），因此不暴露任何 mechanic Action；宏观行动集来自 `simulation/rules/macro-world-engine.mjs` 的 `MACRO_ACTIONS`（`macro.relief` / `macro.invest` / `macro.mobilize` / `macro.negotiate`），由 `macro-simulation-service` 直接引用，不经本包。
- 本文件不定义退出条件或终局判定；`macro-simulation-service.run` 以调用方给出的 `quarters`（1–40）为唯一上界。
