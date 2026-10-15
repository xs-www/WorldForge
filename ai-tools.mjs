// 自由创作 Agent 的只读资料工具。工具只读取随请求传入的资料库快照，
// 不访问文件系统、数据库或任何密钥；所有返回值都标注 status / truthScope，
// 避免模型把 proposed 草案当成已批准正史。
export const AGENT_LIMITS = {
  maxEntries: 400,
  maxDetails: 8000,
  maxSummary: 1200,
  maxFieldText: 300,
  searchLimit: 12,
  getLimit: 5,
  listLimit: 30,
  resultChars: 6000,
  maxArtAssets: 200,
  artListLimit: 30,
  maxImages: 4,
  maxImagePrompt: 300
};

const STATUS_VALUES = ['canon', 'proposed', 'unknown', 'deprecated'];

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function textList(value, maxItems, maxLength) {
  return (Array.isArray(value) ? value : []).map(item => text(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

export function prepareLibrary(value) {
  return (Array.isArray(value) ? value : []).slice(0, AGENT_LIMITS.maxEntries).map(entry => ({
    id: text(entry?.id, 100),
    type: text(entry?.type, 40),
    name: text(entry?.name, 160),
    status: text(entry?.status, 20),
    truthScope: text(entry?.truthScope, 30),
    worldId: text(entry?.worldId, 30),
    summary: text(entry?.summary, AGENT_LIMITS.maxSummary),
    details: text(entry?.details, AGENT_LIMITS.maxDetails),
    tags: textList(entry?.tags, 20, 60),
    relationIds: textList(entry?.relationIds, 40, 100),
    constraints: textList(entry?.constraints, 20, AGENT_LIMITS.maxFieldText),
    openQuestions: textList(entry?.openQuestions, 20, AGENT_LIMITS.maxFieldText)
  })).filter(entry => entry.id);
}

export const FREE_AGENT_TOOLS = [
  {
    name: 'search_lore',
    description: '按关键词、类型、世界或状态检索资料库，返回匹配条目的编号、名称、状态、事实层次与摘要。不确定有哪些相关条目时先用它。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '关键词；会在名称、编号、摘要、正文与标签中匹配' },
        type: { type: 'string', description: '限定资料类型，例如 world / faction / character / magic / technology / event / timeline / story' },
        worldId: { type: 'string', description: '限定世界编号，例如 W01' },
        status: { type: 'string', enum: STATUS_VALUES, description: '限定状态' },
        limit: { type: 'integer', minimum: 1, maximum: AGENT_LIMITS.searchLimit, description: '返回条数上限' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_lore_entry',
    description: '按稳定 ID 读取一到五个条目的完整资料，包含正文、约束、开放问题与关联编号。需要引用具体设定内容时必须先调用它，不要凭摘要臆测正文。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ids: { type: 'array', minItems: 1, maxItems: AGENT_LIMITS.getLimit, items: { type: 'string' }, description: '条目稳定 ID 列表' }
      },
      required: ['ids']
    }
  },
  {
    name: 'list_lore',
    description: '列出资料库条目索引（编号、类型、名称、状态、世界），可按类型、世界或状态过滤。适合先了解资料库结构再决定读哪些条目。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string' },
        worldId: { type: 'string' },
        status: { type: 'string', enum: STATUS_VALUES },
        limit: { type: 'integer', minimum: 1, maximum: AGENT_LIMITS.listLimit }
      },
      required: []
    }
  },
  {
    name: 'list_art_assets',
    description: '列出美术资产（原画 / 视觉原型）索引：资产编号、用途、绑定目标、生成通道与尺寸。想知道某个条目或卡牌有哪些画作时先用它。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        targetId: { type: 'string', description: '按绑定目标过滤，例如某个资料条目 ID 或卡牌 ID' },
        targetType: { type: 'string', enum: ['lore', 'card'] },
        purpose: { type: 'string', description: '用途，例如 portrait / environment / item / scene / concept / card_art' },
        limit: { type: 'integer', minimum: 1, maximum: AGENT_LIMITS.artListLimit }
      },
      required: []
    }
  },
  {
    name: 'get_art_asset',
    description: '查看一到四张美术资产的实际画面，并把图片附到本次对话中。需要判断画面内容、风格、构图或视觉一致性时必须先调用它；元数据不足以描述画面。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ids: { type: 'array', minItems: 1, maxItems: AGENT_LIMITS.maxImages, items: { type: 'string' }, description: '美术资产编号，来自 list_art_assets' }
      },
      required: ['ids']
    }
  }
];

