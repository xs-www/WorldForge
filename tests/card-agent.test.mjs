import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as createProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { completeCardVariants, createCardResponseSchema, inspectCardResponse, validateCardVariant } from '../card-agent.mjs';
import { buildCardPrompt } from '../ai-harness.mjs';
import { loadAgentProfiles } from '../agent-profile-registry.mjs';

// Sprint 4：卡牌文字 Agent 的受限契约（字段白名单、类型互斥、引用白名单、评审完整性）
// 以及真实 /api/ai/card 的接入。

const repositoryRoot = new URL('../', import.meta.url);
const KEYWORDS = [{ id: 'KEY-001', name: '疾启', text: '入场即可攻击。', status: 'proposed' }];
const basePayload = (overrides = {}) => ({
  action: 'brainstorm',
  variantCount: 1,
  selectedFields: ['name', 'cost', 'rulesText'],
  draft: { name: '草案', type: 'minion', cost: 2, attack: 1, health: 1, rarity: 'common', rulesText: '', keywordIds: [], loreRefs: [] },
  allowedKeywordIds: ['KEY-001'],
  allowedLoreIds: ['CHR-W01-001'],
  keywords: KEYWORDS,
  ...overrides
});
const variant = (patch, extra = {}) => ({ key: 'a', patch, ...extra });

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createProbe();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

test('a legal candidate is accepted for each card type', () => {
  const minion = validateCardVariant(variant({ name: '灰烬匠', cost: 3 }), basePayload({ selectedFields: ['name', 'cost'] }));
  assert.deepEqual(minion.patch, { name: '灰烬匠', cost: 3, notes: ['数值未经测试（untested）'] });
  const spell = validateCardVariant(variant({ name: '引燃', rulesText: '造成 2 点伤害。' }), basePayload({ draft: { type: 'spell' }, selectedFields: ['name', 'rulesText'] }));
  assert.equal(spell.patch.name, '引燃');
  const equipment = validateCardVariant(variant({ name: '扳手', cost: 2, attack: 1, durability: 2 }), basePayload({ draft: { type: 'equipment' }, selectedFields: ['name', 'cost', 'attack', 'durability'] }));
  assert.equal(equipment.patch.durability, 2);
});

test('card types cannot mix stats, tribe or spell school', () => {
  const cases = [
    ['法术带 attack', { draft: { type: 'spell' }, selectedFields: ['attack', 'name'] }, { name: '甲', attack: 2 }],
    ['法术带 health', { draft: { type: 'spell' }, selectedFields: ['health', 'name'] }, { name: '甲', health: 2 }],
    ['武器带 health', { draft: { type: 'equipment' }, selectedFields: ['health', 'name'] }, { name: '甲', health: 2 }],
    ['随从带 durability', { draft: { type: 'minion' }, selectedFields: ['durability', 'name'] }, { name: '甲', durability: 2 }],
    ['法术带 tribeId', { draft: { type: 'spell' }, selectedFields: ['tribeId', 'name'] }, { name: '甲', tribeId: 'human' }],
    ['随从带 spellSchoolId', { draft: { type: 'minion' }, selectedFields: ['spellSchoolId', 'name'] }, { name: '甲', spellSchoolId: 'fire' }]
  ];
  for (const [label, payload, patch] of cases) {
    assert.throws(() => validateCardVariant(variant(patch), basePayload(payload)), /不允许|不能包含|只有/, `${label} 应被拒绝`);
  }
});

