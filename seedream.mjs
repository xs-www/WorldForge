const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_MODEL = 'doubao-seedream-5-0-flash-260915';
const ALLOWED_SIZES = new Set(['2K', '1872x1248', '1248x1872']);

export function seedreamConfig(env = process.env) {
  return {
    key: env.SEEDREAM_API_KEY || '',
    baseUrl: (env.SEEDREAM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    model: env.SEEDREAM_MODEL || DEFAULT_MODEL
  };
}

export function validateSeedreamSettings(payload) {
  const baseUrl = String(payload.seedreamBaseUrl || DEFAULT_BASE_URL).trim().replace(/\/$/, '');
  const model = String(payload.seedreamModel || DEFAULT_MODEL).trim();
  const apiKey = payload.clearSeedreamApiKey ? '' : (payload.seedreamApiKey === undefined ? undefined : String(payload.seedreamApiKey).trim());
  if (!/^https:\/\/ark\.cn-beijing\.volces\.com\/api\/v3$/i.test(baseUrl)) throw new Error('Seedream Base URL 必须是火山方舟中国区 API v3 地址');
  if (!model || model.length > 160 || !/^doubao-seedream-[a-z0-9.-]+$/i.test(model)) throw new Error('Seedream 模型 ID 无效');
  if (apiKey !== undefined && (apiKey.length > 1000 || /[\r\n]/.test(apiKey))) throw new Error('Seedream API Key 无效');
  return { baseUrl, model, apiKey };
}

export function validateImageRequest(payload) {
  const prompt = String(payload?.prompt || '').trim();
  const size = String(payload?.size || '2K');
  const targetType=payload?.targetType==='lore'?'lore':'card';
  const targetId=String(payload?.targetId||payload?.cardId||'').trim();
  const purpose=String(payload?.purpose|| (targetType==='card'?'card_art':'concept')).trim().slice(0,40);
  if (!prompt || prompt.length > 3000) throw new Error('生图提示词必须为 1–3000 个字符');
  if (!ALLOWED_SIZES.has(size)) throw new Error('不支持的图片尺寸');
  if(!targetId||targetId.length>160)throw new Error('生成目标 ID 无效');
  if(targetType==='card'&&!/^CARD-[A-Za-z0-9-]+$/.test(targetId))throw new Error('卡牌 ID 无效，请先建立卡牌草案');
  if(targetType==='lore'&&!/^[A-Za-z0-9][A-Za-z0-9-]{1,159}$/.test(targetId))throw new Error('设定条目 ID 无效，请先保存资料');
  const referenceImages=Array.isArray(payload?.referenceImages)?payload.referenceImages:[];
  if(referenceImages.length>10)throw new Error('一次最多使用 10 张参考图');
  if(referenceImages.some(image=>typeof image!=='string'||!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)))throw new Error('参考图数据格式无效');
  return { prompt, size, targetType, targetId, purpose, cardId:targetType==='card'?targetId:'', referenceImages };
}

export function buildSeedreamBody(config, request) {
  const body={
    model: config.model,
    prompt: `${request.prompt}\n仅生成原创视觉原型或插画本体，不要文字、数字、卡框、标志或界面元素。`,
    size: request.size,
    response_format: 'url',
    stream: false,
    watermark: false
  };
  if(request.referenceImages?.length)body.image=request.referenceImages.length===1?request.referenceImages[0]:request.referenceImages;
  return body;
}

export async function generateSeedreamImage(config, payload, fetchImpl = fetch) {
  if (!config.key) throw new Error('尚未配置 Seedream API Key');
  const request = validateImageRequest(payload);
  const response = await fetchImpl(`${config.baseUrl}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSeedreamBody(config, request)),
    signal: AbortSignal.timeout(180000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error?.message || `Seedream 返回 ${response.status}`); error.status = response.status; throw error; }
  const output = data.data?.[0];
  if (!output?.url || !/^https:\/\//i.test(output.url)) throw new Error('Seedream 未返回有效图片 URL');
  const imageResponse = await fetchImpl(output.url, { signal: AbortSignal.timeout(60000) });
  if (!imageResponse.ok) throw new Error(`下载 Seedream 图片失败：${imageResponse.status}`);
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw new Error('Seedream 图片数据大小无效');
  return {
    request,
    bytes,
    mimeType: imageResponse.headers?.get?.('content-type')?.split(';')[0] || 'image/jpeg',
    providerMetadata: { created: data.created || null, usage: data.usage || null, returnedSize: output.size || request.size }
  };
}

export const SEEDREAM_DEFAULTS = { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, sizes: [...ALLOWED_SIZES] };
