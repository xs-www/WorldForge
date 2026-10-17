import { deflateRawSync } from 'node:zlib';

// 测试用的文档夹具：在内存里造出真实结构的 ZIP / DOCX / XLSX / OLE2 / RTF 字节，
// 让 `lore-import-files.mjs` 的解析路径跑真实数据，而不是被 mock 掉。
// CRC 字段固定写 0：读取端不校验校验和，夹具只负责结构与压缩算法正确。

function escapeXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 极简 ZIP 写入器。
 * @param {Array<{name: string, data: string|Buffer, store?: boolean, encrypted?: boolean, declaredUncompressed?: number}>} files
 */
export function zipBytes(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8');
    const method = file.store ? 0 : 8;
    const payload = method === 8 ? deflateRawSync(data) : data;
    const uncompressed = Number.isFinite(file.declaredUncompressed) ? file.declaredUncompressed : data.length;
    const flags = 0x800 | (file.encrypted ? 0x1 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(uncompressed, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, payload);
    centrals.push(central, name);
    offset += local.length + name.length + payload.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

/** 最小 DOCX：段落 + 一个两列表格 + 一个制表符，覆盖正文抽取的主要分支。 */
export function docxBytes(paragraphs = []) {
  const body = paragraphs.map(paragraph => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`).join('');
  const table = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>议员甲</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>守序</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const document = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${table}</w:body></w:document>`;
  const footnotes = '<w:footnotes><w:footnote><w:p><w:r><w:t>脚注文本</w:t></w:r></w:p></w:footnote></w:footnotes>';
  return zipBytes([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'word/document.xml', data: document },
    { name: 'word/footnotes.xml', data: footnotes }
  ]);
}

/**
 * 最小 XLSX：两张工作表 + 共享字符串 + 内联字符串 + 数值 + 布尔。
 * @param {{shared?: string[], sheets?: Array<{name: string, rows: Array<Array<string|number|{inline: string}|boolean>>}>}} input
 */
export function xlsxBytes({ shared = [], sheets = [] } = {}) {
  const sharedXml = `<sst>${shared.map(value => `<si><t>${escapeXml(value)}</t></si>`).join('')}</sst>`;
  const workbook = `<workbook><sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`;
  const rels = `<Relationships>${sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`;
  const files = [
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: rels },
    { name: 'xl/sharedStrings.xml', data: sharedXml }
  ];
  sheets.forEach((sheet, index) => {
    const rows = sheet.rows.map((cells, rowIndex) => {
      const xml = cells.map((cell, cellIndex) => {
        const ref = `${String.fromCharCode(65 + cellIndex)}${rowIndex + 1}`;
        if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
        if (typeof cell === 'boolean') return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`;
        if (cell && typeof cell === 'object' && 'inline' in cell) return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell.inline)}</t></is></c>`;
        const sharedIndex = shared.indexOf(String(cell));
        if (sharedIndex >= 0) return `<c r="${ref}" t="s"><v>${sharedIndex}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
      }).join('');
      return `<row r="${rowIndex + 1}">${xml}</row>`;
    }).join('');
    files.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: `<worksheet><sheetData>${rows}</sheetData></worksheet>` });
  });
  return zipBytes(files);
}

/** 伪造 OLE2 复合文件：合法签名 + UTF-16LE 正文 + 二进制噪声，用于旧版 .doc 的尽力抽取。 */
export function ole2Bytes(textValue) {
  const header = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  const body = Buffer.from(String(textValue), 'utf16le');
  const noise = Buffer.alloc(256, 0xff);
  return Buffer.concat([header, noise, body, noise]);
}

export function rarBytes() {
  return Buffer.concat([Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]), Buffer.from('payload', 'latin1')]);
}

export function pdfBytes() {
  return Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'latin1');
}

export function rtfBytes() {
  return Buffer.from('{\\rtf1\\ansi\\ansicpg936 \\u20320?\\u22909?\\par \\u19990?\\u30028?}', 'latin1');
}
