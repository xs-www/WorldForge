// 数据导入 / 导出：只做「快照 → 交换格式」与「交换格式 → 待写入快照」的纯变换，
// 不接触磁盘、数据库或 HTTP。文件读写与事务由 server.mjs 负责。
// 交换格式的目标是「整库可搬运」：资料、卡牌、关键词、备注、自定义资料组、
// 美术资产元数据，以及可选内嵌的图片本体（base64）。

export const EXPORT_FORMAT = 'worldforge-export';
export const EXPORT_FORMAT_VERSION = 1;

// 图片本体上限：单张 10 MB（与上传上限一致）、整包 200 MB。
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_IMPORT_ITEMS = 10000;

const plainObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value;
};
const stringField = (value, fallback = '') => (typeof value === 'string' ? value : fallback);
const ART_ID = /^ART-[A-F0-9-]+$/i;
const FILE_NAME = /^[A-Za-z0-9._-]+$/;
const MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

/** 组装导出包。`images` 由调用方读盘后传入（base64），不传则是纯元数据导出。 */
export function buildExportBundle({ content, artAssets = [], images = [], productVersion = '', exportedAt = new Date().toISOString() } = {}) {
  const snapshot = plainObject(content, '内容快照');
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt,
    productVersion,
    schemaVersion: Number(snapshot.schemaVersion) || 0,
    revision: Number(snapshot.revision) || 0,
    lastSavedBy: snapshot.lastSavedBy || null,
    content: {
      loreEntries: snapshot.loreEntries || [],
      cardDrafts: snapshot.cardDrafts || [],
      keywords: snapshot.keywords || [],
      loreGroups: snapshot.loreGroups || [],
      notes: snapshot.notes || {}
    },
    artAssets: (Array.isArray(artAssets) ? artAssets : []).map(normalizeAssetMetadata),
    images: (Array.isArray(images) ? images : []).map(normalizeImageEntry)
  };
}

function normalizeAssetMetadata(value) {
  const asset = plainObject(value, '美术资产');
  const id = stringField(asset.id).trim();
  if (!ART_ID.test(id)) throw new Error(`美术资产 ID 无效：${id || '(空)'}`);
  return JSON.parse(JSON.stringify({ ...asset, id }));
}

function normalizeImageEntry(value) {
  const image = plainObject(value, '图片');
  const id = stringField(image.id).trim();
  if (!ART_ID.test(id)) throw new Error(`图片 ID 无效：${id || '(空)'}`);
  const mimeType = stringField(image.mimeType).trim();
  if (!MIME[mimeType]) throw new Error(`不支持的图片类型：${mimeType || '(空)'}`);
  const dataBase64 = stringField(image.dataBase64).replace(/\s+/g, '');
  if (!dataBase64) throw new Error(`图片 ${id} 缺少数据`);
  const bytes = Buffer.byteLength(dataBase64, 'base64');
  if (bytes > MAX_IMAGE_BYTES) throw new Error(`图片 ${id} 超过单张上限 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`);
  const fileName = stringField(image.fileName).trim();
  if (fileName && !FILE_NAME.test(fileName)) throw new Error(`图片文件名无效：${fileName}`);
  return { id, fileName: fileName || `${id}${MIME[mimeType]}`, mimeType, bytes, dataBase64 };
}

/**
 * 解析并清洗导入包。任何结构问题都在写库之前抛错，因此 `dryRun` 与真实导入走同一条校验。
 * 返回 { meta, content, artAssets, images }，其中 content 仍未与现有数据合并。
 */
export function parseImportBundle(value) {
  const bundle = plainObject(value, '导入文件');
  if (bundle.format !== undefined && bundle.format !== EXPORT_FORMAT) throw new Error(`不是 WorldForge 导出文件（format=${stringField(bundle.format) || '缺失'}）`);
  const formatVersion = Number(bundle.formatVersion);
  if (bundle.formatVersion !== undefined && (!Number.isFinite(formatVersion) || formatVersion > EXPORT_FORMAT_VERSION)) throw new Error(`导出文件版本 ${bundle.formatVersion} 高于当前服务支持的 ${EXPORT_FORMAT_VERSION}`);
  const raw = bundle.content !== undefined ? bundle.content : bundle;
  const content = plainObject(raw, 'content');
  for (const key of ['loreEntries', 'cardDrafts', 'keywords', 'loreGroups']) {
    if (content[key] !== undefined && (!Array.isArray(content[key]) || content[key].length > MAX_IMPORT_ITEMS)) throw new Error(`${key} 必须是数组且不得超过 ${MAX_IMPORT_ITEMS} 项`);
  }
  if (content.notes !== undefined) plainObject(content.notes, 'notes');
  const artAssets = (Array.isArray(bundle.artAssets) ? bundle.artAssets : []).map(normalizeAssetMetadata);
  const images = (Array.isArray(bundle.images) ? bundle.images : []).map(normalizeImageEntry);
  const totalBytes = images.reduce((sum, image) => sum + image.bytes, 0);
  if (totalBytes > MAX_IMAGES_TOTAL_BYTES) throw new Error(`内嵌图片合计超过 ${Math.round(MAX_IMAGES_TOTAL_BYTES / 1024 / 1024)} MB`);
  return {
    meta: { formatVersion: Number.isFinite(formatVersion) ? formatVersion : EXPORT_FORMAT_VERSION, exportedAt: stringField(bundle.exportedAt), productVersion: stringField(bundle.productVersion), revision: Number(bundle.revision) || 0, lastSavedBy: bundle.lastSavedBy || null },
    content: {
      loreEntries: content.loreEntries || [],
      cardDrafts: content.cardDrafts || [],
      keywords: content.keywords || [],
      loreGroups: content.loreGroups || [],
      notes: content.notes || {}
    },
    artAssets,
    images
  };
}

