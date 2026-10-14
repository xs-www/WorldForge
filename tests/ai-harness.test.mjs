import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContextBundle, buildPrompt, createLoreResponseSchema, createModelBody, parseAiResponse, parseNameResponse } from '../ai-harness.mjs';
import { contentSpec, normalizeSelectedBlocks } from '../ai-content-specs.mjs';

const draft = { id: 'CHR-DRAFT', type: 'character', name: '空白角色', status: 'proposed', truthScope: 'objective', worldId: 'W01', tags: ['矿区'], relationIds: [] };
const entry = (id, overrides = {}) => ({ id, type: 'character', name: id, status: 'proposed', truthScope: 'objective', worldId: 'W01', summary: '', details: '', tags: [], relationIds: [], ...overrides });

test('context prioritizes same-world canon examples and isolates unrelated worlds', () => {
  const bundle = buildContextBundle({ draft, library: [entry('CHR-W01-001', { status: 'canon' }), entry('CHR-W02-001', { worldId: 'W02', status: 'canon' }), entry('FAC-W01-001', { type: 'faction', status: 'canon' })] });
  assert.deepEqual(bundle.contextMeta.exampleIds, ['CHR-W01-001']);
  assert.ok(!bundle.contextMeta.includedIds.includes('CHR-W02-001'));
});

test('each module exposes dedicated content blocks and timeline containers omit node-only fields', () => {
  assert.ok(contentSpec('magic').blocks.some(item => item.label === '施展成本'));
  assert.ok(contentSpec('location').blocks.some(item => item.key === 'environment'));
  assert.ok(!contentSpec('timeline', { chronicle: { kind: 'chronicle' } }).blocks.some(item => item.key === 'dateLabel'));
  assert.deepEqual(normalizeSelectedBlocks('story', ['details']), ['details']);
});

test('prompt and schema contain only selected content blocks', () => {
  const payload = { draft, selectedBlocks: ['name', 'details'], variantCount: 2, typePrompt: '突出人物选择', personalizedPrompt: '语言克制' };
  const bundle = buildContextBundle({ ...payload, library: [] });
  const prompt = buildPrompt(payload, bundle), schema = createLoreResponseSchema(payload);
  assert.match(prompt, /只生成以下已勾选内容块/);
  assert.match(prompt, /禁止输出“本候选”/);
  assert.deepEqual(schema.properties.variants.items.properties.content.required, ['name', 'details']);
  assert.deepEqual(Object.keys(schema.properties.variants.items.properties.content.properties), ['name', 'details']);
});

test('partial response accepts selected blocks and rejects leaked generic fields', () => {
  const payload = { draft, selectedBlocks: ['details'] };
  const accepted = parseAiResponse(JSON.stringify({ variants: [{ key: 'a', content: { details: '直接可用的人物正文。' } }] }), payload);
  assert.equal(accepted.variants[0].content.details, '直接可用的人物正文。');
  assert.throws(() => parseAiResponse({ variants: [{ key: 'a', content: { details: '正文', assumptions: ['多余'] } }] }, payload), /未选择/);
});

test('relation block only accepts ids from the supplied context whitelist', () => {
  const payload = { draft, selectedBlocks: ['relations'], allowedRelationIds: ['FAC-W01-001'] };
  const accepted = parseAiResponse({ variants: [{ key: 'a', content: { relations: [{ id: 'FAC-W01-001', reason: '雇佣关系' }] } }] }, payload);
  assert.equal(accepted.variants[0].content.relations[0].id, 'FAC-W01-001');
  assert.throws(() => parseAiResponse({ variants: [{ key: 'a', content: { relations: [{ id: 'MISSING', reason: '虚构关系' }] } }] }, payload), /不在上下文/);
});

test('model bodies support dynamic schemas and free unstructured responses', () => {
  const payload = { draft, selectedBlocks: ['summary'] }, schema = createLoreResponseSchema(payload);
  assert.equal(createModelBody({ model: 'x', style: 'responses' }, 'p', { schema, payload }).text.format.type, 'json_schema');
  assert.equal(createModelBody({ model: 'x', style: 'chat' }, 'p', { schema, payload }).response_format.type, 'json_schema');
  assert.equal(createModelBody({ model: 'x', style: 'responses' }, 'p', { structured: false }).text, undefined);
});

test('name generator validates exact candidate count', () => {
  const value = parseNameResponse(JSON.stringify({ names: [{ name: '雾铆港', note: '强调潮湿港区与铆接工业。' }] }), 1);
  assert.equal(value.names[0].name, '雾铆港');
  assert.throws(() => parseNameResponse(JSON.stringify({ names: [] }), 1), /数量/);
});
