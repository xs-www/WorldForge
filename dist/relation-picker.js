(function(root,factory){
  const api=factory(root.WorldforgeWorldScope);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WorldforgeRelationPicker=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(worldScope){
  const worldIdOf=worldScope?worldScope.worldIdOf:(entry=>String(entry?.worldId||'').trim()||'W01');
  function haystack(entry){return`${entry?.name||''} ${entry?.id||''} ${entry?.summary||''} ${entry?.details||''} ${Array.isArray(entry?.tags)?entry.tags.join(' '):''}`.toLowerCase()}
  function filter(entries,options={}){
    const list=Array.isArray(entries)?entries:[],query=String(options.query||'').trim().toLowerCase(),exclude=String(options.excludeId||'').trim(),
      current=String(options.currentWorldId||'').trim(),worldMode=String(options.worldMode||'current'),view=String(options.view||'all'),
      selected=new Set(Array.isArray(options.selectedIds)?options.selectedIds:[]);
    return list.filter(entry=>{
      if(!entry||!entry.id)return false;
      if(exclude&&entry.id===exclude)return false;
      if(options.type&&options.type!=='all'&&entry.type!==options.type)return false;
      if(options.status&&options.status!=='all'&&entry.status!==options.status)return false;
      if(current&&worldMode!=='all'){
        const entryWorld=worldIdOf(entry);
        if(worldMode==='current'&&entryWorld!==current)return false;
        if(worldMode==='other'&&entryWorld===current)return false;
      }
      if(view==='selected'&&!selected.has(entry.id))return false;
      if(view==='unselected'&&selected.has(entry.id))return false;
      return query?haystack(entry).includes(query):true;
    });
  }
  function toggle(ids,id){
    const list=Array.isArray(ids)?ids:[],target=String(id||'').trim();
    if(!target)return[...list];
    return list.includes(target)?list.filter(item=>item!==target):[...list,target];
  }
  function remove(ids,id){
    const target=String(id||'').trim();
    return(Array.isArray(ids)?ids:[]).filter(item=>item!==target);
  }
  function summarize(ids,entries){
    const byId=new Map((Array.isArray(entries)?entries:[]).filter(entry=>entry?.id).map(entry=>[entry.id,entry]));
    return(Array.isArray(ids)?ids:[]).map(id=>byId.get(id)).filter(Boolean);
  }
  function missingCount(ids,entries){
    const list=Array.isArray(ids)?ids:[];
    return list.length-summarize(list,entries).length;
  }
  return{filter,toggle,remove,summarize,missingCount,worldIdOf};
});
