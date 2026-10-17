import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExportBundle, EXPORT_FORMAT, EXPORT_FORMAT_VERSION, extensionForMimeType, MAX_IMAGE_BYTES, parseImportBundle, planArtAssetImport, planImport } from '../data-transfer.mjs';

const content = () => ({
  schemaVersion: 3,
  revision: 7,
  updatedAt: '2026-10-20T00:00:00.000Z',
  lastSavedBy: 'alice',
  loreEntries: [
    { id: 'W01', type: 'world', name: '甲世界', worldId: 'W01', status: 'proposed', truthScope: 'objective' },
    { id: 'FAC-W01-001', type: 'faction', name: '旧势力', worldId: 'W01' }
  ],
  cardDrafts: [{ id: 'CARD-W01-DRAFT-1', name: '旧卡', type: 'minion', worldId: 'W01' }],
  keywords: [{ id: 'KEY-001', name: '疾启', definition: '进入战场时立即行动。' }],
  loreGroups: [{ id: 'faction', label: '势力', form: 'generic', attributes: ['类型', '首领', '据点'] }],
  notes: { 'FAC-W01-001': '待裁定' }
});

const asset = (id) => ({ id, targetType: 'lore', targetId: 'W01', purpose: 'portrait', prompt: '提示词', model: 'seedream', size: '2K', mimeType: 'image/png', fileName: `${id}.png`, status: 'proposed', createdAt: '2026-10-20T00:00:00.000Z' });

test('导出的整包带上格式标识、资料组与美术元数据', () => {
  const bundle = buildExportBundle({ content: content(), artAssets: [asset('ART-0001')], productVersion: '0.3.2' });
  assert.equal(bundle.format, EXPORT_FORMAT);
  assert.equal(bundle.formatVersion, EXPORT_FORMAT_VERSION);
  assert.equal(bundle.productVersion, '0.3.2');
  assert.equal(bundle.revision, 7);
  assert.equal(bundle.lastSavedBy, 'alice');
  assert.deepEqual(Object.keys(bundle.content).sort(), ['cardDrafts', 'keywords', 'loreEntries', 'loreGroups', 'notes']);
  assert.equal(bundle.content.loreGroups[0].label, '势力');
  assert.equal(bundle.artAssets.length, 1);
  assert.deepEqual(bundle.images, []);
});

test('导出包在解析后仍是同一份内容（往返无损）', () => {
  const original = content();
  const bundle = buildExportBundle({ content: original, artAssets: [asset('ART-0001')] });
  const parsed = parseImportBundle(JSON.parse(JSON.stringify(bundle)));
  assert.deepEqual(parsed.content.loreEntries, original.loreEntries);
  assert.deepEqual(parsed.content.loreGroups, original.loreGroups);
  assert.deepEqual(parsed.content.notes, original.notes);
  assert.equal(parsed.artAssets.length, 1);
  assert.equal(parsed.meta.revision, 7);
});

test('导入解析拒绝错误格式、过新版本与危险图片', () => {
  assert.throws(() => parseImportBundle({ format: 'other-app', content: {} }), /不是 WorldForge 导出文件/);
  assert.throws(() => parseImportBundle({ format: EXPORT_FORMAT, formatVersion: 99, content: {} }), /高于当前服务支持的/);
  assert.throws(() => parseImportBundle({ content: { loreEntries: 'x' } }), /loreEntries 必须是数组/);
  assert.throws(() => parseImportBundle({ content: { notes: [] } }), /notes 必须是对象/);
  assert.throws(() => parseImportBundle({ content: {}, images: [{ id: 'ART-1', mimeType: 'image/gif', dataBase64: 'AAAA' }] }), /不支持的图片类型/);
  assert.throws(() => parseImportBundle({ content: {}, images: [{ id: 'NOPE', mimeType: 'image/png', dataBase64: 'AAAA' }] }), /图片 ID 无效/);
  // 单张上限：写入比上限略大的 base64 必须被拒绝，而不是等落盘时才失败。
  const huge = Buffer.alloc(MAX_IMAGE_BYTES + 16, 1).toString('base64');
  assert.throws(() => parseImportBundle({ content: {}, images: [{ id: 'ART-2', mimeType: 'image/png', dataBase64: huge }] }), /超过单张上限/);
});

test('合并模式按 ID 覆盖、新增并保留本机独有条目', () => {
  const current = content();
  const incoming = {
    loreEntries: [
      { id: 'FAC-W01-001', type: 'faction', name: '新势力' },
      { id: 'CHR-W01-001', type: 'character', name: '新角色' }
    ],
    cardDrafts: [],
    keywords: [],
    loreGroups: [],
    notes: { 'FAC-W01-001': '已裁定' }
  };
  const plan = planImport(current, incoming, 'merge');
  assert.equal(plan.summary.mode, 'merge');
  assert.deepEqual(plan.summary.loreEntries, { added: 1, updated: 1, total: 3 });
  assert.equal(plan.content.loreEntries.find(item => item.id === 'FAC-W01-001').name, '新势力');
  assert.equal(plan.content.loreEntries.find(item => item.id === 'W01').name, '甲世界');
  // 合并不会丢掉本机已有的卡牌、关键词与资料组。
  assert.equal(plan.content.cardDrafts.length, 1);
  assert.equal(plan.content.keywords.length, 1);
  assert.equal(plan.content.loreGroups.length, 1);
  assert.equal(plan.content.notes['FAC-W01-001'], '已裁定');
  assert.deepEqual(plan.summary.notes, { added: 0, updated: 1, total: 1 });
});

test('替换模式整库覆盖，但美术资产不在其中', () => {
  const plan = planImport(content(), { loreEntries: [{ id: 'W09', type: 'world', name: '新宇宙' }], cardDrafts: [], keywords: [], loreGroups: [], notes: {} }, 'replace');
  assert.equal(plan.summary.mode, 'replace');
  assert.deepEqual(plan.content.loreEntries.map(item => item.id), ['W09']);
  assert.deepEqual(plan.content.cardDrafts, []);
  assert.deepEqual(plan.content.loreGroups, []);
  assert.deepEqual(plan.content.notes, {});
});

test('美术资产只补不覆盖，导入别人的库不会解绑本机画作', () => {
  const current = [asset('ART-0001'), asset('ART-0002')];
  const incoming = [asset('ART-0001'), asset('ART-0003')];
  const plan = planArtAssetImport(current, incoming);
  assert.deepEqual(plan.added.map(item => item.id), ['ART-0003']);
  assert.equal(plan.skipped, 1);
  assert.deepEqual(plan.summary, { added: 1, skipped: 1, total: 3 });
});

test('图片扩展名与支持的 MIME 一致', () => {
  assert.equal(extensionForMimeType('image/png'), '.png');
  assert.equal(extensionForMimeType('image/jpeg'), '.jpg');
  assert.equal(extensionForMimeType('image/webp'), '.webp');
  assert.equal(extensionForMimeType('image/gif'), '');
});
