import { previewOf } from './ai-harness.mjs';
import { normalizeModelOutput, repairsApplied } from './model-json-normalizer.mjs';
import { LEGACY_GROUPS, MAX_LORE_GROUPS, sanitizeLoreGroup } from './lore-groups.mjs';

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

export const LORE_IMPORT_TYPES = Object.freeze(['character', 'location', 'timeline', 'story', 'info', 'misc']);

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
  entriesPerChunk: 16,
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
const ID_PREFIX = Object.freeze({ character: 'CHR', location: 'LOC', timeline: 'EVT', story: 'STY', info: 'INF', misc: 'SET' });

/** 模型在非结构化降级时可能写中文类型名，这里收敛到封闭集合。 */
const TYPE_ALIASES = Object.freeze({
  character: ['character', '角色', '人物', '主角', '配角'],
  location: ['location', '地点', '地理', '地名', '地图', '大陆', '国家', '城市', '区域', 'place'],
  timeline: ['timeline', '编年史', '时间线', '年表', '纪年', '大事记', 'chronicle'],
  story: ['story', '背景故事', '故事', '传说', '歌谣', '书信', 'legend'],
  misc: ['misc', '设定', '未分组', '未分类', '其他', '其它'],
  info: ['info', '世界信息', '势力', '组织', 'faction', '种族', 'species', '文化', 'culture', '宗教', 'religion', '信仰', '力量体系', '魔法', 'magic', '技术', 'technology', '科技', '物品', 'item', '事件', 'event', 'artifact']
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

// 抽取字段的机器可读清单：记录格式的字段名、别名与类型都以这里为准。
// 注意：导入入口**不再**向模型发送 json_schema（ADR-0033 §10），字段契约写在提示词第 5 层，
// 模型输出由 model-json-normalizer.mjs 统一规范化。
export const IMPORT_RECORD_FIELDS = Object.freeze([
  { key: 'type', labels: ['类型', '条目类型'], kind: 'text' },
  { key: 'name', labels: ['名称', '名字', '标题'], kind: 'text' },
  { key: 'summary', labels: ['概述', '摘要', '一句话概述'], kind: 'text' },
  { key: 'details', labels: ['正文', '详细设定', '内容'], kind: 'text' },
  { key: 'attributeA', labels: ['属性一', '要点一', '第一条要点'], kind: 'text' },
  { key: 'attributeB', labels: ['属性二', '要点二', '归属'], kind: 'text' },
  { key: 'attributeC', labels: ['属性三', '要点三'], kind: 'text' },
  { key: 'constraints', labels: ['约束', '限制', '限制与边界'], kind: 'lines' },
  { key: 'openQuestions', labels: ['开放问题', '待定'], kind: 'lines' },
  { key: 'tags', labels: ['标签'], kind: 'lines' },
  { key: 'relations', labels: ['关联', '关联条目'], kind: 'lines' },
  { key: 'locationKind', labels: ['地理层级'], kind: 'text' },
  { key: 'locationParent', labels: ['上级'], kind: 'text' },
  { key: 'chronicleKind', labels: ['编年史类型'], kind: 'text' },
  { key: 'chronicleParent', labels: ['所属编年史'], kind: 'text' },
  { key: 'dateLabel', labels: ['纪年'], kind: 'text' },
  { key: 'order', labels: ['排序', '排序值'], kind: 'number' },
  { key: 'truthScope', labels: ['事实层次', '事实层次/视角'], kind: 'text' },
  { key: 'category', labels: ['分类', '类别', '资料组'], kind: 'text' }
]);

/** 第 4–6 层提示词：作者风格（4）→ 本次任务与输出契约（5）→ 原文（6）。 */
export function buildImportPrompt(options = {}) {
  const index = Math.max(0, Number(options.index) || 0);
  const total = Math.max(1, Number(options.total) || 1);
  const personalized = text(options.personalizedPrompt, 8000) || '无额外统一风格要求';
  const instruction = text(options.instruction, 300);
  const source = String(options.text ?? '');
  // 原文属于不可信上下文：只可能撑破标签，因此把闭合标签打断，避免它伪装成新的指令段。
  const guarded = source.replace(/<\/worldforge_import_source/gi, '< /worldforge_import_source');
  const taskRequest = `最高优先级：直接输出记录格式，不要输出思考过程、分析、计划或英文说明。你的回答第一个字符必须是「@」（第一行就是「@@ 世界」）。
任务：把下面这段原创世界设定原文整理成资料库条目，供作者逐条确认后写入一个新建的世界。
本段是原文的第 ${index + 1}/${total} 段；只整理本段出现的信息，不要为了连贯而补写其它段落的内容，同名同类型的条目会由系统自动合并。
整理规则：
- 只使用原文明确写出的信息。可以归纳、分段、改写成通顺正文，但不得新增原文没有的事实、数字、名称、关系、年代或机制。
- 原文没交代但整理时确实需要作者裁定的地方，只能写进 openQuestions，不能当作已知事实写进正文。
- 一条条目只讲一个对象（一个人、一个地点、一个势力、一个事件……）；同一对象的分散描述必须合并成一条。
- 目标类型只有五种：character 角色、location 地理条目、timeline 编年史、story 背景故事、info 其它设定。势力、种族、文化、宗教、力量体系、技术、物品、事件等一律用 info，并在「分类」里写它的类别名（如「势力」「技术体系」「物品」「事件」）；分类会决定条目归入哪个资料组，系统按分类名自动复用或新建资料组，没有分类的条目进「设定」组。原文里有独立的传说、歌谣、书信或短篇叙述时用 story。
- name 必须是原文出现的专名；没有专名时用原文的描述性称呼，不要自行造名。
- details 直接写可进入条目正文的成品文字，保留作者的措辞、自造词与口吻；禁止出现“原文提到”“本条目”“以上内容”“设计说明”“字段说明”等元话语。
- 地理层级只能是 ${IMPORT_LOCATION_KINDS.join(' / ')}；只有在原文能看出上下级关系时才填上级。
- 年表要先有容器（编年史类型=chronicle 的 timeline 条目），再有节点（编年史类型=entry，写所属编年史与纪年、排序）；没有年表就不要产出 timeline。
- 世界本身不要写成条目，把世界名称与概述写进「世界」段落。
- 原文以世界内传说、教义、宣传或不可靠叙述者口吻出现的内容，事实层次用 in_world_belief；原文自称不确定或互相矛盾的用 unknown；其余用 objective。
- 不要引用任何商业 IP 的专有角色、地名、故事、标志或规则组合。
${instruction ? `作者补充要求：${instruction}\n` : ''}输出格式：按下面的**记录格式**写，不要写 JSON，也不要写解释文字或 Markdown 代码围栏。
先写一段世界信息，再逐条写条目；条目之间用单独一行「@@ 条目」分隔：

@@ 世界
名称：（原文里的世界名称，没有就留空）
概述：（不超过 300 字的世界概述，没有就留空）
正文：（本段对世界的整体描述，没有就留空）

@@ 条目
类型：（只能是 character / location / timeline / story / info）
名称：（原文里的专名）
概述：（一句话概述）
正文：（可进入条目正文的成品文字）
属性一：（info 条目填分类，如「势力」「技术体系」；其它类型可留空）
属性二：（如所属势力、地区）
属性三：（最关键的要点）
分类：（info 条目必填：势力 / 种族 / 文化 / 宗教 / 力量体系 / 技术体系 / 物品 / 事件 等，决定归入哪个资料组；其它类型留空）
约束：（原文明确写出的限制与代价）
开放问题：（原文没交代、需要作者裁定的缺口）
标签：（关键词）
关联：（原文里与它确有关系的其它条目名称，只写名称）
地理层级：（continent / country / region / area / city / site / route，不是地理条目就留空）
上级：（原文里的上级地理条目名称）
编年史类型：（chronicle 容器 / entry 节点 / 空）
所属编年史：（节点所属的编年史名称）
纪年：（原文里的纪年文本）
排序：（同一编年史内从 1 开始，不确定就留空）
事实层次：（objective / in_world_belief / unknown）

写法约定：
- 字段每行一个，写成「字段名：内容」，冒号中英文都行；没有内容的字段留空或整行省略，不要写「无」「未知」之类占位。
- 概述、正文可以自然多行：从字段名后面开始写，直到下一个字段名或下一个「@@」段落。
- 约束、开放问题、标签、关联每行一项，用「- 」开头；也可以在一行里用顿号分隔。
- 本段最多整理 ${LORE_IMPORT_LIMITS.entriesPerChunk} 条，单条正文建议控制在 1500 字以内；宁可少而准，不要为凑数拆分同一对象。`;
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
      truthScope: type === 'story' ? 'unknown' : truthScope,
      // 分类只对 info 有意义：它决定条目最后进哪个资料组（见 buildImportPlan 的类型解析）。
      category: type === 'info' ? text(source.category, 60) : ''
    }
  };
}