test('unselected fields, unknown references and script effects are rejected', () => {
  assert.throws(() => validateCardVariant(variant({ rarity: 'rare' }), basePayload()), /未勾选字段/);
  assert.throws(() => validateCardVariant(variant({ keywordIds: ['KEY-999'] }), basePayload({ selectedFields: ['keywordIds'] })), /未提供的关键词/);
  assert.throws(() => validateCardVariant(variant({ loreRefs: ['CHR-W01-999'] }), basePayload({ selectedFields: ['loreRefs'] })), /未提供的设定/);
  assert.throws(() => validateCardVariant(variant({ effects: [{ op: 'run_script', params: {} }] }), basePayload({ selectedFields: ['effects'] })), /未登记的效果操作/);
  assert.throws(() => validateCardVariant(variant({ effects: [{ op: 'deal_damage', params: { amount: 'exec(1)' } }] }), basePayload({ selectedFields: ['effects'] })), /脚本或表达式/);
  // 白名单内的效果可以通过。
  const legal = validateCardVariant(variant({ effects: [{ op: 'deal_damage', params: { amount: 2 } }] }), basePayload({ selectedFields: ['effects'] }));
  assert.deepEqual(legal.patch.effects, [{ op: 'deal_damage', params: { amount: 2 } }]);
});

test('illegal variants are diagnostics, not silent passes', () => {
  const illegal = { key: 'a', patch: { attack: 5 } };
  const inspected = inspectCardResponse({ variants: [illegal] }, basePayload({ selectedFields: ['name'] }));
  assert.equal(inspected.variants.length, 0);
  assert.equal(inspected.issues[0].code, 'INVALID_VARIANT');
  assert.match(inspected.issues[0].message, /未勾选字段/);
  assert.equal(inspectCardResponse('not json', basePayload()).issues[0].code, 'INVALID_JSON');
  assert.equal(inspectCardResponse({ variants: [] }, basePayload()).variants.length, 0);
  // 评审字段已移除：模型即使仍返回 review 也不会进入候选，也不因此失败。
  const withLegacyReview = inspectCardResponse({ variants: [{ key: 'b', patch: { name: '乙' }, review: { legalTargets: '自身' } }] }, basePayload({ selectedFields: ['name'] }));
  assert.equal(withLegacyReview.variants.length, 1);
  assert.equal(withLegacyReview.variants[0].review, undefined, '候选不再携带评审');
});

test('a model that ignores the response schema is still accepted', () => {
  // 兼容接口常忽略 json_schema，把 items 当根对象返回、或漏写 key；
  // 这些形状应当被收敛而不是整次失败（DeepSeek 等只支持 json_object 的端点）。
  const bare = inspectCardResponse({ patch: { name: '甲' } }, basePayload({ selectedFields: ['name'] }));
  assert.equal(bare.variants.length, 1);
  assert.equal(bare.variants[0].key, 'candidate-1');
  const fenced = inspectCardResponse(`说明如下：\n\`\`\`json\n${JSON.stringify({ key: '', patch: { name: '乙' } })}\n\`\`\``, basePayload({ selectedFields: ['name'] }));
  assert.equal(fenced.variants.length, 1);
  assert.equal(fenced.variants[0].patch.name, '乙');
  const wrapped = inspectCardResponse([{ key: 'a', patch: { name: '丙' } }], basePayload({ selectedFields: ['name'] }));
  assert.equal(wrapped.variants.length, 1);
  // 真正跑偏的返回仍然只产出诊断，并附带原文片段便于定位。
  const wrong = inspectCardResponse({ name: '丁' }, basePayload({ selectedFields: ['name'] }));
  assert.equal(wrong.variants.length, 0);
  assert.equal(wrong.issues[0].code, 'INVALID_ENVELOPE');
  assert.ok(wrong.issues[0].preview.includes('丁'), '诊断必须带模型原文片段');
  assert.match(inspectCardResponse('我认为应该更便宜', basePayload()).issues[0].preview, /更便宜/);
});

test('the card prompt states the JSON envelope inside layer 5', () => {
  const prompt = buildCardPrompt({ ...basePayload(), selectedFields: ['name', 'cost', 'keywordIds'], variantCount: 2 }, { draft: { name: '草案' } });
  for (const key of ['"variants"', '"key"', '"patch"']) assert.ok(prompt.includes(key), `缺少 ${key}`);
  assert.ok(!/"review"/.test(prompt), '外壳不得再要求评审字段');
  assert.ok(prompt.includes('评审由作者完成'), '第 5 层必须写明评审归作者');
  assert.ok(prompt.includes('"name":"新卡名"') && prompt.includes('"cost":3'), '示例值必须是安全的类型占位');
  assert.ok(prompt.includes('"keywordIds":[]'), 'ID 数组示例必须为空，避免模型照抄未提供的 ID');
  assert.ok(prompt.indexOf('响应格式') < prompt.indexOf('<card_draft>'), '外壳说明属于第 5 层');
  assert.ok(prompt.trimEnd().endsWith('</rules_context>'), '提示仍以第 6 层结尾');
});

