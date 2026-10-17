import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_IMAGE_PROMPTS, DEFAULT_TYPE_PROMPTS, IMAGE_PROMPT_KEYS, PROMPT_TYPE_KEYS, normalizePromptSettings, validatePromptSettings } from '../prompt-settings.mjs';

test('prompt settings expose defaults for the five fixed groups and preserve legacy text', () => {
  const defaults = normalizePromptSettings();
  // 只有五项固定组拥有出厂提示词；自定义资料组共用「世界信息」档。
  assert.deepEqual(PROMPT_TYPE_KEYS, ['world', 'info', 'character', 'timeline', 'story']);
  assert.deepEqual(Object.keys(defaults.typePrompts), PROMPT_TYPE_KEYS);
  assert.ok(PROMPT_TYPE_KEYS.every(key => DEFAULT_TYPE_PROMPTS[key].length > 20));

  // 出厂默认值不得写死任何世界的题材：没有魔法、蒸汽、工业或神性才成立的世界也能直接用。
  assert.ok(PROMPT_TYPE_KEYS.every(key => !/魔法|法术|蒸汽|工业|神力|神性|以太/.test(DEFAULT_TYPE_PROMPTS[key])));
  assert.ok(IMAGE_PROMPT_KEYS.every(key => !/魔法|蒸汽|工业|以太/.test(DEFAULT_IMAGE_PROMPTS[key])));

  const customized = validatePromptSettings({
    personalizedPrompt: '保持克制的传记风格',
    typePrompts: { ...defaults.typePrompts, character: '强调人物选择与代价' }
  });
  assert.equal(customized.personalizedPrompt, '保持克制的传记风格');
  assert.equal(customized.typePrompts.character, '强调人物选择与代价');
  assert.equal(customized.version, 5);
  assert.deepEqual(Object.keys(customized.imagePrompts), IMAGE_PROMPT_KEYS);
  assert.ok(IMAGE_PROMPT_KEYS.every(key => DEFAULT_IMAGE_PROMPTS[key].length > 20));

  // 旧十三类的提示词不再参与生成，但作者写过的文本必须原样保留。
  const legacy = normalizePromptSettings({
    version: 4,
    typePrompts: { ...defaults.typePrompts, magic: '说明这套力量体系的来源与代价。' },
    imagePrompts: { magic: '旧的力量体系生图提示' }
  });
  assert.equal(legacy.typePrompts.magic, '说明这套力量体系的来源与代价。');
  assert.equal(legacy.imagePrompts.magic, '旧的力量体系生图提示');
  assert.equal(legacy.typePrompts.info, DEFAULT_TYPE_PROMPTS.info);

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
