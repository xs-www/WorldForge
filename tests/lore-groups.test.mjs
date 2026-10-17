import test from 'node:test';
import assert from 'node:assert/strict';
await import('../dist/lore-groups.js');
await import('../lore-groups.mjs');
const groups = globalThis.WorldforgeLoreGroups;

test('只有五个固定资料组，其余全部由作者自定义', () => {
  assert.deepEqual(groups.FIXED_GROUPS.map(group => group.id), ['world', 'info', 'character', 'timeline', 'story']);
  assert.deepEqual(groups.FIXED_GROUPS.map(group => group.label), ['世界', '世界信息', '角色', '编年史', '背景故事']);
  for (const group of groups.FIXED_GROUPS) {
    assert.equal(group.fixed, true);
    assert.equal(group.attributes.length, 3);
    assert.ok(groups.FORMS.includes(group.form));
  }
  // 固定组的 form 决定编年史树与地理树，不依赖题材。
  assert.equal(groups.FIXED_GROUPS.find(group => group.id === 'timeline').form, 'chronicle');
  assert.equal(groups.FIXED_GROUPS.find(group => group.id === 'story').form, 'story');
});

test('自定义组规范化：拒绝固定组 id、重复 id、非法 id，并限制数量', () => {
  const normalized = groups.normalizeGroups([
    { id: 'world', label: '世界' },
    { id: 'faction', label: '势力', attributes: ['类型', '首领', '据点'] },
    { id: 'faction', label: '重复' },
    { id: '非法 ID', label: '非法' },
    { id: 'g-ok', label: '合法' }, { id: 'g-ok-2', label: '' }
  ]);
  assert.deepEqual(normalized.map(group => group.id), ['faction', 'g-ok', 'g-ok-2']);
  assert.deepEqual(normalized[0].attributes, ['类型', '首领', '据点']);
  assert.equal(normalized[2].label, 'g-ok-2');
  for (const group of normalized) assert.equal(group.custom, true);
  const many = Array.from({ length: groups.MAX_GROUPS + 5 }, (_, index) => ({ id: `g-${index}`, label: `组 ${index}` }));
  assert.equal(groups.normalizeGroups(many).length, groups.MAX_GROUPS);
});

test('新建资料组使用稳定 id，且不会撞号', () => {
  assert.equal(groups.slugify('Faction'), 'faction');
  // 中文标签无法生成 ASCII slug，回落到 group-N 形式，仍然稳定可预测。
  assert.equal(groups.slugify('势力'), '');
  const created = groups.createGroup('势力', { groups: [], attributes: ['a', 'b', 'c'] });
  assert.equal(created.id, 'group');
  assert.ok(groups.ID_PATTERN.test(created.id));
  assert.equal(created.label, '势力');
  assert.deepEqual(created.attributes, ['a', 'b', 'c']);
  const first = groups.createGroup('Lore', { groups: [] });
  const second = groups.createGroup('Lore', { groups: [first] });
  const third = groups.createGroup('势力', { groups: [created, first, second] });
  assert.equal(first.id, 'lore');
  assert.equal(second.id, 'lore-2');
  assert.equal(third.id, 'group-2');
});

test('旧十三类资料自动派生为自定义组，且不改写资料 type', () => {
  const entries = [
    { id: 'W01', type: 'world', worldId: 'W01' },
    { id: 'FAC-W01-001', type: 'faction', worldId: 'W01' },
    { id: 'LOC-W01-001', type: 'location', worldId: 'W01' },
    { id: 'MAG-W01-001', type: 'magic', worldId: 'W01' },
    { id: 'X-1', type: 'homebrew', worldId: 'W01' }
  ];
  const derived = groups.deriveGroups(entries, []);
  assert.deepEqual(derived.map(group => group.id), ['faction', 'location', 'magic', 'homebrew']);
  assert.equal(derived.find(group => group.id === 'faction').label, '势力');
  assert.equal(derived.find(group => group.id === 'location').form, 'geography');
  assert.equal(derived.find(group => group.id === 'magic').label, '力量体系');
  // 无法识别的 type 原样建组，标签就是 id，作者可以随后改名。
  assert.equal(derived.find(group => group.id === 'homebrew').label, 'homebrew');
  // 固定 type 不会被派生成自定义组。
  assert.ok(!derived.some(group => group.id === 'world'));
  // 重复派生是幂等的。
  assert.deepEqual(groups.deriveGroups(entries, derived).map(group => group.id), derived.map(group => group.id));
});

test('提示词档位收敛到五个固定键，未知组落到世界信息档', () => {
  assert.equal(groups.promptKey('world'), 'world');
  assert.equal(groups.promptKey('info'), 'info');
  assert.equal(groups.promptKey('character'), 'character');
  assert.equal(groups.promptKey('timeline'), 'timeline');
  assert.equal(groups.promptKey('story'), 'story');
  assert.equal(groups.promptKey('faction'), 'info');
  assert.equal(groups.promptKey('homebrew'), 'info');
  assert.equal(groups.promptKey(''), 'info');
  assert.deepEqual(groups.PROMPT_KEYS, ['world', 'info', 'character', 'timeline', 'story']);
});

test('groupForEntry 找不到组时回落到世界信息，而不是世界', () => {
  const fallback = groups.groupForEntry([], [], 'nope');
  assert.equal(fallback.id, 'info');
  const derived = groups.groupForEntry([{ id: 'F-1', type: 'faction' }], [], 'faction');
  assert.equal(derived.label, '势力');
});

test('服务端包装层与浏览器侧共享同一张表', async () => {
  const server = await import('../lore-groups.mjs');
  assert.equal(server.FIXED_GROUPS.length, 5);
  assert.equal(server.promptKeyOf('faction'), 'info');
  assert.equal(server.MAX_LORE_GROUPS, groups.MAX_GROUPS);
  assert.deepEqual(server.deriveLoreGroups([{ id: 'F-1', type: 'faction' }], []).map(group => group.label), ['势力']);
  const sanitized = server.sanitizeLoreGroup({ id: 'faction', label: '势力', form: 'generic', attributes: ['a', 'b', 'c'] });
  assert.deepEqual(sanitized, { id: 'faction', label: '势力', form: 'generic', attributes: ['a', 'b', 'c'], custom: true });
  assert.equal(server.sanitizeLoreGroup({ id: '非法 ID' }), null);
});
