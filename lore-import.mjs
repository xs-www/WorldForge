import { parseLooseJson, previewOf } from './ai-harness.mjs';
import { fallbackGroup } from './lore-groups.mjs';

// ── 设定导入（ADR-0033）─────────────────────────────────────────────────────
// 「粘贴一篇长篇设定 → Agent 分段解析 → 改写成资料库条目 → 作者预览确认 → 建立新世界」。
//
// 本模块是纯变换层：不读磁盘、不连数据库、不发 HTTP。切分、Schema、提示词、
// 模型返回收敛、跨段合并、ID 分配与「条目 plan → 项目资料格式」的改写都在这里，
// 因此可以完全离线单测；`server.mjs` 只负责解析 preset、计费、调用模型与落库。
//
// 关键取舍（ADR-0033）：
// 1. 只整理原文明确写出的信息。模型可以归纳与改写措辞，但不得补出原文没有的
//    事实、名称、数字与关系；不确定的内容只能进 openQuestions。
// 2. 目标格式就是项目已有的资料格式：`values` 存组字段，`location` / `chronicle`
//    存结构，`relationIds` 存关联。导入不新造字段，也不假设任何世界题材。
// 3. 导入永远不会产出 canon：所有条目固定 proposed，背景故事固定 unknown。
// 4. 跨段合并是确定性的（同名同类型合并），不额外调用模型做归并；世界名与概述
//    取第一段非空值，避免多一次模型调用带来的费用与不确定输出。

export const LORE_IMPORT_TYPES = Object.freeze(['character', 'location', 'timeline', 'story', 'info']);

/**
 * 第 3 层入口契约：设定导入整理器的输出与事实纪律。
 * 与 `ai-harness.mjs` 里的其它入口契约同级；本入口不提供工具，也不写库。
 */
export const LORE_IMPORT_ENTRY_CONTRACT = `你只做「把作者已有的设定原文整理成资料库条目」，不做新的创作，也不新增原文没有的设定。
只使用原文明确写出的信息：可以归纳、分段、改写成通顺正文，但不得补出原文没有的事实、数字、名称、关系、年代或机制。
原文没有交代但整理时确实需要作者裁定的地方，只能写进 openQuestions，不能当作已知事实写进正文。
整理结果一律是 proposed 草案：不要声称已经保存、已经批准，也不要判定 canon 或 deprecated。
世界本身不是条目：把世界名称与概述放进 world 字段，不要在 entries 里再造一个世界。
直接写可进入条目正文的成品文字，禁止输出“原文提到”“本条目”“设计说明”“字段说明”等元话语。`

export const LORE_IMPORT_LIMITS = Object.freeze({
  // 一次导入最多读取的字符数（按 UTF-16 码元计），超出部分明确截断并回报。
  characters: 90000,
  chunkCharacters: 9000,
  maxChunks: 10,
  entriesPerChunk: 24,
  totalEntries: 160,
  concurrency: 3,
  name: 80,
  summary: 300,
  details: 6000,
  attribute: 200,
  line: 300,
  tags: 12,
  relations: 12
});

export const IMPORT_TYPE_LABELS = Object.freeze({
  character: '角色',
  location: '世界地图',
  timeline: '编年史',
  story: '背景故事',
  info: '世界信息'
});

/** 地理层级与 `dist/geography.js` 的 kinds 保持一致；这里只做格式校验，不复制树规则。 */
export const IMPORT_LOCATION_KINDS = Object.freeze(['continent', 'country', 'region', 'area', 'city', 'site', 'route']);
export const IMPORT_CHRONICLE_KINDS = Object.freeze(['chronicle', 'entry']);
export const IMPORT_TRUTH_SCOPES = Object.freeze(['objective', 'in_world_belief', 'unknown']);

/** 条目类型 → 稳定 ID 前缀，沿用仓库的 `CHR-W##-###` 式约定。 */
const ID_PREFIX = Object.freeze({ character: 'CHR', location: 'LOC', timeline: 'EVT', story: 'STY', info: 'INF' });

