// 文字与生图提示词的出厂默认值。这里只描述**写作方法与边界**，不假设世界有魔法、机械、
// 工业或神性：任何题材都应当能直接使用这套默认值。世界自身的设定由作者与资料库提供。
export const PROMPT_TYPE_KEYS = ['world', 'info', 'character', 'timeline', 'story'];
// 旧版把资料分成十三类，其中九类已改成作者自定义组。这些键不再有出厂默认值，
// 但作者保存过的文本必须原样保留，因此仍然接受与回写（不会用来生成）。
export const LEGACY_PROMPT_TYPE_KEYS = ['location', 'faction', 'species', 'culture', 'religion', 'magic', 'technology', 'item', 'event'];
export const IMAGE_PROMPT_KEYS = ['card', ...PROMPT_TYPE_KEYS, 'other'];

export const DEFAULT_TYPE_PROMPTS = Object.freeze({
  world: '从本世界的底层条件出发：世界构成、自然或超自然法则、能源与资源、生产与运输、通信与组织、社会分化，以及这个世界独有的边界与代价。优先形成可继续拆分资料的框架，不一次填满所有空白。',
  info: '只写这条世界信息自身的具体内容：它是什么、由什么构成、如何运作、成本与限制、影响谁、与哪些条目相关。让作者能据此继续拆成更细的条目，不代替作者补完整个世界。',
  character: '从人物经历、欲望、选择、能力边界、人际关系和正在面对的具体冲突展开。让人物能够进入故事，但不要替作者确定未经批准的身世真相。',
  timeline: '以编年史方式组织记录：区分编年史容器与具体节点，为节点提供纪年文本和可排序的先后值，并说明事件、因果、并发、持续时间、影响与史料不确定性。不要为填满年代而制造未经支持的重大事件。',
  story: '只创作标题与完整故事正文，从传记、轶事、局部事件或具体场景切入，以行动、感官、对话和因果推进。不要输出摘要、标签、约束、开放问题或设定分析。'
});

export const DEFAULT_VISUAL_STYLE_PROMPT = '保持同一世界中的材质、工艺、服装、建筑和色彩语言一致；优先依据已提供设定，不把模型临时补充的细节视为正史；使用原创视觉表达，不模仿特定商业 IP 或在世艺术家的辨识性风格。';

export const DEFAULT_IMAGE_PROMPTS = Object.freeze({
  card: '以清晰主体、可读轮廓和环境叙事构成策略卡牌插画；突出卡牌身份与能力意象，画面比例约 3:2。',
  world: '制作世界级概念图，表现核心自然条件、文明尺度和视觉母题，避免把全部文明挤进一张百科拼贴。',
  info: '制作世界信息概念图，表现这条信息所指的对象、结构、用途与环境关系；一张图只讲清一件事。',
  character: '制作人物视觉原型，优先表现身份、年龄、体态、服装材料、工具、处境和关系线索；保持脸部与轮廓清晰。',
  timeline: '制作编年史视觉辅助，选取明确时代切片或史料式场景，不把多个相隔年代的事件混为同一瞬间。',
  story: '制作故事场景概念图，选择一个具体动作或转折，以人物、空间、光线和物件承载叙事。',
  other: '制作可供作者审阅的世界观视觉原型，清楚表现主体、尺度、材料、环境和功能，不擅自增加决定性设定。'
});

const text = (value, limit = 8000) => String(value ?? '').trim().slice(0, limit);
const has = (input, key) => Object.prototype.hasOwnProperty.call(input || {}, key);
const LEGACY_TIMELINE_PROMPT = '按明确历法或相对时间组织事件，标注因果、并发、持续时间与仍不确定的日期。不要为填满时间线而制造未经支持的重大事件。';

export function normalizePromptSettings(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const source = input.typePrompts && typeof input.typePrompts === 'object' ? input.typePrompts : {};
  const typePrompts = Object.fromEntries(PROMPT_TYPE_KEYS.map(key => [key, has(source, key) ? text(source[key]) : DEFAULT_TYPE_PROMPTS[key]]));
  // 旧键原样保留：作者以前写过的分类提示词不会因为分组方式改变而消失。
  for (const key of LEGACY_PROMPT_TYPE_KEYS) if (has(source, key)) typePrompts[key] = text(source[key]);
  if (typePrompts.timeline === LEGACY_TIMELINE_PROMPT) typePrompts.timeline = DEFAULT_TYPE_PROMPTS.timeline;
  const imageSource = input.imagePrompts || {};
  const imagePrompts = Object.fromEntries(IMAGE_PROMPT_KEYS.map(key => [key, has(imageSource, key) ? text(imageSource[key]) : DEFAULT_IMAGE_PROMPTS[key]]));
  for (const key of LEGACY_PROMPT_TYPE_KEYS) if (has(imageSource, key)) imagePrompts[key] = text(imageSource[key]);
  return {
    version: 5,
    personalizedPrompt: text(input.personalizedPrompt),
    visualStylePrompt: has(input, 'visualStylePrompt') ? text(input.visualStylePrompt) : DEFAULT_VISUAL_STYLE_PROMPT,
    imagePrompts,
    typePrompts
  };
}

export function validatePromptSettings(value) {
  if (!value || typeof value !== 'object') throw new Error('提示词设置必须是对象');
  if (value.personalizedPrompt !== undefined && (typeof value.personalizedPrompt !== 'string' || value.personalizedPrompt.length > 8000)) throw new Error('个性化提示词不得超过 8000 个字符');
  if (value.visualStylePrompt !== undefined && (typeof value.visualStylePrompt !== 'string' || value.visualStylePrompt.length > 8000)) throw new Error('统一视觉提示词不得超过 8000 个字符');
  if (!value.typePrompts || typeof value.typePrompts !== 'object' || Array.isArray(value.typePrompts)) throw new Error('分类提示词格式无效');
  for (const [key, prompt] of Object.entries(value.typePrompts)) {
    if (!PROMPT_TYPE_KEYS.includes(key) && !LEGACY_PROMPT_TYPE_KEYS.includes(key)) throw new Error(`未知提示词分类：${key}`);
    if (typeof prompt !== 'string' || prompt.length > 8000) throw new Error(`${key} 提示词不得超过 8000 个字符`);
  }
  if (value.imagePrompts !== undefined) {
    if (!value.imagePrompts || typeof value.imagePrompts !== 'object' || Array.isArray(value.imagePrompts)) throw new Error('生图提示词格式无效');
    for (const [key, prompt] of Object.entries(value.imagePrompts)) {
      if (!IMAGE_PROMPT_KEYS.includes(key) && !LEGACY_PROMPT_TYPE_KEYS.includes(key)) throw new Error(`未知生图提示词分类：${key}`);
      if (typeof prompt !== 'string' || prompt.length > 8000) throw new Error(`${key} 生图提示词不得超过 8000 个字符`);
    }
  }
  return normalizePromptSettings(value);
}