export const FREE_AGENT_TOOL_NAMES = FREE_AGENT_TOOLS.map(tool => tool.name);

// 美术资产只传元数据索引；图片本体由服务端按编号从磁盘读取后附到对话里。
export function prepareArtAssets(value) {
  return (Array.isArray(value) ? value : []).slice(0, AGENT_LIMITS.maxArtAssets).map(asset => ({
    id: text(asset?.id, 60),
    purpose: text(asset?.purpose, 40),
    targetType: asset?.targetType === 'lore' ? 'lore' : 'card',
    targetId: text(asset?.targetId || asset?.cardId, 100),
    provider: text(asset?.provider || asset?.model, 60),
    size: text(asset?.size, 30),
    provenance: text(asset?.provenance, 30),
    createdAt: text(asset?.createdAt, 40),
    prompt: text(asset?.prompt, AGENT_LIMITS.maxImagePrompt)
  })).filter(asset => /^ART-/i.test(asset.id));
}

function clampLimit(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(number)));
}

function haystack(entry) {
  return `${entry.name} ${entry.id} ${entry.summary} ${entry.details} ${entry.tags.join(' ')}`.toLowerCase();
}

function clip(payload) {
  const encoded = JSON.stringify(payload);
  if (encoded.length <= AGENT_LIMITS.resultChars) return encoded;
  return JSON.stringify({ truncated: true, note: `结果超过 ${AGENT_LIMITS.resultChars} 字符已截断，请缩小查询范围或按 ID 精确读取。`, preview: encoded.slice(0, AGENT_LIMITS.resultChars) });
}

function matchFilters(entry, args) {
  if (args.type && entry.type !== String(args.type).trim()) return false;
  if (args.worldId && entry.worldId !== String(args.worldId).trim()) return false;
  if (args.status && entry.status !== String(args.status).trim()) return false;
  return true;
}

function searchLore(args, library) {
  const query = text(args.query, 200).toLowerCase();
  const limit = clampLimit(args.limit, 8, AGENT_LIMITS.searchLimit);
  const matches = library
    .filter(entry => matchFilters(entry, args))
    .filter(entry => !query || haystack(entry).includes(query))
    .slice(0, limit)
    .map(entry => ({ id: entry.id, type: entry.type, name: entry.name, status: entry.status, truthScope: entry.truthScope, worldId: entry.worldId, summary: entry.summary }));
  return { total: matches.length, matches, hint: matches.length ? '需要正文时用 get_lore_entry 按 ID 读取。' : '没有匹配条目，可放宽关键词或省略 type/worldId/status。' };
}

function getLoreEntry(args, library) {
  const ids = textList(args.ids, AGENT_LIMITS.getLimit, 100);
  if (!ids.length) throw new Error('ids 必须包含至少一个条目 ID');
  const byId = new Map(library.map(entry => [entry.id, entry]));
  const found = [];
  const missing = [];
  ids.forEach(id => {
    const entry = byId.get(id);
    if (entry) found.push(entry); else missing.push(id);
  });
  return { entries: found, missing, includePrivateNotes: false };
}

