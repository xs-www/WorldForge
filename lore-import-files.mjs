import { inflateRawSync } from 'node:zlib';

// ── 设定导入的文件输入层（ADR-0033 §9）──────────────────────────────────────
// 把作者上传的文档读成纯文本，再交给 `lore-import.mjs` 的解析管线。本模块同样是
// 纯变换层：不收 HTTP、不写磁盘、不调用模型。上传内容一律在内存里处理，解压出的
// 条目从不落盘，因此 ZIP 路径穿越只影响显示名，不影响文件系统。
//
// 支持范围（能力与代价写清楚，避免「静默产出垃圾」）：
// - `.md` / `.markdown` / `.txt` 以及其它看起来是文本的文件：自动识别 UTF-8 / UTF-16 / GBK。
// - `.docx` / `.xlsx`：OOXML 就是 ZIP + XML，直接读 `word/document.xml` 与 `xl/*`。
// - `.zip`：逐个校验内部条目格式，只抽取可导入的文档，其余条目跳过并告警；嵌套深度有限。
// - `.doc` / `.xls`：旧版二进制（OLE2）格式做**尽力抽取**（扫描 UTF-16 / GBK 文本段），
//   结果可能含格式噪声或顺序偏差，必须由作者核对；这不是「解析 Word」。
// - `.rar` / `.pdf`：识别格式后明确拒绝并给出可操作建议（RAR 是专有压缩格式，服务端不解压）。

export const LORE_IMPORT_FILE_LIMITS = Object.freeze({
  files: 8,
  fileBytes: 12 * 1024 * 1024,
  totalBytes: 24 * 1024 * 1024,
  characters: 120000,
  archiveEntries: 200,
  archiveEntryBytes: 8 * 1024 * 1024,
  archiveTotalBytes: 24 * 1024 * 1024,
  archiveDepth: 2
});

/** 对话框与提示里展示的可选扩展名；`.doc` / `.rar` 会被接受但按上面的规则处理。 */
export const LORE_IMPORT_FILE_EXTENSIONS = Object.freeze(['md', 'markdown', 'txt', 'docx', 'doc', 'xlsx', 'xls', 'zip', 'rar', 'rtf']);

/** 压缩包内部允许被抽取的条目扩展名；其它类型一律跳过并告警。`zip` 允许一层嵌套。 */
const ARCHIVE_ENTRY_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'docx', 'doc', 'xlsx', 'xls', 'rtf', 'zip']);

const TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'text', 'csv', 'tsv', 'log', 'json', 'yaml', 'yml']);
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const RAR_SIGNATURES = [[0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00], [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]];

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function warning(code, message) { return { code, message }; }
function megabytes(bytes) { return `${Math.round(bytes / (1024 * 1024) * 10) / 10} MB`; }
function text(value, limit) { return String(value ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, limit); }

function startsWithBytes(bytes, signature) {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function extensionOf(name) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(String(name ?? ''));
  return match ? match[1].toLowerCase() : '';
}

