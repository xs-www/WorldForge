const text=(value,limit=1600)=>String(value??'').trim().slice(0,limit);

function entryText(entry){
  const attributes=Object.values(entry?.attributes||{}).filter(Boolean).join('；');
  return [
    `${text(entry?.name,100)}（${text(entry?.id,160)}，${text(entry?.type,30)}，${text(entry?.status,20)}）`,
    entry?.summary&&`摘要：${text(entry.summary,500)}`,
    entry?.details&&`正文：${text(entry.details,1200)}`,
    attributes&&`属性：${text(attributes,300)}`,
    entry?.location?.environment&&`环境：${text(entry.location.environment,300)}`,
    entry?.tags?.length&&`标签：${entry.tags.slice(0,12).map(item=>text(item,40)).join('、')}`
  ].filter(Boolean).join('\n');
}

export function selectVisualLore(payload={}){
  const library=Array.isArray(payload.library)?payload.library.slice(0,500):[],known=new Map(library.filter(item=>item?.id).map(item=>[item.id,item]));
  const target=payload.target&&typeof payload.target==='object'?payload.target:{},card=payload.card&&typeof payload.card==='object'?payload.card:{};
  const seeds=payload.targetType==='lore'?[target.id||payload.targetId]:Array.isArray(card.loreRefs)?card.loreRefs:[];
  const ids=new Set(seeds.filter(Boolean));
  for(const id of [...ids]){
    const entry=known.get(id);
    for(const relationId of entry?.relationIds||[])ids.add(relationId);
  }
  for(const entry of library){
    if((entry?.relationIds||[]).some(id=>seeds.includes(id)))ids.add(entry.id);
  }
  const entries=[...ids].map(id=>known.get(id)).filter(Boolean).slice(0,12);
  if(payload.targetType==='lore'&&target.id&&!entries.some(entry=>entry.id===target.id))entries.unshift(target);
  return entries.slice(0,12);
}

export function imagePromptKey(payload={}){
  if(payload.targetType!=='lore')return'card';
  const type=String(payload.target?.type||payload.loreType||'other');
  return ['world','location','faction','character','species','culture','religion','magic','technology','item','event','timeline','story'].includes(type)?type:'other';
}

export function composeImagePrompt(payload={},settings={}){
  const entries=selectVisualLore(payload),key=imagePromptKey(payload),target=payload.target||{},card=payload.card||{};
  const targetName=text(payload.targetType==='lore'?target.name:card.name,120)||'未命名视觉原型';
  const blocks=[
    settings.visualStylePrompt&&`统一视觉方向：${text(settings.visualStylePrompt,1000)}`,
    settings.imagePrompts?.[key]&&`本类生图要求：${text(settings.imagePrompts[key],1000)}`,
    `生成目标：${payload.targetType==='lore'?'世界观视觉原型':'策略卡牌插画'}；名称：${targetName}；用途：${text(payload.purpose||'concept',40)}`,
    entries.length&&`可用设定依据（只据此表现，不擅自补成正史）：\n${entries.map(entryText).join('\n\n')}`,
    card.rulesText&&`卡牌规则意象：${text(card.rulesText,600)}`,
    text(payload.prompt,3000)&&`作者本次要求：${text(payload.prompt,3000)}`,
    '只生成原创画面；不要文字、数字、卡框、Logo、UI 或商业 IP 专有元素。模型补充的视觉细节仅是 proposed 候选。'
  ].filter(Boolean);
  const prompt=blocks.join('\n\n');
  if(prompt.length<=3000)return{prompt,key,contextIds:entries.map(entry=>entry.id),truncated:false};
  const compact=[blocks[0],blocks[1],blocks[2],entries.length&&`设定依据：\n${entries.map(entry=>`${text(entry.name,80)}（${text(entry.id,100)}）：${text(entry.summary||entry.details,300)}`).join('\n')}`,blocks.at(-2),blocks.at(-1)].filter(Boolean).join('\n\n');
  return{prompt:compact.slice(0,3000),key,contextIds:entries.map(entry=>entry.id),truncated:true};
}
