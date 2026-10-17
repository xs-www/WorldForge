# `simulation/compiler/world-package.mjs`

> 作用：把发布清单 + 内容源 + 机制注册表编译成一份深冻结、可校验的 World Package，并对内容 ID、引用闭包、机制契约与参数、依赖图施加编译期约束；`packageHash` 是该产物的确定性身份。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `WORLD_PACKAGE_FORMAT_VERSION` / `WORLD_PACKAGE_COMPILER_VERSION` | 产物格式号 `1` 与编译器版本 `0.1.0`；清单 `compilerVersion` 必须与之完全相等 | `L5`、`L6` |
| `canonicalJson(value)` / `packageHash(value)` | 递归按 key 排序后 `JSON.stringify`；对结果取 sha256 十六进制摘要 | `L45`、`L49` |
| `compileWorldPackage({manifest, contentSources, mechanicRegistry})` | 纯函数编译入口：校验 → 发布筛选 → 机制装配 → 初始状态 → 冻结产物并附 `packageHash` | `L340` |
| `compileWorldPackageFile(manifestPath)` | 异步入口：读清单/内容源/注册表三个 JSON 后转交纯函数 | `L389` |
| `writeWorldPackageFile(manifestPath, outputPath)` | 编译后以 2 空格缩进 + 尾换行落盘，返回同一产物 | `L403` |
| `WorldPackageCompileError` | 本模块唯一抛出的错误类型，携带 `code` 与可选 `details` | `L16` |
| `validateManifest` | 清单版本、各字段格式、selection、contentSources、mechanics、initialState 形状 | `L60` |
| `validateContentEntry` / `collectEntries` | 单条目字段与 `refs` 合法性；跨内容源 ID 去重并 `structuredClone` | `L87`、`L104` |
| `selectEntries` | 发布筛选 + 实验白名单 + 引用闭包校验 | `L121` |
| `compileMechanicContract` / `compileMechanics` | 机制契约校验；注册表版本、命名空间唯一性、参数 Schema、依赖图与拓扑序 | `L195`、`L231` |
| `compileInitialState` | 初始状态 ID 唯一性、前缀、来源与地区引用校验 | `L307` |

## 输入 / 输出契约
- `manifest.manifestVersion` 必须为 `1`；`selection.defaultStatus` 必须为 `'canon'`（`L62`、`L69`）。
- 每个内容源必须 `sourceVersion === 1` 且有 `entries` 数组；`mechanicRegistry.registryVersion` 必须等于 `manifest.mechanics.registryVersion`（`L108`、`L232`）。
- 产物字段：`formatVersion`、`compilerVersion`、`worldId`、`definitionVersion`、`sourceCommit`、`experimental`、`experimentalIncludes`、`content{objectiveDefinitions, beliefSeeds, unresolvedMetadata}`、`mechanics{registryVersion, modules[]}`、`initialState{regions, entities, events}`、`packageHash`（`L347-366`）。
- 每个 `mechanics.modules[]` 元素形如 `{id, version, actionNamespace, effectNamespace, contract, parameters, dependencies}`（`L293-301`）。

## 重点逻辑
### `selectEntries(entries, experimentalIncludes)` `L121`
- 事实层次分区只由 `truthScope` 决定（`objective` / `in_world_belief` / `unknown` 三个数组），发布筛选只由 `status` 决定，两者正交（`L131`、`L356-358`）。
- `canon` 无条件发布；`proposed` 仅当被 `experimentalIncludes` 显式列出才发布（列出的条目必须存在且状态为 `proposed`）；`deprecated` 永不发布（`L125-131`）。
- 引用完整性针对"发布后的视图"：选中集合中任一条目的每个 `ref` 都必须也在选中集合内，否则 `MISSING_REFERENCE`（`L133-137`）。
- `experimentalIncludes` 不允许重复（`L123`）。

