import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';

const presetsRoot = new URL('../.agent-presets/', import.meta.url);
const presets = [
  ['card-designer', 'skills/worldforge-card-design/SKILL.md'],
  ['lore-writer', 'skills/worldforge-lore-writing/SKILL.md'],
  ['free-creator', 'skills/worldforge-free-creation/SKILL.md']
];

test('the repository ships a self-contained DSH card-designer preset', async () => {
  const required = [
    'agent.cordis.yml',
    'preset.yml',
    'skills/worldforge-card-design/SKILL.md',
    'skills/worldforge-card-design/reference/card-fields.md',
    'skills/worldforge-card-design/reference/keyword-fields.md'
  ];

  const presetRoot = new URL('card-designer/', presetsRoot);
  for (const relative of required) {
    assert.equal((await stat(new URL(relative, presetRoot))).isFile(), true, `${relative} should exist`);
  }
});

test('every WorldForge mode is a self-contained DSH preset', async () => {
  for (const [id, skill] of presets) {
    const root = new URL(`${id}/`, presetsRoot);
    for (const relative of ['agent.cordis.yml', 'preset.yml', skill]) {
      assert.equal((await stat(new URL(relative, root))).isFile(), true, `${id}/${relative} should exist`);
    }
    const composition = await readFile(new URL('agent.cordis.yml', root), 'utf8');
    assert.match(composition, /name: '@deepseek-ai\/dsh-persona'/);
    assert.match(composition, /new URL\('skills\/', baseUrl\)/);
    assert.doesNotMatch(composition, /dsh-tool-(?:bash|pwsh|jobs|subagent|workflow|ralph)/);
    assert.doesNotMatch(composition, /[A-Z]:\\/);
  }
});

test('the card-designer preset keeps a narrow capability boundary', async () => {
  const presetRoot = new URL('card-designer/', presetsRoot);
  const composition = await readFile(new URL('agent.cordis.yml', presetRoot), 'utf8');
  const metadata = await readFile(new URL('preset.yml', presetRoot), 'utf8');
  const skill = await readFile(new URL('skills/worldforge-card-design/SKILL.md', presetRoot), 'utf8');

  assert.match(metadata, /^name: WorldForge 卡牌设计$/m);
  assert.match(composition, /name: '@deepseek-ai\/dsh-persona'/);
  assert.match(composition, /new URL\('skills\/', baseUrl\)/);
  assert.doesNotMatch(composition, /dsh-tool-(?:bash|pwsh|jobs|subagent|workflow|ralph)/);
  assert.doesNotMatch(composition, /[A-Z]:\\/);
  assert.doesNotMatch(skill, /[A-Z]:\\/);
  assert.match(skill, /balance_status: untested/);
  assert.match(skill, /作者拥有 canon 决定权/);
});

test('lore writing and free creation preserve their distinct prompt contracts', async () => {
  const loreRoot = new URL('lore-writer/', presetsRoot);
  const freeRoot = new URL('free-creator/', presetsRoot);
  const loreComposition = await readFile(new URL('agent.cordis.yml', loreRoot), 'utf8');
  const loreSkill = await readFile(new URL('skills/worldforge-lore-writing/SKILL.md', loreRoot), 'utf8');
  const freeComposition = await readFile(new URL('agent.cordis.yml', freeRoot), 'utf8');
  const freeSkill = await readFile(new URL('skills/worldforge-free-creation/SKILL.md', freeRoot), 'utf8');

  assert.match(loreComposition, /structured lore-writing partner/);
  assert.match(loreSkill, /只写被要求的内容块/);
  assert.match(freeComposition, /Do not force JSON/);
  assert.match(freeComposition, /do not edit repository files/);
  assert.doesNotMatch(freeComposition, /tool-todo|plan-mode|tool-goal/);
  assert.match(freeSkill, /不会自动获得 SQLite 作者资料库/);
});