function baseName(name) {
  const normalized = String(name ?? '').replace(/\\/g, '/').split('/').pop() || '未命名文件';
  return normalized.replace(/[\u0000-\u001f<>:"|?*]/g, '').slice(0, 120) || '未命名文件';
}

/** 压缩包内部条目名必须是相对、无穿越的普通路径，否则只丢弃该条目。 */
function safeEntryName(name) {
  const normalized = String(name ?? '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return '';
  if (normalized.split('/').some(segment => segment === '..' || segment === '')) return '';
  const cleaned = normalized.split('/').filter(segment => segment !== '.').join('/');
  return cleaned.replace(/[\u0000-\u001f]/g, '').slice(0, 200);
}

function looksBinary(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (!sample.length) return false;
  let control = 0;
  for (const value of sample) if (value === 0) control += 1;
  return control / sample.length > 0.01;
}

// ── 文本编码 ────────────────────────────────────────────────────────────────

/** UTF-8 → UTF-16 → GBK 依次尝试；GBK 让作者从 Windows 记事本另存的 .txt 也能读。 */
export function decodeTextBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) return '';
  if (startsWithBytes(bytes, [0xef, 0xbb, 0xbf])) return text(new TextDecoder('utf-8').decode(bytes.subarray(3)), LORE_IMPORT_FILE_LIMITS.characters);
  if (startsWithBytes(bytes, [0xff, 0xfe])) return text(new TextDecoder('utf-16le').decode(bytes.subarray(2)), LORE_IMPORT_FILE_LIMITS.characters);
  if (startsWithBytes(bytes, [0xfe, 0xff])) return text(new TextDecoder('utf-16be').decode(bytes.subarray(2)), LORE_IMPORT_FILE_LIMITS.characters);
  try { return text(new TextDecoder('utf-8', { fatal: true }).decode(bytes), LORE_IMPORT_FILE_LIMITS.characters); }
  catch {
    try { return text(new TextDecoder('gbk').decode(bytes), LORE_IMPORT_FILE_LIMITS.characters); }
    catch { return text(new TextDecoder('utf-8').decode(bytes), LORE_IMPORT_FILE_LIMITS.characters); }
  }
}

// ── ZIP（OOXML 与普通压缩包共用）────────────────────────────────────────────

function decodeZipName(bytes, flags) {
  try { return new TextDecoder((flags & 0x800) ? 'utf-8' : 'latin1').decode(bytes); }
  catch { return bytes.toString('latin1'); }
}

/**
 * 只读中央目录；不做 CRC 校验（这里只关心内容，不关心完整性）。
 * ZIP64 与分卷压缩直接拒绝：设定文档不会用到，支持它们只会扩大攻击面。
 */
export function readZipDirectory(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22) throw badRequest('不是有效的 ZIP 压缩包');
  let eocd = -1;
  const earliest = Math.max(0, bytes.length - 0xffff - 22);
  for (let index = bytes.length - 22; index >= earliest; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw badRequest('压缩包缺少 ZIP 目录（文件可能损坏）');
  const total = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (total === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) throw badRequest('暂不支持 ZIP64 压缩包；请另存为普通 ZIP');
  if (total > LORE_IMPORT_FILE_LIMITS.archiveEntries) throw badRequest(`压缩包内文件过多（${total} 个，上限 ${LORE_IMPORT_FILE_LIMITS.archiveEntries} 个）`);
  if (directoryOffset + directorySize > bytes.length) throw badRequest('压缩包目录越界（文件可能损坏）');
  const entries = [];
  let cursor = directoryOffset;
  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) break;
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameLength > bytes.length) break;
    const name = decodeZipName(bytes.subarray(cursor + 46, cursor + 46 + nameLength), flags);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!name || name.endsWith('/')) continue;
    entries.push({
      name,
      method,
      flags,
      compressedSize,
      uncompressedSize,
      localOffset,
      encrypted: Boolean(flags & 0x1),
      unsupportedSize: compressedSize === 0xffffffff || uncompressedSize === 0xffffffff
    });
  }
  return entries;
}

function readZipEntry(bytes, entry, maxBytes) {
  if (entry.unsupportedSize) throw new Error('条目大小使用了 ZIP64 扩展，暂不支持');
  const offset = entry.localOffset;
  if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error('ZIP 条目头无效');
  const nameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length || end < start) throw new Error('ZIP 条目数据越界');
  if (entry.uncompressedSize > maxBytes) throw new Error(`条目解压后为 ${megabytes(entry.uncompressedSize)}，超过 ${megabytes(maxBytes)} 上限`);
  const payload = bytes.subarray(start, end);
  if (entry.method === 0) return Buffer.from(payload);
  if (entry.method !== 8) throw new Error(`不支持的压缩算法（method=${entry.method}）`);
  try {
    return inflateRawSync(payload, { maxOutputLength: maxBytes });
  } catch (error) {
    if (String(error.code || '').startsWith('ERR_BUFFER')) throw new Error(`条目解压后超过 ${megabytes(maxBytes)} 上限`);
    throw new Error(`条目解压失败：${error.message}`);
  }
}

