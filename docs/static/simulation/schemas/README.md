# `simulation/schemas/`

> 作用：6 份 draft 2020-12 JSON Schema，描述发布链路（manifest / content-source / mechanic-registry / world-package）与模拟链路（action / effect）的结构契约；`$id` 统一为 `https://worldforge.local/schemas/<name>.schema.json`。

静态分析未发现任何模块加载或校验这些 Schema 文件：`compiler/world-package.mjs` 用等价的手写校验器实现同一约束（`validateManifest` `L60`、`validateContentEntry` `L87`、`validateJsonSchemaValue` `L141`），JSON 侧只通过对象内的 `$schema` 字段声明引用。因此约束变更时 Schema 与手写校验器需人工保持一致。

## `action.schema.json`
- 模拟 Action 信封：必填 `actionId`（`^ACT-[A-Z0-9-]+$`）、`actorId`、`type`、`expectedTick`（≥0）、`parameters`，`additionalProperties: false`——不允许携带额外字段。
- 消费方：无代码加载；实际信封校验由 `runtime/simulation-runtime.mjs` 的 `validateBatch`（`L48`）与各机制 `validate` 完成。

## `effect.schema.json`
- `oneOf` 目前只有一支 `resource.transfer`：必填 `resourceId`、`amount`（≥1）、`from` / `to`，两者的 `kind` 枚举为 `region-reserve | region-consumed | entity`（`$defs.resourceEndpoint`）。
- 消费方：无代码加载；实际应用在 `rules/mechanic-runtime.mjs` 的 `applyWorldEffects`，形状由机制 `resolve` 产出。

## `world-package.schema.json`
- 描述编译产物：`formatVersion` 恒 `1`、`compilerVersion` 恒 `'0.1.0'`、`worldId`（`^W[0-9]{2}$`）、`packageHash`（64 位小写 hex）、`experimental` / `experimentalIncludes`，`content` 三分类数组，`mechanics.modules` 必含 `id/version/actionNamespace/effectNamespace/contract/parameters/dependencies`。
- 消费方：`compiler/world-package.mjs` 的 `compileWorldPackage` 按此形状产出（`L340`–`L366`）；`storage/instance-store.mjs` 的 `validateInstantiation` 只校验 `formatVersion === 1` 与 `packageHash` 一致。

## `mechanic-registry.schema.json`
- 必填 `registryVersion` + `mechanics[]`；每个机制必填 `id/version/parameterSchema/dependencies/actionNamespace/effectNamespace/contract`，`contract` 必含 `actions`（≥1）、`effects`（≥1）、`access.reads/writes`（去重字符串）、`knowledge.classifications`（∈ `public|restricted|secret`）与 `maxTtl`（≥0）。
- 消费方：`compiler/world-package.mjs` 的 `compileMechanics`；实例见 `registries/core-mechanics.json`（当前 `mechanics` 为空数组）。

## `publish-manifest.schema.json`
- 手工发布清单：必填 `manifestVersion`（1）、`worldId`、`definitionVersion`（`x.y.z`）、`sourceCommit`（7–40 位 hex）、`compilerVersion`（`'0.1.0'`）、`contentSources`（≥1、去重）、`selection.defaultStatus` 恒 `'canon'`、`mechanics{registry,registryVersion,modules}`、`initialState{regions,entities,events}`。
- 消费方：`compiler/world-package.mjs` 的 `validateManifest` 与 `compileWorldPackageFile`（按清单中的相对路径读取内容源与注册表）；实例见 `manifests/w01-0.1.0.json`。

## `content-source.schema.json`
- 必填 `sourceVersion` 恒 `1` + `entries[]`；每条 entry 必填 `id/title/status/truthScope/worldId/type/refs/payload`，`status ∈ canon|proposed|deprecated`，`truthScope ∈ objective|in_world_belief|unknown`。
- 消费方：`compiler/world-package.mjs` 的 `validateContentEntry` / `collectEntries`；实例见 `content/w01-core.json`，实验场景则以内存对象直接传入 `compileWorldPackage`。