test('balance claims are rejected while untested markers are added', () => {
  assert.throws(() => validateCardVariant(variant({ rulesText: '该卡数值已平衡。' }), basePayload()), /已平衡/);
  assert.throws(() => validateCardVariant(variant({ cost: 3, notes: ['经过仿真验证无解'] }), basePayload({ selectedFields: ['cost', 'notes'] })), /仿真验证/);
  const added = validateCardVariant(variant({ cost: 4 }), basePayload({ selectedFields: ['cost'] }));
  assert.deepEqual(added.patch.notes, ['数值未经测试（untested）']);
});

test('the supplement fills only the missing count and keeps diagnostics', async () => {
  const payload = basePayload({ variantCount: 2 });
  const first = { variants: [{ key: 'a', patch: { name: '甲' } }] };
  const second = { variants: [{ key: 'b', patch: { name: '乙' } }] };
  let asked = null;
  const result = await completeCardVariants({
    raw: JSON.stringify(first),
    payload,
    expectedCount: 2,
    requestSupplement: async request => { asked = request; return JSON.stringify(second); }
  });
  assert.equal(result.variants.length, 2);
  assert.equal(asked.missingCount, 1);
  assert.equal(result.diagnostics.status, 'complete');
  // Schema 的数量跟着本次请求走。
  const schema = createCardResponseSchema({ selectedFields: ['name'], variantCount: 1 });
  assert.equal(schema.properties.variants.minItems, 1);
  assert.equal(schema.properties.variants.maxItems, 1);
  assert.deepEqual(Object.keys(schema.properties.variants.items.properties.patch.properties), ['name']);
});

// ── 真实服务接入 ──────────────────────────────────────────────────────────
function fakeModel() {
  const state = { requests: [], behavior: null };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
    state.requests.push(parsed);
    const reply = state.behavior ? state.behavior(parsed, state.requests) : { status: 200, json: { choices: [{ message: { content: JSON.stringify({ variants: [{ key: 'candidate-a', patch: { name: '甲', cost: 3 } }] }) } }] } };
    res.writeHead(reply.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.json));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    requests: state.requests,
    set: fn => { state.behavior = fn; },
    reset: () => { state.requests.length = 0; state.behavior = null; },
    close: () => new Promise(done => { server.closeAllConnections?.(); server.close(done); })
  })));
}

