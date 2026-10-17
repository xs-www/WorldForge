(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorldforgeWorldScope=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  // 世界编号是排版约定（W + 两位数字），不是内容前提：新装实例没有默认世界，
  // 第一条世界由作者建立并获得 W01。`UNASSIGNED_WORLD_ID` 表示「没有世界归属」，
  // 用来把历史数据、导入数据或字段缺失的资料聚成一类，而不是悄悄算进某个世界。
  const worldIdPattern=/^W\d{2}$/;
  const UNASSIGNED_WORLD_ID='';
  const UNASSIGNED_WORLD_TITLE='未归属资料';
  function worldIdOf(entry){return String(entry?.worldId||'').trim()}
  function nextWorldId(entries){
    const used=new Set();
    (Array.isArray(entries)?entries:[]).forEach(entry=>{
      const candidates=[entry?.type==='world'?entry.id:'',worldIdOf(entry)];
      candidates.forEach(id=>{const text=String(id||'');if(worldIdPattern.test(text))used.add(Number(text.slice(1)))});
    });
    let next=1;
    while(used.has(next))next+=1;
    return `W${String(next).padStart(2,'0')}`;
  }
  function countByType(entries){
    const counts={};
    entries.forEach(entry=>{const type=String(entry?.type||'');if(!type)return;counts[type]=(counts[type]||0)+1});
    return counts;
  }
  function groups(entries){
    const byId=new Map();
    (Array.isArray(entries)?entries:[]).forEach(entry=>{
      const worldId=worldIdOf(entry);
      if(!byId.has(worldId))byId.set(worldId,{worldId,world:null,entries:[]});
      const group=byId.get(worldId);
      group.entries.push(entry);
      if(entry?.type==='world'&&(entry.id===worldId||!group.world))group.world=entry;
    });
    return [...byId.values()].map(group=>{
      const others=group.entries.filter(entry=>!(entry.type==='world'&&entry.id===group.worldId));
      return{
        worldId:group.worldId,
        world:group.world,
        entries:group.entries,
        others,
        counts:countByType(others),
        total:others.length,
        title:group.world?.name||(group.worldId?`未命名世界（${group.worldId}）`:UNASSIGNED_WORLD_TITLE),
        assigned:Boolean(group.world)
      };
    }).sort((a,b)=>{
      // 未归属桶固定排最后，避免它抢在真实世界前面成为默认入口。
      const aUnassigned=!a.worldId,bUnassigned=!b.worldId;
      if(aUnassigned!==bUnassigned)return aUnassigned?1:-1;
      return a.worldId.localeCompare(b.worldId);
    });
  }
  function loreOfWorld(entries,worldId){
    const list=Array.isArray(entries)?entries:[];
    if(worldId===undefined||worldId===null)return[...list];
    const target=String(worldId).trim();
    return list.filter(entry=>worldIdOf(entry)===target);
  }
  function searchWorlds(groups_,query){
    const z=String(query||'').trim().toLowerCase();
    if(!z)return [...groups_];
    return groups_.filter(group=>`${group.title} ${group.worldId} ${group.world?.summary||''} ${group.world?.details||''}`.toLowerCase().includes(z));
  }
  function reassign(entries,sourceWorldId,targetWorldId){
    const source=String(sourceWorldId??'').trim(),target=String(targetWorldId??'').trim();
    const list=Array.isArray(entries)?entries:[];
    if(source===target)return{entries:[...list],moved:0};
    let moved=0;
    const next=list.map(entry=>{
      if(entry?.type==='world'||worldIdOf(entry)!==source)return entry;
      moved+=1;
      return{...entry,worldId:target};
    });
    return{entries:next,moved};
  }
  return{worldIdPattern,UNASSIGNED_WORLD_ID,UNASSIGNED_WORLD_TITLE,worldIdOf,nextWorldId,countByType,groups,loreOfWorld,searchWorlds,reassign};
});
