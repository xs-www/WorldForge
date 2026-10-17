# `static-doc-manifest.mjs`

> 作用：校验 `docs/static/manifest.json` 与磁盘是否一致——每个条目的 SHA-256 必须等于源文件字节哈希，`doc` 路径必须存在，`counts` 必须与状态统计吻合。`npm run check` 的第二道静态文档门禁；`--write` 只重算哈希。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `hashBytes(buffer)` | 对**原始字节**求 SHA-256；不做换行归一化，因此 CRLF 与 LF 视为不同内容 | `L22` |
| `shortHash(value)` | 诊断用的短哈希；非字符串输入安全格式化为「（非字符串：类型）」，避免结构损坏时 `.slice()` 抛 `TypeError` | `L27` |
| `nonEmptyString(value)` | 字段有效性的**唯一判定**：必须是非空字符串；空串与纯空白同样视为结构非法 | `L32` |
| `verifyManifest({manifest, contents, rewrite})` | 纯函数：逐条校验哈希、`doc` 存在性、状态枚举、重复 `source`、绝对路径/`..` 越界与 `counts`；`rewrite` 时把漂移哈希放进 `updates` 而不是 `errors` | `L47` |
| `loadContents(manifest, root)` | 把清单里所有 `source` 与 `doc` 读成 `Map`；缺失文件记为 `undefined`，交由校验层报 `FILE_MISSING` / `DOC_MISSING` | `L106` |
| `main(argv)` | CLI：`--check`（默认，失败 `exit 1`）与 `--write`（重算哈希后写回清单，其余字段与顺序不动） | `L121` |

## 重要约束

- 错误码固定为 `MANIFEST_INVALID` / `PATH_UNSAFE` / `DUPLICATE_SOURCE` / `FILE_MISSING` / `HASH_MISMATCH` / `DOC_MISSING` / `COUNT_MISMATCH`；测试按错误码断言，不依赖文案。
- **停止条件与结构校验共用 `nonEmptyString`**：`sha256` 缺失、数字、`null`、对象、空串或纯空白时只记 `MANIFEST_INVALID`，不再比较哈希、也不由 `--write` 补写——字段缺失属于需要人工确认的问题，不能靠自动重写掩盖；这也保证校验器在任何损坏清单上只返回诊断、不抛异常，且不会同时冒出误导性的 `HASH_MISMATCH`。
- 空 `files` 视为失败而不是「无内容可查」，避免清单被清空后静默通过。
- `--write` 只写**有效条目**的 `sha256`：`counts`、`status`、`doc` 与实际不符属于真问题，必须人工判断。
- 与 `static-doc-anchors.mjs` 分工互补：锚点校验「`L###` 是否仍指向正确代码行」，本脚本校验「清单是否仍描述当前文件」；两者都接入 `npm run check`，任一方不一致都会让 CI 变红。