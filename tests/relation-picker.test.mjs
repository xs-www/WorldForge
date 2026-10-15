import test from 'node:test';
import assert from 'node:assert/strict';
await import('../dist/world-scope.js');
await import('../dist/relation-picker.js');
const picker=globalThis.WorldforgeRelationPicker;

const entry=(id,type,worldId,name,extra={})=>({id,type,worldId,name,summary:'',details:'',tags:[],status:'proposed',...extra});
const all=[
  entry('W01','world','W01','魔导工业世界',{status:'canon',summary:'蒸汽与魔法'}),
  entry('FAC-W01-001','faction','W01','工业联盟',{status:'canon'}),
  entry('CHR-W01-001','character','W01','技工长'),
  entry('MAG-W01-001','magic','W01','火系术式',{tags:['以太']}),
  entry('FAC-W02-001','faction','W02','深海议会'),
];

test('the current entry is never offered as its own relation',()=>{
  const result=picker.filter(all,{excludeId:'FAC-W01-001',worldMode:'all'});
  assert.equal(result.some(item=>item.id==='FAC-W01-001'),false);
  assert.equal(result.length,4);
});

test('the pool defaults to the current world and can reach other worlds',()=>{
  assert.deepEqual(picker.filter(all,{currentWorldId:'W01',worldMode:'current'}).map(item=>item.id),['W01','FAC-W01-001','CHR-W01-001','MAG-W01-001']);
  assert.deepEqual(picker.filter(all,{currentWorldId:'W01',worldMode:'other'}).map(item=>item.id),['FAC-W02-001']);
  assert.equal(picker.filter(all,{currentWorldId:'W01',worldMode:'all'}).length,5);
  // 没有当前世界时不做世界收窄，避免列表空掉。
  assert.equal(picker.filter(all,{currentWorldId:'',worldMode:'current'}).length,5);
});

test('type, status and view filters compose',()=>{
  assert.deepEqual(picker.filter(all,{type:'faction',worldMode:'all'}).map(item=>item.id),['FAC-W01-001','FAC-W02-001']);
  assert.deepEqual(picker.filter(all,{status:'canon',worldMode:'all'}).map(item=>item.id),['W01','FAC-W01-001']);
  assert.deepEqual(picker.filter(all,{view:'selected',selectedIds:['CHR-W01-001'],worldMode:'all'}).map(item=>item.id),['CHR-W01-001']);
  assert.deepEqual(picker.filter(all,{view:'unselected',selectedIds:['CHR-W01-001'],worldMode:'all'}).map(item=>item.id),['W01','FAC-W01-001','MAG-W01-001','FAC-W02-001']);
});

test('search matches name, id, summary, details and tags',()=>{
  assert.deepEqual(picker.filter(all,{query:'深海',worldMode:'all'}).map(item=>item.id),['FAC-W02-001']);
  assert.deepEqual(picker.filter(all,{query:'fac-w01',worldMode:'all'}).map(item=>item.id),['FAC-W01-001']);
  assert.deepEqual(picker.filter(all,{query:'以太',worldMode:'all'}).map(item=>item.id),['MAG-W01-001']);
  assert.deepEqual(picker.filter(all,{query:'蒸汽',worldMode:'all'}).map(item=>item.id),['W01']);
  assert.equal(picker.filter(all,{query:'不存在',worldMode:'all'}).length,0);
});

test('toggle adds then removes while preserving selection order',()=>{
  let ids=[];
  ids=picker.toggle(ids,'B');ids=picker.toggle(ids,'A');ids=picker.toggle(ids,'C');
  assert.deepEqual(ids,['B','A','C']);
  ids=picker.toggle(ids,'A');
  assert.deepEqual(ids,['B','C']);
  assert.deepEqual(picker.toggle(ids,''),['B','C']);
  assert.deepEqual(picker.remove(ids,'B'),['C']);
  assert.deepEqual(picker.remove(ids,'ZZ'),['B','C']);
});

test('summarize follows selection order and reports dangling ids',()=>{
  assert.deepEqual(picker.summarize(['MAG-W01-001','W01'],all).map(item=>item.id),['MAG-W01-001','W01']);
  assert.deepEqual(picker.summarize(['GONE-1','W01'],all).map(item=>item.id),['W01']);
  assert.equal(picker.missingCount(['GONE-1','W01'],all),1);
  assert.equal(picker.missingCount([],all),0);
});
