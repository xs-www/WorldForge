export const PROMPT_TYPE_KEYS = ['world', 'location', 'faction', 'character', 'species', 'culture', 'religion', 'magic', 'technology', 'item', 'event', 'timeline', 'story'];
export const IMAGE_PROMPT_KEYS = ['card', ...PROMPT_TYPE_KEYS, 'other'];

export const DEFAULT_TYPE_PROMPTS = Object.freeze({
  world: '从世界的底层条件出发：世界构成、能源、生产、运输、通信、社会分化与神性干涉边界。优先形成可继续拆分为国家、文明和事件的框架，不一次填满所有空白。',
  location: '把地理条目放入明确的世界与父级层次，说明地貌、气候、资源、人口、交通、控制关系及其形成原因。世界先拆分为大陆，国家归属大陆，城市与地点继续沿祖先链向上追溯，不把行政层级平铺。',
  faction: '说明势力的目标、成员基础、资源、组织方式、影响范围、内部矛盾、外部关系与可被反制的弱点。避免只有名称和口号而没有实际运行逻辑。',
  character: '从人物经历、欲望、选择、能力边界、人际关系和正在面对的具体冲突展开。让人物能够进入故事，但不要替作者确定未经批准的身世真相。',
  species: '说明种族的起源层次、身体或精神特征、寿命、繁衍、环境适应、社会差异及与其他群体的互动。避免把文化和生物属性简单等同。',
  culture: '说明语言、习俗、生产生活、审美、教育、权力关系、地域差异及文化传播方式。文化应随历史和交流变化，而不是静止标签。',
  religion: '明确区分世界内信仰、教义解释、组织实践与作者层客观事实。说明仪式、伦理、权力结构、分歧和社会作用，不把信徒观点自动视为宇宙真相。',
  magic: '说明力量来源、施展流程、成本、限制、失败方式、学习条件与反制手段。遵守能量守恒，避免免费能量、无限神力或无条件万能魔法。',
  technology: '说明技术所需能源、材料、制造能力、维护成本、成熟度、基础设施、使用者和社会影响。技术能力必须与世界生产和运输条件相匹配。',
  item: '说明物品的来源、材料、制造者或持有者、用途、限制、维护方式、流转经历及叙事价值。特殊能力必须有代价与边界。',
  event: '说明事件的时间、地点、参与者、前因、过程、直接结果、长期影响及不同立场的解释。保持因果链清楚，不用巧合替代关键动机。',
  timeline: '以编年史方式组织记录：区分编年史容器与具体节点，为节点提供纪年文本和可排序的先后值，并说明事件、因果、并发、持续时间、影响与史料不确定性。不要为填满年代而制造未经支持的重大事件。',
  story: '只创作标题与完整故事正文，从传记、轶事、局部事件或具体场景切入，以行动、感官、对话和因果推进。不要输出摘要、标签、约束、开放问题或设定分析。'
});

export const DEFAULT_VISUAL_STYLE_PROMPT = '保持同一世界中的材质、工艺、服装、建筑和色彩语言一致；优先依据已提供设定，不把模型临时补充的细节视为正史；使用原创视觉表达，不模仿特定商业 IP 或在世艺术家的辨识性风格。';

export const DEFAULT_IMAGE_PROMPTS = Object.freeze({
  card:'以清晰主体、可读轮廓和环境叙事构成策略卡牌插画；突出卡牌身份与能力意象，画面比例约 3:2。',
  world:'制作世界级概念图，表现核心自然条件、文明尺度和视觉母题，避免把全部文明挤进一张百科拼贴。',
  location:'制作环境概念图，表现地貌、气候、建筑、交通、资源与尺度关系；地点必须符合其祖先地理与所属世界。',
  faction:'制作势力视觉原型，表现成员、组织功能、资源与活动环境；标志和制服只作为 proposed 候选。',
  character:'制作人物视觉原型，优先表现身份、年龄、体态、服装材料、工具、处境和关系线索；保持脸部与轮廓清晰。',
  species:'制作种族视觉原型，区分生物特征与文化装束，表现环境适应和个体差异，避免单一刻板模板。',
  culture:'制作文化生活场景，表现生产、服饰、饮食、仪式、空间和社会差异，不把文化简化为装饰纹样。',
  religion:'制作宗教实践或圣所概念图，区分信仰象征与作者层客观事实，不把神学图像自动视为真实神貌。',
  magic:'制作魔法现象概念图，表现施展流程、能量来源、代价、限制和环境反馈，避免无来源的万能光效。',
  technology:'制作技术或工业系统概念图，清楚表现材料、能源、结构、维护接口、使用者和生产条件。',
  item:'制作物品设定图，突出外形、材料、尺度、磨损、功能结构和持有者痕迹，使用干净且可辨识的构图。',
  event:'制作事件场景概念图，聚焦一个关键时刻、参与者行动、地点条件与因果后果，不做无重点的群像堆叠。',
  timeline:'制作编年史视觉辅助，选取明确时代切片或史料式场景，不把多个相隔年代的事件混为同一瞬间。',
  story:'制作故事场景概念图，选择一个具体动作或转折，以人物、空间、光线和物件承载叙事。',
  other:'制作可供作者审阅的世界观视觉原型，清楚表现主体、尺度、材料、环境和功能，不擅自增加决定性设定。'
});

