# `simulation/registries/core-mechanics.json`

> 作用：W01 的机制注册表（`$schema` 指向 `../schemas/mechanic-registry.schema.json`），`registryVersion: '0.1.0'`。

- 内容：`mechanics` 为空数组，因此 W01 包不加载任何机制模块，也就不暴露任何 Action / Effect 类型；不含 canon 或实验性质的机制定义。
- 读取方：`manifests/w01-0.1.0.json` 的 `mechanics.registry` 指向它，由 `compiler/world-package.mjs` 的 `compileMechanics` 消费（`modules` 为空时直接得到空模块列表）。