/**
 * 记录格式 → 抽取外壳。与 JSON 相比它不需要转义：正文可以自然换行，
 * 列表可以自然分行；模型只负责写清楚内容，转成结构化数据由规范化层负责。
 */
function envelopeFromRecord(sections) {
  const world = { name: '', summary: '', details: '' };
  const entries = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const kind = String(section?.section ?? '');
    const fields = section?.fields && typeof section.fields === 'object' ? section.fields : {};
    if (/世界/.test(kind) && !/条目/.test(kind)) {
      if (!world.name && fields.name) world.name = fields.name;
      if (!world.summary && fields.summary) world.summary = fields.summary;
      if (fields.details) world.details = world.details ? `${world.details}\n\n${fields.details}` : fields.details;
      continue;
    }
    if (Object.keys(fields).length) entries.push(fields);
  }
  return { world, entries };
}

/**
 * 收敛单段模型输出。解析 agent 只负责识别、抽离、建立条目；把它写下来的内容变成
 * 结构化数据是 `model-json-normalizer.mjs` 的职责：
 * - 模型照记录格式写 → 由记录格式解析器读成对象；
 * - 模型仍写了 JSON（有语法缺陷也算）→ 由 JSON 修复器尽量救回。
 * 语法/外壳问题只记 issue、不抛错：一段失败不该让整次导入白跑；全部段落失败才整体报错。
 * 修复动作与模型原文片段都会带进 issue，作者能在对话框里看到发生了什么。
 */
