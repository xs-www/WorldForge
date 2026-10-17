import { fallbackGroup, fieldSchema as loreFieldSchema, sanitizeLoreGroup } from './lore-groups.mjs';

// 内容块契约不再由产品写死：默认取「该资料组自己的字段」，只有请求没带组时才回落到
// 固定组的默认字段。因此作者可以给一个组只留名称与详细设定，也可以加任意块。
const NAME_BLOCK = { key: 'name', label: '名称', kind: 'string', instruction: '给出可直接使用、具有辨识度且不依赖解释的名称。' };
const DETAILS_BLOCK = { key: 'details', label: '详细设定', kind: 'string', instruction: '直接撰写可进入条目正文的内容：写清事实、运作方式、因果与边界，不写“本候选”“设计意图”等元说明。' };
const RELATIONS_BLOCK = { key: 'relations', label: '关联建议', kind: 'relations', instruction: '只从本次上下文已有 ID 中选择确有价值的关联，并说明关系如何影响当前条目。' };
const KIND_TO_BLOCK = { text: 'string', multiline: 'string', lines: 'array', number: 'number' };
const KIND_INSTRUCTION = {
  text: '只填写可直接展示的单行内容。',
  multiline: '直接撰写可进入资料正文的内容，不写“本候选”“层次位置”“设计意图”等元说明。',
  lines: '每行一项，只写真实成立的条目，不要为了填满而编造。',
  number: '只填写数值；无法判断时返回 null。'
};

function fieldToBlock(item) {
  return { key: item.key, label: item.label, kind: KIND_TO_BLOCK[item.kind] || 'string', instruction: item.hint || KIND_INSTRUCTION[item.kind] || KIND_INSTRUCTION.text };
}

/**
 * 解析本次生成实际使用的内容块契约。
 * `group` 由客户端随请求提交（已清洗，含字段列表与提示），缺省时回落到该 type 的固定组默认字段。
 */
export function contentSpec(type = 'world', draft = {}, group = null) {
  const safe = sanitizeLoreGroup(group);
  const base = safe || fallbackGroup(type);
  const story = base.form === 'story';
  // 「名称」与「详细设定」是每个条目内置的两块，其余来自组字段
  const blocks = [NAME_BLOCK, DETAILS_BLOCK, ...base.fields.map(fieldToBlock)];
  if (!story) blocks.push(RELATIONS_BLOCK);
  return {
    label: base.label,
    form: base.form,
    prompt: base.prompt || '',
    fields: base.fields,
    blocks,
    focus: base.prompt || (base.form === 'story' ? '只生成标题或故事正文；叙述中新出现的事实仍是 proposed。' : '只写这个资料组关心的内容，不要替作者补完它所属的世界。')
  };
}

export function normalizeSelectedBlocks(type, selected, draft = {}, group = null) {
  const spec = contentSpec(type, draft, group), allowed = new Set(spec.blocks.map(item => item.key));
  const requested = Array.isArray(selected) ? selected.filter(key => allowed.has(key)) : [];
  return requested.length ? [...new Set(requested)] : spec.blocks.map(item => item.key);
}

/** 字段类型 → JSON Schema 片段；与浏览器侧 `groupResponseSchema` 同源。 */
export function blockSchema(item) {
  if (item.kind === 'array') return { type: 'array', items: { type: 'string' }, maxItems: 12 };
  if (item.kind === 'relations') return { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['id', 'reason'], properties: { id: { type: 'string' }, reason: { type: 'string' } } } };
  if (item.kind === 'number') return { type: ['number', 'null'] };
  return { type: 'string' };
}

export { loreFieldSchema };
