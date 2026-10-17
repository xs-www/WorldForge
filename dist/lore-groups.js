(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorldforgeLoreGroups=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  // 资料组是**作者可定义的**词条容器，不是产品内置的世界类型清单。
  // 只有五项是固定的（世界、世界信息、角色、编年史、背景故事），其余全部由作者新建；
  // 固定组保证模块导航、编年史树、地理树和背景故事视图始终可用，自定义组共用通用表单。
  //
  // form 决定表单形态，与「组叫什么名字」无关：
  //   generic   通用字段（名称/摘要/正文/三个属性/限制/开放问题）
  //   story     只有标题与正文
  //   chronicle 编年史容器与节点（纪年文本 + 排序值）
  //   geography 地理树（层级 + 上级 + 环境）
  const FORMS=['generic','story','chronicle','geography'];
  const FIXED_GROUPS=Object.freeze([
    Object.freeze({id:'world',label:'世界',icon:'◎',form:'generic',attributes:Object.freeze(['题材','时代','尺度']),fixed:true}),
    Object.freeze({id:'info',label:'世界信息',icon:'◇',form:'generic',attributes:Object.freeze(['分类','归属','要点']),fixed:true}),
    Object.freeze({id:'character',label:'角色',icon:'人',form:'generic',attributes:Object.freeze(['叙事身份','年龄阶段','种族']),fixed:true}),
    Object.freeze({id:'timeline',label:'编年史',icon:'史',form:'chronicle',attributes:Object.freeze(['时间范围','采用历法','叙事范围']),fixed:true}),
    Object.freeze({id:'story',label:'背景故事',icon:'篇',form:'story',attributes:Object.freeze(['故事类型','发生时期','叙事视角']),fixed:true})
  ]);
  const FIXED_IDS=new Set(FIXED_GROUPS.map(group=>group.id));
  const PROMPT_KEYS=Object.freeze(['world','info','character','timeline','story']);
  // 旧版的十三类资料里有九个不是固定组。这里只声明它们迁移成什么样，
  // 不声明它们必须存在：资料本身的 type 值不变，作者随时可以改名或删组。
  const LEGACY_GROUPS=Object.freeze({
    location:{label:'世界地图',icon:'地',form:'geography',attributes:['地理角色','管辖主体','人口规模']},
    faction:{label:'势力',icon:'旗',form:'generic',attributes:['势力类型','领导者','总部']},
    species:{label:'种族',icon:'种',form:'generic',attributes:['起源','寿命','核心特征']},
    culture:{label:'文化',icon:'文',form:'generic',attributes:['主要地区','语言','核心习俗']},
    religion:{label:'宗教',icon:'祈',form:'generic',attributes:['崇拜对象','核心教义','组织形态']},
    magic:{label:'力量体系',icon:'术',form:'generic',attributes:['力量来源','使用成本','硬性限制']},
    technology:{label:'技术体系',icon:'械',form:'generic',attributes:['成熟度','能源','社会影响']},
    item:{label:'物品',icon:'物',form:'generic',attributes:['物品类型','持有者','当前状态']},
    event:{label:'事件',icon:'事',form:'generic',attributes:['发生时间','发生地点','参与者']}
  });
  const MAX_GROUPS=40,ID_PATTERN=/^[a-z][a-z0-9_-]{0,31}$/,LABEL_LIMIT=40,ATTRIBUTE_LIMIT=24,ICON_LIMIT=2;
  function text(value,limit){return String(value??'').trim().slice(0,limit)}
  function normalizeForm(value){const form=text(value,20);return FORMS.includes(form)?form:'generic'}
  function normalizeAttributes(value,fallback=['分类','归属','要点']){const list=Array.isArray(value)?value:[],out=list.map(item=>text(item,ATTRIBUTE_LIMIT)).filter(Boolean).slice(0,3);while(out.length<3)out.push(fallback[out.length]||`属性 ${out.length+1}`);return out}
  function normalizeGroup(raw){
    const source=raw&&typeof raw==='object'?raw:{},id=text(source.id,32);
    if(!ID_PATTERN.test(id))return null;
    return{id,label:text(source.label,LABEL_LIMIT)||id,icon:text(source.icon,ICON_LIMIT)||'·',form:normalizeForm(source.form),attributes:normalizeAttributes(source.attributes),fixed:FIXED_IDS.has(id),custom:!FIXED_IDS.has(id)};
  }
  function normalizeGroups(value){
    const seen=new Set(),out=[];
    (Array.isArray(value)?value:[]).forEach(raw=>{
      const group=normalizeGroup(raw);
      if(!group||FIXED_IDS.has(group.id)||seen.has(group.id)||out.length>=MAX_GROUPS)return;
      seen.add(group.id);out.push(group);
    });
    return out;
  }
  function allGroups(custom){return[...FIXED_GROUPS.map(group=>({...group,attributes:[...group.attributes]})),...normalizeGroups(custom)]}
  function isFixedGroup(id){return FIXED_IDS.has(String(id||''))}
  function groupOf(groups,id){
    const target=String(id||'').trim();
    return(Array.isArray(groups)?groups:allGroups([])).find(group=>group.id===target)||null;
  }
  /** 资料组 → 提示词档位。自定义组共用「世界信息」这一档，避免每加一个组就多一份提示词要维护。 */
  function promptKey(id){const target=String(id||'').trim();return PROMPT_KEYS.includes(target)?target:'info'}
  function slugify(label){const ascii=String(label||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,24);return ID_PATTERN.test(ascii)?ascii:''}
  function nextGroupId(label,groups){
    const used=new Set([...FIXED_IDS,...(Array.isArray(groups)?groups:[]).map(group=>group.id)]);
    const slug=slugify(label),base=slug||'group';
    if(!used.has(base))return base;
    let index=2;
    while(used.has(`${base}-${index}`))index+=1;
    return`${base}-${index}`;
  }
  function createGroup(label,{form,attributes,icon,groups}={}){
    const name=text(label,LABEL_LIMIT)||'新资料组';
    return normalizeGroup({id:nextGroupId(name,groups),label:name,icon:icon||'·',form:form||'generic',attributes});
  }
  /**
   * 保证「资料里出现过的 type」都有对应组：旧库的九个旧类型按 LEGACY_GROUPS 迁移，
   * 无法识别的 type 原样建组。返回值只新增、不修改已有组。
   */
  function deriveGroups(entries,customGroups){
    const groups=normalizeGroups(customGroups),used=new Set([...FIXED_IDS,...groups.map(group=>group.id)]);
    (Array.isArray(entries)?entries:[]).forEach(entry=>{
      const type=text(entry?.type,32);
      if(!type||used.has(type)||groups.length>=MAX_GROUPS)return;
      const legacy=LEGACY_GROUPS[type];
      const group=normalizeGroup(legacy?{id:type,...legacy}:{id:type,label:type,icon:'·',form:'generic'});
      if(!group)return;
      used.add(type);groups.push(group);
    });
    return groups;
  }
  function groupForEntry(entries,customGroups,type){
    return groupOf(allGroups(deriveGroups(entries,customGroups)),type)||groupOf(allGroups([]),'info');
  }
  return{FORMS,FIXED_GROUPS,FIXED_IDS,PROMPT_KEYS,LEGACY_GROUPS,MAX_GROUPS,ID_PATTERN,normalizeGroup,normalizeGroups,allGroups,isFixedGroup,groupOf,promptKey,slugify,nextGroupId,createGroup,deriveGroups,groupForEntry};
});