### `compileMechanics(manifestMechanics, registry)` `L231`
- 先编译注册表全量机制：ID/版本格式、重复 ID、Action/Effect 命名空间唯一、`compileMechanicContract` 完整校验（`L238-256`）。
- 再按清单逐模块校验：未注册 `MISSING_MECHANIC`、版本必须严格相等 `MECHANIC_VERSION_MISMATCH`、`parameters` 过 `parameterSchema`、重复配置 `DUPLICATE_MECHANIC`（`L259-270`）。
- 依赖只在"已配置机制集合"内解析：缺依赖 `MISSING_MECHANIC_DEPENDENCY`、版本不符 `MECHANIC_DEPENDENCY_VERSION_MISMATCH`（`L272-280`）。
- `visiting/visited` DFS 检出环并报 `MECHANIC_DEPENDENCY_CYCLE`，同时产出依赖在前的模块数组（`L282-304`）。
- 契约 Schema 是受限子集：`additionalProperties` 必须为 `false`，`const` 不得与 `type` 并存，类型仅 `object/string/integer/number/boolean`，`required` 的每个 key 必须已在 `properties` 中定义（`L177-193`）。
- 参数校验支持的 keyword 仅 object/required/additionalProperties、string/integer/number/boolean、`enum`/`minimum`/`maximum`；缺 `type` 或类型不受支持直接失败（`L141-175`）。

### `compileInitialState(initialState, selectedEntries)` `L307`
- `regions` 的 ID 必须 `LOC-` 前缀、`events` 必须 `EVT-` 前缀，ID 格式统一走 `ID_PATTERN`；三类集合共用一个 `seen`，跨集合同 ID 也算 `DUPLICATE_INITIAL_STATE_ID`（`L314-318`）。
- 每条的 `sourceId` 必须指向已发布的 `objective` 条目，否则 `INVALID_INITIAL_STATE_SOURCE`（`L308`、`L319`）。
- `entity.regionId`（若给出）必须存在于 `regions`，否则 `MISSING_INITIAL_REGION`（`L331-336`）。

### 哈希参与范围
- `packageHash` 由 `definition`（不含 `packageHash` 自身）计算（`L347`、`L366`）。
- 参与哈希：格式/编译器版本、`worldId`、`definitionVersion`、`sourceCommit`、`experimental` 布尔、已排序的 `experimentalIncludes`、三个内容分类数组、`mechanics`（`registryVersion` + 拓扑序模块及其 `contract`/`parameters`/`dependencies`）、`initialState`。
- 规范化只排序对象 key，**数组顺序原样保留**（`L40`）：内容数组顺序取决于内容源文件顺序及其 `entries` 顺序；`modules` 顺序取决于 DFS 起点（即清单 `modules` 顺序）与依赖先后（`L303`）。

## 拒绝时的错误形状
- 所有拒绝都是 `WorldPackageCompileError`：`code` 为机器可读枚举，`message` 为中文描述，`details` 按场景携带 `{field}`、`{id}`、`{ref}`、`{sourceId}`、`{cause}`（`L16-27`）。

## 重要约束
- `compileWorldPackage` 不读文件系统、不取时间与随机数，同一输入产出同一 `packageHash`（`L340-367`）；文件 IO 只存在于 `compileWorldPackageFile` / `writeWorldPackageFile`。
- 文件入口把"清单目录的父目录"作为允许根：内容源与注册表必须是相对路径且解析结果不得越出该根（`INVALID_MANIFEST_PATH` / `MANIFEST_PATH_ESCAPE`，`L377-387`、`L392`）。
- 文件入口在读取前先 `validateManifest`，纯函数入口内部再次校验（`L394`、`L341`）。
- `readJson` 把任何读取或解析失败统一包装为 `JSON_READ_ERROR`，`details.cause` 保留原始错误信息（`L369-375`）。
- 仅重排内容源条目或清单 `modules` 顺序即会改变 `packageHash`，即使语义等价。
