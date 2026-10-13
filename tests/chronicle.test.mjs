import test from 'node:test';
import assert from 'node:assert/strict';

await import('../dist/chronicle.js');
const chronicle = globalThis.WorldforgeChronicle;

const timeline = (id, name, kind = 'chronicle', parentId = '', dateLabel = '', order = null, worldId = 'W01') => ({
  id, name, type: 'timeline', worldId, summary: '', details: '', tags: [],
  chronicle: { kind, parentId, dateLabel, order }
});

test('chronicle groups entries and sorts them by explicit order', () => {
  const root = timeline('TML-ROOT', '第一纪编年史');
  const later = timeline('TML-LATER', '第二次远征', 'entry', root.id, '炉历 22 年', 22);
  const earlier = timeline('TML-EARLIER', '第一座以太炉', 'entry', root.id, '炉历 3 年', 3);
  const tree = chronicle.build([later, root, earlier]);

  assert.deepEqual(tree.roots.map(entry => entry.id), [root.id]);
  assert.deepEqual(tree.children.get(root.id).map(entry => entry.id), [earlier.id, later.id]);
  assert.equal(tree.orphans.length, 0);
});

test('chronicle search preserves its parent and isolates invalid nodes', () => {
  const root = timeline('TML-ROOT', '第一纪编年史');
  const entry = timeline('TML-ENTRY', '雾港建立', 'entry', root.id, '炉历 8 年', 8);
  const orphan = timeline('TML-ORPHAN', '失落记录', 'entry', 'MISSING', '未知年', null);
  const tree = chronicle.build([root, entry, orphan], '雾港');

  assert.deepEqual([...tree.visibleIds], [entry.id, root.id]);
  assert.deepEqual(tree.orphans.map(item => item.id), [orphan.id]);
  assert.equal(chronicle.canParent(root, entry, 'W01'), true);
  assert.equal(chronicle.canParent(root, entry, 'W02'), false);
  assert.equal(chronicle.normalize({}, true).kind, 'chronicle');
});