export function normalizeExtraction(raw, options = {}) {
  const chunk = options.chunkIndex ?? 0;
  if (typeof raw === 'string' && !raw.trim()) {
    return { world: { name: '', summary: '', details: '' }, entries: [], issues: [{ code: 'EMPTY_RESPONSE', message: '模型返回了空内容（可能被输出上限截断，或接口没有把内容放在 content 字段）', preview: '', chunk }] };
  }
  const normalized = typeof raw === 'string'
    ? normalizeModelOutput(raw, { fields: IMPORT_RECORD_FIELDS, sectionField: 'section' })
    : { format: 'value', value: raw, repairs: {} };
  if (!normalized) {
    return { world: { name: '', summary: '', details: '' }, entries: [], issues: [{ code: 'INVALID_OUTPUT', message: '模型输出既不是记录格式也不是可修复的 JSON', preview: previewOf(raw), chunk }] };
  }
  const value = normalized.format === 'record' ? envelopeFromRecord(normalized.sections) : normalized.value;
  const envelope = coerceExtraction(value);
  if (!envelope) {
    return { world: { name: '', summary: '', details: '' }, entries: [], issues: [{ code: 'INVALID_ENVELOPE', message: '返回值既不是 {world, entries} 也不是条目数组', preview: previewOf(value), chunk }] };
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
    else issues.push({ code: 'ENTRY_DROPPED', message: `第 ${index + 1} 条被丢弃：${result.reason}`, preview: previewOf(candidate, 200), chunk });
  });
  return { world, entries, issues, format: normalized.format, repairs: normalized.repairs, repaired: repairsApplied(normalized.repairs) };
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