function zipTextFile(bytes, entry) { return decodeTextBytes(readZipEntry(bytes, entry, LORE_IMPORT_FILE_LIMITS.archiveEntryBytes)); }

// ── OOXML：DOCX / XLSX ─────────────────────────────────────────────────────

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlEntities(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(body.slice(2), 16) || 0));
    if (body.startsWith('#')) return String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(body.slice(1), 10) || 0));
    return XML_ENTITIES[body] ?? match;
  });
}

/** WordprocessingML → 文本：保留段落、制表与表格单元格，丢弃域代码与修订删除文本。 */
export function wordXmlToText(xml) {
  const converted = String(xml ?? '')
    .replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, '')
    .replace(/<w:delText\b[\s\S]*?<\/w:delText>/g, '')
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<w:cr\s*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlEntities(converted)
    .replace(/\n+\t/g, '\t')
    .replace(/[ \u00a0\t]+\n/g, '\n')
    .replace(/\t{2,}/g, '\t')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function zipEntriesByName(bytes) {
  const map = new Map();
  for (const entry of readZipDirectory(bytes)) map.set(entry.name.replace(/^\/+/, ''), entry);
  return map;
}

export function docxToText(bytes) {
  const entries = zipEntriesByName(bytes);
  const parts = [];
  for (const name of ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml']) {
    const entry = entries.get(name);
    if (!entry) continue;
    const body = wordXmlToText(zipTextFile(bytes, entry));
    if (body) parts.push(body);
  }
  if (!parts.length) throw new Error('DOCX 内找不到 word/document.xml');
  return parts.join('\n\n');
}

/** 读单元格文本：共享字符串、内联字符串、公式字符串、布尔与数值。 */
function sheetCellText(attributes, inner, shared) {
  const type = /(?:^|\s)t="([^"]*)"/.exec(attributes)?.[1] ?? '';
  const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
  if (type === 's') {
    const index = Number(value);
    return Number.isInteger(index) && index >= 0 && index < shared.length ? shared[index] : '';
  }
  if (type === 'inlineStr') {
    return decodeXmlEntities([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]).join(''));
  }
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE';
  if (type === 'e') return '';
  return decodeXmlEntities(value);
}

export function sheetXmlToText(xml, shared = []) {
  const lines = [];
  for (const row of String(xml ?? '').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const value = sheetCellText(cell[1], cell[2] ?? '', shared);
      if (value !== '') cells.push(value.replace(/\s+/g, ' ').trim());
    }
    if (cells.length) lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

function sharedStrings(xml) {
  const source = String(xml ?? '').replace(/<si\s*\/>/g, '<si></si>');
  const list = [];
  for (const item of source.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    list.push(decodeXmlEntities([...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]).join('')));
  }
  return list;
}

function attributeOf(attributes, name) {
  return new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}="([^"]*)"`).exec(attributes)?.[1] ?? '';
}

function workbookSheets(bytes, entries) {
  const workbook = entries.get('xl/workbook.xml');
  const relationships = entries.get('xl/_rels/workbook.xml.rels');
  const rels = new Map();
  if (relationships) {
    for (const match of zipTextFile(bytes, relationships).matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
      const target = attributeOf(match[1], 'Target');
      const id = attributeOf(match[1], 'Id');
      if (id && target) rels.set(id, target.replace(/^\/+/, '').startsWith('xl/') ? target.replace(/^\/+/, '') : `xl/${target.replace(/^\/+/, '')}`);
    }
  }
  const sheets = [];
  if (workbook) {
    for (const match of zipTextFile(bytes, workbook).matchAll(/<sheet\b([^>]*?)\/?>/g)) {
      const name = attributeOf(match[1], 'name');
      const rid = attributeOf(match[1], 'r:id');
      const target = rels.get(rid);
      if (target && entries.has(target)) sheets.push({ name: name || target, target });
    }
  }
  if (!sheets.length) {
    // 没有 workbook/rels 时按文件名兜底：仍然给出内容，只是表名退化为文件名。
    [...entries.keys()].filter(name => /^xl\/worksheets\/[^/]+\.xml$/.test(name)).sort().forEach(target => sheets.push({ name: target.split('/').pop().replace(/\.xml$/, ''), target }));
  }
  return sheets;
}