function listLore(args, library) {
  const limit = clampLimit(args.limit, 20, AGENT_LIMITS.listLimit);
  const entries = library.filter(entry => matchFilters(entry, args));
  return {
    total: entries.length,
    returned: Math.min(limit, entries.length),
    entries: entries.slice(0, limit).map(entry => ({ id: entry.id, type: entry.type, name: entry.name, status: entry.status, worldId: entry.worldId }))
  };
}

function matchArt(asset, args) {
  if (args.targetId && asset.targetId !== text(args.targetId, 100)) return false;
  if (args.targetType && asset.targetType !== text(args.targetType, 20)) return false;
  if (args.purpose && asset.purpose !== text(args.purpose, 40)) return false;
  return true;
}

function listArtAssets(args, artAssets) {
  const limit = clampLimit(args.limit, 20, AGENT_LIMITS.artListLimit);
  const assets = artAssets.filter(asset => matchArt(asset, args));
  return {
    total: assets.length,
    returned: Math.min(limit, assets.length),
    assets: assets.slice(0, limit).map(asset => ({ id: asset.id, purpose: asset.purpose, targetType: asset.targetType, targetId: asset.targetId, provider: asset.provider, size: asset.size, createdAt: asset.createdAt })),
    hint: '要看实际画面请用 get_art_asset 按编号取图；元数据不足以判断构图与风格。'
  };
}

function getArtAsset(args, artAssets) {
  const ids = textList(args.ids, AGENT_LIMITS.maxImages, 60);
  if (!ids.length) throw new Error('ids 必须包含至少一个美术资产编号');
  const byId = new Map(artAssets.map(asset => [asset.id, asset]));
  const found = [];
  const missing = [];
  ids.forEach(id => {
    const asset = byId.get(id);
    if (asset) found.push(asset); else missing.push(id);
  });
  return { assets: found, missing };
}

// 返回 { ok, content, summary, imageIds? }。失败不会抛出，而是把错误文本交回模型让它自行修正。
// imageIds 由调用方解析成本地图片后附到对话里；工具消息本身不能携带图片。
export function runToolCall(name, args, library, artAssets = []) {
  const tool = String(name || '').trim();
  const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const assets = Array.isArray(artAssets) ? artAssets : [];
  if (!FREE_AGENT_TOOL_NAMES.includes(tool)) {
    return { ok: false, summary: `未知工具 ${tool || '(空)'}`, content: clip({ error: `未知工具：${tool || '(空)'}`, available: FREE_AGENT_TOOL_NAMES }) };
  }
  try {
    if (tool === 'search_lore') {
      const result = searchLore(safeArgs, library);
      return { ok: true, summary: `检索命中 ${result.total} 条`, content: clip(result) };
    }
    if (tool === 'get_lore_entry') {
      const result = getLoreEntry(safeArgs, library);
      return { ok: true, summary: `读取 ${result.entries.length} 条完整资料`, content: clip(result) };
    }
    if (tool === 'list_lore') {
      const result = listLore(safeArgs, library);
      return { ok: true, summary: `列出 ${result.returned} / ${result.total} 条`, content: clip(result) };
    }
    if (tool === 'list_art_assets') {
      const result = listArtAssets(safeArgs, assets);
      return { ok: true, summary: `美术资产 ${result.returned} / ${result.total} 个`, content: clip(result) };
    }
    const result = getArtAsset(safeArgs, assets);
    return {
      ok: true,
      summary: `附上 ${result.assets.length} 张原画`,
      content: clip({ attached: result.assets.map(asset => ({ id: asset.id, purpose: asset.purpose, targetType: asset.targetType, targetId: asset.targetId, provider: asset.provider, size: asset.size, originalPrompt: asset.prompt })), missing: result.missing, note: '图片已附在本条消息之后；请直接依据画面回答。' }),
      imageIds: result.assets.map(asset => asset.id)
    };
  } catch (error) {
    return { ok: false, summary: `工具调用失败：${error.message}`, content: clip({ error: String(error.message || '工具调用失败') }) };
  }
}