/** 模型在非结构化降级时可能写中文类型名，这里收敛到封闭集合。 */
const TYPE_ALIASES = Object.freeze({
  character: ['character', '角色', '人物', '主角', '配角'],
  location: ['location', '地点', '地理', '地名', '地图', '大陆', '国家', '城市', '区域', 'place'],
  timeline: ['timeline', '编年史', '时间线', '年表', '纪年', '大事记', 'chronicle'],
  story: ['story', '背景故事', '故事', '传说', '歌谣', '书信', 'legend'],
  info: ['info', '世界信息', '设定', '势力', '组织', 'faction', '种族', 'species', '文化', 'culture', '宗教', 'religion', '信仰', '力量体系', '魔法', 'magic', '技术', 'technology', '科技', '物品', 'item', '事件', 'event', 'artifact']
});

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${label} 必须是对象`);
  return value;
}

function text(value, limit) { return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, limit); }
function finiteNumber(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function stringList(value, maximum, limit) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => text(item, limit)).filter(Boolean))].slice(0, maximum);
}

// ── 输入与切分 ──────────────────────────────────────────────────────────────

/**
 * 规范化作者粘贴的原文：统一换行、去掉 BOM 与 NUL，并按上限截断。
 * 截断优先落在段落边界上，避免把一句话从中间切开。
 */
export function normalizeImportSource(value) {
  const raw = typeof value === 'string' ? value : '';
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  if (!normalized) throw badRequest('请先粘贴要导入的设定文本');
  if (normalized.length <= LORE_IMPORT_LIMITS.characters) {
    return { text: normalized, characters: normalized.length, truncated: false, droppedCharacters: 0 };
  }
  let cut = LORE_IMPORT_LIMITS.characters;
  const tail = normalized.slice(0, cut);
  const boundary = Math.max(tail.lastIndexOf('\n\n'), tail.lastIndexOf('\n'));
  if (boundary >= cut * 0.8) cut = boundary;
  const text = normalized.slice(0, cut).trim();
  return { text, characters: text.length, truncated: true, droppedCharacters: normalized.length - text.length };
}

/** 在不超过上限的窗口里找最靠后的自然断点（段落 → 换行 → 句末）。 */
function findCutIndex(window) {
  const markers = ['\n\n', '\n', '。', '！', '？', '；', '!', '?', ';'];
  let best = -1;
  for (const marker of markers) {
    const at = window.lastIndexOf(marker);
    if (at > best) best = at + marker.length;
  }
  return best >= window.length * 0.4 ? best : window.length;
}

/**
 * 把原文切成逐段请求模型的小块。切分是确定性的：同样的输入永远得到同样的分块，
 * 因此重跑一次导入不会改变分块边界（便于复现与测试）。
 */
export function splitImportSource(text, options = {}) {
  const chunkCharacters = Math.max(500, Number(options.chunkCharacters) || LORE_IMPORT_LIMITS.chunkCharacters);
  const maxChunks = Math.max(1, Number(options.maxChunks) || LORE_IMPORT_LIMITS.maxChunks);
  const source = String(text ?? '').trim();
  const chunks = [];
  let rest = source;
  while (rest.trim() && chunks.length < maxChunks) {
    if (rest.length <= chunkCharacters) { chunks.push(rest.trim()); rest = ''; break; }
    const window = rest.slice(0, chunkCharacters);
    const cut = findCutIndex(window), piece = rest.slice(0, cut).trim();
    rest = rest.slice(cut);
    if (piece) chunks.push(piece);
  }
  const dropped = rest.trim();
  return {
    chunks: chunks.map((text, index) => ({ index, characters: text.length, text })),
    truncated: Boolean(dropped),
    droppedCharacters: dropped.length
  };
}

// ── 抽取 Schema 与提示词 ────────────────────────────────────────────────────

const ENTRY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['type', 'name', 'summary', 'details', 'attributeA', 'attributeB', 'attributeC', 'constraints', 'openQuestions', 'tags', 'relations', 'locationKind', 'locationParent', 'chronicleKind', 'chronicleParent', 'dateLabel', 'order', 'truthScope'],
  properties: {
    type: { type: 'string', enum: LORE_IMPORT_TYPES, description: '只能取这些值：character 角色、location 地理条目、timeline 编年史容器或节点、story 背景故事、info 其它设定（势力/种族/文化/宗教/力量体系/技术/物品/事件等）' },
    name: { type: 'string', description: '原文里出现的专名；没有专名时用原文的描述性称呼，不要自行造名' },
    summary: { type: 'string', description: `一句话概述；原文没有概括时留空字符串，不超过 ${LORE_IMPORT_LIMITS.summary} 字` },
    details: { type: 'string', description: `可直接进入条目正文的成品文字：合并原文中关于该对象的分散描述，保留作者措辞与自造词，不超过 ${LORE_IMPORT_LIMITS.details} 字` },
    attributeA: { type: 'string', description: '第一条要点：info 条目填分类（如“势力”“技术体系”），其它类型可留空' },
    attributeB: { type: 'string', description: '第二条要点：info 条目填归属（如所属势力、地区）' },
    attributeC: { type: 'string', description: '第三条要点：info 条目填最关键的要点' },
    constraints: { type: 'array', maxItems: 12, items: { type: 'string' }, description: '原文明确写出的限制、代价与边界；没有就返回空数组' },
    openQuestions: { type: 'array', maxItems: 12, items: { type: 'string' }, description: '原文没有交代、但整理时确实需要作者裁定的缺口；不要用猜测填空' },
    tags: { type: 'array', maxItems: 12, items: { type: 'string' }, description: '2–6 个字的关键词标签，取自原文用词' },
    relations: { type: 'array', maxItems: 12, items: { type: 'string' }, description: '原文里与它确有关系的其它条目的名称；只写名称，不写编号' },
    locationKind: { type: 'string', enum: ['', ...IMPORT_LOCATION_KINDS], description: '仅 location：地理层级；不是地理条目留空' },
    locationParent: { type: 'string', description: '仅 location：原文里它的上级地理条目名称；不确定留空' },
    chronicleKind: { type: 'string', enum: ['', ...IMPORT_CHRONICLE_KINDS], description: '仅 timeline：编年史容器用 chronicle，具体纪年节点用 entry' },
    chronicleParent: { type: 'string', description: '仅 timeline 节点：所属编年史的名称' },
    dateLabel: { type: 'string', description: '仅 timeline 节点：原文里的纪年文本（如“第三纪元 412 年”）' },
    order: { type: ['number', 'null'], description: '仅 timeline 节点：同一编年史内的排序值，从 1 开始递增；不确定返回 null' },
    truthScope: { type: 'string', enum: IMPORT_TRUTH_SCOPES, description: 'objective 原文陈述的事实、in_world_belief 世界内传说或宣传口吻、unknown 原文自称不确定' }
  }
});

/** 单段抽取的严格 JSON Schema；与提示词第 5 层写死的响应外壳一一对应。 */
export const IMPORT_EXTRACTION_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['world', 'entries'],
  properties: {
    world: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'summary', 'details'],
      properties: {
        name: { type: 'string', description: '这一段提到的世界名称；没有就留空字符串' },
        summary: { type: 'string', description: '这一段对世界的概括；没有就留空字符串' },
        details: { type: 'string', description: '这一段对世界的整体描述；没有就留空字符串' }
      }
    },
    entries: {
      type: 'array',
      maxItems: LORE_IMPORT_LIMITS.entriesPerChunk,
      items: ENTRY_SCHEMA
    }
  }
});

/** 第 4–6 层提示词：作者风格（4）→ 本次任务与外壳（5）→ 原文（6）。 */
export function buildImportPrompt(options = {}) {
  const index = Math.max(0, Number(options.index) || 0);
  const total = Math.max(1, Number(options.total) || 1);
  const requireJson = options.requireJson === true;
  const personalized = text(options.personalizedPrompt, 8000) || '无额外统一风格要求';
  const instruction = text(options.instruction, 300);
  const source = String(options.text ?? '');
  // 原文属于不可信上下文：只可能撑破标签，因此把闭合标签打断，避免它伪装成新的指令段。
  const guarded = source.replace(/<\/worldforge_import_source/gi, '< /worldforge_import_source');
  const shapeExample = '{"world":{"name":"（世界名称，没有就空串）","summary":"（世界概述，没有就空串）","details":"（本段对世界的整体描述，没有就空串）"},"entries":[{"type":"character","name":"（原文中的专名）","summary":"（一句话概述）","details":"（成品正文）","attributeA":"","attributeB":"","attributeC":"","constraints":[],"openQuestions":[],"tags":[],"relations":[],"locationKind":"","locationParent":"","chronicleKind":"","chronicleParent":"","dateLabel":"","order":null,"truthScope":"objective"}]}';
  const taskRequest = `任务：把下面这段原创世界设定原文整理成资料库条目，供作者逐条确认后写入一个新建的世界。