export function xlsxToText(bytes) {
  const entries = zipEntriesByName(bytes);
  if (!entries.has('xl/workbook.xml') && ![...entries.keys()].some(name => name.startsWith('xl/worksheets/'))) throw new Error('XLSX 内找不到工作表（xl/worksheets）');
  const sharedEntry = entries.get('xl/sharedStrings.xml');
  const shared = sharedEntry ? sharedStrings(zipTextFile(bytes, sharedEntry)) : [];
  const parts = [];
  for (const sheet of workbookSheets(bytes, entries)) {
    const body = sheetXmlToText(zipTextFile(bytes, entries.get(sheet.target)), shared);
    if (body) parts.push(`【工作表：${sheet.name}】\n${body}`);
  }
  return parts.join('\n\n');
}

// ── 旧版二进制（.doc / .xls）与 RTF ────────────────────────────────────────

function isPrintableUtf16(code) {
  if (code < 0x20) return code === 0x09 || code === 0x0a || code === 0x0d;
  if (code >= 0x7f && code <= 0x9f) return false;
  if (code === 0xfffd || code === 0xfffe || code === 0xffff) return false;
  return code <= 0xd7ff || (code >= 0xe000 && code <= 0xfffd);
}

function meaningfulRun(value) {
  const kept = String(value).trim();
  if (kept.length < 12) return '';
  const letters = (kept.match(/[\p{L}\p{N}]/gu) || []).length;
  return letters >= Math.max(6, kept.length * 0.4) ? kept : '';
}

/** 旧版 Word 正文常见的高频汉字：用来在两种字节对齐之间判断哪一版才是真正的文本。 */
const FREQUENT_HAN = new Set('的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感见明问力理尔点文几定本公特做外孩相西果走将月十实向声车全信重三机工物气每并别真打太新比才便夫再书部水像眼等体却加电主界门利海受听表德少克代员许先口由死安写性马光白或住难望教命花结乐色更拉东神记处让母父应直字场平报友关放至张认接告入笑内英军候民岁往何度山觉路带万男边风解叫任金快原吃妈变通师立象数四失满战远格士音轻目条呢病始达深完今提求清王化空业思切怎非找片罗钱吗语元喜曾离飞科言干流欢约各指合反题必该论交终林请医晚制球决传画保读运及则房早院量苦火布品近坐产答星精视五连司巴');

function textScore(value) {
  const source = String(value);
  let frequent = 0, punctuation = 0;
  for (const char of source) {
    if (FREQUENT_HAN.has(char)) frequent += 1;
    else if (/[\u3000-\u303f\uff00-\uff65\u0020-\u007e]/.test(char)) punctuation += 1;
  }
  return source.length + frequent * 6 + punctuation * 6;
}

function utf16Runs(bytes, alignment) {
  const runs = [];
  let current = '';
  for (let index = alignment; index + 1 < bytes.length; index += 2) {
    const code = bytes[index] | (bytes[index + 1] << 8);
    if (isPrintableUtf16(code)) current += String.fromCharCode(code);
    else {
      const run = meaningfulRun(current);
      if (run) runs.push(run);
      current = '';
    }
  }
  const run = meaningfulRun(current);
  if (run) runs.push(run);
  return runs;
}

/**
 * 在 OLE2 复合文件里扫 UTF-16LE 文本段：旧版 Word 的正文通常就是这样存放的。
 * 两种字节对齐都试：OLE2 的流从扇区边界开始（偶数偏移先验更高，给 1.1 倍加权），
 * 但错位对齐也能产出一串「看起来像汉字」的乱码，所以用高频字与标点打分而不是数长度。
 */