const text = (value, limit = 8000) => String(value ?? '').trim().slice(0, limit);
const LEGACY_LOCATION_PROMPT = '把地理条目放入明确的世界与父级层次，说明地貌、气候、资源、人口、交通、控制关系及其形成原因。城市与地点必须能够追溯到所属国家，不把行政层级平铺。';
const LEGACY_TIMELINE_PROMPT = '按明确历法或相对时间组织事件，标注因果、并发、持续时间与仍不确定的日期。不要为填满时间线而制造未经支持的重大事件。';

export function normalizePromptSettings(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const source = input.typePrompts && typeof input.typePrompts === 'object' ? input.typePrompts : {};
  return {
    version: 4,
    personalizedPrompt: text(input.personalizedPrompt),
    visualStylePrompt: Object.prototype.hasOwnProperty.call(input,'visualStylePrompt')?text(input.visualStylePrompt):DEFAULT_VISUAL_STYLE_PROMPT,
    imagePrompts:Object.fromEntries(IMAGE_PROMPT_KEYS.map(key=>[key,Object.prototype.hasOwnProperty.call(input.imagePrompts||{},key)?text(input.imagePrompts[key]):DEFAULT_IMAGE_PROMPTS[key]])),
    typePrompts: Object.fromEntries(PROMPT_TYPE_KEYS.map(key => {
      const prompt = Object.prototype.hasOwnProperty.call(source, key) ? text(source[key]) : DEFAULT_TYPE_PROMPTS[key];
      if (key === 'location' && prompt === LEGACY_LOCATION_PROMPT) return [key, DEFAULT_TYPE_PROMPTS.location];
      if (key === 'timeline' && prompt === LEGACY_TIMELINE_PROMPT) return [key, DEFAULT_TYPE_PROMPTS.timeline];
      return [key, prompt];
    }))
  };
}

export function validatePromptSettings(value) {
  if (!value || typeof value !== 'object') throw new Error('提示词设置必须是对象');
  if (value.personalizedPrompt !== undefined && (typeof value.personalizedPrompt !== 'string' || value.personalizedPrompt.length > 8000)) throw new Error('个性化提示词不得超过 8000 个字符');
  if (value.visualStylePrompt !== undefined && (typeof value.visualStylePrompt !== 'string' || value.visualStylePrompt.length > 8000)) throw new Error('统一视觉提示词不得超过 8000 个字符');
  if (!value.typePrompts || typeof value.typePrompts !== 'object' || Array.isArray(value.typePrompts)) throw new Error('分类提示词格式无效');
  for (const [key, prompt] of Object.entries(value.typePrompts)) {
    if (!PROMPT_TYPE_KEYS.includes(key)) throw new Error(`未知提示词分类：${key}`);
    if (typeof prompt !== 'string' || prompt.length > 8000) throw new Error(`${key} 提示词不得超过 8000 个字符`);
  }
  if(value.imagePrompts!==undefined){
    if(!value.imagePrompts||typeof value.imagePrompts!=='object'||Array.isArray(value.imagePrompts))throw new Error('生图提示词格式无效');
    for(const[key,prompt]of Object.entries(value.imagePrompts)){
      if(!IMAGE_PROMPT_KEYS.includes(key))throw new Error(`未知生图提示词分类：${key}`);
      if(typeof prompt!=='string'||prompt.length>8000)throw new Error(`${key} 生图提示词不得超过 8000 个字符`);
    }
  }
  return normalizePromptSettings(value);
}
