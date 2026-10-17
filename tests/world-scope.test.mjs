import test from 'node:test';
import assert from 'node:assert/strict';
await import('../dist/world-scope.js');
const scope=globalThis.WorldforgeWorldScope;

const entry=(id,type,worldId,name=id)=>({id,type,worldId,name});

test('entries group by worldId and keep the world entry as the group head',()=>{
  const groups=scope.groups([
    entry('W01','world','W01','魔导工业世界'),
    entry('FAC-W01-001','faction','W01','工业联盟'),
    entry('CHR-W01-001','character','W01','技工'),
    entry('W02','world','W02','第二世界'),
  ]);
  assert.deepEqual(groups.map(group=>group.worldId),['W01','W02']);
  assert.equal(groups[0].world.name,'魔导工业世界');
  assert.equal(groups[0].total,2);
  assert.deepEqual(groups[0].counts,{faction:1,character:1});
  assert.equal(groups[1].total,0);
  assert.equal(groups[1].assigned,true);
});

test('a worldId without a world entry becomes an unassigned group instead of vanishing',()=>{
  const groups=scope.groups([entry('W01','world','W01'),entry('FAC-W99-001','faction','W99')]);
  const orphan=groups.find(group=>group.worldId==='W99');
  assert.equal(orphan.assigned,false);
  assert.equal(orphan.title,'未命名世界（W99）');
  assert.equal(orphan.total,1);
});

test('entries without worldId stay unassigned instead of joining a default world',()=>{
  assert.equal(scope.worldIdOf({id:'X',type:'faction'}),'');
  const groups=scope.groups([entry('W01','world','W01'),{id:'X',type:'faction'}]);
  const orphan=groups.find(group=>group.worldId==='');
  assert.equal(orphan.assigned,false);
  assert.equal(orphan.title,scope.UNASSIGNED_WORLD_TITLE);
  assert.equal(orphan.total,1);
  // 未归属桶固定排在真实世界之后，不会抢在世界前成为默认入口。
  assert.equal(groups.at(-1).worldId,'');
});

test('loreOfWorld scopes by world, keeps the unassigned bucket addressable and copies when unscoped',()=>{
  const all=[entry('W01','world','W01'),entry('FAC-W01-001','faction','W01'),entry('FAC-W02-001','faction','W02'),{id:'ORPHAN',type:'faction'}];
  assert.deepEqual(scope.loreOfWorld(all,'W01').map(item=>item.id),['W01','FAC-W01-001']);
  assert.deepEqual(scope.loreOfWorld(all,'W02').map(item=>item.id),['FAC-W02-001']);
  // 显式传空串表示「未归属桶」，而不是「全部」；不传参才是全部。
  assert.deepEqual(scope.loreOfWorld(all,'').map(item=>item.id),['ORPHAN']);
  const copy=scope.loreOfWorld(all);
  assert.equal(copy.length,4);
  assert.notEqual(copy,all);
  // 未归属资料可以被搬运进真实世界。
  assert.equal(scope.reassign(all,'','W01').moved,1);
});

test('nextWorldId allocates the lowest free two-digit world id',()=>{
  assert.equal(scope.nextWorldId([]),'W01');
  assert.equal(scope.nextWorldId([entry('W01','world','W01')]),'W02');
  assert.equal(scope.nextWorldId([entry('W01','world','W01'),entry('W02','world','W02')]),'W03');
  // 只被资料引用、没有世界条目的编号也算已占用，避免撞号。
  assert.equal(scope.nextWorldId([entry('W01','world','W01'),entry('X','faction','W02')]),'W03');
  assert.equal(scope.nextWorldId([entry('W01','world','W01'),entry('W03','world','W03')]),'W02');
});

test('world search matches title, id, summary and details',()=>{
  const groups=scope.groups([{id:'W01',type:'world',worldId:'W01',name:'魔导工业世界',summary:'蒸汽与魔法'},{id:'W02',type:'world',worldId:'W02',name:'潮汐世界',details:'深海文明'}]);
  assert.deepEqual(scope.searchWorlds(groups,'蒸汽').map(group=>group.worldId),['W01']);
  assert.deepEqual(scope.searchWorlds(groups,'w02').map(group=>group.worldId),['W02']);
  assert.deepEqual(scope.searchWorlds(groups,'深海').map(group=>group.worldId),['W02']);
  assert.equal(scope.searchWorlds(groups,'').length,2);
  assert.equal(scope.searchWorlds(groups,'不存在').length,0);
});

test('reassign moves only non-world entries and reports the count',()=>{
  const all=[entry('W01','world','W01'),entry('FAC-W99-001','faction','W99'),entry('W99','world','W99')];
  const result=scope.reassign(all,'W99','W01');
  assert.equal(result.moved,1);
  assert.equal(result.entries.find(item=>item.id==='FAC-W99-001').worldId,'W01');
  // 世界条目自身不参与搬运，避免出现 id 与 worldId 不一致的世界。
  assert.equal(result.entries.find(item=>item.id==='W99').worldId,'W99');
  assert.equal(scope.reassign(all,'W99','W99').moved,0);
  assert.equal(scope.reassign(all,'','W01').moved,0);
});
