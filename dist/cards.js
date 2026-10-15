(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorldforgeCards=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const typeLabels={minion:'随从',spell:'法术',equipment:'武器'};
  const rarityLabels={common:'普通',rare:'稀有',epic:'史诗',legendary:'传说'};
  const legacyTypes={unit:'minion',action:'spell',asset:'equipment'};
  const cardableLoreTypes=new Set(['character','species','faction','item','technology','magic','event','location']);
  const loreTypeDefaults={character:'minion',species:'minion',faction:'minion',item:'equipment',technology:'equipment',location:'equipment',magic:'spell',event:'spell'};
  const minionTribes=[{id:'human',name:'人类',status:'proposed'},{id:'construct',name:'构装体',status:'proposed'},{id:'machine',name:'蒸汽机械',status:'proposed'},{id:'undead',name:'亡灵',status:'proposed'},{id:'beast',name:'野兽',status:'proposed'}];
  const spellSchools=[{id:'fire',name:'火',tier:'basic',status:'canon'},{id:'water',name:'水',tier:'basic',status:'canon'},{id:'earth',name:'土',tier:'basic',status:'canon'},{id:'wind',name:'风',tier:'basic',status:'canon'},{id:'lightning',name:'电',tier:'basic',status:'canon'},{id:'light',name:'光明',tier:'advanced',status:'canon'},{id:'dark',name:'黑暗',tier:'advanced',status:'canon'},{id:'life',name:'生命',tier:'advanced',status:'canon'},{id:'death',name:'死亡',tier:'advanced',status:'canon'},{id:'time',name:'时间',tier:'higher',status:'canon'},{id:'space',name:'空间',tier:'higher',status:'canon'}];
  const schoolTierLabels={basic:'基础',advanced:'高阶',higher:'更高层'};
  function normalizeSubtype(type,card){
    const tribeId=String(card.tribeId||''),spellSchoolId=String(card.spellSchoolId||'');
    if(type==='minion')return{tribeId:minionTribes.some(item=>item.id===tribeId)?tribeId:'',spellSchoolId:''};
    if(type==='spell')return{tribeId:'',spellSchoolId:spellSchools.some(item=>item.id===spellSchoolId)?spellSchoolId:''};
    return{tribeId:'',spellSchoolId:''};
  }
  function tribeName(id){return minionTribes.find(item=>item.id===id)?.name||''}
  function spellSchoolName(id){return spellSchools.find(item=>item.id===id)?.name||''}
  function subtypeText(card={}){
    if(card.type==='minion')return tribeName(card.tribeId);
    if(card.type==='spell')return spellSchoolName(card.spellSchoolId);
    return'';
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
    return{id:String(card.id||'').trim(),name:String(card.name||'未命名卡牌').trim()||'未命名卡牌',status:'proposed',worldId:String(card.worldId||'W01').trim()||'W01',type,rarity:normalizeRarity(card.rarity),cost:Math.max(0,Number(card.cost)||0),...stats,...subtype,keywordIds:usages.map(item=>item.keywordId),keywordUsages:usages,loreRefs:normalizeLoreRefs(card.loreRefs),referenceAssetIds:normalizeLoreRefs(card.referenceAssetIds).slice(0,10),artAssetId:String(card.artAssetId||''),artCrop:{x:boundedNumber(crop.x,50,0,100),y:boundedNumber(crop.y,50,0,100),zoom:boundedNumber(crop.zoom,1,1,2.5)},rulesText:String(card.rulesText||''),flavorText:String(card.flavorText||''),balanceStatus:'untested'};
  }
  return{typeLabels,rarityLabels,legacyTypes,minionTribes,spellSchools,schoolTierLabels,normalizeType,normalizeRarity,normalizeLoreRefs,isCardableLore,defaultTypeForLore,normalizeStats,normalizeSubtype,tribeName,spellSchoolName,subtypeText,parseRichText,compileDescription,normalize};
});
