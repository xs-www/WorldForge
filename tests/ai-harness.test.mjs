import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContextBundle, buildPrompt, completeAiVariants, createLoreResponseSchema, createModelBody, inspectAiResponse, parseAiResponse, parseNameResponse } from '../ai-harness.mjs';
import { contentSpec, normalizeSelectedBlocks } from '../ai-content-specs.mjs';

const draft = { id: 'CHR-DRAFT', type: 'character', name: '空白角色', status: 'proposed', truthScope: 'objective', worldId: 'W01', tags: ['矿区'], relationIds: [] };
const entry = (id, overrides = {}) => ({ id, type: 'character', name: id, status: 'proposed', truthScope: 'objective', worldId: 'W01', summary: '', details: '', tags: [], relationIds: [], ...overrides });

test('context prioritizes same-world canon examples and isolates unrelated worlds', () => {
  const bundle = buildContextBundle({ draft, library: [entry('CHR-W01-001', { status: 'canon' }), entry('CHR-W02-001', { worldId: 'W02', status: 'canon' }), entry('FAC-W01-001', { type: 'faction', status: 'canon' })] });
  assert.deepEqual(bundle.contextMeta.exampleIds, ['CHR-W01-001']);
  assert.ok(!bundle.contextMeta.includedIds.includes('CHR-W02-001'));
});

test('each module exposes dedicated content blocks and timeline containers omit node-only fields', () => {
  assert.ok(contentSpec('magic').blocks.some(item => item.label === '使用成本'));
  assert.equal(contentSpec('location').blocks.find(item => item.key === 'details')?.label, '详细设定');
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
  assert.equal(schema.properties.variants.minItems, 2);
  assert.equal(schema.properties.variants.maxItems, 2);
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
  const image='data:image/png;base64,aA==';
  const responses=createModelBody({model:'x',style:'responses'},'看图',{schema,payload,images:[image]});
  const chat=createModelBody({model:'x',style:'chat'},'看图',{schema,payload,images:[image]});
  assert.deepEqual(responses.input[0].content[1],{type:'input_image',image_url:image,detail:'auto'});
  assert.deepEqual(chat.messages[1].content[1],{type:'image_url',image_url:{url:image,detail:'auto'}});
});

test('name generator validates exact candidate count', () => {
  const value = parseNameResponse(JSON.stringify({ names: [{ name: '雾铆港', note: '强调潮湿港区与铆接工业。' }] }), 1);
  assert.equal(value.names[0].name, '雾铆港');
  assert.throws(() => parseNameResponse(JSON.stringify({ names: [] }), 1), /数量/);
});

test('candidate inspection preserves valid variants and exposes invalid model fragments', () => {
  const payload = { draft, selectedBlocks: ['details'] };
  const inspected = inspectAiResponse({ variants: [
    { key: 'usable', content: { details: '可以直接使用的正文。' } },
    { key: 'broken', content: { summary: '返回了未选择字段。' } }
  ] }, payload);
  assert.deepEqual(inspected.variants.map(item => item.key), ['usable']);
  assert.equal(inspected.receivedCount, 2);
  assert.equal(inspected.issues[0].index, 1);
  assert.match(inspected.issues[0].message, /未选择/);
  assert.match(inspected.issues[0].preview, /broken/);
});

test('candidate completion requests only the missing count and merges accepted variants', async () => {
  const payload = { draft, selectedBlocks: ['details'] };
  const result = await completeAiVariants({
    raw: { variants: [
      { key: 'kept', content: { details: '保留我。' } },
      { key: 'invalid', content: {} }
    ] },
    payload,
    expectedCount: 3,
    requestSupplement: async ({ missingCount, acceptedVariants }) => {
      assert.equal(missingCount, 2);
      assert.deepEqual(acceptedVariants.map(item => item.key), ['kept']);
      return { variants: [
        { key: 'added-a', content: { details: '只补第一条。' } },
        { key: 'added-b', content: { details: '只补第二条。' } }
      ] };
    }
  });
  assert.deepEqual(result.variants.map(item => item.key), ['kept', 'added-a', 'added-b']);
  assert.equal(result.diagnostics.supplementalRequested, 2);
  assert.equal(result.diagnostics.supplementalAccepted, 2);
  assert.equal(result.diagnostics.status, 'complete');
});

test('failed supplement returns visible partial diagnostics instead of discarding output', async () => {
  const result = await completeAiVariants({
    raw: 'not-json model prose',
    payload: { draft, selectedBlocks: ['details'] },
    expectedCount: 3,
    requestSupplement: async () => 'still not json'
  });
  assert.equal(result.variants.length, 0);
  assert.equal(result.diagnostics.status, 'partial');
  assert.equal(result.diagnostics.supplementalRequested, 3);
  assert.ok(result.diagnostics.issues.some(item => item.preview.includes('not-json model prose')));
  assert.ok(result.diagnostics.issues.some(item => item.stage === 'supplement' && item.preview.includes('still not json')));
});
