(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorldforgeLoreGroups=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  // 资料组是**作者可定义**的词条 schema，不是产品内置的世界类型清单。
  //
  // 一个组 = 名称 + 作用范围 + 表单形态 + **自己的内容块列表** + 该组的 AI 写作提示。
  // 内容块完全由作者决定：可以没有摘要、没有约束、没有开放问题，也可以加任意「属性」。
  // 固定组只是**预置了默认字段**的组，字段同样可以改、可以恢复默认——不做「一半可配置」。
  //
  // form 决定表单里的专属部件（与字段无关）：
  //   generic   无专属部件
  //   story     隐去状态/事实层次/关联，只留正文
  //   chronicle 编年史容器与节点（纪年文本 + 排序值 + 所属编年史）
  //   geography 地理树（层级 + 上级 + 坐标）
  const FORMS=['generic','story','chronicle','geography'];
  const FIELD_KINDS=['text','multiline','lines','number'];
  const FIXED_IDS=new Set(['world','location','character','timeline','story']);
  const PROMPT_KEYS=Object.freeze(['world','location','character','timeline','story']);
  const IMAGE_KEYS=Object.freeze(['card','world','location','character','timeline','story','other']);

  const field=(key,label,kind='text',hint='')=>({key,label,kind,hint});
  // 每个组默认只有「详细设定」；摘要、属性、约束、开放问题都要作者自己加。
  const DEFAULT_FIELDS=Object.freeze([field('details','详细设定','multiline')]);
  const FIXED_GROUPS=Object.freeze([
    Object.freeze({id:'world',label:'世界',icon:'◎',form:'generic',fixed:true,defaultFields:DEFAULT_FIELDS}),
    Object.freeze({id:'location',label:'世界地图',icon:'地',form:'geography',fixed:true,defaultFields:DEFAULT_FIELDS}),
    Object.freeze({id:'character',label:'角色',icon:'人',form:'generic',fixed:true,defaultFields:DEFAULT_FIELDS}),
    Object.freeze({id:'timeline',label:'编年史',icon:'史',form:'chronicle',fixed:true,defaultFields:DEFAULT_FIELDS}),
    Object.freeze({id:'story',label:'背景故事',icon:'篇',form:'story',fixed:true,defaultFields:DEFAULT_FIELDS})
  ]);
  // 旧版的十三类资料里有八个不是固定组（世界地图已升为固定组）。
  // 这里只声明迁移后的样子，不声明它们必须存在。
  const LEGACY_GROUPS=Object.freeze({
    info:{label:'世界信息',icon:'◇',form:'generic',defaultFields:[field('summary','摘要','text'),field('details','正文','multiline'),field('attributeA','分类','text'),field('attributeB','归属','text'),field('attributeC','要点','text'),field('constraints','限制与边界','lines'),field('openQuestions','开放问题','lines')]},
    faction:{label:'势力',icon:'旗',form:'generic',defaultFields:[field('summary','摘要','text'),field('details','组织正文','multiline'),field('attributeA','势力类型','text'),field('attributeB','领导者','text'),field('attributeC','总部','text'),field('constraints','限制与边界','lines'),field('openQuestions','开放问题','lines')]},
    species:{label:'种族',icon:'种',form:'generic',defaultFields:[field('summary','摘要','text'),field('details','种族正文','multiline'),field('attributeA','起源','text'),field('attributeB','寿命','text'),field('attributeC','核心特征','text'),field('constraints','限制与边界','lines'),field('openQuestions','开放问题','lines')]},
    culture:{label:'文化',icon:'文',form:'generic',defaultFields:[field('summary','摘要','text'),field('details','文化正文','multiline'),field('attributeA','主要地区','text'),field('attributeB','语言','text'),field('attributeC','核心习俗','text'),field('constraints','限制与边界','lines'),field('openQuestions','开放问题','lines')]},
    religion:{label:'宗教',icon:'祈',form:'generic',defaultFields:[field('summary','摘要','text'),field('details','信仰正文','multiline'),field('attributeA','崇拜对象','text'),field('attributeB','核心教义','text'),field('attributeC','组织形态','text'),field('constraints','限制与边界','lines'),field('openQuestions','开放问题','lines')]},
    magic:{label:'力量体系',icon:'术',form:'generic',defaultFields:[field('summary','摘要','text'),field('details','力量体系正文','multiline'),field('attributeA','力量来源','text'),field('attributeB','使用成本','text'),field('attributeC','硬性限制','text'),field('constraints','限制与边界','lines'),field('openQuestions','开放问题','lines')]},
    technology:{label:'技术体系',icon:'械',form:'generic',defaultFields:[field('summary','摘要','text'),field('details','技术体系正文','multiline'),field('attributeA','成熟度','text'),field('attributeB','能源','text'),field('attributeC','社会影响','text'),field('constraints','限制与边界','lines'),field('openQuestions','开放问题','lines')]},
    item:{label:'物品',icon:'物',form:'generic',defaultFields:[field('summary','摘要','text'),field('details','物品正文','multiline'),field('attributeA','物品类型','text'),field('attributeB','持有者','text'),field('attributeC','当前状态','text'),field('constraints','限制与边界','lines'),field('openQuestions','开放问题','lines')]},
    event:{label:'事件',icon:'事',form:'generic',defaultFields:[field('summary','摘要','text'),field('details','事件正文','multiline'),field('attributeA','发生时间','text'),field('attributeB','发生地点','text'),field('attributeC','参与者','text'),field('constraints','限制与边界','lines'),field('openQuestions','开放问题','lines')]}
  });
  // 新建组的最小默认与固定组一致：只有「详细设定」。
  const MINIMAL_FIELDS=DEFAULT_FIELDS;
  // 旧字段的标签与类型：迁移旧资料时把「资料里实际有值」的旧字段补进组定义。
  const LEGACY_FIELD_LABELS=Object.freeze({
    summary:{label:'摘要',kind:'text'},
    details:{label:'详细设定',kind:'multiline'},
    attributeA:{label:'属性一',kind:'text'},
    attributeB:{label:'属性二',kind:'text'},
    attributeC:{label:'属性三',kind:'text'},
    constraints:{label:'限制与边界',kind:'lines'},
    openQuestions:{label:'开放问题',kind:'lines'},
    environment:{label:'环境与交通',kind:'text'}
  });

  const MAX_GROUPS=40,MAX_FIELDS=16,ID_PATTERN=/^[a-z][a-z0-9_-]{0,31}$/,FIELD_KEY_PATTERN=/^[a-z][A-Za-z0-9]{0,31}$/;
  const LABEL_LIMIT=40,ATTRIBUTE_LIMIT=24,ICON_LIMIT=2,WORLD_LIMIT=32,HINT_LIMIT=300,PROMPT_LIMIT=4000;

  function text(value,limit){return String(value??'').trim().slice(0,limit)}
  function normalizeForm(value){const form=text(value,20);return FORMS.includes(form)?form:'generic'}
  function normalizeKind(value){const kind=text(value,16);return FIELD_KINDS.includes(kind)?kind:'text'}
  function normalizeField(raw,index){
    const source=raw&&typeof raw==='object'?raw:{},rawKey=text(source.key,32),key=FIELD_KEY_PATTERN.test(rawKey)?rawKey:`field${index+1}`;
    return{key,label:text(source.label,ATTRIBUTE_LIMIT)||key,kind:normalizeKind(source.kind),hint:text(source.hint,HINT_LIMIT)};
  }
  /** 字段列表：去重（同 key 只留第一个）、限长、至少一个。 */
  function normalizeFields(value,fallback=MINIMAL_FIELDS){
    const list=Array.isArray(value)?value:[],seen=new Set(),out=[];
    list.forEach((raw,index)=>{
      const item=normalizeField(raw,index);
      if(seen.has(item.key)||out.length>=MAX_FIELDS)return;
      seen.add(item.key);out.push(item);
    });
    if(out.length)return out;
    return (Array.isArray(fallback)?fallback:MINIMAL_FIELDS).map((raw,index)=>normalizeField(raw,index));
  }
  function normalizeGroup(raw){
    const source=raw&&typeof raw==='object'?raw:{},id=text(source.id,32);
    if(!ID_PATTERN.test(id))return null;
    const builtin=FIXED_GROUPS.find(item=>item.id===id),legacy=LEGACY_GROUPS[id];
    const fallbackFields=builtin?builtin.defaultFields:legacy?legacy.defaultFields:MINIMAL_FIELDS;
    return{
      id,
      worldId:text(source.worldId,WORLD_LIMIT),
      label:text(source.label,LABEL_LIMIT)||builtin?.label||legacy?.label||id,
      icon:text(source.icon,ICON_LIMIT)||builtin?.icon||legacy?.icon||'·',
      form:normalizeForm(source.form||builtin?.form||legacy?.form),
      prompt:text(source.prompt,PROMPT_LIMIT),
      fields:normalizeFields(source.fields,fallbackFields),
      fixed:FIXED_IDS.has(id),
      custom:!FIXED_IDS.has(id)
    };
  }
  function groupKey(group){return`${group.worldId||''}|${group.id}`}
  /** 落库用的规范化：保留固定组的「覆盖行」（worldId 固定为空），视图层会把它合并成固定组。 */
  function normalizeStoredGroups(value){
    const seen=new Set(),out=[];
    (Array.isArray(value)?value:[]).forEach(raw=>{
      const group=normalizeGroup(raw);
      if(!group)return;
      if(group.fixed)group.worldId='';
      const key=groupKey(group);
      if(seen.has(key)||out.length>=MAX_GROUPS+10)return;
      seen.add(key);out.push(group);
    });
    return out;
  }
  function normalizeGroups(value){
    const seen=new Set(),out=[];
    (Array.isArray(value)?value:[]).forEach(raw=>{
      const group=normalizeGroup(raw);
      if(!group||group.fixed)return;
      const key=groupKey(group);
      if(seen.has(key)||out.length>=MAX_GROUPS)return;
      seen.add(key);out.push(group);
    });
    return out;
  }
  /** 固定组的字段/提示也可以被作者改：共享范围（worldId 为空）的固定组记录就是覆盖层。 */
  function materializeFixed(storedGroups){
    const saved=normalizeStoredGroups(storedGroups).filter(group=>group.fixed&&!group.worldId);
    return FIXED_GROUPS.map(fixed=>{
      const override=saved.find(group=>group.id===fixed.id);
      return normalizeGroup({...fixed,fields:override?override.fields:fixed.defaultFields,prompt:override?override.prompt:''});
    });
  }
  function allGroups(custom){const groups=normalizeStoredGroups(custom);return[...materializeFixed(groups),...groups.filter(group=>!group.fixed&&Boolean(group.worldId))]}
  function isFixedGroup(id){return FIXED_IDS.has(String(id||''))}
  function groupOf(groups,id){
    const target=String(id||'').trim();
    return(Array.isArray(groups)?groups:allGroups([])).find(group=>group.id===target)||null;
  }
  /** 组 → 生图档位：固定组按 id，自定义组按 form 归到最近的一档。 */
  function imageKey(group){const id=typeof group==='string'?group:(group&&group.id)||'';if(IMAGE_KEYS.includes(id))return id;const form=typeof group==='object'?normalizeForm(group.form):'';if(form==='geography')return'location';if(form==='chronicle')return'timeline';if(form==='story')return'story';return'other'}
  function promptKey(id){const target=String(id||'').trim();return PROMPT_KEYS.includes(target)?target:'world'}
  function slugify(label){const ascii=String(label||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,24);return ID_PATTERN.test(ascii)?ascii:''}
  function nextGroupId(label,groups,worldId){
    const scope=text(worldId,WORLD_LIMIT);
    const used=new Set([...FIXED_IDS,...(Array.isArray(groups)?groups:[]).filter(group=>(group.worldId||'')===scope).map(group=>group.id)]);
    const slug=slugify(label),base=slug||'group';
    if(!used.has(base))return base;
    let index=2;
    while(used.has(`${base}-${index}`))index+=1;
    return`${base}-${index}`;
  }
  function createGroup(label,{form,fields,icon,groups,worldId,prompt}={}){
    const name=text(label,LABEL_LIMIT)||'新资料组';
    return normalizeGroup({id:nextGroupId(name,groups,worldId),worldId:text(worldId,WORLD_LIMIT),label:name,icon:icon||'·',form:form||'generic',fields:fields||MINIMAL_FIELDS,prompt:prompt||''});
  }
  /** 只保留与某个世界相关的组：本世界的排在共享组之前，同 id 时本世界的优先。 */
  function groupsForWorld(customGroups,worldId){
    const world=text(worldId,WORLD_LIMIT),groups=normalizeGroups(customGroups),seen=new Set(),out=[];
    groups.filter(group=>!group.fixed&&world&&group.worldId===world).forEach(group=>{if(seen.has(group.id))return;seen.add(group.id);out.push(group)});
    groups.filter(group=>!group.fixed&&!group.worldId).forEach(group=>{if(seen.has(group.id))return;seen.add(group.id);out.push(group)});
    return out;
  }
  /**
   * 旧数据迁移（0.3.1 之前）：组没有 worldId / fields / prompt。
   * worldId 按实际使用情况推断：只在一个世界用到 → 收窄到该世界；跨世界或没有资料 → 共享。
   * 幂等：写过一次之后该行就带这些字段，不再被推断。
   */
  function migrateLegacyGroups(groups,entries){
    const list=Array.isArray(groups)?groups:[],rows=Array.isArray(entries)?entries:[];
    return list.filter(group=>group&&typeof group==='object').map(group=>{
      const next={...group};
      if(!Object.prototype.hasOwnProperty.call(group,'worldId')){
        const worlds=[...new Set(rows.filter(entry=>String(entry?.type||'').trim()===String(group.id||'').trim()).map(entry=>text(entry?.worldId,WORLD_LIMIT)))];
        next.worldId=worlds.length===1?worlds[0]:'';
      }
      if(!Array.isArray(group.fields)){
        const legacy=LEGACY_GROUPS[group.id]||FIXED_GROUPS.find(item=>item.id===group.id);
        // 老版本的组配置里有 attributes:[a,b,c]（作者可能改过标签），优先按它转成三个 text 字段。
        if(Array.isArray(group.attributes)&&group.attributes.length){
          next.fields=[
            field('summary','摘要','text'),
            field('details','正文','multiline'),
            ...group.attributes.slice(0,3).map((label,index)=>field(`attribute${'ABC'[index]}`,text(label,ATTRIBUTE_LIMIT)||`属性 ${index+1}`,'text')),
            field('constraints','限制与边界','lines'),
            field('openQuestions','开放问题','lines')
          ];
        }else if(legacy)next.fields=legacy.defaultFields;
      }
      if(typeof group.prompt!=='string')next.prompt='';
      return next;
    });
  }
  /**
   * 保证「当前世界里出现过的 type」都有对应组：无法识别的 type 原样建组（最小字段集）。
   * 只新增、不修改已有组，且只按该世界的资料派生。`worldId` 省略时保持旧的全局行为。
   */
  function deriveGroups(entries,customGroups,worldId){
    const scoped=worldId!==undefined&&worldId!==null,world=text(worldId,WORLD_LIMIT);
    const groups=scoped?groupsForWorld(customGroups,world):normalizeStoredGroups(customGroups).filter(group=>!group.fixed);
    const used=new Set([...FIXED_IDS,...groups.map(group=>group.id)]);
    (Array.isArray(entries)?entries:[]).forEach(entry=>{
      if(scoped&&text(entry?.worldId,WORLD_LIMIT)!==world)return;
      const type=text(entry?.type,32);
      if(!type||used.has(type)||groups.length>=MAX_GROUPS)return;
      const legacy=LEGACY_GROUPS[type],scope=scoped?world:'';
      const group=normalizeGroup(legacy?{id:type,...legacy,worldId:scope}:{id:type,label:type,icon:'·',form:'generic',worldId:scope});
      if(!group)return;
      used.add(type);groups.push(group);
    });
    return groups;
  }
  function groupForEntry(entries,customGroups,type,worldId){
    return groupOf(allGroups(deriveGroups(entries,customGroups,worldId)),type)||groupOf(allGroups([]),'world');
  }
  /** 字段 → agent 的返回 JSON 约束（与 ai-content-specs 的 blockSchema 同源）。 */
  function fieldSchema(item){
    if(item.kind==='lines')return{type:'array',items:{type:'string'},maxItems:12};
    if(item.kind==='number')return{type:['number','null']};
    if(item.kind==='multiline')return{type:'string',maxLength:16000};
    return{type:'string',maxLength:2000};
  }
  function groupResponseSchema(group){
    const fields=(group&&group.fields)||MINIMAL_FIELDS;
    return{
      type:'object',
      additionalProperties:false,
      required:['variants'],
      properties:{
        variants:{
          type:'array',
          items:{
            type:'object',
            additionalProperties:false,
            required:['key','content'],
            properties:{
              key:{type:'string'},
              content:{type:'object',additionalProperties:false,required:['name',...fields.map(item=>item.key)],properties:{name:{type:'string'},...Object.fromEntries(fields.map(item=>[item.key,fieldSchema(item)]))}}
            }
          }
        }
      }
    };
  }
  return{FORMS,FIELD_KINDS,DEFAULT_FIELDS,LEGACY_FIELD_LABELS,FIXED_GROUPS,FIXED_IDS,LEGACY_GROUPS,PROMPT_KEYS,IMAGE_KEYS,MINIMAL_FIELDS,MAX_GROUPS,MAX_FIELDS,ID_PATTERN,FIELD_KEY_PATTERN,normalizeField,normalizeFields,normalizeGroup,normalizeGroups,normalizeStoredGroups,allGroups,isFixedGroup,groupOf,groupKey,imageKey,promptKey,slugify,nextGroupId,createGroup,groupsForWorld,migrateLegacyGroups,deriveGroups,groupForEntry,fieldSchema,groupResponseSchema};
});
