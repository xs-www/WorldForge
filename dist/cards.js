(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorldforgeCards=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const typeLabels={minion:'随从',spell:'法术',equipment:'武器'};
  const rarityLabels={common:'普通',rare:'稀有',epic:'史诗',legendary:'传说'};
  const legacyTypes={unit:'minion',action:'spell',asset:'equipment'};
  const cardableLoreTypes=new Set(['character','species','faction','item','technology','magic','event','location']);
  const loreTypeDefaults={character:'minion',species:'minion',faction:'minion',item:'equipment',technology:'equipment',location:'equipment',magic:'spell',event:'spell'};
  // 随从种族与法术派系是**世界内**的分类，不属于产品常量：每个世界可以完全不同，
  // 可以没有魔法也没有机械。卡牌只存作者写下的名称，候选项按当前世界的资料与已有卡牌派生。
  // 下表只为早期草案里的稳定 ID 保留展示名称，不构成可选集合，也不限制新值。
  const legacySubtypeLabels=Object.freeze({human:'人类',construct:'构装体',machine:'机械',undead:'亡灵',beast:'野兽',fire:'火',water:'水',earth:'土',wind:'风',lightning:'电',light:'光明',dark:'黑暗',life:'生命',death:'死亡',time:'时间',space:'空间'});
  const SUBTYPE_LIMIT=60;
  const subtypeLoreTypes={minion:'species',spell:'magic'};
  const subtypeField={minion:'tribeId',spell:'spellSchoolId'};
  function subtypeValue(value){return String(value||'').trim().slice(0,SUBTYPE_LIMIT)}
  function normalizeSubtype(type,card){
    const tribeId=subtypeValue(card.tribeId),spellSchoolId=subtypeValue(card.spellSchoolId);
    if(type==='minion')return{tribeId,spellSchoolId:''};
    if(type==='spell')return{tribeId:'',spellSchoolId};
    return{tribeId:'',spellSchoolId:''};
  }
  /** 展示用文本：卡牌里存的就是作者写的名称；早期草案的稳定 ID 用旧名称兼容。 */
  function subtypeText(card={}){
    const type=normalizeType(card.type);
    if(type!=='minion'&&type!=='spell')return'';
    const value=subtypeValue(card[subtypeField[type]]);
    return value?(legacySubtypeLabels[value]||value):'';
  }
  /**
   * 当前世界的子类型候选：已有卡牌里的写法 + 同世界资料（随从取种族、法术取力量体系）。
   * 只是补全建议，作者仍可输入任意名称；跨世界的词不会混进来。
   */
  function subtypeOptions(options={}){
    const type=normalizeType(options.type),worldId=String(options.worldId||'').trim(),field=subtypeField[type],loreType=subtypeLoreTypes[type];
    if(!field)return[];
    const found=new Map();
    const push=value=>{const text=subtypeValue(value);if(text&&!found.has(text))found.set(text,legacySubtypeLabels[text]||text)};
    (Array.isArray(options.cards)?options.cards:[]).forEach(card=>{if(card&&normalizeType(card.type)===type&&String(card.worldId||'').trim()===worldId)push(card[field])});
    (Array.isArray(options.lore)?options.lore:[]).forEach(entry=>{if(entry&&entry.type===loreType&&String(entry.worldId||'').trim()===worldId)push(entry.name)});
    return [...found].map(([value,label])=>({value,label}));
  }
  function normalizeType(value){const type=legacyTypes[value]||value;return typeLabels[type]?type:'minion'}
  function normalizeRarity(value){return rarityLabels[value]?value:'common'}
  function normalizeLoreRefs(value){return [...new Set((Array.isArray(value)?value:[]).map(id=>String(id||'').trim()).filter(Boolean))]}
  function boundedNumber(value,fallback,min,max){const number=Number(value);return Math.min(max,Math.max(min,Number.isFinite(number)?number:fallback))}
  function isCardableLore(entry){return Boolean(entry?.id&&cardableLoreTypes.has(entry.type))}
  function defaultTypeForLore(entry){return loreTypeDefaults[entry?.type]||'minion'}
  function normalizeStats(type,card){
    if(type==='spell')return{attack:null,health:null,durability:null};
    if(type==='equipment')return{attack:Math.max(0,Number(card.attack)||0),health:null,durability:Math.max(1,Number(card.durability??card.health)||1)};
    return{attack:Math.max(0,Number(card.attack)||0),health:Math.max(1,Number(card.health)||1),durability:null};
  }
  function parseRichText(value=''){
    const source=String(value),runs=[];
    let bold=false,italic=false,buffer='';
    const append=(text,runBold=bold,runItalic=italic)=>{if(!text)return;const previous=runs.at(-1);if(previous&&previous.bold===runBold&&previous.italic===runItalic)previous.text+=text;else runs.push({text,bold:runBold,italic:runItalic})};
    const flush=()=>{append(buffer);buffer=''};
    for(let index=0;index<source.length;){
      const rest=source.slice(index),lower=rest.toLowerCase();
      if(lower.startsWith('<b>')){flush();bold=true;index+=3;continue}
      if(lower.startsWith('</b>')){flush();bold=false;index+=4;continue}
      if(lower.startsWith('<i>')){flush();italic=true;index+=3;continue}
      if(lower.startsWith('</i>')){flush();italic=false;index+=4;continue}
      if(rest.startsWith('**')){flush();bold=!bold;index+=2;continue}
      if(rest.startsWith('*')){flush();italic=!italic;index+=1;continue}
      buffer+=source[index];index+=1;
    }
    flush();
    return runs;
  }
  function compileDescription(card={},keywords=[]){
    const lookup=keywords instanceof Map?keywords:new Map(keywords.map(item=>[item.id,item])),usages=Array.isArray(card.keywordUsages)?card.keywordUsages:[],standalone=[],detailed=[];
    for(const usage of usages){const keyword=lookup.get(usage.keywordId);if(!keyword)continue;const detail=String(usage.detail||'').trim(),plainDetail=parseRichText(detail).map(run=>run.text).join('');(detail?detailed:standalone).push({keywordId:usage.keywordId,name:keyword.name,detail,text:detail?`${keyword.name}：${plainDetail}`:keyword.name})}
    const rulesText=String(card.rulesText||'').trim(),runs=[],keywordCount=standalone.length+detailed.length;
    standalone.forEach((item,index)=>{runs.push({text:item.name,bold:true,italic:false,kind:'keyword'});if(index<standalone.length-1||detailed.length)runs.push({text:'，',bold:false,italic:false,kind:'punctuation'})});
    detailed.forEach((item,index)=>{runs.push({text:`${item.name}：`,bold:true,italic:false,kind:'keyword'});parseRichText(item.detail).forEach(run=>runs.push({...run,kind:'detail'}));if(index<detailed.length-1)runs.push({text:'；',bold:false,italic:false,kind:'punctuation'})});
    if(rulesText){if(keywordCount)runs.push({text:'\n',bold:false,italic:false,kind:'break'});parseRichText(rulesText).forEach(run=>runs.push({...run,kind:'rules'}))}
    const plainRules=parseRichText(rulesText).map(run=>run.text).join('');
    return{standalone,detailed,rulesText,runs,text:runs.map(run=>run.text).join(''),lines:[...standalone.map(item=>item.text),...detailed.map(item=>item.text),plainRules].filter(Boolean)};
  }
  function normalize(card={}){
    const raw=Array.isArray(card.keywordUsages)?card.keywordUsages:(card.keywordIds||[]).map(keywordId=>({keywordId,detail:''}));
    const usages=[...new Map(raw.filter(item=>item?.keywordId).map(item=>[item.keywordId,{keywordId:item.keywordId,detail:String(item.detail||'')}])).values()];
    const crop=card.artCrop&&typeof card.artCrop==='object'?card.artCrop:{},type=normalizeType(card.type),stats=normalizeStats(type,card),subtype=normalizeSubtype(type,card);
    return{id:String(card.id||'').trim(),name:String(card.name||'未命名卡牌').trim()||'未命名卡牌',status:'proposed',worldId:String(card.worldId||'').trim(),type,rarity:normalizeRarity(card.rarity),cost:Math.max(0,Number(card.cost)||0),...stats,...subtype,keywordIds:usages.map(item=>item.keywordId),keywordUsages:usages,loreRefs:normalizeLoreRefs(card.loreRefs),referenceAssetIds:normalizeLoreRefs(card.referenceAssetIds).slice(0,10),artAssetId:String(card.artAssetId||''),artCrop:{x:boundedNumber(crop.x,50,0,100),y:boundedNumber(crop.y,50,0,100),zoom:boundedNumber(crop.zoom,1,1,2.5)},rulesText:String(card.rulesText||''),flavorText:String(card.flavorText||''),balanceStatus:'untested'};
  }
  return{typeLabels,rarityLabels,legacyTypes,legacySubtypeLabels,SUBTYPE_LIMIT,subtypeValue,subtypeOptions,normalizeType,normalizeRarity,normalizeLoreRefs,isCardableLore,defaultTypeForLore,normalizeStats,normalizeSubtype,subtypeText,parseRichText,compileDescription,normalize};
});
