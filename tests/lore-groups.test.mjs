import test from 'node:test';
import assert from 'node:assert/strict';
await import('../dist/lore-groups.js');
const groups = globalThis.WorldforgeLoreGroups;

test('五个固定资料组：世界 / 世界地图 / 角色 / 编年史 / 背景故事', () => {
  assert.deepEqual(groups.FIXED_GROUPS.map(group => group.id), ['world', 'location', 'character', 'timeline', 'story']);
  assert.deepEqual(groups.FIXED_GROUPS.map(group => group.label), ['世界', '世界地图', '角色', '编年史', '背景故事']);
  for (const group of groups.FIXED_GROUPS) {
    assert.equal(group.fixed, true);
    assert.ok(groups.FORMS.includes(group.form));
  }
  assert.equal(groups.FIXED_GROUPS.find(group => group.id === 'location').form, 'geography');
  assert.equal(groups.FIXED_GROUPS.find(group => group.id === 'timeline').form, 'chronicle');
  assert.equal(groups.FIXED_GROUPS.find(group => group.id === 'story').form, 'story');
});

test('固定字段只有「名称」和「详细设定」：默认字段就是一段多行正文', () => {
  assert.deepEqual(groups.MINIMAL_FIELDS.map(item => item.key), ['details']);
  assert.equal(groups.MINIMAL_FIELDS[0].label, '详细设定');
  assert.equal(groups.MINIMAL_FIELDS[0].kind, 'multiline');
  // 固定组没有额外的「必须有」字段：摘要、属性、约束、开放问题都要作者自己加。
  for (const group of groups.FIXED_GROUPS) {
    assert.deepEqual(group.defaultFields.map(item => item.key), ['details'], group.id);
  }
  // 「名称」由契约层固定提供，不占字段位。
  assert.deepEqual(groups.normalizeGroup({ id: 'world' }).fields.map(item => item.key), ['details']);
});

test('字段列表规范化：类型白名单、去重、上限、空列表回落默认', () => {
  const normalized = groups.normalizeFields([
    { key: 'summary', label: '摘要', kind: 'text' },
    { key: 'summary', label: '重复', kind: 'text' },
    { key: 'notes', label: '', kind: 'weird' },
    ...Array.from({ length: 20 }, (_, index) => ({ key: `extra${index}`, label: `额外 ${index}`, kind: 'lines' }))
  ]);
  assert.equal(normalized[0].key, 'summary');
  assert.equal(normalized[1].key, 'notes');
  assert.equal(normalized[1].label, 'notes', '缺标签时用 key 兜底');
  assert.equal(normalized[1].kind, 'text', '未知类型回落单行文本');
  assert.equal(normalized.length, groups.MAX_FIELDS);
  assert.deepEqual(groups.normalizeFields([]).map(item => item.key), ['details']);
});

test('自定义组规范化：拒绝固定 id 与非法 id，作用范围保留', () => {
  const normalized = groups.normalizeGroups([
    { id: 'world', label: '世界' },
    { id: 'faction', worldId: 'W01', label: '势力', fields: [{ key: 'details', label: '正文', kind: 'multiline' }] },
    { id: 'faction', worldId: 'W02', label: '势力' },
    { id: '非法 ID', label: '非法' }
  ]);
  assert.deepEqual(normalized.map(group => `${group.worldId}:${group.id}`), ['W01:faction', 'W02:faction']);
  assert.equal(normalized[0].fields[0].label, '正文');
  // 落库规范化会保留固定组的覆盖行（字段/提示可改），视图层再合并。
  const stored = groups.normalizeStoredGroups([{ id: 'world', fields: [{ key: 'details', label: '世界正文', kind: 'multiline' }] }]);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].fixed, true);
  assert.equal(stored[0].worldId, '');
  assert.equal(groups.allGroups(stored).find(group => group.id === 'world').fields[0].label, '世界正文');
});

test('新建资料组默认只有「详细设定」，可加任意块，id 在同一作用范围内唯一', () => {
  const local = groups.createGroup('势力', { groups: [], worldId: 'W01' });
  assert.equal(local.worldId, 'W01');
  assert.deepEqual(local.fields.map(item => item.key), ['details']);
  const shared = groups.createGroup('势力', { groups: [local], worldId: '' });
  assert.equal(shared.worldId, '');
  const other = groups.createGroup('势力', { groups: [local], worldId: 'W02' });
  assert.equal(other.id, local.id, '不同世界可以同 id');
  const same = groups.createGroup('势力', { groups: [local], worldId: 'W01' });
  assert.equal(same.id, 'group-2');
  const withFields = groups.createGroup('历法', { groups: [], worldId: 'W01', fields: [{ key: 'details', label: '正文', kind: 'multiline' }, { key: 'era', label: '纪元', kind: 'number' }] });
  assert.equal(withFields.fields.length, 2);
  assert.equal(withFields.fields[1].kind, 'number');
});

