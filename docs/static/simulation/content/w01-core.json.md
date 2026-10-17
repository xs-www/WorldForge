# `simulation/content/w01-core.json`

> 作用：W01 的内容源文件（`$schema` 指向 `../schemas/content-source.schema.json`），`sourceVersion: 1`，只含 1 条 entry。

- 唯一 entry：`W01`「魔导工业世界」，`type: 'world'`、`status: 'canon'`、`truthScope: 'objective'`、`refs: []`，`payload` 仅 `summary` 与指向 `worlds/w01-magitech/overview.md` 的 `sourcePath`——属 canonical 客观设定层，不含 `in_world_belief` 或 `unknown` 条目。
- 读取方：`manifests/w01-0.1.0.json` 的 `contentSources` 引用它，由 `compiler/world-package.mjs` 的 `compileWorldPackageFile` 相对清单目录解析并编译进 `content.objectiveDefinitions`。