/** 分类名归一：去空白、去「资料组/组」后缀，用于把模型写的类别匹配到已有组。 */
function categoryKey(value) {
  return String(value ?? '').replace(/[\s\u3000]/g, '').replace(/(资料组|条目组|组)$/u, '').toLowerCase();
}

/** 中文分类无法 slug 化，用确定性短哈希生成稳定 id（cat-xxxx），同一分类永远同一 id。 */
function categoryGroupId(label) {
  let hash = 5381;
  for (const char of String(label)) hash = ((hash * 33) ^ char.codePointAt(0)) >>> 0;
  return `cat-${hash.toString(36).slice(0, 8)}`;
}

/**
 * 把模型写的「分类」落到一个资料组：
 * 1. 已有组的 id / 标签精确匹配 → 复用；
 * 2. 旧类型（势力 / 力量体系 / 技术体系 / 物品 / 事件 / 种族 / 文化 / 宗教）按稳定 legacy id 复用；
 * 3. 都没有 → 为当前世界新建一个通用组（标签就是分类名）。
 * 返回 `{type, group}`，group 为需要新建的组（复用已有组时为 null）。
 */
function resolveCategoryType(category, groups, created, worldId, warnings) {
  const key = categoryKey(category);
  if (!key) return { type: 'misc', group: null };
  const pool = [...groups, ...created];
  const byId = pool.find(group => String(group.id).toLowerCase() === key);
  if (byId) return { type: byId.id, group: null };
  const byLabel = pool.find(group => categoryKey(group.label) === key);
  if (byLabel) return { type: byLabel.id, group: null };
  for (const [id, legacy] of Object.entries(LEGACY_GROUPS)) {
    if (categoryKey(id) !== key && categoryKey(legacy.label) !== key) continue;
    if (groups.some(group => group.id === id)) return { type: id, group: null };
    if (groups.length + created.length >= MAX_LORE_GROUPS) break;
    const group = sanitizeLoreGroup({ id, worldId, label: legacy.label, form: legacy.form, fields: legacy.defaultFields });
    if (group) { created.push(group); return { type: id, group } }
  }
  if (groups.length + created.length >= MAX_LORE_GROUPS) {
    warnings.push({ code: 'GROUP_LIMIT_REACHED', message: `自定义资料组已达上限 ${MAX_LORE_GROUPS}，「${category}」的条目先放进「设定」组` });
    return { type: 'misc', group: null };
  }
  const id = categoryGroupId(category);
  const existing = groups.find(group => group.id === id);
  if (existing) return { type: id, group: null };
  const group = sanitizeLoreGroup({ id, worldId, label: category, form: 'generic', fields: [] });
  if (!group) { warnings.push({ code: 'GROUP_INVALID', message: `分类「${category}」无法生成有效资料组，条目放进「设定」组` }); return { type: 'misc', group: null } }
  created.push(group);
  return { type: id, group };
}

/**
 * 汇总一次解析结果：分配世界编号、解析条目分类、跳过已存在的条目、改写条目并统计。
 * - `existingEntries`：当前内容库里的全部条目（编号避让 + 目标世界内重复检测）。
 * - `existingGroups`：当前全部资料组视图（分类解析与复用）。
 * 重复检测只看**目标世界内同类型 + 同名**的条目：这样「第一次导入漏了几条、再导一次」不会
 * 产生重复，而不同世界里的同名条目仍然可以各自存在。
 */
