# `lore-groups.mjs`

> 作用：服务端访问资料组模型的唯一入口。真正的表与逻辑在浏览器侧的 `dist/lore-groups.js`，本文件通过副作用导入把它挂到 `globalThis` 再以具名绑定导出，避免服务端与前端各维护一份「五个固定组 + 旧类型迁移表」。

## 与 `dist/lore-groups.js` 的关系
- 唯一真源是 `dist/lore-groups.js`；本文件只做三件事：`import './dist/lore-groups.js'`（副作用注册 `worldforgeLoreGroups`）、取出 `globalThis.WorldforgeLoreGroups`、转成 ESM 具名导出。
- 因此 Node 与浏览器看到的是同一张 `FIXED_GROUPS` / `LEGACY_GROUPS` 表；改分组规则只需改 `dist/` 那一份。
- 部署要求：`dist/` 必须随服务端一起发布（`Dockerfile` 已 `COPY dist/`）。缺失时本模块在导入阶段抛错，属于 fail-fast。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `FIXED_GROUPS` / `LEGACY_GROUPS` | 五个固定组（world、info、character、timeline、story）与旧十三类中九个非固定类型的迁移声明 | `L7` / `L8` |
| `PROMPT_GROUP_KEYS` | 拥有独立提示词档位的组键，等于五个固定键 | `L9` |
| `MAX_LORE_GROUPS` | 自定义组上限（40），与服务端 `storage.mjs` 的校验上限一致 | `L10` |
| `normalizeLoreGroups` / `allLoreGroups` / `deriveLoreGroups` / `loreGroupOf` / `promptKeyOf` | 规范化、合并固定组、按资料派生组、按 id 查组、把任意组收敛到提示词档位 | `L12`–`L16` |
| `sanitizeLoreGroup(value)` | 把客户端提交的组清洗成 `{id,label,form,attributes,custom}`，非法返回 `null` | `L19` |
