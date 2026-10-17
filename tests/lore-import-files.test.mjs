import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeTextBytes,
  detectFormat,
  docxToText,
  extractDocument,
  extractImportDocuments,
  legacyBinaryText,
  LORE_IMPORT_FILE_LIMITS,
  readZipDirectory,
  rtfToText,
  xlsxToText
} from '../lore-import-files.mjs';
import { docxBytes, ole2Bytes, pdfBytes, rarBytes, rtfBytes, xlsxBytes, zipBytes } from './helpers/document-fixtures.mjs';

// 文件输入层（ADR-0033 §9）：真实字节夹具下的格式识别、OOXML 抽取、压缩包内格式校验与预算。
// 这里不 mock 任何解析步骤，ZIP/DOCX/XLSX 都是按规范写出来的真实字节。

const encode = buffer => ({ name: '未命名', dataBase64: buffer.toString('base64') });
const upload = (name, buffer) => ({ name, dataBase64: buffer.toString('base64') });

test('文本文件自动识别 UTF-8 / BOM / UTF-16LE / GBK', () => {
  assert.equal(decodeTextBytes(Buffer.from('余烬界\n甲', 'utf8')), '余烬界\n甲');
  assert.equal(decodeTextBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('带 BOM 的文本', 'utf8')])), '带 BOM 的文本');
  assert.equal(decodeTextBytes(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('UTF16 文本', 'utf16le')])), 'UTF16 文本');
  // 「中文测试文本」的 GBK 字节；Windows 记事本另存的 .txt 常见这种编码。
  const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4, 0xce, 0xc4, 0xb1, 0xbe]);
  assert.equal(decodeTextBytes(gbk), '中文测试文本');
  assert.equal(decodeTextBytes(Buffer.alloc(0)), '');
});

test('格式识别以内容为准：扩展名与内容不符时按内容处理', () => {
  const docx = docxBytes(['正文']);
  assert.equal(detectFormat('设定.doc', docx), 'docx', '.doc 里其实是 docx 时必须按 docx 处理');
  assert.equal(detectFormat('设定.docx', docx), 'docx');
  assert.equal(detectFormat('资料.zip', zipBytes([{ name: 'a.md', data: '甲' }])), 'zip');
  assert.equal(detectFormat('资料.rar', rarBytes()), 'rar');
  assert.equal(detectFormat('资料.pdf', pdfBytes()), 'pdf');
  assert.equal(detectFormat('设定.doc', ole2Bytes('旧版正文')), 'doc');
  assert.equal(detectFormat('说明.rtf', rtfBytes()), 'rtf');
  assert.equal(detectFormat('设定.md', Buffer.from('# 设定', 'utf8')), 'text');
  assert.equal(detectFormat('笔记', Buffer.from('没有扩展名但可读', 'utf8')), 'text');
  assert.equal(detectFormat('真二进制', Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03, 0x00])), 'unknown');
});

test('DOCX：段落、表格制表符、脚注与 XML 实体', () => {
  const bytes = docxBytes(['第一段', '第二段 & <标签>']);
  const value = docxToText(bytes);
  assert.ok(value.includes('第一段'));
  assert.ok(value.includes('第二段 & <标签>'));
  assert.ok(value.includes('议员甲\t守序'), '表格单元格之间用制表符');
  assert.ok(value.includes('脚注文本'), '脚注也要抽取');
});

test('XLSX：共享字符串、内联字符串、数值、布尔与工作表名', () => {
  const bytes = xlsxBytes({
    shared: ['议会', '议员甲'],
    sheets: [
      { name: '人物', rows: [['议会', '议员甲'], ['议员乙', 7], [true, { inline: '内联文本' }]] },
      { name: '年表', rows: [['第三纪元 412 年', 412]] }
    ]
  });
  const value = xlsxToText(bytes);
  assert.ok(value.includes('【工作表：人物】'));
  assert.ok(value.includes('【工作表：年表】'));
  assert.ok(value.includes('议会\t议员甲'));
  assert.ok(value.includes('议员乙\t7'));
  assert.ok(value.includes('TRUE\t内联文本'));
  assert.ok(value.includes('第三纪元 412 年\t412'));
});