let base, model, server, port, registry;
before(async () => {
  base = await mkdtemp(join(tmpdir(), 'worldforge-sprint4-'));
  registry = await loadAgentProfiles();
  model = await fakeModel();
  port = await freePort();
  server = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', repositoryRoot),
    env: {
      ...process.env, PORT: String(port), LLM_API_KEY: 'test', LLM_MODEL: 'fake', LLM_API_STYLE: 'chat',
      LLM_BASE_URL: `http://127.0.0.1:${model.port}/v1`,
      WORLDFORGE_DB_PATH: join(base, 'c.sqlite'), WORLDFORGE_SIM_DB_PATH: join(base, 's.sqlite'),
      WORLDFORGE_ASSETS_PATH: join(base, 'assets'), WORLDFORGE_CONFIG_PATH: join(base, '.env.local'),
      WORLDFORGE_PROMPT_SETTINGS_PATH: join(base, 'p.json'), WORLDFORGE_COMFY_WORKFLOW_PATH: join(base, 'w.json'),
      WORLDFORGE_AGENT_SETTINGS_PATH: join(base, 'agent-settings.json')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  server.stdout.on('data', chunk => { out += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务未就绪\n${out}`)), 15000);
    const poll = () => { if (/http:\/\/127\.0\.0\.1:\d+/.test(out)) { clearTimeout(timer); resolve(); } else if (server.exitCode !== null) { clearTimeout(timer); reject(new Error('提前退出')); } else setTimeout(poll, 25); };
    poll();
  });
});
after(async () => {
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  if (model) await model.close();
  if (base) await rm(base, { recursive: true, force: true });
});

test('POST /api/ai/card returns patches with an authoritative preset snapshot', async () => {
  model.reset();
  const response = await fetch(`http://127.0.0.1:${port}/api/ai/card`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...basePayload(), selectedFields: ['name', 'cost'], variantCount: 1 })
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  const profile = registry.get('card-designer');
  assert.deepEqual(data.agent, { presetId: profile.id, presetVersion: '1.1.0', presetHash: profile.hash, mode: 'structured_card' });
  assert.equal(data.variants.length, 1);
  assert.equal(data.variants[0].patch.notes[0], '数值未经测试（untested）');
  assert.equal(data.diagnostics.status, 'complete');
  // 出站请求：三层 system + 第 5 层任务 + 第 6 层草案与引用白名单。
  const system = model.requests[0].messages[0].content;
  assert.ok(system.includes('<product_boundary>') && system.includes('<agent_preset>') && system.includes('<entry_contract>'));
  assert.ok(system.includes('proposed'), '第 3 层应固定 proposed/untested 纪律');
  const presetBlock = system.slice(system.indexOf('<agent_preset>'), system.indexOf('</agent_preset>'));
  assert.ok(presetBlock.includes('卡牌与机制设计伙伴'), 'preset 层保留 persona');
  assert.ok(!presetBlock.includes('untested'), 'preset 层已被裁剪，纪律不在那里重复');
  const user = model.requests[0].messages[1].content;
  assert.ok(user.includes('<card_draft>') && user.includes('<allowed_references>'));
  assert.ok(user.indexOf('任务：') < user.indexOf('<card_draft>'), '任务在第 6 层之前');
  assert.ok(!user.includes('CHR-W01-999'));
});

test('the card entry rejects other surfaces before calling the model', async () => {
  for (const presetId of ['lore-writer', 'free-creator', 'nope']) {
    model.reset();
    const response = await fetch(`http://127.0.0.1:${port}/api/ai/card`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...basePayload(), presetId }) });
    assert.equal(response.status, 400, `${presetId} 应 400`);
    assert.equal(model.requests.length, 0, `${presetId} 不应调用模型`);
  }
});

test('illegal model output is reported as diagnostics instead of reaching the client', async () => {
  model.reset();
  model.set(() => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify({ variants: [{ key: 'a', patch: { attack: 5 } }] }) } }] } }));
  const response = await fetch(`http://127.0.0.1:${port}/api/ai/card`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...basePayload(), selectedFields: ['name'], variantCount: 1 })
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.variants.length, 0);
  assert.equal(data.diagnostics.status, 'partial');
  assert.ok(data.diagnostics.issues.some(issue => /未勾选字段/.test(issue.message)));
});

test('a schema-ignoring model still yields a usable candidate end to end', async () => {
  model.reset();
  // 只支持 json_object 的兼容接口：没有 variants 外壳、也没有 key。
  model.set(() => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify({ patch: { name: '灰烬匠', cost: 3 } }) } }] } }));
  const response = await fetch(`http://127.0.0.1:${port}/api/ai/card`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...basePayload(), selectedFields: ['name', 'cost'], variantCount: 1 })
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.variants.length, 1);
  assert.equal(data.variants[0].key, 'candidate-1');
  assert.equal(data.variants[0].patch.name, '灰烬匠');
  assert.equal(data.diagnostics.status, 'complete');
  assert.equal(data.diagnostics.issues.length, 0);
});

