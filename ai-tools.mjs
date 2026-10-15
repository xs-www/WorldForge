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
  resultChars: 6000
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
  }
];

export const FREE_AGENT_TOOL_NAMES = FREE_AGENT_TOOLS.map(tool => tool.name);

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

// 返回 { ok, content, summary }。失败不会抛出，而是把错误文本交回模型让它自行修正。
export function runToolCall(name, args, library) {
  const tool = String(name || '').trim();
  const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
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
    const result = listLore(safeArgs, library);
    return { ok: true, summary: `列出 ${result.returned} / ${result.total} 条`, content: clip(result) };
  } catch (error) {
    return { ok: false, summary: `工具调用失败：${error.message}`, content: clip({ error: String(error.message || '工具调用失败') }) };
  }
}
