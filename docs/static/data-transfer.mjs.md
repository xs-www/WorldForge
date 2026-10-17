# `data-transfer.mjs`

> 作用：数据导入 / 导出的**纯变换层**。把整库快照包装成可搬运的交换格式，把交换格式解析、清洗成待写入快照并计算改动统计。不读写磁盘、不连数据库、不发 HTTP——落盘与事务由 `server.mjs` 的 `runImport` 负责。

## 关键符号
| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `EXPORT_FORMAT` / `EXPORT_FORMAT_VERSION` | 交换格式标识 `worldforge-export` 与版本 `1`；导入时版本更高即拒绝 | `L6` / `L7` |
| `MAX_IMAGE_BYTES` / `MAX_IMAGES_TOTAL_BYTES` | 内嵌图片单张 10 MB、整包 200 MB 的硬上限（与上传上限一致） | `L10` / `L11` |
| `buildExportBundle({content,artAssets,images,productVersion})` | 组装导出包；`images` 由调用方读盘后传入，不传就是纯元数据导出 | `L24` |
| `parseImportBundle(value)` | 解析 + 清洗导入包，任何结构问题都在写库前抛错；返回 `{meta,content,artAssets,images}` | `L72` |
| `planImport(current,incoming,mode)` | 计算合并 / 替换后的整库内容与 `summary`（每类的 added/updated/total） | `L123` |
| `planArtAssetImport(currentAssets,incomingAssets)` | 美术资产只按 ID 补齐，从不覆盖既有绑定、从不删除 | `L158` |
| `extensionForMimeType(mimeType)` | 与支持的三种 MIME 对应的扩展名；不支持时返回空串 | `L171` |

## 重点逻辑

### 导出包形状
- 顶层：`format`、`formatVersion`、`exportedAt`、`productVersion`、`schemaVersion`、`revision`、`lastSavedBy`。
- `content`：`loreEntries`、`cardDrafts`、`keywords`、`loreGroups`、`notes` —— 与服务端 `read()` 的字段同名，便于直接回灌。
- `artAssets`：美术资产元数据（含 `unbound`/`targetType`/`targetId`）；`images`：`{id,fileName,mimeType,bytes,dataBase64}`。
- 美术资产 ID 与文件名在导出与导入两侧都按 `^ART-[A-F0-9-]+$` / `^[A-Za-z0-9._-]+$` 校验，避免路径穿越。

### `planImport(current, incoming, mode)`
- `mergeItems`：按 `id` 建 Map，导入项覆盖同名项、新项追加；卡牌、关键词、资料组与备注都走同一规则。
- `replaceItems`：直接改用导入项（签名与 `mergeItems` 一致，`planImport` 才能按模式换函数）；备注在 `replace` 模式下从空对象开始。
- 无 `id` 的项被跳过而不是抛错：导入文件里多余的占位项不应阻断整次导入。
- `summary` 的 `total` 是**写入后**的总数，供界面直接显示。

### 为什么美术资产不参与 `replace`
- 资产文件是磁盘上的真实图片，删元数据会留下孤儿文件；导入别人的库更不该解绑本机画作。
- 因此 `planArtAssetImport` 只补缺失项，重名一律以本机为准并计入 `skipped`。

## 重要约束
- 本模块没有 I/O 与事务：调用方必须先 `validateContentSnapshot` 再交给存储层，且必须在内容提交成功之后才落图片文件。
- `parseImportBundle` 同时接受「带 `format` 的完整包」与「裸 `{content:{…}}`」，但 `format` 存在且不等于 `worldforge-export` 时立即拒绝。
- 图片 base64 在这里完成大小与 MIME 校验；写入失败必须由调用方清理 `.tmp`/`.import` 临时文件。
