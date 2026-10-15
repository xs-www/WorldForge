(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorldforgeCards=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const typeLabels={minion:'随从',spell:'法术',equipment:'装备'};
  const rarityLabels={common:'普通',rare:'稀有',epic:'史诗',legendary:'传说'};
  const legacyTypes={unit:'minion',action:'spell',asset:'equipment'};
  const cardableLoreTypes=new Set(['character','species','faction','item','technology','magic','event','location']);
  const loreTypeDefaults={character:'minion',species:'minion',faction:'minion',item:'equipment',technology:'equipment',location:'equipment',magic:'spell',event:'spell'};
  function normalizeType(value){const type=legacyTypes[value]||value;return typeLabels[type]?type:'minion'}
  function normalizeRarity(value){return rarityLabels[value]?value:'common'}
  function normalizeLoreRefs(value){return [...new Set((Array.isArray(value)?value:[]).map(id=>String(id||'').trim()).filter(Boolean))]}
  function isCardableLore(entry){return Boolean(entry?.id&&cardableLoreTypes.has(entry.type))}
  function defaultTypeForLore(entry){return loreTypeDefaults[entry?.type]||'minion'}
  function normalize(card={}){
    const raw=Array.isArray(card.keywordUsages)?card.keywordUsages:(card.keywordIds||[]).map(keywordId=>({keywordId,detail:''}));
    const usages=[...new Map(raw.filter(item=>item?.keywordId).map(item=>[item.keywordId,{keywordId:item.keywordId,detail:String(item.detail||'')}])).values()];
    return{id:String(card.id||'').trim(),name:String(card.name||'未命名卡牌').trim()||'未命名卡牌',status:'proposed',worldId:String(card.worldId||'W01').trim()||'W01',type:normalizeType(card.type),rarity:normalizeRarity(card.rarity),cost:Math.max(0,Number(card.cost)||0),attack:Math.max(0,Number(card.attack)||0),health:Math.max(1,Number(card.health)||1),keywordIds:usages.map(item=>item.keywordId),keywordUsages:usages,loreRefs:normalizeLoreRefs(card.loreRefs),referenceAssetIds:normalizeLoreRefs(card.referenceAssetIds).slice(0,10),artAssetId:String(card.artAssetId||''),rulesText:String(card.rulesText||''),balanceStatus:'untested'};
  }
  return{typeLabels,rarityLabels,legacyTypes,normalizeType,normalizeRarity,normalizeLoreRefs,isCardableLore,defaultTypeForLore,normalize};
});
