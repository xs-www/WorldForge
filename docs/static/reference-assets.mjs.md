# `reference-assets.mjs`

> 作用：参考图的输入边界。解析上传的 `data:` URL、限制 MIME／字节数／张数，并把已存资产转回 data URL 交给模型。

| 符号 | 契约 | 位置 |
| --- | --- | --- |
| `MAX_REFERENCE_BYTES` / `MAX_REFERENCE_IMAGES` | 上传 8 MB；一次最多 10 张 | `L2` / `L3` |
| `parseReferenceUpload(payload)` | 仅接受 PNG/JPEG/WebP 的 `data:image/...;base64,`；`targetType` 非 `lore` 一律归为 `card`，并用 `^CARD-[A-Za-z0-9-]+$` 或 `[A-Za-z0-9][A-Za-z0-9-]{1,159}` 校验 `targetId` | `L6` |
| `toReferenceDataUrl(asset, bytes)` | 复用已存资产时上限 30 MB（`MAX_EXISTING_ASSET_BYTES`），MIME 不在白名单即拒绝 | `L20` |
| `normalizeReferenceAssetIds(value)` | 去空、`Set` 去重后校验 `^ART-[A-F0-9-]+$`，超过 10 个直接报错 | `L26` |

- 大小按 `Buffer` 解码后的实际字节数判断，不看 base64 串长度；抛出的都是普通 `Error`（无 `status`），由路由层落到 500 或生图失败分支。
