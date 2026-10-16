import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';

const presetRoot = new URL('../.agent-presets/card-designer/', import.meta.url);

test('the repository ships a self-contained DSH card-designer preset', async () => {
  const required = [
    'agent.cordis.yml',
    'preset.yml',
    'skills/worldforge-card-design/SKILL.md',
    'skills/worldforge-card-design/reference/card-fields.md',
    'skills/worldforge-card-design/reference/keyword-fields.md'
  ];

  for (const relative of required) {
    assert.equal((await stat(new URL(relative, presetRoot))).isFile(), true, `${relative} should exist`);
  }
});

test('the card-designer preset keeps a narrow capability boundary', async () => {
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

