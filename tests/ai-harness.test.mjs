import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContextBundle, buildPrompt, createModelBody, parseAiResponse, validateAiResponse } from '../ai-harness.mjs';

const draft = { id: 'CHR-W01-DRAFT-X', type: 'character', name: '候选角色', status: 'proposed', truthScope: 'objective', worldId: 'W01', tags: ['蒸汽'], relationIds: ['FAC-W01-001'] };
const library = [
  { id: 'FAC-W01-001', type: 'faction', name: '关联势力', status: 'proposed', worldId: 'W01', tags: [] },
  { id: 'W01', type: 'world', name: '世界基线', status: 'canon', worldId: 'W01', tags: [] },
  { id: 'CHR-W02-001', type: 'character', name: '无关角色', status: 'proposed', worldId: 'W02', tags: [] }
];

test('context prioritizes direct relations and same-world canon', () => {
  const bundle = buildContextBundle({ draft, library });
  assert.deepEqual(bundle.contextMeta.includedIds, ['FAC-W01-001', 'W01']);
  assert.equal(bundle.contextMeta.omittedCount, 1);
});

test('prompt requests exact variant count and contains bounded context', () => {
  const bundle = buildContextBundle({ draft, library });
  const prompt = buildPrompt({ action: 'brainstorm', variantCount: 4, prompt: '保持克制' }, bundle);
  assert.match(prompt, /严格返回 4 份/);
  assert.match(prompt, /<worldforge_context>/);
});

test('background story prompt requests independent proposed narratives', () => {
  const bundle = buildContextBundle({ draft, library });
  const prompt = buildPrompt({ action: 'background_story', variantCount: 2 }, bundle);
  assert.match(prompt, /背景故事/);
  assert.match(prompt, /传记、轶事或局部事件/);
  assert.match(prompt, /而不是百科式改写/);
  assert.match(prompt, /必须全部返回空数组/);
});

test('canon entries of the same world and type form a bounded example layer', () => {
  const exampleLibrary = [
    { ...draft, id: 'CHR-W01-001', name: '正史角色', status: 'canon' },
    { ...draft, id: 'CHR-W01-002', name: '普通草案', status: 'proposed' },
    { ...draft, id: 'CHR-W02-001', name: '异世界正史', status: 'canon', worldId: 'W02' }
  ];
  const bundle = buildContextBundle({ draft, library: exampleLibrary });
  assert.deepEqual(bundle.contextMeta.exampleIds, ['CHR-W01-001']);
  assert.equal(bundle.examples[0].name, '正史角色');
  assert.doesNotMatch(JSON.stringify(bundle.examples), /普通草案|异世界正史/);
});

test('prompt composes type guidance, personalized style, canon and author examples', () => {
  const bundle = buildContextBundle({ draft, library: [{ ...draft, id: 'CHR-W01-001', status: 'canon' }] });
  const prompt = buildPrompt({ action: 'brainstorm', variantCount: 2, typePrompt: '突出人物选择', personalizedPrompt: '语言克制', userExamples: '示例段落' }, bundle);
  assert.match(prompt, /<author_type_prompt>\s*突出人物选择/);
  assert.match(prompt, /<author_personalized_style>\s*语言克制/);
  assert.match(prompt, /<worldforge_examples>/);
  assert.match(prompt, /CHR-W01-001/);
  assert.match(prompt, /示例段落/);
});

test('response schema rejects unknown relation ids', () => {
  const response = { variants: [{ key: 'a', title: 'A', summary: 'S', details: 'D', constraints: [], openQuestions: [], relationSuggestions: [{ id: 'MISSING', reason: 'x' }], conflicts: [], assumptions: [] }] };
  assert.throws(() => validateAiResponse(response, ['W01']), /不在上下文/);
});

test('parser accepts fenced JSON and model bodies enable native schemas', () => {
  const response = { variants: [{ key: 'a', title: 'A', summary: 'S', details: 'D', constraints: [], openQuestions: [], relationSuggestions: [], conflicts: [], assumptions: [] }] };
  assert.equal(parseAiResponse('```json\n' + JSON.stringify(response) + '\n```', []).variants.length, 1);
  assert.equal(createModelBody({ model: 'x', style: 'responses' }, 'p').text.format.type, 'json_schema');
  assert.equal(createModelBody({ model: 'x', style: 'chat' }, 'p').response_format.type, 'json_schema');
});
