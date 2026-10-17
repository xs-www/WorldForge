import { LEGACY_GROUPS, sanitizeLoreGroup } from './lore-groups.mjs';

const block = (key, label, instruction, kind = 'string') => ({ key, label, instruction, kind });

const common = {
  name: block('name', '名称', '给出可直接使用、具有辨识度且不依赖解释的名称。'),
  summary: block('summary', '摘要', '用一段面向读者的文字说明它是什么，以及它在当前世界中的作用。'),
  details: block('details', '正文', '直接撰写可进入资料正文的内容，不写“本候选”“层次位置”“设计意图”等元说明。'),
  constraints: block('constraints', '限制与边界', '列出真实约束、成本、弱点或不可成立的条件。', 'array'),
  openQuestions: block('openQuestions', '开放问题', '只列出确实需要作者裁定、且上下文无法确定的问题。', 'array'),
  relations: block('relations', '关联建议', '只从本次上下文已有 ID 中选择确有价值的关联，并说明关系如何影响当前条目。', 'relations')
};

const attributes = (a, b, c) => [
  block('attributeA', a, `只填写“${a}”字段可直接使用的内容。`),
  block('attributeB', b, `只填写“${b}”字段可直接使用的内容。`),
  block('attributeC', c, `只填写“${c}”字段可直接使用的内容。`)
];

// 五个固定组：模块导航、编年史树、地理树和背景故事视图依赖它们的 form，不依赖具体题材。
const WORDS_WORLD = ['题材', '时代', '尺度'];
const WORDS_INFO = ['分类', '归属', '要点'];
const WORDS_CHARACTER = ['叙事身份', '年龄阶段', '种族'];
const WORDS_TIMELINE = ['时间范围', '采用历法', '叙事范围'];

const FOCUS_WORLD = '正文应从本世界的底层条件展开：世界构成、自然或超自然法则、生产、运输通信、社会分化、世界之间的关系，以及这个世界独有的边界与代价；保留尚未裁定的宇宙真相。';
const FOCUS_INFO = '只写这条世界信息自身的具体内容，让作者能据此继续拆成更细的条目；不要代替作者补完它所属的世界。';
const FOCUS_CHARACTER = '人物应能进入具体故事；不要擅自确定未经批准的身世真相。';

// 旧版十三类资料中的九个不是固定组，按下表迁移成自定义组。
// 这里的写作重点只影响生成质量，不构成「这个组必须存在」的约束。
const LEGACY_FOCUS = Object.freeze({
  location: '遵守现有父子地理层级；只写当前条目自身，不把祖先链说明写进正文，也不代替作者批量创建子级。',
  faction: '让组织具备可运行的利益、资源与弱点，避免只有口号。',
  species: '区分生物属性与文化，不把群体写成单一性格。',
  culture: '文化应随历史、迁徙和交流而变化，不是静止标签。',
  religion: '明确这是世界内信仰还是作者层事实；信徒观点不得自动成为宇宙真相。',
  magic: '写清这套力量或能力体系的来源、运作流程、学习条件、成本、失败方式与反制；不要假设它一定存在。',
  technology: '能力必须匹配这个世界的材料、能源、生产与运输条件。',
  item: '特殊能力必须有代价、使用条件和可识别边界。',
  event: '保持因果链清楚，不用巧合替代关键动机。'
});

function genericBlocks(attributeLabels, { detailsLabel = '正文' } = {}) {
  return [
    common.name,
    common.summary,
    block('details', detailsLabel, '直接撰写可进入资料正文的内容，不写“本候选”“层次位置”“设计意图”等元说明。'),
    ...attributes(...attributeLabels),
    common.constraints,
    common.openQuestions
  ];
}

export const CONTENT_SPECS = Object.freeze({
  world: { label: '世界', blocks: genericBlocks(WORDS_WORLD), focus: FOCUS_WORLD },
  info: { label: '世界信息', blocks: genericBlocks(WORDS_INFO), focus: FOCUS_INFO },
  character: { label: '角色', blocks: genericBlocks(WORDS_CHARACTER), focus: FOCUS_CHARACTER },
  timeline: {
    label: '编年史',
    blocks: [
      common.name,
      block('dateLabel', '纪年文本', '填写可直接展示的虚构纪年或不确定日期。'),
      block('order', '排序值', '填写只表示先后顺序的数值；无法判断时返回 null。', 'number'),
      common.summary,
      block('details', '史料正文', '直接撰写事件经过、因果、影响、并发关系及史料差异，不输出编年史设计说明。'),
      ...attributes(...WORDS_TIMELINE),
      common.constraints,
      common.openQuestions
    ],
    focus: '容器负责时间范围与史料口径；节点负责一条具体记录。纪年文本用于展示，排序值只用于排序。'
  },
  story: {
    label: '背景故事',
    blocks: [common.name, block('details', '故事正文', '直接写完整故事正文，以行动、场景、感官、对话和因果推进，不输出摘要或设定分析。')],
    focus: '只生成标题或故事正文；叙述中新出现的事实仍是 proposed。'
  }
});