export function buildImportPlan({ worldId, world, entries, warnings = [], extractions = [], source = {}, existingEntries = [], existingGroups = [], now } = {}) {
  const existingIds = (Array.isArray(existingEntries) ? existingEntries : []).map(entry => String(entry?.id ?? '')).filter(Boolean);
  const groups = Array.isArray(existingGroups) ? existingGroups : [];
  const createdGroups = [];
  const duplicates = [];
  const resolved = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    let type = entry.type;
    if (type === 'info') {
      const category = String(entry.category || '').trim();
      if (!category) { type = 'misc' }
      else {
        const result = resolveCategoryType(category, groups, createdGroups, worldId, warnings);
        type = result.type;
      }
    }
    resolved.push({ ...entry, type });
  }
  const existingByName = new Map((Array.isArray(existingEntries) ? existingEntries : [])
    .filter(entry => entry && entry.type !== 'world' && String(entry.worldId || '') === worldId)
    .map(entry => [`${entry.type}|${nameKey(entry.name)}`, entry]));
  const fresh = [];
  for (const entry of resolved) {
    const key = `${entry.type}|${nameKey(entry.name)}`;
    const existing = existingByName.get(key);
    if (existing) { duplicates.push({ type: entry.type, name: entry.name, existingId: existing.id }); continue; }
    existingByName.set(key, entry);
    fresh.push(entry);
  }
  if (duplicates.length) {
    const names = duplicates.slice(0, 5).map(item => item.name).join('、');
    warnings.push({ code: 'DUPLICATES_SKIPPED', message: `跳过 ${duplicates.length} 条库里已有的条目（同类型同名）：${names}${duplicates.length > 5 ? ' 等' : ''}` });
  }
  const built = buildLoreEntries(fresh, { worldId, existingIds: [worldId, ...existingIds], now });
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
    groups: createdGroups,
    duplicates,
    warnings: [...warnings, ...built.warnings],
    stats: {
      chunks: Array.isArray(extractions) ? extractions.length : 0,
      characters: Number(source.characters) || 0,
      truncated: Boolean(source.truncated),
      droppedCharacters: Number(source.droppedCharacters) || 0,
      total: built.entries.length,
      duplicates: duplicates.length,
      createdGroups: createdGroups.map(group => group.label),
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
  // 类型可以是内置的六种，也可以是分类解析后新建 / 复用的资料组 id（如 faction、cat-xxx）。
  const customGroupId = /^[a-z][a-z0-9_-]{0,31}$/.test(type) && type !== 'world';
  if (!LORE_IMPORT_TYPES.includes(type) && !customGroupId) throw badRequest(`不支持的资料类型：${type || '(空)'}`);
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
 * 默认是「新建世界」语义：编号冲突、世界编号已存在都会拒绝。
 * 传 `intoWorld` 则改为「并入已有世界」：世界编号必须等于它，且不再检查编号是否空闲。
 */
export function validateImportPlan(value, { existingEntries = [], now = () => new Date().toISOString(), intoWorld = '' } = {}) {
  const plan = plainObject(value, '导入计划');
  const target = text(intoWorld, 20);
  let worldId = text(plan.worldId, 20);
  if (target) {
    if (worldId && worldId !== target) throw badRequest('导入计划的目标世界与请求不一致');
    worldId = target;
  }
  if (!/^W\d{2,}$/.test(worldId)) throw badRequest('世界编号无效（应为 W01 形式）');
  const current = Array.isArray(existingEntries) ? existingEntries : [];
  if (!target) {
    if (current.some(entry => entry?.type === 'world' && entry?.id === worldId)) throw Object.assign(badRequest(`世界编号 ${worldId} 已存在`), { status: 409 });
    if (current.some(entry => String(entry?.worldId ?? '') === worldId)) throw Object.assign(badRequest(`世界编号 ${worldId} 已被资料占用`), { status: 409 });
  }
  const world = plan.world && typeof plan.world === 'object' ? plan.world : {};
  const name = text(world.name, 120) || `导入的世界 ${worldId}`;
  const rawEntries = Array.isArray(plan.entries) ? plan.entries : [];
  if (rawEntries.length > LORE_IMPORT_LIMITS.totalEntries) throw badRequest(`一次最多导入 ${LORE_IMPORT_LIMITS.totalEntries} 条资料`);
  const existingIds = new Set(current.map(entry => String(entry?.id ?? '')));
  const existingNames = new Map(current
    .filter(entry => entry && entry.type !== 'world' && String(entry.worldId || '') === worldId)
    .map(entry => [`${entry.type}|${nameKey(entry.name)}`, entry]));
  const seen = new Set();
  const duplicates = [];
  const entries = [];
  for (const raw of rawEntries) {
    const entry = normalizePlanEntry(raw, worldId, now());
    // 同一批里重复出现同一编号属于客户端结构错误，直接拒绝，不当作「重复条目」静默跳过。
    if (seen.has(entry.id)) throw badRequest(`条目编号重复：${entry.id}`);
    const nameKeyOfEntry = `${entry.type}|${nameKey(entry.name)}`;
    // 二次导入保护优先于「编号是否已被占用」：预览之后库里可能已经有了同名同类型的条目，
    // 这时 plan 里的编号很可能已过期，直接 409 会挡住「补导」。
    const clash = existingNames.get(nameKeyOfEntry);
    if (clash) { duplicates.push({ type: entry.type, name: entry.name, existingId: clash.id }); continue; }
    if (existingIds.has(entry.id)) throw badRequest(`条目编号 ${entry.id} 已存在`);
    seen.add(entry.id);
    existingNames.set(nameKeyOfEntry, entry);
    entries.push(entry);
  }
  // 关联与被引用关系只保留指向本批次条目的部分：不存在的编号会被静默丢弃会让作者困惑，因此明确清空并回报。
  const warnings = [];
  let droppedRelationCount = 0;
  for (const entry of entries) {
    const before = entry.relationIds.length;
    entry.relationIds = entry.relationIds.filter(id => seen.has(id) && id !== entry.id);
    droppedRelationCount += before - entry.relationIds.length;
  }
  if (droppedRelationCount) warnings.push({ code: 'RELATION_DROPPED', message: `有 ${droppedRelationCount} 个关联指向未被勾选的条目，已移除` });
  if (duplicates.length) warnings.push({ code: 'DUPLICATES_SKIPPED', message: `有 ${duplicates.length} 条资料在保存前已存在于该世界（${duplicates.slice(0, 5).map(item => item.name).join('、')}${duplicates.length > 5 ? ' 等' : ''}），已跳过` });
  const ids = new Set(entries.map(entry => entry.id));
  const chronicleOrphans = entries.filter(entry => entry.chronicle.kind === 'entry' && (!entry.chronicle.parentId || !ids.has(entry.chronicle.parentId)));
  // 只清空父级、保留 kind：节点仍被识别为节点，前端会把它列进「待整理的编年节点」，
  // 而不是把它悄悄升级成编年史容器。
  for (const entry of chronicleOrphans) entry.chronicle = { ...entry.chronicle, parentId: '' };
  if (chronicleOrphans.length) warnings.push({ code: 'CHRONICLE_ORPHAN', message: `${chronicleOrphans.length} 个纪年节点缺少同批次里的编年史容器，会显示在「待整理的编年节点」里` });
  const locationOrphans = entries.filter(entry => entry.type === 'location' && entry.location.parentId && !ids.has(entry.location.parentId));
  for (const entry of locationOrphans) entry.location = { ...entry.location, parentId: '' };
  if (locationOrphans.length) warnings.push({ code: 'LOCATION_ORPHAN', message: `${locationOrphans.length} 个地理条目缺少同批次里的上级，会显示在「待整理的地理条目」里` });
  // 新组随计划回传：只接受与目标世界一致、且确实被条目引用的组，数量受全局上限约束。
  const usedTypes = new Set(entries.map(entry => entry.type));
  const groups = [];
  for (const raw of Array.isArray(plan.groups) ? plan.groups : []) {
    if (groups.length + 1 > MAX_LORE_GROUPS) break;
    const group = sanitizeLoreGroup({ ...(raw && typeof raw === 'object' ? raw : {}), worldId });
    if (!group || !usedTypes.has(group.id) || groups.some(item => item.id === group.id)) continue;
    groups.push(group);
  }
  return {
    worldId,
    world: { name, summary: text(world.summary, 2000), details: text(world.details, 16000) },
    entries,
    groups,
    duplicates,
    warnings
  };
}
