const ALLOWED_REFERENCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
export const MAX_REFERENCE_IMAGES = 10;
const MAX_EXISTING_ASSET_BYTES = 30 * 1024 * 1024;

export function parseReferenceUpload(payload) {
  const targetType = payload?.targetType === 'lore' ? 'lore' : 'card';
  const targetId = String(payload?.targetId || '').trim();
  const originalName = String(payload?.fileName || 'reference').trim().slice(0, 180);
  const match = String(payload?.dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!targetId || targetId.length > 160) throw new Error('参考图目标 ID 无效');
  if (targetType === 'card' && !/^CARD-[A-Za-z0-9-]+$/.test(targetId)) throw new Error('卡牌 ID 无效，请先建立卡牌草案');
  if (targetType === 'lore' && !/^[A-Za-z0-9][A-Za-z0-9-]{1,159}$/.test(targetId)) throw new Error('设定条目 ID 无效，请先保存资料');
  if (!match || !ALLOWED_REFERENCE_MIME_TYPES.has(match[1])) throw new Error('参考图仅支持 PNG、JPEG 或 WebP');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES) throw new Error('参考图大小必须在 1 字节到 8 MB 之间');
  return { targetType, targetId, originalName, mimeType: match[1], bytes };
}

export function toReferenceDataUrl(asset, bytes) {
  if (!asset || !ALLOWED_REFERENCE_MIME_TYPES.has(asset.mimeType)) throw new Error('参考资源格式不受支持');
  if (!bytes?.length || bytes.length > MAX_EXISTING_ASSET_BYTES) throw new Error('参考资源大小无效');
  return `data:${asset.mimeType};base64,${bytes.toString('base64')}`;
}

export function normalizeReferenceAssetIds(value) {
  const ids = [...new Set((Array.isArray(value) ? value : []).map(id => String(id || '').trim()).filter(Boolean))];
  if (ids.length > MAX_REFERENCE_IMAGES) throw new Error(`一次最多选择 ${MAX_REFERENCE_IMAGES} 张参考图`);
  if (ids.some(id => !/^ART-[A-F0-9-]+$/i.test(id))) throw new Error('参考图资源 ID 无效');
  return ids;
}