test('ZIP：只抽取可导入格式，其它条目跳过并给出文件级摘要', () => {
  const archive = zipBytes([
    { name: '设定主线.md', data: '# 余烬界\n炉心余热维持城邦。' },
    { name: '附录/人物.docx', data: docxBytes(['首席议员主持议会。']) },
    { name: '工具/安装.exe', data: 'MZ' },
    { name: '图片.png', data: 'not-an-image' }
  ]);
  const result = extractImportDocuments([upload('设定合集.zip', archive)]);
  assert.ok(result.text.includes('【设定主线.md】'));
  assert.ok(result.text.includes('炉心余热维持城邦。'));
  assert.ok(result.text.includes('【附录/人物.docx】'));
  assert.ok(result.text.includes('首席议员主持议会。'));
  assert.ok(!result.text.includes('.exe'));
  assert.equal(result.warnings.filter(item => item.code === 'ARCHIVE_ENTRY_SKIPPED').length, 2);
  assert.equal(result.files[0].format, 'zip');
  assert.ok(result.files[0].characters > 20);
});

test('ZIP：加密条目、路径穿越与解压后超限都被拒绝但保留其它条目', () => {
  const archive = zipBytes([
    { name: '正常.md', data: '可导入的正文。' },
    { name: '机密.md', data: '加密内容', encrypted: true },
    { name: '../逃逸.md', data: '穿越内容' },
    { name: '膨胀.md', data: '炸弹', declaredUncompressed: 100 * 1024 * 1024 }
  ]);
  const result = extractImportDocuments([upload('混合.zip', archive)]);
  assert.ok(result.text.includes('可导入的正文。'));
  assert.ok(!result.text.includes('加密内容'));
  assert.ok(!result.text.includes('穿越内容'));
  assert.equal(result.warnings.some(item => item.code === 'ARCHIVE_ENCRYPTED'), true);
  assert.equal(result.warnings.some(item => item.code === 'ARCHIVE_ENTRY_PATH'), true);
  assert.equal(result.warnings.some(item => item.code === 'ARCHIVE_ENTRY_UNREADABLE' && item.message.includes('上限')), true);
});

test('ZIP：允许一层嵌套，超过深度上限只告警', () => {
  const markdown = { name: '正文.md', data: '嵌套包里的正文。' };
  const inner = zipBytes([markdown]);
  const oneLevel = extractImportDocuments([upload('一层.zip', zipBytes([{ name: '内层.zip', data: inner }]))]);
  assert.ok(oneLevel.text.includes('嵌套包里的正文。'), '一层嵌套应被读取');

  const twoLevels = zipBytes([{ name: 'b.zip', data: inner }]);
  const tooDeep = extractImportDocuments([upload('两层.zip', zipBytes([{ name: 'a.zip', data: twoLevels }]))]);
  assert.equal(tooDeep.text.includes('嵌套包里的正文。'), false);
  assert.equal(tooDeep.warnings.some(item => item.code === 'ARCHIVE_DEPTH_LIMIT'), true);
});

test('旧版 .doc 做尽力抽取并显式告警；RTF 只抽取纯文本', () => {
  const legacy = extractDocument('旧设定.doc', ole2Bytes('炉心余热维持着城邦的运转，议会由七名议员组成。'));
  assert.ok(legacy.text.includes('议会由七名议员组成'));
  const warnings = [];
  extractDocument('旧设定.doc', ole2Bytes('炉心余热维持着城邦的运转，议会由七名议员组成。'), { warnings });
  assert.equal(warnings.some(item => item.code === 'LEGACY_BINARY_BEST_EFFORT'), true);

  const rtf = rtfToText(rtfBytes().toString('latin1'));
  assert.ok(rtf.includes('你好'));
  assert.ok(rtf.includes('世界'));

  const scan = legacyBinaryText(ole2Bytes('炉心余热维持着城邦的运转。'.repeat(20)));
  assert.equal(scan.method, 'utf16');
  assert.ok(scan.text.includes('炉心余热维持着城邦的运转。'));

  // 英文旧版文档常见单字节（cp1252）正文：UTF-16 扫描会得到等长的「假汉字」，只能靠打分回落到单字节。
  const header = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  const singleByte = Buffer.concat([header, Buffer.from('The council of ash allocates the heat of the furnace. '.repeat(10), 'latin1')]);
  const fallback = legacyBinaryText(singleByte);
  assert.equal(fallback.method, 'single-byte');
  assert.ok(fallback.text.includes('council of ash'));
});

