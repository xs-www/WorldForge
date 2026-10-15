import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_LIMITS, FREE_AGENT_TOOLS, FREE_AGENT_TOOL_NAMES, prepareLibrary, runToolCall } from '../ai-tools.mjs';

const entry=(id,type,name,extra={})=>({id,type,name,status:'proposed',truthScope:'objective',worldId:'W01',summary:'',details:'',tags:[],relationIds:[],...extra});
const library=prepareLibrary([
  entry('FAC-W01-001','faction','工业联盟',{status:'canon',summary:'由多个工业城市组成',details:'以蕴魔矿贸易为核心',tags:['魔导工业']}),
  entry('CHR-W01-001','character','技工长',{details:'出身矿区，精通符文通路'}),
  entry('MAG-W01-001','magic','火系术式',{summary:'基础派系',details:'以太亲和引导热能',tags:['以太']}),
  entry('FAC-W02-001','faction','深海议会',{worldId:'W02'})
]);

test('the tool set is read-only and namespaced',()=>{
  assert.deepEqual(FREE_AGENT_TOOL_NAMES,['search_lore','get_lore_entry','list_lore']);
  assert.equal(FREE_AGENT_TOOLS.every(tool=>tool.parameters.type==='object'&&tool.parameters.additionalProperties===false),true);
});

test('prepareLibrary drops entries without an id and caps oversized text',()=>{
  const prepared=prepareLibrary([{type:'faction',name:'无 ID'},entry('X','faction','有 ID',{details:'字'.repeat(AGENT_LIMITS.maxDetails+500)})]);
  assert.deepEqual(prepared.map(item=>item.id),['X']);
  assert.equal(prepared[0].details.length,AGENT_LIMITS.maxDetails);
  assert.deepEqual(prepareLibrary(null),[]);
});

test('search_lore matches name, id, summary, details and tags',()=>{
  assert.deepEqual(JSON.parse(runToolCall('search_lore',{query:'工业'},library).content).matches.map(m=>m.id),['FAC-W01-001']);
  assert.deepEqual(JSON.parse(runToolCall('search_lore',{query:'chr-w01'},library).content).matches.map(m=>m.id),['CHR-W01-001']);
  assert.deepEqual(JSON.parse(runToolCall('search_lore',{query:'蕴魔矿'},library).content).matches.map(m=>m.id),['FAC-W01-001']);
  assert.deepEqual(JSON.parse(runToolCall('search_lore',{query:'以太'},library).content).matches.map(m=>m.id),['MAG-W01-001']);
  assert.deepEqual(JSON.parse(runToolCall('search_lore',{query:'魔导工业'},library).content).matches.map(m=>m.id),['FAC-W01-001']);
  assert.equal(JSON.parse(runToolCall('search_lore',{query:'不存在'},library).content).total,0);
});

test('search_lore honours type, world and status filters plus the limit clamp',()=>{
  assert.deepEqual(JSON.parse(runToolCall('search_lore',{query:'',type:'faction'},library).content).matches.map(m=>m.id),['FAC-W01-001','FAC-W02-001']);
  assert.deepEqual(JSON.parse(runToolCall('search_lore',{query:'',worldId:'W02'},library).content).matches.map(m=>m.id),['FAC-W02-001']);
  assert.deepEqual(JSON.parse(runToolCall('search_lore',{query:'',status:'canon'},library).content).matches.map(m=>m.id),['FAC-W01-001']);
  assert.equal(JSON.parse(runToolCall('search_lore',{query:'',limit:999},library).content).matches.length<=AGENT_LIMITS.searchLimit,true);
  // 摘要级结果不应带正文，避免模型凭摘要臆测内容
  assert.equal('details' in JSON.parse(runToolCall('search_lore',{query:'工业'},library).content).matches[0],false);
});

test('get_lore_entry returns full entries and reports missing ids',()=>{
  const result=JSON.parse(runToolCall('get_lore_entry',{ids:['FAC-W01-001','NOPE-1']},library).content);
  assert.deepEqual(result.entries.map(item=>item.id),['FAC-W01-001']);
  assert.deepEqual(result.missing,['NOPE-1']);
  assert.equal(result.entries[0].details,'以蕴魔矿贸易为核心');
  assert.deepEqual(result.entries[0].constraints,[]);
});

test('get_lore_entry rejects an empty id list and clamps to five',()=>{
  const empty=runToolCall('get_lore_entry',{ids:[]},library);
  assert.equal(empty.ok,false);
  const many=JSON.parse(runToolCall('get_lore_entry',{ids:library.map(item=>item.id)},library).content);
  assert.ok(many.entries.length<=AGENT_LIMITS.getLimit);
  assert.equal(many.missing.length,Math.max(0,library.length-AGENT_LIMITS.getLimit));
});

test('list_lore returns an index without bodies',()=>{
  const result=JSON.parse(runToolCall('list_lore',{type:'faction'},library).content);
  assert.equal(result.total,2);
  assert.deepEqual(Object.keys(result.entries[0]).sort(),['id','name','status','type','worldId']);
  assert.equal(JSON.parse(runToolCall('list_lore',{limit:999},library).content).returned<=AGENT_LIMITS.listLimit,true);
});

test('unknown tools and unusable arguments come back as recoverable errors',()=>{
  const unknown=runToolCall('delete_everything',{},library);
  assert.equal(unknown.ok,false);
  assert.match(unknown.content,/未知工具/);
  assert.deepEqual(runToolCall('search_lore',null,library).ok,true);
  assert.deepEqual(runToolCall('search_lore',['not','an','object'],library).ok,true);
});

test('oversized tool output is clipped with an explicit note',()=>{
  const huge=prepareLibrary([entry('BIG','world','大条目',{details:'字'.repeat(AGENT_LIMITS.maxDetails)})]);
  const result=runToolCall('get_lore_entry',{ids:['BIG']},huge);
  assert.ok(result.content.length<=AGENT_LIMITS.resultChars+200);
  assert.match(result.content,/truncated/);
});