function scanUtf16Runs(bytes) {
  const even = utf16Runs(bytes, 0), odd = utf16Runs(bytes, 1);
  const evenScore = textScore(even.join('')), oddScore = textScore(odd.join(''));
  return (oddScore > evenScore * 1.1 ? odd : even).join('\n\n');
}

/** 单字节文本段（GBK / latin1）：只在 UTF-16 扫描几乎无收获时使用。 */
function scanSingleByteRuns(bytes) {
  const runs = [];
  let start = -1;
  const flush = end => {
    if (start < 0 || end - start < 40) { start = -1; return; }
    const chunk = bytes.subarray(start, end);
    let decoded = '';
    try { decoded = new TextDecoder('gbk').decode(chunk); } catch { decoded = chunk.toString('latin1'); }
    const run = meaningfulRun(decoded);
    if (run) runs.push(run);
    start = -1;
  };
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index];
    const printable = value >= 0x20 && value <= 0xfe && value !== 0x7f;
    if (printable) { if (start < 0) start = index; } else flush(index);
  }
  flush(bytes.length);
  return runs.join('\n\n');
}

export function legacyBinaryText(bytes) {
  const utf16 = scanUtf16Runs(bytes);
  // 单字节 GBK 扫描会把 UTF-16 正文的每个字节都当成字符，必须让「更像文本」的一侧明显胜出才采用。
  // 不按长度提前返回：纯英文的单字节正文在 UTF-16 扫描下会得到等长的「假汉字」，只能靠打分区分。
  const single = scanSingleByteRuns(bytes);
  if (single && textScore(single) > textScore(utf16) * 1.2) return { text: single, method: 'single-byte' };
  if (utf16) return { text: utf16, method: 'utf16' };
  return { text: single, method: single ? 'single-byte' : 'none' };
}