for (const [type, spec] of Object.entries(CONTENT_SPECS)) {
  if (type !== 'story') spec.blocks.push(common.relations);
}

/** 地理树组多一个「环境与交通」字段；表单里有对应输入，正文块也要与之一致。 */
function geographySpec(group) {
  return {
    label: group?.label || LEGACY_GROUPS.location?.label || '世界地图',
    blocks: [
      common.name,
      common.summary,
      block('details', '详细设定', '直接撰写可回填到地图条目“详细设定”的完整正文，描述地貌结构、聚落与权力、资源流动、历史成因和空间关系，不复述条目层级。'),
      block('environment', '环境与交通', '简洁填写地貌、气候、资源、交通与主要危险。'),
      ...attributes(...(group?.attributes || LEGACY_GROUPS.location?.attributes || ['地理角色', '管辖主体', '人口规模'])),
      common.constraints,
      common.openQuestions,
      common.relations
    ],
    focus: LEGACY_FOCUS.location
  };
}

/**
 * 解析本次生成实际使用的内容块契约。
 * `group` 由客户端随请求提交（已清洗），用来给自定义组提供标签与三个属性名；
 * 缺省时按 type 回落到固定组或「世界信息」通用契约，绝不因为未知 type 而假装是「世界」。
 */
export function contentSpec(type = 'world', draft = {}, group = null) {
  const safeGroup = sanitizeLoreGroup(group);
  const key = String(type || '').trim();
  const spec = resolveSpec(key, safeGroup);
  if (key === 'timeline' && draft?.chronicle?.kind === 'chronicle') return { ...spec, blocks: spec.blocks.filter(item => !['dateLabel', 'order'].includes(item.key)) };
  return spec;
}

function resolveSpec(key, group) {
  const base = CONTENT_SPECS[key];
  if (base) return group && group.id === key && group.label ? { ...base, label: group.label, blocks: relabel(base.blocks, group) } : base;
  // 旧的 location 组即使客户端没有回传 group，也要保持地理表单（详细设定 + 环境与交通）。
  const legacy = LEGACY_GROUPS[key];
  if (group?.form === 'geography' || (!group && legacy?.form === 'geography')) return geographySpec(group || { ...legacy, id: key });
  return buildCustomSpec(key, group);
}

function relabel(blocks, group) {
  const labels = group.attributes || [];
  return blocks.map(item => {
    const index = ['attributeA', 'attributeB', 'attributeC'].indexOf(item.key);
    if (index < 0 || !labels[index]) return item;
    return block(item.key, labels[index], `只填写“${labels[index]}”字段可直接使用的内容。`);
  });
}

function buildCustomSpec(key, group) {
  const label = group?.label || LEGACY_GROUPS[key]?.label || (key || '世界信息');
  if (group?.form === 'story') return { ...CONTENT_SPECS.story, label };
  if (group?.form === 'chronicle') return { ...CONTENT_SPECS.timeline, label };
  return {
    label,
    // 旧类型即使客户端没有回传 group，也仍然拿到它原来的三个属性名，避免一律退化成「分类/归属/要点」。
    blocks: genericBlocks(group?.attributes || LEGACY_GROUPS[key]?.attributes || WORDS_INFO),
    focus: LEGACY_FOCUS[key] || FOCUS_INFO
  };
}

export function normalizeSelectedBlocks(type, selected, draft = {}, group = null) {
  const spec = contentSpec(type, draft, group), allowed = new Set(spec.blocks.map(item => item.key));
  const requested = Array.isArray(selected) ? selected.filter(key => allowed.has(key)) : [];
  return requested.length ? [...new Set(requested)] : spec.blocks.map(item => item.key);
}

export function blockSchema(item) {
  if (item.kind === 'array') return { type: 'array', items: { type: 'string' }, maxItems: 12 };
  if (item.kind === 'relations') return { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['id', 'reason'], properties: { id: { type: 'string' }, reason: { type: 'string' } } } };
  if (item.kind === 'number') return { type: ['number', 'null'] };
  return { type: 'string' };
}