test('a provider that rejects the json schema falls back and reports why', async () => {
  model.reset();
  model.set(parsed => (parsed.response_format
    ? { status: 400, json: { error: { message: 'response_format is not supported' } } }
    : { status: 200, json: { choices: [{ message: { content: JSON.stringify({ key: 'candidate-1', patch: { name: '甲' } }) } }] } }));
  const response = await fetch(`http://127.0.0.1:${port}/api/ai/card`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...basePayload(), selectedFields: ['name'], variantCount: 1 })
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.structured, false);
  assert.match(data.fallbackReason, /400/);
  assert.equal(data.variants.length, 1);
  // 降级后的第二次请求不再带 response_format，但仍然写明 JSON 外壳。
  assert.equal(model.requests.length, 2);
  assert.equal(model.requests[1].response_format, undefined);
  assert.ok(model.requests[1].messages[1].content.includes('"variants"'));
});

test('cross-type patches apply the target type stats (both directions)', async () => {
  // 真实执行前端回填逻辑（浏览器与测试共用 dist/card-agent-apply.js）。
  const source = await readFile(new URL('../dist/card-agent-apply.js', import.meta.url), 'utf8');
  const sandbox = { window: {} };
  runInNewContext(source, sandbox);
  const assigner = sandbox.window.WorldforgeCardAgentApply;
  const toEquipment = assigner.formAssignments({ type: 'equipment', durability: 2 }, 'minion');
  assert.equal(toEquipment.targetType, 'equipment');
  assert.equal(toEquipment.values.cardHealth, 2, 'minion→equipment 应写入 durability');
  assert.equal(toEquipment.values.cardType, 'equipment');
  const toMinion = assigner.formAssignments({ type: 'minion', health: 3 }, 'equipment');
  assert.equal(toMinion.values.cardHealth, 3, 'equipment→minion 应写入 health');
  const sameType = assigner.formAssignments({ durability: 4 }, 'minion');
  assert.equal(sameType.values.cardHealth, undefined, '类型不变时不得把 durability 写进随从');

  // 服务端允许 patch.type 改变类型；回填按目标类型判断专属数值。
  const serverPatch = validateCardVariant(variant({ type: 'equipment', durability: 2 }), basePayload({ draft: { type: 'minion' }, selectedFields: ['type', 'durability'] }));
  assert.equal(serverPatch.patch.type, 'equipment');
  assert.equal(serverPatch.patch.durability, 2);
  const serverPatchBack = validateCardVariant(variant({ type: 'minion', health: 3 }), basePayload({ draft: { type: 'equipment' }, selectedFields: ['type', 'health'] }));
  assert.equal(serverPatchBack.patch.health, 3);
});

test('the card context carries referenced lore content and keyword definitions', async () => {
  model.reset();
  const response = await fetch(`http://127.0.0.1:${port}/api/ai/card`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...basePayload(),
      selectedFields: ['name'],
      draft: { ...basePayload().draft, loreRefs: ['CHR-W01-001'] },
      allowedLoreIds: ['CHR-W01-001'],
      loreRefs: [{ id: 'CHR-W01-001', name: '灰烬匠', type: 'character', status: 'proposed', truthScope: 'unknown', summary: '以余温锻造的匠人。', constraints: ['不能凭空生火'] }, { id: 'CHR-W01-999', name: '注入条目', type: 'character', status: 'proposed', truthScope: 'unknown', summary: '不应出现。', constraints: [] }],
      keywords: [{ id: 'KEY-001', name: '疾启', definition: '入场即可攻击。', status: 'proposed' }]
    })
  });
  assert.equal(response.status, 200);
  const user = model.requests[0].messages[1].content;
  assert.ok(user.includes('<card_lore>'), '第 6 层应附引用 lore 的内容');
  assert.ok(user.includes('以余温锻造的匠人。'), '必须带摘要');
  assert.ok(user.includes('不能凭空生火'), '必须带约束');
  assert.ok(user.includes('以余温锻造的匠人。') || user.includes('灰烬匠'));
  assert.ok(user.includes('experimental'), '规则摘要必须标为 experimental');
  assert.ok(user.includes('入场即可攻击。'), '关键词定义正文必须进入上下文');
  const loreBlock = user.slice(user.indexOf('<card_lore>'), user.indexOf('</card_lore>'));
  assert.ok(loreBlock.includes('CHR-W01-001'));
  assert.ok(!loreBlock.includes('CHR-W01-999'), '未被当前卡牌引用的 lore 不得进入 <card_lore>');
});