export function rtfToText(source) {
  let body = String(source ?? '');
  // 先解出 \uN 与 \'hh（连续的十六进制转义按 GBK 解码，中文 RTF 常见）。
  body = body.replace(/\\u(-?\d+)\s?\??/g, (match, value) => {
    const code = ((Number(value) % 65536) + 65536) % 65536;
    return String.fromCharCode(code);
  });
  body = body.replace(/(?:\\'[0-9a-fA-F]{2})+/g, block => {
    const hex = block.replace(/\\'/g, '');
    try { return new TextDecoder('gbk').decode(Buffer.from(hex, 'hex')); } catch { return ''; }
  });
  body = body.replace(/\{\\\*[\s\S]*?\}/g, ' ')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, ' ')
    .replace(/\\[^a-zA-Z]/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  return text(body, LORE_IMPORT_FILE_LIMITS.characters);
}

// ── 格式识别与逐文件抽取 ───────────────────────────────────────────────────

/** 以文件签名为主、扩展名为辅；扩展名与内容不符时以内容为准（`.doc` 其实是 docx 很常见）。 */
export function detectFormat(name, bytes) {
  const extension = extensionOf(name);
  if (startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    try {
      const names = new Set(readZipDirectory(bytes).map(entry => entry.name.replace(/^\/+/, '')));
      if (names.has('word/document.xml')) return 'docx';
      if (names.has('xl/workbook.xml') || [...names].some(entry => entry.startsWith('xl/worksheets/'))) return 'xlsx';
    } catch { /* 签名对但目录坏：按普通 zip 继续，抽取阶段再报错 */ }
    return 'zip';
  }
  if (startsWithBytes(bytes, OLE2_SIGNATURE)) return ['doc', 'xls', 'ppt'].includes(extension) ? extension : 'legacy';
  if (RAR_SIGNATURES.some(signature => startsWithBytes(bytes, signature))) return 'rar';
  if (bytes.subarray(0, 5).toString('latin1') === '{\\rtf') return 'rtf';
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';
  return looksBinary(bytes) ? 'unknown' : 'text';
}

function extractArchive(name, bytes, depth, warnings) {
  const entries = readZipDirectory(bytes);
  if (!entries.length) throw new Error('压缩包内没有文件');
  const parts = [];
  let extractedBytes = 0;
  for (const entry of entries) {
    if (entry.encrypted) { warnings.push(warning('ARCHIVE_ENCRYPTED', `${name} 内的 ${entry.name} 已加密，已跳过`)); continue; }
    const safe = safeEntryName(entry.name);
    if (!safe) { warnings.push(warning('ARCHIVE_ENTRY_PATH', `${name} 内有不安全的条目路径，已跳过：${entry.name}`)); continue; }
    const extension = extensionOf(safe);
    if (!ARCHIVE_ENTRY_EXTENSIONS.has(extension)) {
      warnings.push(warning('ARCHIVE_ENTRY_SKIPPED', `${name} 内的 ${safe}（${extension ? `.${extension}` : '无扩展名'}）不在可导入格式内，已跳过`));
      continue;
    }
    let payload;
    try { payload = readZipEntry(bytes, entry, LORE_IMPORT_FILE_LIMITS.archiveEntryBytes); }
    catch (error) { warnings.push(warning('ARCHIVE_ENTRY_UNREADABLE', `${name} 内的 ${safe} 无法读取：${error.message}`)); continue; }
    extractedBytes += payload.length;
    if (extractedBytes > LORE_IMPORT_FILE_LIMITS.archiveTotalBytes) {
      warnings.push(warning('ARCHIVE_TOTAL_LIMIT', `${name} 解压后超过 ${megabytes(LORE_IMPORT_FILE_LIMITS.archiveTotalBytes)}，后续条目已跳过`));
      break;
    }
    if (extension === 'zip') {
      if (depth + 1 >= LORE_IMPORT_FILE_LIMITS.archiveDepth) { warnings.push(warning('ARCHIVE_DEPTH_LIMIT', `${name} 内的 ${safe} 超过嵌套深度上限，已跳过`)); continue; }
      try {
        const nested = extractArchive(safe, payload, depth + 1, warnings);
        if (nested) parts.push(`【${safe}】\n${nested}`);
      } catch (error) { warnings.push(warning('ARCHIVE_ENTRY_UNREADABLE', `${name} 内的 ${safe} 无法读取：${error.message}`)); }
      continue;
    }
    try {
      const document = extractDocument(safe, payload, { depth: depth + 1, warnings });
      if (document.text) parts.push(`【${safe}】\n${document.text}`);
      else warnings.push(warning('ARCHIVE_ENTRY_EMPTY', `${name} 内的 ${safe} 没有抽取到文本`));
    } catch (error) { warnings.push(warning('ARCHIVE_ENTRY_UNREADABLE', `${name} 内的 ${safe} 无法读取：${error.message}`)); }
  }
  return parts.join('\n\n');
}

/** 单文件 → 文本；不抛错的地方以 warnings 回报，真正无法识别时返回空文本。 */
export function extractDocument(name, bytes, options = {}) {
  const warnings = options.warnings || [];
  const format = detectFormat(name, bytes);
  if (format === 'zip') return { format, text: extractArchive(name, bytes, options.depth || 0, warnings) };
  if (format === 'docx') return { format, text: docxToText(bytes) };
  if (format === 'xlsx') return { format, text: xlsxToText(bytes) };
  if (format === 'text') return { format, text: decodeTextBytes(bytes) };
  if (format === 'rtf') {
    warnings.push(warning('RTF_BEST_EFFORT', `${name} 是 RTF，只抽取纯文本（格式与表格会丢失）`));
    return { format, text: rtfToText(bytes.toString('latin1')) };
  }
  if (format === 'doc' || format === 'xls' || format === 'legacy') {
    const extracted = legacyBinaryText(bytes);
    warnings.push(warning('LEGACY_BINARY_BEST_EFFORT', `${name} 是旧版二进制 Office 文件，只做尽力抽取（可能含格式噪声或顺序偏差），请核对正文`));
    return { format: format === 'legacy' ? 'legacy' : format, text: extracted.text };
  }
  if (format === 'rar') {
    warnings.push(warning('RAR_UNSUPPORTED', `${name} 是 RAR 压缩包：RAR 为专有格式，服务端不解压，也无法校验其内部文件。请改用 ZIP，或解压后直接粘贴文本`));
    return { format, text: '' };
  }
  if (format === 'pdf') {
    warnings.push(warning('PDF_UNSUPPORTED', `${name} 是 PDF：请先另存为 .docx / .md，或直接粘贴文本`));
    return { format, text: '' };
  }
  if (/^(doc|docx|xlsx)$/.test(extensionOf(name))) throw new Error(`扩展名是 .${extensionOf(name)}，但文件内容不是有效的 Office 文档`);
  warnings.push(warning('UNSUPPORTED_FORMAT', `${name} 不是可识别的文本或文档格式，已跳过`));
  return { format: 'unknown', text: '' };
}

// ── 上传载荷解码与总入口 ────────────────────────────────────────────────────

function decodeFilePayload(item) {
  const source = String(item?.dataUrl ?? item?.dataBase64 ?? '');
  const base64 = source.startsWith('data:') ? source.slice(source.indexOf(',') + 1) : source;
  const compact = base64.replace(/\s+/g, '');
  if (!compact) throw badRequest('文件内容为空');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(compact)) throw badRequest('文件内容不是有效的 base64');
  const bytes = Buffer.from(compact, 'base64');
  if (!bytes.length) throw badRequest('文件内容为空');
  if (bytes.length > LORE_IMPORT_FILE_LIMITS.fileBytes) throw badRequest(`单个文件不得超过 ${megabytes(LORE_IMPORT_FILE_LIMITS.fileBytes)}`);
  return bytes;
}