test('组的作用范围：本世界优先于共享组，同 id 不冲突', () => {
  const shared = { id: 'faction', worldId: '', label: '共享势力', form: 'generic' };
  const local = { id: 'faction', worldId: 'W01', label: '本世界势力', form: 'generic' };
  assert.deepEqual(groups.groupsForWorld([shared, local], 'W01').map(group => group.label), ['本世界势力']);
  assert.deepEqual(groups.groupsForWorld([shared, local], 'W02').map(group => group.label), ['共享势力']);
  assert.equal(groups.groupsForWorld([shared, local], 'W03').length, 1);
  // 固定组不进「世界关系」列表（它们由 materializeFixed 提供）。
  assert.deepEqual(groups.groupsForWorld([{ id: 'world' }], 'W01'), []);
});

test('按世界派生：新世界不会凭空出现旧组', () => {
  const entries = [
    { id: 'W01', type: 'world', worldId: 'W01' },
    { id: 'FAC-W01-001', type: 'faction', worldId: 'W01' },
    { id: 'SPC-W01-001', type: 'species', worldId: 'W01' },
    { id: 'W02', type: 'world', worldId: 'W02' }
  ];
  const forW01 = groups.deriveGroups(entries, [], 'W01');
  const forW02 = groups.deriveGroups(entries, [], 'W02');
  assert.deepEqual(forW01.map(group => group.id), ['faction', 'species']);
  assert.deepEqual(forW02, []);
  assert.ok(forW01.every(group => group.worldId === 'W01'));
  assert.deepEqual(groups.allGroups(forW02).map(group => group.id), ['world', 'location', 'character', 'timeline', 'story']);
});

test('旧组数据迁移：补 worldId 与字段，老 attributes 变成三个字段', () => {
  const entries = [{ id: 'FAC-1', type: 'faction', worldId: 'W01' }];
  const migrated = groups.migrateLegacyGroups([
    { id: 'faction', label: '势力', form: 'generic', attributes: ['类型', '首领', '据点'] }
  ], entries);
  assert.equal(migrated[0].worldId, 'W01', '只在一个世界用到就收窄到该世界');
  assert.ok(Array.isArray(migrated[0].fields));
  assert.deepEqual(migrated[0].fields.map(item => item.label).slice(0, 5), ['摘要', '正文', '类型', '首领', '据点']);
  assert.equal(migrated[0].prompt, '');
  const shared = groups.migrateLegacyGroups([{ id: 'faction' }], [{ id: 'A', type: 'faction', worldId: 'W01' }, { id: 'B', type: 'faction', worldId: 'W02' }]);
  assert.equal(shared[0].worldId, '');
  assert.deepEqual(groups.migrateLegacyGroups(migrated, entries), migrated, '迁移必须幂等');
});

test('组的返回 JSON 约束由字段生成（给 Agent）', () => {
  const schema = groups.groupResponseSchema({ fields: [{ key: 'summary', label: '摘要', kind: 'text' }, { key: 'notes', label: '条目', kind: 'lines' }, { key: 'order', label: '排序', kind: 'number' }] });
  const content = schema.properties.variants.items.properties.content;
  assert.deepEqual(content.required, ['name', 'summary', 'notes', 'order']);
  assert.equal(content.properties.summary.type, 'string');
  assert.equal(content.properties.notes.type, 'array');
  assert.deepEqual(content.properties.order.type, ['number', 'null']);
  assert.equal(content.additionalProperties, false);
});

test('生图档位按表单形态归一', () => {
  assert.equal(groups.imageKey('world'), 'world');
  assert.equal(groups.imageKey('location'), 'location');
  assert.equal(groups.imageKey({ id: 'faction', form: 'generic' }), 'other');
  assert.equal(groups.imageKey({ id: 'terrain', form: 'geography' }), 'location');
  assert.equal(groups.imageKey({ id: 'era', form: 'chronicle' }), 'timeline');
  assert.equal(groups.imageKey({ id: 'tale', form: 'story' }), 'story');
});

test('服务端包装层与浏览器侧共享同一张表', async () => {
  const server = await import('../lore-groups.mjs');
  assert.equal(server.FIXED_GROUPS.length, 5);
  assert.equal(server.MAX_LORE_GROUPS, groups.MAX_GROUPS);
  assert.deepEqual(server.MINIMAL_FIELDS.map(item => item.key), ['details']);
  assert.equal(server.fallbackGroup('magic').label, '力量体系');
  // 请求没带组时用旧字段集兜底，旧客户端不会掉字段。
  assert.equal(server.fallbackGroup('magic').fields[0].key, 'summary');
  assert.equal(server.fallbackGroup('nope').id, 'world');
  assert.equal(server.imageKeyForId('location'), 'location');
  assert.equal(server.imageKeyForId('magic'), 'other');
  const sanitized = server.sanitizeLoreGroup({ id: 'faction', label: '势力', fields: [{ key: 'details', label: '正文', kind: 'multiline' }] });
  assert.equal(sanitized.label, '势力');
  assert.equal(sanitized.fields[0].key, 'details');
  assert.equal(server.sanitizeLoreGroup({ id: '非法 ID' }), null);
  assert.equal(server.promptKeyOf('faction'), 'world');
});
