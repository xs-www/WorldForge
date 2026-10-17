import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { completeCardVariants, createCardResponseSchema, inspectCardResponse, validateCardVariant } from '../card-agent.mjs';
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
const review = () => ({ legalTargets: '自身', timing: '入场时', effectOrder: '先结算战吼再触发其他效果', duration: '永久', counterplay: '沉默或移除', edgeCases: ['没有合法目标时跳过'] });
const variant = (patch, extra = {}) => ({ key: 'a', patch, review: review(), ...extra });

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

test('incomplete reviews are diagnostics, not silent passes', () => {
  const incomplete = { key: 'a', patch: { name: '甲' }, review: { legalTargets: '自身', timing: '入场', effectOrder: '顺序', duration: '', counterplay: '沉默', edgeCases: [] } };
  const inspected = inspectCardResponse({ variants: [incomplete] }, basePayload());
  assert.equal(inspected.variants.length, 0);
  assert.equal(inspected.issues[0].code, 'INVALID_VARIANT');
  assert.match(inspected.issues[0].message, /duration|edgeCases/);
  assert.equal(inspectCardResponse('not json', basePayload()).issues[0].code, 'INVALID_JSON');
  assert.equal(inspectCardResponse({ variants: [] }, basePayload()).variants.length, 0);
});

test('balance claims are rejected while untested markers are added', () => {
  assert.throws(() => validateCardVariant(variant({ rulesText: '该卡数值已平衡。' }), basePayload()), /已平衡/);
  assert.throws(() => validateCardVariant(variant({ name: '甲' }, { review: { ...review(), counterplay: '经过仿真验证无解' } }), basePayload()), /仿真验证/);
  const added = validateCardVariant(variant({ cost: 4 }), basePayload({ selectedFields: ['cost'] }));
  assert.deepEqual(added.patch.notes, ['数值未经测试（untested）']);
});

test('the supplement fills only the missing count and keeps diagnostics', async () => {
  const payload = basePayload({ variantCount: 2 });
  const first = { variants: [{ key: 'a', patch: { name: '甲' }, review: review() }] };
  const second = { variants: [{ key: 'b', patch: { name: '乙' }, review: review() }] };
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
    const reply = state.behavior ? state.behavior(parsed, state.requests) : { status: 200, json: { choices: [{ message: { content: JSON.stringify({ variants: [{ key: 'candidate-a', patch: { name: '甲', cost: 3 }, review: review() }] }) } }] } };
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
  model.set(() => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify({ variants: [{ key: 'a', patch: { attack: 5 }, review: review() }] }) } }] } }));
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

test('cross-type patches apply the target type stats (both directions)', () => {
  // 服务端允许 patch.type 改变类型；前端回填必须先按目标类型判断专属数值。
  const toEquipment = validateCardVariant(variant({ type: 'equipment', durability: 2 }), basePayload({ draft: { type: 'minion' }, selectedFields: ['type', 'durability'] }));
  assert.equal(toEquipment.patch.type, 'equipment');
  assert.equal(toEquipment.patch.durability, 2);
  const toMinion = validateCardVariant(variant({ type: 'minion', health: 3 }), basePayload({ draft: { type: 'equipment' }, selectedFields: ['type', 'health'] }));
  assert.equal(toMinion.patch.health, 3);
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
      loreRefs: [{ id: 'CHR-W01-001', name: '灰烬匠', type: 'character', status: 'proposed', truthScope: 'unknown', summary: '以余温锻造的匠人。', constraints: ['不能凭空生火'] }]
    })
  });
  assert.equal(response.status, 200);
  const user = model.requests[0].messages[1].content;
  assert.ok(user.includes('<card_lore>'), '第 6 层应附引用 lore 的内容');
  assert.ok(user.includes('以余温锻造的匠人。'), '必须带摘要');
  assert.ok(user.includes('不能凭空生火'), '必须带约束');
  assert.ok(user.includes('以余温锻造的匠人。') || user.includes('灰烬匠'));
  assert.ok(user.includes('experimental'), '规则摘要必须标为 experimental');
});