本段是原文的第 ${index + 1}/${total} 段；只整理本段出现的信息，不要为了连贯而补写其它段落的内容，同名同类型的条目会由系统自动合并。
整理规则：
- 只使用原文明确写出的信息。可以归纳、分段、改写成通顺正文，但不得新增原文没有的事实、数字、名称、关系、年代或机制。
- 原文没交代但整理时确实需要作者裁定的地方，只能写进 openQuestions，不能当作已知事实写进正文。
- 一条条目只讲一个对象（一个人、一个地点、一个势力、一个事件……）；同一对象的分散描述必须合并成一条。
- 目标类型只有五种：character 角色、location 地理条目、timeline 编年史、story 背景故事、info 其它设定。势力、种族、文化、宗教、力量体系、技术、物品、事件等一律用 info，并把分类写进 attributeA；原文里有独立的传说、歌谣、书信或短篇叙述时用 story。
- name 必须是原文出现的专名；没有专名时用原文的描述性称呼，不要自行造名。
- details 直接写可进入条目正文的成品文字，保留作者的措辞、自造词与口吻；禁止出现“原文提到”“本条目”“以上内容”“设计说明”“字段说明”等元话语。
- 地理层级只能是 ${IMPORT_LOCATION_KINDS.join(' / ')}；只有在原文能看出上下级关系时才填 locationParent。
- 年表要先有容器（chronicleKind=chronicle 的 timeline 条目），再有节点（chronicleKind=entry，写 chronicleParent 与 dateLabel、order）；没有年表就不要产出 timeline。
- 世界本身不要写成条目，把世界名称与概述放进 world 字段。
- 原文以世界内传说、教义、宣传或不可靠叙述者口吻出现的内容，truthScope 用 in_world_belief；原文自称不确定或互相矛盾的用 unknown；其余用 objective。
- 不要引用任何商业 IP 的专有角色、地名、故事、标志或规则组合。
${instruction ? `作者补充要求：${instruction}\n` : ''}响应格式（必须严格遵守，只返回这一个 JSON 对象）：
${shapeExample}
- entries 的每一项都必须包含上面示例里的全部键，不适用时用空字符串、空数组或 null，不要删除键。
- 本段最多整理 ${LORE_IMPORT_LIMITS.entriesPerChunk} 条；宁可少而准，不要为凑数拆分同一对象。${requireJson ? '\n严格只返回 JSON 对象，不要添加解释文字或 Markdown 代码围栏。' : ''}`;
  // 顺序固定为第 4 层（作者风格）→ 第 5 层（本次任务）→ 第 6 层（原文）。原文只出现在最后：
  // 作者风格是服务端保存的指令，原文是不可信上下文，两者不得交换位置。
  const authorPrompts = `<author_personalized_style>\n${personalized}\n</author_personalized_style>`;
  const untrusted = `<worldforge_import_source index="${index + 1}" total="${total}">\n${guarded}\n</worldforge_import_source>`;
  return `${authorPrompts}\n${taskRequest}\n${untrusted}`;
}

// ── 模型返回的收敛与逐条校验 ────────────────────────────────────────────────

function resolveImportType(value) {
  const key = text(value, 40).toLowerCase();
  if (LORE_IMPORT_TYPES.includes(key)) return key;
  for (const [type, aliases] of Object.entries(TYPE_ALIASES)) {
    if (aliases.some(alias => alias.toLowerCase() === key)) return type;
  }
  return '';
}

/** 把数组 / `{entries}` / `{items}` / 裸条目收敛成 `{world, entries}`。 */
function coerceExtraction(value) {
  if (Array.isArray(value)) return { world: {}, entries: value };
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value.entries)) return { world: value.world && typeof value.world === 'object' ? value.world : {}, entries: value.entries };
  if (Array.isArray(value.items)) return { world: value.world && typeof value.world === 'object' ? value.world : {}, entries: value.items };
  if (typeof value.name === 'string' && (typeof value.details === 'string' || typeof value.type === 'string')) return { world: {}, entries: [value] };
  if ('world' in value) return { world: value.world && typeof value.world === 'object' ? value.world : {}, entries: [] };
  return null;
}

function normalizeExtractedEntry(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const type = resolveImportType(source.type);
  const name = text(source.name, LORE_IMPORT_LIMITS.name);
  const summary = text(source.summary, LORE_IMPORT_LIMITS.summary);
  const details = text(source.details, LORE_IMPORT_LIMITS.details);
  if (!LORE_IMPORT_TYPES.includes(type)) return { reason: '类型无法识别' };
  if (!name) return { reason: '缺少名称' };
  if (!details && !summary) return { reason: '缺少正文与概述' };
  const truthScope = IMPORT_TRUTH_SCOPES.includes(text(source.truthScope, 20)) ? text(source.truthScope, 20) : 'objective';
  const locationKind = IMPORT_LOCATION_KINDS.includes(text(source.locationKind, 20)) ? text(source.locationKind, 20) : '';
  const chronicleKind = IMPORT_CHRONICLE_KINDS.includes(text(source.chronicleKind, 20)) ? text(source.chronicleKind, 20) : '';
  return {
    entry: {
      type,
      name,
      summary,
      details: details || summary,
      attributeA: text(source.attributeA, LORE_IMPORT_LIMITS.attribute),
      attributeB: text(source.attributeB, LORE_IMPORT_LIMITS.attribute),
      attributeC: text(source.attributeC, LORE_IMPORT_LIMITS.attribute),
      constraints: stringList(source.constraints, LORE_IMPORT_LIMITS.lines, LORE_IMPORT_LIMITS.line),
      openQuestions: stringList(source.openQuestions, LORE_IMPORT_LIMITS.lines, LORE_IMPORT_LIMITS.line),
      tags: stringList(source.tags, LORE_IMPORT_LIMITS.tags, 24),
      relations: stringList(source.relations, LORE_IMPORT_LIMITS.relations, LORE_IMPORT_LIMITS.name),
      locationKind: type === 'location' ? locationKind : '',
      locationParent: type === 'location' ? text(source.locationParent, LORE_IMPORT_LIMITS.name) : '',
      chronicleKind: type === 'timeline' ? chronicleKind : '',
      chronicleParent: type === 'timeline' ? text(source.chronicleParent, LORE_IMPORT_LIMITS.name) : '',
      dateLabel: type === 'timeline' ? text(source.dateLabel, LORE_IMPORT_LIMITS.name) : '',
      order: type === 'timeline' ? finiteNumber(source.order) : null,
      truthScope: type === 'story' ? 'unknown' : truthScope
    }
  };
}

/**
 * 收敛单段模型输出。语法错误或外壳不对只记 issue、不抛错：
 * 一段失败不应让整次导入白跑；调用方按「全部段落都失败」才报错。
 */
export function normalizeExtraction(raw, options = {}) {
  const value = typeof raw === 'string' ? parseLooseJson(raw) : raw;
  if (value === undefined) {
    return { world: { name: '', summary: '', details: '' }, entries: [], issues: [{ code: 'INVALID_JSON', message: '模型没有返回有效 JSON', preview: previewOf(raw), chunk: options.chunkIndex ?? 0 }] };
  }
  const envelope = coerceExtraction(value);
  if (!envelope) {
    return { world: { name: '', summary: '', details: '' }, entries: [], issues: [{ code: 'INVALID_ENVELOPE', message: '返回值既不是 {world, entries} 也不是条目数组', preview: previewOf(value), chunk: options.chunkIndex ?? 0 }] };
  }
  const world = {
    name: text(envelope.world?.name, 120),
    summary: text(envelope.world?.summary, 2000),
    details: text(envelope.world?.details, 16000)
  };
  const entries = [], issues = [];
  envelope.entries.slice(0, LORE_IMPORT_LIMITS.entriesPerChunk).forEach((candidate, index) => {
    const result = normalizeExtractedEntry(candidate);
    if (result.entry) entries.push(result.entry);
    else issues.push({ code: 'ENTRY_DROPPED', message: `第 ${index + 1} 条被丢弃：${result.reason}`, preview: previewOf(candidate, 200), chunk: options.chunkIndex ?? 0 });
  });
  return { world, entries, issues };
}

// ── 跨段合并（确定性） ──────────────────────────────────────────────────────

function nameKey(value) {
  return String(value ?? '').replace(/[\s\u3000·・:：,，.。、()（）【】[\]「」『』"'!！?？]/g, '').toLowerCase();
}

function longerText(left, right, limit) {
  const a = String(left ?? ''), b = String(right ?? '');
  if (!a) return text(b, limit);
  if (!b) return text(a, limit);
  if (a.includes(b)) return text(a, limit);
  if (b.includes(a)) return text(b, limit);
  return text(`${a}\n\n${b}`, limit);
}

/**
 * 合并多段抽取结果：同名同类型视为同一实体，保留首条并补充缺失字段。
 * 世界名 / 概述 / 正文取首段非空值，保证多段解析不会拼出奇怪的世界名。
 */
export function mergeExtractions(extractions = []) {
  const world = { name: '', summary: '', details: '' };
  const merged = new Map(), warnings = [];
  let dropped = 0;
  for (const extraction of Array.isArray(extractions) ? extractions : []) {
    if (!extraction) continue;
    if (!world.name && extraction.world?.name) world.name = extraction.world.name;
    if (!world.summary && extraction.world?.summary) world.summary = extraction.world.summary;
    if (extraction.world?.details) world.details = longerText(world.details, extraction.world.details, 16000);
    for (const entry of extraction.entries || []) {
      const key = `${entry.type}|${nameKey(entry.name)}`;
      const existing = merged.get(key);
      if (!existing) { merged.set(key, entry); continue; }
      dropped += 1;
      existing.summary = longerText(existing.summary, entry.summary, LORE_IMPORT_LIMITS.summary);
      existing.details = longerText(existing.details, entry.details, LORE_IMPORT_LIMITS.details);
      for (const field of ['attributeA', 'attributeB', 'attributeC', 'locationKind', 'locationParent', 'chronicleKind', 'chronicleParent', 'dateLabel']) {
        if (!existing[field] && entry[field]) existing[field] = entry[field];
      }
      if (existing.order === null || existing.order === undefined) existing.order = entry.order;
      for (const field of ['constraints', 'openQuestions', 'tags', 'relations']) {
        existing[field] = stringList([...(existing[field] || []), ...(entry[field] || [])], field === 'relations' ? LORE_IMPORT_LIMITS.relations : LORE_IMPORT_LIMITS.lines, field === 'tags' ? 24 : field === 'relations' ? LORE_IMPORT_LIMITS.name : LORE_IMPORT_LIMITS.line);
      }
      if (entry.truthScope === 'unknown') existing.truthScope = 'unknown';
    }
  }
  const entries = [...merged.values()];
  if (dropped) warnings.push({ code: 'DUPLICATE_MERGED', message: `跨段出现同名同类型条目 ${dropped} 次，已合并为同一条` });
  if (entries.length > LORE_IMPORT_LIMITS.totalEntries) {
    warnings.push({ code: 'ENTRIES_TRUNCATED', message: `条目超过上限 ${LORE_IMPORT_LIMITS.totalEntries}，只保留前 ${LORE_IMPORT_LIMITS.totalEntries} 条` });
    entries.length = LORE_IMPORT_LIMITS.totalEntries;
  }
  return { world, entries, warnings };
}

/** 为缺容器的编年史节点补建容器（名称来自原文，不新造设定）。 */
function ensureChronicleContainers(entries) {
  const containers = new Map(entries.filter(entry => entry.type === 'timeline' && entry.chronicleKind === 'chronicle').map(entry => [nameKey(entry.name), entry]));
  const created = [];
  for (const node of [...entries]) {
    if (node.type !== 'timeline' || node.chronicleKind !== 'entry' || !node.chronicleParent) continue;
    const key = nameKey(node.chronicleParent);
    if (containers.has(key)) continue;
    const container = {
      type: 'timeline', name: node.chronicleParent, summary: '', details: node.chronicleParent,
      attributeA: '', attributeB: '', attributeC: '', constraints: [], openQuestions: [], tags: [], relations: [],
      locationKind: '', locationParent: '', chronicleKind: 'chronicle', chronicleParent: '', dateLabel: '', order: null,
      truthScope: 'objective'
    };
    containers.set(key, container);
    created.push(container);
  }
  return { entries: [...entries, ...created], created: created.map(item => item.name) };
}

// ── 世界编号与条目编号 ──────────────────────────────────────────────────────

/** 与浏览器端 `WorldforgeWorldScope.nextWorldId` 一致：取最小可用的 W##。 */
export function nextWorldIdOf(entries = []) {
  const used = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const value of [entry?.type === 'world' ? entry?.id : '', entry?.worldId]) {
      const match = /^W(\d{2,})$/.exec(String(value ?? '').trim());
      if (match) used.add(Number(match[1]));
    }
  }
  let next = 1;
  while (used.has(next)) next += 1;
  return `W${String(next).padStart(2, '0')}`;
}

function nextSequentialId(prefix, worldId, used) {
  const pattern = new RegExp(`^${prefix}-${worldId}-(\\d{3,})$`);
  let sequence = 1;
  for (const id of used) {
    const match = pattern.exec(String(id));
    if (match) sequence = Math.max(sequence, Number(match[1]) + 1);
  }
  let id = `${prefix}-${worldId}-${String(sequence).padStart(3, '0')}`;
  while (used.has(id)) {
    sequence += 1;
    id = `${prefix}-${worldId}-${String(sequence).padStart(3, '0')}`;
  }
  used.add(id);
  return id;
}

// ── 改写为项目资料格式 ──────────────────────────────────────────────────────

function entryValues(entry) {
  const values = { details: entry.details };
  if (entry.summary) values.summary = entry.summary;
  if (entry.attributeA) values.attributeA = entry.attributeA;
  if (entry.attributeB) values.attributeB = entry.attributeB;
  if (entry.attributeC) values.attributeC = entry.attributeC;
  if (entry.constraints.length) values.constraints = [...entry.constraints];
  if (entry.openQuestions.length) values.openQuestions = [...entry.openQuestions];
  return values;
}

/**
 * 把合并后的 plan 条目改写成项目资料格式（`values` + `location` + `chronicle`），
 * 并分配稳定 ID、把关联名称解析成条目 ID。
 */
export function buildLoreEntries(planEntries = [], { worldId, existingIds = [], now = () => new Date().toISOString() } = {}) {
  const { entries: withContainers, created } = ensureChronicleContainers(Array.isArray(planEntries) ? planEntries.map(entry => ({ ...entry })) : []);
  const used = new Set(existingIds.map(id => String(id)));
  const idOf = new Map();
  for (const entry of withContainers) {
    const prefix = ID_PREFIX[entry.type] || 'INF';
    idOf.set(entry, nextSequentialId(prefix, worldId, used));
  }
  const byName = new Map();
  const ambiguous = [];
  for (const entry of withContainers) {
    const key = nameKey(entry.name);
    if (!key) continue;
    if (byName.has(key) && byName.get(key) !== idOf.get(entry)) { ambiguous.push(entry.name); continue; }
    byName.set(key, idOf.get(entry));
  }
  const unresolved = new Set(), orphanLocations = [], orphanChronicles = [];
  const timestamp = now();
  const entries = withContainers.map(entry => {
    const id = idOf.get(entry);
    const relationIds = [];
    for (const name of entry.relations || []) {
      const target = byName.get(nameKey(name));
      if (target && target !== id) relationIds.push(target);
      else unresolved.add(name);
    }
    const location = {
      kind: entry.locationKind || '',
      parentId: entry.locationParent ? (byName.get(nameKey(entry.locationParent)) || '') : '',
      x: '', y: '',
      environment: ''
    };
    if (entry.type === 'location' && entry.locationParent && !location.parentId) orphanLocations.push(entry.name);
    const chronicle = {
      kind: entry.chronicleKind || '',
      parentId: entry.chronicleParent ? (byName.get(nameKey(entry.chronicleParent)) || '') : '',
      dateLabel: entry.dateLabel || '',
      order: entry.order === undefined ? null : entry.order
    };
    if (entry.type === 'timeline' && entry.chronicleParent && !chronicle.parentId) orphanChronicles.push(entry.name);
    return {
      id,
      type: entry.type,
      worldId,
      name: entry.name,
      status: 'proposed',
      truthScope: entry.type === 'story' ? 'unknown' : (IMPORT_TRUTH_SCOPES.includes(entry.truthScope) ? entry.truthScope : 'objective'),
      values: entryValues(entry),
      tags: entry.type === 'story' ? [] : [...(entry.tags || [])],
      relationIds: [...new Set(relationIds)],
      location,
      chronicle,
      updatedAt: timestamp
    };
  });
  const warnings = [];
  if (created.length) warnings.push({ code: 'CHRONICLE_CONTAINER_CREATED', message: `为纪年节点补建了编年史容器：${created.slice(0, 5).join('、')}${created.length > 5 ? ' 等' : ''}` });
  if (unresolved.size) warnings.push({ code: 'RELATION_UNRESOLVED', message: `这些关联名称没有对应的导入条目，已忽略：${[...unresolved].slice(0, 6).join('、')}${unresolved.size > 6 ? ' 等' : ''}` });
  if (ambiguous.length) warnings.push({ code: 'RELATION_AMBIGUOUS', message: `这些名称在多个类型里重复，关联只指向同名的第一条：${[...new Set(ambiguous)].slice(0, 6).join('、')}` });
  if (orphanLocations.length) warnings.push({ code: 'LOCATION_ORPHAN', message: `这些地理条目找不到原文里的上级，会显示在「待整理的地理条目」里：${orphanLocations.slice(0, 6).join('、')}` });
  if (orphanChronicles.length) warnings.push({ code: 'CHRONICLE_ORPHAN', message: `这些纪年节点找不到所属编年史，会显示在「待整理的编年节点」里：${orphanChronicles.slice(0, 6).join('、')}` });
  return { entries, warnings };
}

/** 新建世界的世界条目：名称取作者输入 → 模型识别 → 兜底编号，概述与正文保持原文信息。 */
export function buildWorldEntry({ worldId, world = {}, authorName = '', now = () => new Date().toISOString() } = {}) {
  const name = text(authorName, 120) || text(world.name, 120) || `导入的世界 ${worldId}`;
  const summary = text(world.summary, 2000);
  const details = text(world.details, 16000);
  const values = { details };
  if (summary) values.summary = summary;
  return {
    id: worldId,
    type: 'world',
    worldId,
    name,
    status: 'proposed',
    truthScope: 'objective',
    values,
    tags: [],
    relationIds: [],
    location: { kind: '', parentId: '', x: '', y: '', environment: '' },
    chronicle: { kind: '', parentId: '', dateLabel: '', order: null },
    updatedAt: now()
  };
}

/** 导入用到 `info` 时才落一行资料组记录；它是作者可改的自定义组，不是产品常量。 */
export function buildImportGroups(entries, worldId) {
  if (!(entries || []).some(entry => entry.type === 'info')) return [];
  const group = fallbackGroup('info');
  return [{ ...group, worldId }];
}

/**
 * 汇总一次解析结果：分配世界编号、改写条目、生成可选资料组与统计。
 * `existingEntries` 是当前内容库里的资料条目（只用于编号避让与世界编号）。
 */
export function buildImportPlan({ worldId, world, entries, warnings = [], extractions = [], source = {}, existingEntries = [], now } = {}) {
  const existingIds = (Array.isArray(existingEntries) ? existingEntries : []).map(entry => String(entry?.id ?? '')).filter(Boolean);
  const built = buildLoreEntries(entries || [], { worldId, existingIds: [worldId, ...existingIds], now });
  const counts = {};
  for (const entry of built.entries) counts[entry.type] = (counts[entry.type] || 0) + 1;
  return {
    worldId,
    world: {
      name: text(world?.name, 120),
      summary: text(world?.summary, 2000),
      details: text(world?.details, 16000)
    },
    entries: built.entries,
    groups: buildImportGroups(built.entries, worldId),
    warnings: [...warnings, ...built.warnings],
    stats: {
      chunks: Array.isArray(extractions) ? extractions.length : 0,
      characters: Number(source.characters) || 0,
      truncated: Boolean(source.truncated),
      droppedCharacters: Number(source.droppedCharacters) || 0,
      total: built.entries.length,
      counts
    }
  };
}

// ── 落库前的复核（客户端回传的 plan） ───────────────────────────────────────

function normalizePlanValues(raw, label) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const keys = Object.keys(source);
  if (keys.length > 40) throw badRequest(`${label} 的内容块过多`);
  const values = {};
  for (const key of keys) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(key)) throw badRequest(`${label} 含非法的内容块键：${key}`);
    const value = source[key];
    if (Array.isArray(value)) values[key] = stringList(value, 24, 2000);
    else if (value === null) values[key] = null;
    else if (typeof value === 'number') { if (!Number.isFinite(value)) throw badRequest(`${label} 的 ${key} 不是有效数值`); values[key] = value; }
    else if (typeof value === 'string') { if (value.length > 16000) throw badRequest(`${label} 的 ${key} 过长`); values[key] = value.trim(); }
    else throw badRequest(`${label} 的 ${key} 类型不支持`);
  }
  return values;
}

function normalizePlanEntry(raw, worldId, now) {
  const item = plainObject(raw, '导入条目');
  const id = text(item.id, 80);
  if (!/^[A-Za-z][A-Za-z0-9-]{2,79}$/.test(id)) throw badRequest(`条目编号无效：${id || '(空)'}`);
  const type = text(item.type, 24);
  if (!LORE_IMPORT_TYPES.includes(type)) throw badRequest(`不支持的资料类型：${type || '(空)'}`);
  const name = text(item.name, LORE_IMPORT_LIMITS.name);
  if (!name) throw badRequest(`条目 ${id} 缺少名称`);
  const values = normalizePlanValues(item.values, `条目 ${id}`);
  if (!text(values.details, 16000)) throw badRequest(`条目 ${id} 缺少正文`);
  const location = item.location && typeof item.location === 'object' ? item.location : {};
  const chronicle = item.chronicle && typeof item.chronicle === 'object' ? item.chronicle : {};
  const kind = IMPORT_LOCATION_KINDS.includes(text(location.kind, 20)) ? text(location.kind, 20) : '';
  const chronicleKind = IMPORT_CHRONICLE_KINDS.includes(text(chronicle.kind, 20)) ? text(chronicle.kind, 20) : '';
  const truthScope = type === 'story' ? 'unknown' : (IMPORT_TRUTH_SCOPES.includes(text(item.truthScope, 30)) ? text(item.truthScope, 30) : 'objective');
  return {
    id,
    type,
    worldId,
    name,
    // 导入永远不产出 canon / deprecated：状态只能由作者在编辑器里另行裁定。
    status: 'proposed',
    truthScope,
    values,
    tags: type === 'story' ? [] : stringList(item.tags, LORE_IMPORT_LIMITS.tags, 24),
    relationIds: stringList(item.relationIds, LORE_IMPORT_LIMITS.relations, 80),
    location: { kind, parentId: text(location.parentId, 80), x: '', y: '', environment: text(values.environment, 2000) },
    chronicle: {
      kind: chronicleKind,
      parentId: chronicleKind === 'entry' ? text(chronicle.parentId, 80) : '',
      dateLabel: chronicleKind === 'entry' ? text(chronicle.dateLabel, 80) : '',
      order: chronicleKind === 'entry' ? finiteNumber(chronicle.order) : null
    },
    updatedAt: now
  };
}

/**
 * 校验客户端回传的导入计划（预览里被作者勾选的条目）并转成待写入的条目。
 * 与 `PUT /api/content` 不同，这里是**追加**语义：编号冲突、世界编号已存在都会拒绝。
 */
export function validateImportPlan(value, { existingEntries = [], now = () => new Date().toISOString() } = {}) {
  const plan = plainObject(value, '导入计划');
  const worldId = text(plan.worldId, 20);
  if (!/^W\d{2,}$/.test(worldId)) throw badRequest('世界编号无效（应为 W01 形式）');
  const current = Array.isArray(existingEntries) ? existingEntries : [];
  if (current.some(entry => entry?.type === 'world' && entry?.id === worldId)) throw Object.assign(badRequest(`世界编号 ${worldId} 已存在`), { status: 409 });
  if (current.some(entry => String(entry?.worldId ?? '') === worldId)) throw Object.assign(badRequest(`世界编号 ${worldId} 已被资料占用`), { status: 409 });
  const world = plan.world && typeof plan.world === 'object' ? plan.world : {};
  const name = text(world.name, 120) || `导入的世界 ${worldId}`;
  const rawEntries = Array.isArray(plan.entries) ? plan.entries : [];
  if (rawEntries.length > LORE_IMPORT_LIMITS.totalEntries) throw badRequest(`一次最多导入 ${LORE_IMPORT_LIMITS.totalEntries} 条资料`);
  const existingIds = new Set(current.map(entry => String(entry?.id ?? '')));
  const seen = new Set();
  const entries = rawEntries.map(raw => {
    const entry = normalizePlanEntry(raw, worldId, now());
    if (existingIds.has(entry.id)) throw badRequest(`条目编号 ${entry.id} 已存在`);
    if (seen.has(entry.id)) throw badRequest(`条目编号重复：${entry.id}`);
    seen.add(entry.id);
    return entry;
  });
  // 关联与被引用关系只保留指向本批次条目的部分：不存在的编号会被静默丢弃会让作者困惑，因此明确清空并回报。
  const warnings = [];
  let droppedRelationCount = 0;
  for (const entry of entries) {
    const before = entry.relationIds.length;
    entry.relationIds = entry.relationIds.filter(id => seen.has(id) && id !== entry.id);
    droppedRelationCount += before - entry.relationIds.length;
  }
  if (droppedRelationCount) warnings.push({ code: 'RELATION_DROPPED', message: `有 ${droppedRelationCount} 个关联指向未被勾选的条目，已移除` });
  const ids = new Set(entries.map(entry => entry.id));
  const chronicleOrphans = entries.filter(entry => entry.chronicle.kind === 'entry' && (!entry.chronicle.parentId || !ids.has(entry.chronicle.parentId)));
  // 只清空父级、保留 kind：节点仍被识别为节点，前端会把它列进「待整理的编年节点」，
  // 而不是把它悄悄升级成编年史容器。
  for (const entry of chronicleOrphans) entry.chronicle = { ...entry.chronicle, parentId: '' };
  if (chronicleOrphans.length) warnings.push({ code: 'CHRONICLE_ORPHAN', message: `${chronicleOrphans.length} 个纪年节点缺少同批次里的编年史容器，会显示在「待整理的编年节点」里` });
  const locationOrphans = entries.filter(entry => entry.type === 'location' && entry.location.parentId && !ids.has(entry.location.parentId));
  for (const entry of locationOrphans) entry.location = { ...entry.location, parentId: '' };
  if (locationOrphans.length) warnings.push({ code: 'LOCATION_ORPHAN', message: `${locationOrphans.length} 个地理条目缺少同批次里的上级，会显示在「待整理的地理条目」里` });
  return {
    worldId,
    world: { name, summary: text(world.summary, 2000), details: text(world.details, 16000) },
    entries,
    groups: buildImportGroups(entries, worldId),
    warnings
  };
}
