import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_IMAGE_PROMPTS, DEFAULT_TYPE_PROMPTS, IMAGE_PROMPT_KEYS, PROMPT_TYPE_KEYS, normalizePromptSettings, validatePromptSettings } from '../prompt-settings.mjs';

test('prompt settings expose defaults for every lore type and preserve customization', () => {
  const defaults = normalizePromptSettings();
  assert.equal(PROMPT_TYPE_KEYS.length, 13);
  assert.deepEqual(Object.keys(defaults.typePrompts), PROMPT_TYPE_KEYS);
  assert.ok(PROMPT_TYPE_KEYS.every(key => DEFAULT_TYPE_PROMPTS[key].length > 20));

  const customized = validatePromptSettings({
    personalizedPrompt: '保持克制的传记风格',
    typePrompts: { ...defaults.typePrompts, character: '强调人物选择与代价' }
  });
  assert.equal(customized.personalizedPrompt, '保持克制的传记风格');
  assert.equal(customized.typePrompts.character, '强调人物选择与代价');
  assert.equal(customized.version, 4);
  assert.deepEqual(Object.keys(customized.imagePrompts),IMAGE_PROMPT_KEYS);
  assert.ok(IMAGE_PROMPT_KEYS.every(key=>DEFAULT_IMAGE_PROMPTS[key].length>20));

  const migrated = normalizePromptSettings({
    version: 1,
    typePrompts: { location: '把地理条目放入明确的世界与父级层次，说明地貌、气候、资源、人口、交通、控制关系及其形成原因。城市与地点必须能够追溯到所属国家，不把行政层级平铺。' }
  });
  assert.equal(migrated.typePrompts.location, DEFAULT_TYPE_PROMPTS.location);

  const customLocation = normalizePromptSettings({ typePrompts: { location: '保留作者自定义的地理写法' } });
  assert.equal(customLocation.typePrompts.location, '保留作者自定义的地理写法');

  const migratedTimeline = normalizePromptSettings({
    version: 2,
    typePrompts: { timeline: '按明确历法或相对时间组织事件，标注因果、并发、持续时间与仍不确定的日期。不要为填满时间线而制造未经支持的重大事件。' }
  });
  assert.equal(migratedTimeline.typePrompts.timeline, DEFAULT_TYPE_PROMPTS.timeline);
});

test('prompt settings reject unknown types and excessive content', () => {
  assert.throws(() => validatePromptSettings({ personalizedPrompt: '', typePrompts: { unknown_type: 'x' } }), /未知提示词分类/);
  assert.throws(() => validatePromptSettings({ personalizedPrompt: 'x'.repeat(8001), typePrompts: normalizePromptSettings().typePrompts }), /8000/);
  assert.throws(() => validatePromptSettings({typePrompts:normalizePromptSettings().typePrompts,imagePrompts:{unknown_image:'x'}}),/未知生图提示词分类/);
});