test('RAR 与 PDF 明确拒绝并给出可操作建议，不产出伪文本', () => {
  const rar = extractImportDocuments([upload('设定.rar', rarBytes())]);
  assert.equal(rar.text, '');
  assert.equal(rar.warnings.some(item => item.code === 'RAR_UNSUPPORTED'), true);
  assert.equal(rar.warnings.some(item => item.code === 'NO_TEXT'), true);

  const pdf = extractImportDocuments([upload('设定.pdf', pdfBytes())]);
  assert.equal(pdf.text, '');
  assert.equal(pdf.warnings.some(item => item.code === 'PDF_UNSUPPORTED'), true);
});

test('扩展名是 Office 但内容不是：逐文件报错，不污染其它文件', () => {
  const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x00, 0xff, 0xfe]);
  const result = extractImportDocuments([
    upload('坏文件.docx', garbage),
    upload('好文件.md', Buffer.from('可用的正文。', 'utf8'))
  ]);
  assert.ok(result.text.includes('可用的正文。'));
  assert.equal(result.warnings.some(item => item.code === 'FILE_UNREADABLE'), true);
  assert.equal(result.files[0].characters, 0);
});

test('抽取文本超过上限时截断并告警', () => {
  const long = '甲'.repeat(130000);
  const result = extractImportDocuments([upload('长文.md', Buffer.from(long, 'utf8'))]);
  assert.equal(result.text.length, LORE_IMPORT_FILE_LIMITS.characters);
  assert.equal(result.warnings.some(item => item.code === 'TEXT_TRUNCATED'), true);
});

test('上传载荷的边界：空列表、数量上限、单文件体积上限', () => {
  assert.throws(() => extractImportDocuments([]), /请选择要读取的文件/);
  assert.throws(() => extractImportDocuments(undefined), /请选择要读取的文件/);
  const many = Array.from({ length: LORE_IMPORT_FILE_LIMITS.files + 1 }, (_, index) => ({ name: `${index}.md`, dataBase64: Buffer.from('甲').toString('base64') }));
  assert.throws(() => extractImportDocuments(many), /一次最多读取/);
  const oversized = { name: '超大.md', dataBase64: Buffer.alloc(LORE_IMPORT_FILE_LIMITS.fileBytes + 1, 0x41).toString('base64') };
  assert.throws(() => extractImportDocuments([oversized]), /单个文件不得超过/);
  assert.throws(() => extractImportDocuments([{ name: '空.md', dataBase64: '' }]), /文件内容为空/);
  assert.throws(() => extractImportDocuments([{ name: '坏.md', dataBase64: '不是 base64!!' }]), /不是有效的 base64/);
  // data URL 与裸 base64 都接受。
  const dataUrl = { name: '说明.md', dataUrl: `data:text/markdown;base64,${Buffer.from('正文', 'utf8').toString('base64')}` };
  assert.equal(extractImportDocuments([dataUrl]).text, '【说明.md】\n正文');
});

test('ZIP 目录解析对损坏或非 ZIP 数据明确失败', () => {
  assert.throws(() => readZipDirectory(Buffer.from('not a zip at all')), /不是有效的 ZIP/);
  assert.throws(() => readZipDirectory(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(30, 0)])), /ZIP 目录/);
  const result = extractImportDocuments([encode(Buffer.from('普通文本'))]);
  assert.equal(result.text, '【未命名】\n普通文本', '无扩展名但可读的文本按文本处理');
});