/**
 * 上传文件的唯一入口：解码 → 逐文件抽取 → 拼接文本 → 截断与告警。
 * `value` 是请求体里的 `files` 数组，元素为 `{name, dataUrl|dataBase64}`。
 */
export function extractImportDocuments(value) {
  const list = Array.isArray(value) ? value : [];
  if (!list.length) throw badRequest('请选择要读取的文件');
  if (list.length > LORE_IMPORT_FILE_LIMITS.files) throw badRequest(`一次最多读取 ${LORE_IMPORT_FILE_LIMITS.files} 个文件`);
  const warnings = [], parts = [], files = [];
  let totalBytes = 0;
  for (const item of list) {
    const name = baseName(item?.name);
    const bytes = decodeFilePayload(item);
    totalBytes += bytes.length;
    if (totalBytes > LORE_IMPORT_FILE_LIMITS.totalBytes) throw badRequest(`全部文件合计不得超过 ${megabytes(LORE_IMPORT_FILE_LIMITS.totalBytes)}`);
    try {
      const document = extractDocument(name, bytes, { warnings, depth: 0 });
      const body = text(document.text, LORE_IMPORT_FILE_LIMITS.characters);
      if (body) parts.push(`【${name}】\n${body}`);
      files.push({ name, format: document.format, bytes: bytes.length, characters: body.length });
      if (!body) warnings.push(warning('FILE_NO_TEXT', `${name} 没有抽取到可用文本`));
    } catch (error) {
      warnings.push(warning('FILE_UNREADABLE', `${name} 无法读取：${error.message}`));
      files.push({ name, format: 'unknown', bytes: bytes.length, characters: 0 });
    }
  }
  let combined = parts.join('\n\n').replace(/\n{4,}/g, '\n\n\n').trim();
  const truncated = combined.length > LORE_IMPORT_FILE_LIMITS.characters;
  if (truncated) {
    combined = combined.slice(0, LORE_IMPORT_FILE_LIMITS.characters).trim();
    warnings.push(warning('TEXT_TRUNCATED', `抽取文本超过 ${LORE_IMPORT_FILE_LIMITS.characters} 字，只保留前面部分；可以分开多次导入`));
  }
  if (!combined) warnings.push(warning('NO_TEXT', '这些文件没有抽取到任何文本；请检查格式，或直接把文本粘贴进对话框'));
  return { text: combined, characters: combined.length, files, warnings };
}
