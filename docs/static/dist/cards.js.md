# `dist/cards.js`

> 作用：卡牌数据的纯函数层——类型/稀有度/子类型归一化、关键词使用表合并、卡面描述编译（富文本 → run 列表）。无 DOM、无网络，同时以 `module.exports` 暴露供 Node 复用。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `typeLabels` / `rarityLabels` / `legacyTypes` | 类型与稀有度文案；遗留类型映射 `unit→minion`、`action→spell`、`asset→equipment` | `L2`–`L4` |
| `cardableLoreTypes` / `loreTypeDefaults` | 可生成卡牌的资料类型（8 类）及其默认卡牌类型 | `L5`–`L6` |
| `minionTribes` / `spellSchools` / `schoolTierLabels` | 随从种族 5 项（均 `proposed`）、法术派系 11 项（`basic`/`advanced`/`higher`，均 `canon`） | `L7`–`L9` |
| `normalizeSubtype(type,card)` | 随从只保留合法 `tribeId`，法术只保留合法 `spellSchoolId`，武器两者清空 | `L10` |
| `tribeName` / `spellSchoolName` / `subtypeText` | 子类型显示名；`subtypeText` 供卡面底部中央一行使用 | `L16`–`L18` |
| `normalizeType` / `normalizeRarity` / `normalizeLoreRefs` | 非法值回落（`minion`/`common`）；引用 ID 去空、去重、转字符串 | `L23`–`L25` |
| `boundedNumber(value,fallback,min,max)` | 数值钳制；非有限数用 fallback | `L26` |
| `isCardableLore` / `defaultTypeForLore` | 资料能否生成卡牌、生成时默认卡牌类型 | `L27`–`L28` |
| `normalizeStats(type,card)` | 法术无属性；武器 `durability`（旧字段 `health` 兼容）；随从 `attack/health` 下限分别为 0/1 | `L29` |
| `parseRichText(value)` | 唯一富文本解析器：`<b>`/`</b>`/`<i>`/`</i>`/`**`/`*` 六种标记，其余字符原样入文本 | `L34` |
| `compileDescription(card,keywords)` | 卡面描述编译：关键词 → run 列表、纯文本、逐行台词 | `L52` |
| `normalize(card)` | 卡牌落库前的完整归一（见下） | `L62` |

## 重点逻辑

### `parseRichText(value)`（`L34`–`L51`）
- 单遍字符扫描，维护 `bold`/`italic` 两开关；`<b>` 与 `**` 效果等价但独立翻转，故不要求成对配平。
- 相邻同格式 run 会合并（`append` 复用 `runs.at(-1)`），因此不产生碎片 run。
- 未识别的 `<...>`（含 `<script>`）不作为标签解析，只作为普通字符进入文本，等于天然转义。

### `compileDescription(card,keywords)`（`L52`–`L61`）
- 输出顺序固定：**独立关键词 → 带附加描述的关键词 → 普通文本**。独立项之间用 `，`，带描述项之间用 `；`，普通文本前插入 `kind:'break'` 的换行 run。
- 关键词名恒 `bold:true`；带附加描述项渲染为 `名称：说明`，说明部分沿用其自身 run 格式；`kind` 取值 `keyword`/`detail`/`rules`/`punctuation`/`break`，Canvas 与 DOM 都靠它分流。
- 关键词 ID 在 `keywords`（Map 或数组）中不存在时静默丢弃，不报错。

### `normalize(card)`（`L62`–`L66`）
- `status` 固定 `proposed`、`balanceStatus` 固定 `untested`；`worldId` 默认 `W01`。
- `keywordUsages` 以 ID 去重（后写覆盖先写），并同步派生出 `keywordIds`；旧字段 `keywordIds` 会被升级成空 `detail`。
- `artCrop` 钳制为 `x/y ∈ [0,100]`、`zoom ∈ [1,2.5]`（默认 `50/50/1`）；`referenceAssetIds` 去重后截断为 10 个。

## 重要约束

- 卡面子类型与属性随类型互斥：`normalizeSubtype` 与 `normalizeStats` 都按 `type` 三分支返回，跨类型残留字段会被清空，因此 UI 不必手动清理。
- 富文本能力就是上述六种标记，新增标记需同时改 `parseRichText` 与 `app.js` 的 DOM 预览（`L147`）和 Canvas 绘制（`L119`–`L129`）。
- 种族/派系表硬编码在本文件；新增种族或派系需同时确认 `app.js` 的子类型下拉填充与已存卡牌的 `tribeId`/`spellSchoolId` 兼容性。
