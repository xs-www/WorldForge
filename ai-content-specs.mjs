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

export const CONTENT_SPECS = Object.freeze({
  world: { label: '世界', blocks: [common.name, common.summary, common.details, ...attributes('题材', '时代', '尺度'), common.constraints, common.openQuestions], focus: '正文应从能源与自然法则、生产、运输通信、社会分化、世界间关系和神性干涉边界展开，保留尚未裁定的宇宙真相。' },
  location: { label: '世界地图', blocks: [common.name, common.summary, block('details', '详细设定', '直接撰写可回填到地图条目“详细设定”的完整正文，描述地貌结构、聚落与权力、资源流动、历史成因和空间关系，不复述条目层级。'), block('environment', '环境与交通', '简洁填写地貌、气候、资源、交通与主要危险。'), ...attributes('地理角色', '管辖主体', '人口规模'), common.constraints, common.openQuestions], focus: '遵守现有父子地理层级；只写当前条目自身，不把祖先链说明写进正文，也不代替作者批量创建子级。' },
  faction: { label: '势力', blocks: [common.name, common.summary, block('details', '组织正文', '直接描述目标、成员基础、资源、组织方式、内部矛盾、外部关系和当前行动。'), ...attributes('势力类型', '领导者', '总部'), common.constraints, common.openQuestions], focus: '让组织具备可运行的利益、资源与弱点，避免只有口号。' },
  character: { label: '角色', blocks: [common.name, common.summary, block('details', '人物正文', '直接描述经历、欲望、选择、能力边界、关系与正在面对的冲突。'), ...attributes('叙事身份', '年龄阶段', '种族'), common.constraints, common.openQuestions], focus: '人物应能进入具体故事；不要擅自确定未经批准的身世真相。' },
  species: { label: '种族', blocks: [common.name, common.summary, block('details', '种族正文', '直接描述身体或精神特征、寿命繁衍、环境适应、内部差异和群体互动。'), ...attributes('起源', '寿命', '核心特征'), common.constraints, common.openQuestions], focus: '区分生物属性与文化，不把群体写成单一性格。' },
  culture: { label: '文化', blocks: [common.name, common.summary, block('details', '文化正文', '直接描述语言、生产生活、审美教育、权力关系、地域差异与传播变化。'), ...attributes('主要地区', '语言', '核心习俗'), common.constraints, common.openQuestions], focus: '文化应随历史、迁徙和交流而变化，不是静止标签。' },
  religion: { label: '宗教', blocks: [common.name, common.summary, block('details', '信仰正文', '直接描述教义、仪式、伦理、组织实践、派别分歧与社会作用。'), ...attributes('崇拜对象', '核心教义', '组织形态'), common.constraints, common.openQuestions], focus: '明确这是世界内信仰还是作者层事实；信徒观点不得自动成为宇宙真相。' },
  magic: { label: '魔法', blocks: [common.name, common.summary, block('details', '魔法正文', '直接描述力量来源、施展流程、学习条件、效果、失败方式与反制。'), ...attributes('力量来源', '施展成本', '硬性限制'), common.constraints, common.openQuestions], focus: '遵守能量守恒，写清成本、限制、失败与反制。' },
  technology: { label: '科技', blocks: [common.name, common.summary, block('details', '技术正文', '直接描述原理、材料、制造维护、基础设施、使用者与社会影响。'), ...attributes('成熟度', '能源', '社会影响'), common.constraints, common.openQuestions], focus: '能力必须匹配世界的生产、能源和运输条件。' },
  item: { label: '物品', blocks: [common.name, common.summary, block('details', '物品正文', '直接描述外观材料、来源、制造或持有、用途、维护、流转经历与叙事价值。'), ...attributes('物品类型', '持有者', '当前状态'), common.constraints, common.openQuestions], focus: '特殊能力必须有代价、使用条件和可识别边界。' },
  event: { label: '事件', blocks: [common.name, common.summary, block('details', '事件正文', '按前因、参与者行动、过程、直接结果、长期影响与不同立场叙述事件。'), ...attributes('发生时间', '发生地点', '参与者'), common.constraints, common.openQuestions], focus: '保持因果链清楚，不用巧合替代关键动机。' },
  timeline: { label: '编年史', blocks: [common.name, block('dateLabel', '纪年文本', '填写可直接展示的虚构纪年或不确定日期。'), block('order', '排序值', '填写只表示先后顺序的数值；无法判断时返回 null。', 'number'), common.summary, block('details', '史料正文', '直接撰写事件经过、因果、影响、并发关系及史料差异，不输出编年史设计说明。'), ...attributes('时间范围', '采用历法', '叙事范围'), common.constraints, common.openQuestions], focus: '容器负责时间范围与史料口径；节点负责一条具体记录。纪年文本用于展示，排序值只用于排序。' },
  story: { label: '背景故事', blocks: [common.name, block('details', '故事正文', '直接写完整故事正文，以行动、场景、感官、对话和因果推进，不输出摘要或设定分析。')], focus: '只生成标题或故事正文；叙述中新出现的事实仍是 proposed。' }
});

for (const [type, spec] of Object.entries(CONTENT_SPECS)) {
  if (type !== 'story') spec.blocks.push(common.relations);
}

export function contentSpec(type = 'world', draft = {}) {
  const spec = CONTENT_SPECS[type] || CONTENT_SPECS.world;
  if (type !== 'timeline' || draft?.chronicle?.kind !== 'chronicle') return spec;
  return { ...spec, blocks: spec.blocks.filter(item => !['dateLabel', 'order'].includes(item.key)) };
}

export function normalizeSelectedBlocks(type, selected, draft = {}) {
  const spec = contentSpec(type, draft), allowed = new Set(spec.blocks.map(item => item.key));
  const requested = Array.isArray(selected) ? selected.filter(key => allowed.has(key)) : [];
  return requested.length ? [...new Set(requested)] : spec.blocks.map(item => item.key);
}

export function blockSchema(item) {
  if (item.kind === 'array') return { type: 'array', items: { type: 'string' }, maxItems: 12 };
  if (item.kind === 'relations') return { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['id', 'reason'], properties: { id: { type: 'string' }, reason: { type: 'string' } } } };
  if (item.kind === 'number') return { type: ['number', 'null'] };
  return { type: 'string' };
}