function mergeItems(current, incoming) {
  const byId = new Map();
  let added = 0, updated = 0;
  (Array.isArray(current) ? current : []).forEach(item => { if (item?.id) byId.set(item.id, item); });
  (Array.isArray(incoming) ? incoming : []).forEach(item => {
    if (!item?.id) return;
    if (byId.has(item.id)) updated += 1; else added += 1;
    byId.set(item.id, item);
  });
  return { items: [...byId.values()], added, updated };
}

// 两种策略签名一致（当前值, 导入值），planImport 才能按 mode 直接换函数。
function replaceItems(_current, incoming) {
  const items = (Array.isArray(incoming) ? incoming : []).filter(item => item?.id);
  return { items, added: items.length, updated: 0 };
}

/**
 * 计算导入后的整库内容与改动统计。
 * `merge`：按 ID 合并，导入的同名条目覆盖本地；`replace`：整库替换（美术资产不在此列）。
 */
export function planImport(current, incoming, mode = 'merge') {
  const existing = plainObject(current || {}, '当前内容');
  const next = plainObject(incoming || {}, '导入内容');
  const strategy = mode === 'replace' ? replaceItems : mergeItems;
  const loreEntries = strategy(existing.loreEntries, next.loreEntries);
  const cardDrafts = strategy(existing.cardDrafts, next.cardDrafts);
  const keywords = strategy(existing.keywords, next.keywords);
  const loreGroups = strategy(existing.loreGroups, next.loreGroups);
  const notesBase = mode === 'replace' ? {} : { ...(existing.notes || {}) };
  const incomingNotes = next.notes && typeof next.notes === 'object' ? next.notes : {};
  const notesAdded = Object.keys(incomingNotes).filter(key => !(key in notesBase)).length;
  const notesUpdated = Object.keys(incomingNotes).filter(key => key in notesBase).length;
  return {
    content: {
      loreEntries: loreEntries.items,
      cardDrafts: cardDrafts.items,
      keywords: keywords.items,
      loreGroups: loreGroups.items,
      notes: { ...notesBase, ...incomingNotes }
    },
    summary: {
      mode: mode === 'replace' ? 'replace' : 'merge',
      loreEntries: { added: loreEntries.added, updated: loreEntries.updated, total: loreEntries.items.length },
      cardDrafts: { added: cardDrafts.added, updated: cardDrafts.updated, total: cardDrafts.items.length },
      keywords: { added: keywords.added, updated: keywords.updated, total: keywords.items.length },
      loreGroups: { added: loreGroups.added, updated: loreGroups.updated, total: loreGroups.items.length },
      notes: { added: notesAdded, updated: notesUpdated, total: Object.keys({ ...notesBase, ...incomingNotes }).length }
    }
  };
}

/**
 * 美术资产只按 ID 补齐、不覆盖既有绑定，也从不删除；这样导入别人的库不会
 * 悄悄解绑本机已有的画作，重名资产以本机为准。
 */
export function planArtAssetImport(currentAssets, incomingAssets) {
  const known = new Set((Array.isArray(currentAssets) ? currentAssets : []).map(asset => asset?.id).filter(Boolean));
  const added = [];
  let skipped = 0;
  (Array.isArray(incomingAssets) ? incomingAssets : []).forEach(asset => {
    if (!asset?.id) return;
    if (known.has(asset.id)) { skipped += 1; return; }
    known.add(asset.id);
    added.push(asset);
  });
  return { added, skipped, summary: { added: added.length, skipped, total: known.size } };
}

export function extensionForMimeType(mimeType) {
  return MIME[stringField(mimeType).trim()] || '';
}
