# `lore-import-files.mjs`

> 作用：设定导入的**文件输入层**（ADR-0033 §9）。把作者上传的 `.md` / `.txt` / `.docx` / `.xlsx` / `.doc` / `.xls` / `.zip` / `.rar` / `.rtf` 读成纯文本，交给 `lore-import.mjs` 的解析管线。纯变换层：不收 HTTP、不写磁盘、不调用模型；解压内容只在内存里流转，压缩包路径穿越不会落到文件系统。

> 篇幅说明：ZIP/DOCX/XLSX 解析、压缩包内格式校验与两种旧版格式的边界都要逐条写清（含「不做」的部分），故略超常规长度预算。

## 关键符号

| 符号 | 作用 / 契约 | 位置 |
| --- | --- | --- |
| `LORE_IMPORT_FILE_LIMITS` | 全部预算的唯一真值：8 个文件 / 单文件 12 MB / 合计 24 MB / 文本 120 000 字 / 压缩包 200 条目、单条 8 MB、总计 24 MB、嵌套深度 2 | `L16` |
| `LORE_IMPORT_FILE_EXTENSIONS` | 对话框可选的扩展名（含明确会被拒绝的 `.rar`，让提示与声明一致） | `L28` |
| `decodeTextBytes(bytes)` | UTF-8（含 BOM）→ UTF-16LE/BE → GBK 依次回落；处理 NUL 与换行统一 | `L82` |
| `readZipDirectory(bytes)` | 只读中央目录；拒绝 ZIP64、分卷、条目超 200、目录越界；返回 `{name, method, compressedSize, uncompressedSize, localOffset, flags, encrypted}` | `L105` |
| `decodeXmlEntities(value)` | 解 `&amp;` 等命名实体与 `&#x…;` / `&#…;` 数字实体（码点夹取到 0x10FFFF） | `L176` |
| `wordXmlToText(xml)` | WordprocessingML → 文本：段落换行、表格单元格制表符、丢弃 `instrText`（域代码）与 `delText`（修订删除） | `L185` |
| `docxToText(bytes)` | 读 `word/document.xml` 与脚注/尾注；缺正文部件即报错 | `L210` |
| `sheetXmlToText(xml, shared)` | 工作表 XML → 行 × 列的制表符文本；支持共享字符串、内联字符串、公式字符串、布尔与数值 | `L239` |
| `xlsxToText(bytes)` | 用 `workbook.xml` + `workbook.xml.rels` 还原表名与顺序，按表输出 `【工作表：名】`；缺 workbook 时按文件名兜底 | `L292` |
| `legacyBinaryText(bytes)` | 旧版 `.doc` / `.xls` 的**尽力抽取**：先扫 UTF-16LE 文本段（两种字节对齐按「高频汉字 + 标点」打分），明显更好时才采用单字节 GBK 扫描 | `L384` |
| `rtfToText(source)` | RTF 纯文本抽取：`\uN` 与 `\'hh`（按 GBK 解码）、去控制字与分组 | `L393` |
| `detectFormat(name, bytes)` | 以签名为准、扩展名为辅：`.doc` 里其实是 docx 时按 docx 处理；区分 docx/xlsx/zip/rar/pdf/rtf/legacy/text/unknown | `L416` |
| `extractDocument(name, bytes, {warnings, depth})` | 单文件 → `{format, text}`；不支持或只能尽力而为时写告警而不是抛错（扩展名与内容不符的 Office 文件除外） | `L474` |
| `extractImportDocuments(value)` | 上传唯一入口：解码 base64/data URL → 逐文件抽取 → 拼接（`【文件名】` 分隔）→ 截断与告警；返回 `{text, characters, files, warnings}` | `L521` |

## 重点逻辑

### `readZipDirectory` / `readZipEntry`
- EOCD 从文件尾部往前找；`total === 0xFFFF`、目录偏移/大小 `0xFFFFFFFF` 或条目使用 ZIP64 一律拒绝，不做静默降级。
- 条目解压用 `zlib.inflateRawSync(payload, {maxOutputLength})`，**实际解压量**受 `archiveEntryBytes` 限制，不信任中央目录声明的长度；声明值另做一次上限检查。
- 不做 CRC 校验：这里只关心内容可读，不承担完整性校验（损坏的真实来源由解压失败暴露）。
- `encrypted` 只记录 flag，不解密；调用方跳过并告警。

### `extractArchive(name, bytes, depth, warnings)`
- 逐条目：加密 → 跳过；路径不安全（绝对路径、`..`、空段、盘符）→ 跳过；扩展名不在 `ARCHIVE_ENTRY_EXTENSIONS`（md/markdown/txt/docx/doc/xlsx/xls/rtf/zip）→ 跳过；其余解压后再递归或抽取。
- 嵌套 `zip` 允许一层（顶层 + 1 层），再深只告警；累计解压量超过总量上限立即停止并告警。
- 每个跳过/失败都产出带 `code` 的告警，作者能在对话框里看到「压缩包里哪些东西没被导入、为什么」。

### `legacyBinaryText`（旧版 `.doc` / `.xls`）
- OLE2 复合文件的扇区从 512 字节边界开始，因此偶数对齐是**先验**；两种对齐都扫描后按「高频汉字 + 标点 + ASCII」加权打分，奇数对齐需要超过偶数得分的 1.1 倍才采用。
- 这是启发式而不是格式解析：域代码、页眉页脚、修订记录可能混入，**顺序也可能与文档不一致**。因此 `extractDocument` 对这类文件固定追加 `LEGACY_BINARY_BEST_EFFORT` 告警，提示作者核对。
- 单字节 GBK 扫描只在明显比 UTF-16 结果更像文本时使用，避免把 UTF-16 的每个字节都当字符。

### `extractImportDocuments(value)`
- 入参是请求体的 `files` 数组，元素为 `{name, dataUrl | dataBase64}`；base64 与 data URL 都接受，非法 base64、空内容、单文件/合计超限都是 `400`（可预期的用户输入问题）。
- 文件级失败（坏压缩包、扩展名与内容不符的 Office 文件、内部条目全被跳过）只降级为该文件的告警，不影响同一批里的其它文件。
- 结果文本以 `【文件名】` 分隔并整体截断到 120 000 字；一条文本都没抽到时额外给 `NO_TEXT`，避免前端显示空文本框却不知道为什么。

## 重要约束
- 只支持能**零依赖**解析的格式：RAR 与 PDF 识别后明确拒绝（`RAR_UNSUPPORTED` / `PDF_UNSUPPORTED`），不产出伪文本，也不尝试调用外部命令或第三方库。
- 压缩包内的路径只用于显示与安全校验；解压内容从不写盘，因此不存在 ZIP-slip 落盘风险，但仍按白名单过滤条目类型。
- 所有上限都来自 `LORE_IMPORT_FILE_LIMITS`；调整上限必须同时更新 `server.mjs` 的请求体上限（48 MB）与 `docs/static/dist/README.md` 的体积说明。
- `detectFormat` 里 OOXML 判定依赖 ZIP 目录读取；签名是 PK 但目录损坏时按 `zip` 继续，真正的失败留给抽取阶段逐文件告警。
