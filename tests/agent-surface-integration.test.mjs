import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { AGENT_LIMITS } from '../ai-tools.mjs';
import { FREE_AGENT_TOOLS } from '../ai-tools.mjs';
import { loadAgentProfiles } from '../agent-profile-registry.mjs';

// Sprint 2：两个现有入口真正使用选定的产品投影。
// 这里用真实 server.mjs 子进程 + 本地假模型，断言服务端实际发出的提示层次与
// 响应中的 preset 快照；不包含任何真实模型调用。

const repositoryRoot = new URL('../', import.meta.url);

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createProbe();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** 本地假模型：记录每次请求，按当前 behavior 返回，便于逐场景断言。 */
function createFakeModel() {
  const state = { requests: [], behavior: () => ({ status: 200, json: { choices: [{ message: { content: '好的。' } }] } }) };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
    state.requests.push({ url: req.url, body: parsed, system: parsed.messages?.[0]?.content || parsed.instructions || '' });
    const { status, json } = state.behavior(parsed, state.requests);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(json));
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        requests: state.requests,
        setBehavior: fn => { state.behavior = fn; },
        reset: () => { state.requests.length = 0; state.behavior = () => ({ status: 200, json: { choices: [{ message: { content: '好的。' } }] } }); },
        close: () => new Promise(done => server.close(done))
      });
    });
  });
}

let fakeModel, appServer, baseUrl, baseDir, registry;

before(async () => {
  registry = await loadAgentProfiles();
  fakeModel = await createFakeModel();
  baseDir = await mkdtemp(join(tmpdir(), 'worldforge-sprint2-'));
  // 预置作者提示词，使第 4 层在两次请求里都有真实内容，能检出「补生成丢失服务端提示」。
  await writeFile(join(baseDir, 'prompt-settings.json'), JSON.stringify({ personalizedPrompt: '保持冷峻工业风', typePrompts: { magic: '说明术式的能量来源与代价。' } }), 'utf8');
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  appServer = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', repositoryRoot),
    env: {
      ...process.env,
      PORT: String(port),
      LLM_API_KEY: 'test-key',
      LLM_BASE_URL: `http://127.0.0.1:${fakeModel.port}/v1`,
      LLM_MODEL: 'fake-model',
      LLM_API_STYLE: 'chat',
      WORLDFORGE_DB_PATH: join(baseDir, 'content.sqlite'),
      WORLDFORGE_SIM_DB_PATH: join(baseDir, 'simulation.sqlite'),
      WORLDFORGE_ASSETS_PATH: join(baseDir, 'assets'),
      WORLDFORGE_CONFIG_PATH: join(baseDir, '.env.local'),
      WORLDFORGE_PROMPT_SETTINGS_PATH: join(baseDir, 'prompt-settings.json'),
      WORLDFORGE_COMFY_WORKFLOW_PATH: join(baseDir, 'comfyui-workflow.json')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  appServer.stdout.on('data', chunk => { stdout += chunk; });
  appServer.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务未就绪\n${stdout}\n${stderr}`)), 15000);
    const poll = () => {
      if (/http:\/\/127\.0\.0\.1:\d+/.test(stdout)) { clearTimeout(timer); resolve(); return; }
      if (appServer.exitCode !== null) { clearTimeout(timer); reject(new Error(`服务提前退出\n${stderr}`)); return; }
      setTimeout(poll, 25);
    };
    poll();
  });
});

after(async () => {
  // before 可能中途失败，清理必须对未初始化的句柄保持安全。
  if (appServer && appServer.exitCode === null) await new Promise(resolve => { appServer.once('exit', resolve); appServer.kill(); });
  if (fakeModel) await fakeModel.close();
  if (baseDir) await rm(baseDir, { recursive: true, force: true });
});

const loreDraft = { type: 'magic', name: '测试术式', worldId: 'W01' };
const loreBody = (extra = {}) => ({ draft: loreDraft, selectedBlocks: ['name', 'summary'], variantCount: 1, prompt: '只写名称与摘要', ...extra });

function loreReply(content = { name: '灰烬回响', summary: '以余温为引的术式。' }, key = 'candidate-a') {
  return { status: 200, json: { choices: [{ message: { content: JSON.stringify({ variants: [{ key, content }] }) } }] } };
}

test('the lore entry sends the three fixed layers in order around the preset prompt', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(() => loreReply());
  const response = await fetch(`${baseUrl}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loreBody()) });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(fakeModel.requests.length, 1);

  const system = fakeModel.requests[0].system;
  const boundary = system.indexOf('<product_boundary>');
  const preset = system.indexOf('<agent_preset>');
  const contract = system.indexOf('<entry_contract>');
  assert.ok(boundary >= 0 && preset > boundary && contract > preset, '三层必须按 1→2→3 的顺序出现');
  assert.ok(system.includes(registry.get('lore-writer').systemPrompt.trim()), '必须包含 preset 投影正文');
  assert.ok(system.includes('不复制商业 IP') || system.includes('不得复制商业 IP'), '第 1 层保留 IP 边界');
  assert.ok(system.includes('不得修改、否定或悄悄补完 canon'), '第 3 层保留 canon 纪律');
  assert.ok(system.includes('禁止输出“本候选”'), '第 3 层保留元话语禁令');
});

test('the lore response carries the authoritative preset snapshot', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(() => loreReply());
  const data = await (await fetch(`${baseUrl}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loreBody()) })).json();
  const profile = registry.get('lore-writer');
  assert.deepEqual(data.agent, { presetId: profile.id, presetVersion: profile.version, presetHash: profile.hash, mode: profile.mode });
  assert.equal(data.agent.presetVersion, '1.1.0');
  assert.match(data.agent.presetHash, /^sha256:[0-9a-f]{64}$/);
});

test('an incompatible or unknown preset fails before any model call', async () => {
  for (const [presetId, code] of [['card-designer', 'AGENT_PROFILE_INCOMPATIBLE'], ['free-creator', 'AGENT_PROFILE_INCOMPATIBLE'], ['does-not-exist', 'AGENT_PROFILE_UNKNOWN']]) {
    fakeModel.reset();
    const response = await fetch(`${baseUrl}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loreBody({ presetId })) });
    assert.equal(response.status, 400, `${presetId} 应返回 400`);
    const data = await response.json();
    assert.ok(data.error.includes(code), `${presetId} 的错误应含 ${code}，实际：${data.error}`);
    assert.equal(fakeModel.requests.length, 0, `${presetId} 不应产生模型调用`);
  }
});

test('supplement generation reuses the same preset snapshot', async () => {
  fakeModel.reset();
  let call = 0;
  fakeModel.setBehavior(() => {
    call += 1;
    if (call === 1) return loreReply({ name: '第一份', summary: '第一份摘要' }, 'candidate-a');
    return loreReply({ name: '第二份', summary: '第二份摘要' }, 'candidate-b');
  });
  const data = await (await fetch(`${baseUrl}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loreBody({ variantCount: 2 })) })).json();
  assert.equal(data.variants.length, 2);
  assert.equal(fakeModel.requests.length, 2, '应触发一次差额补生成');
  assert.equal(fakeModel.requests[0].system, fakeModel.requests[1].system, '补生成必须沿用同一 system');
  assert.deepEqual(data.agent, { presetId: 'lore-writer', presetVersion: registry.get('lore-writer').version, presetHash: registry.get('lore-writer').hash, mode: 'structured_lore' });

  // 第二次真实出站请求也必须保持 4 → 5 → 6：补生成任务在第 5 层，
  // 已验收候选与校验问题在第 6 层最后，不能出现 4→5→6→6→5。
  const supplement = fakeModel.requests[1].body.messages.filter(item => item.role === 'user').at(-1).content;
  const order = {
    author: supplement.indexOf('<author_type_prompt>'),
    task: supplement.indexOf('目标模块：'),
    supplementTask: supplement.indexOf('现在只补充缺少的'),
    examples: supplement.indexOf('<worldforge_examples>'),
    context: supplement.indexOf('<worldforge_context>'),
    accepted: supplement.indexOf('<accepted_variants>'),
    issues: supplement.indexOf('<validation_issues>')
  };
  for (const [label, index] of Object.entries(order)) assert.ok(index >= 0, `补生成请求应包含 ${label}`);
  assert.ok(order.author < order.task && order.task < order.supplementTask, '第 4 层 → 第 5 层（含补生成指令）');
  assert.ok(order.supplementTask < order.examples, '补生成指令不得晚于第 6 层');
  assert.ok(order.examples < order.accepted && order.context < order.accepted, '已验收候选属于第 6 层');
  assert.ok(order.accepted < order.issues, '校验问题数据在最后');

  // 第 4 层必须与初次请求逐字一致：服务端注入的分类提示与个性化提示不能丢失。
  const layer4 = text => {
    const start = text.indexOf('<author_type_prompt>');
    const end = text.indexOf('</author_personalized_style>');
    return start >= 0 && end > start ? text.slice(start, end + '</author_personalized_style>'.length) : '';
  };
  const initial = fakeModel.requests[0].body.messages.filter(item => item.role === 'user').at(-1).content;
  assert.ok(layer4(initial).length > 0, '初次请求应带第 4 层');
  assert.ok(layer4(initial).includes('保持冷峻工业风'), '初次请求应带作者个性化提示');
  assert.equal(layer4(supplement), layer4(initial), '补生成的第 4 层必须与初次请求完全一致');
  assert.ok(layer4(supplement).includes('保持冷峻工业风'), '补生成不得丢失作者个性化提示');
  assert.ok(layer4(supplement).includes('说明术式的能量来源与代价。'), '补生成不得丢失分类提示');
  assert.ok(!layer4(supplement).includes('无额外分类提示'), '补生成不得退回无分类提示');
  assert.ok(!layer4(supplement).includes('无额外统一风格要求'), '补生成不得退回无风格要求');

  // 数量要求必须与补生成指令和 Schema 一致，不能同时出现「严格返回 2 份」与「只补 1 份」。
  assert.ok(supplement.includes('候选数量：严格返回 1 份'), '补生成的数量要求应为 missingCount');
  assert.ok(!supplement.includes('候选数量：严格返回 2 份'), '补生成不得沿用原始总数');
  assert.ok(supplement.includes('现在只补充缺少的 1 份'), '补生成指令数量一致');
  const supplementSchema = fakeModel.requests[1].body.response_format.json_schema.schema;
  assert.equal(supplementSchema.properties.variants.minItems, 1, '补生成 Schema 的 minItems 应为 missingCount');
  assert.equal(supplementSchema.properties.variants.maxItems, 1, '补生成 Schema 的 maxItems 应为 missingCount');
});

/** 断言一条出站 prompt 的 JSON 兜底指令位于第 5 层（早于所有第 6 层块），且不在尾部。 */
function assertJsonInstructionInTaskLayer(prompt, { endsWith }) {
  const instruction = '严格只返回 JSON 对象。';
  assert.equal(prompt.split(instruction).length - 1, 1, 'JSON 指令应恰好出现一次');
  const index = prompt.indexOf(instruction);
  const firstUntrusted = Math.min(...['<worldforge_examples>', '<worldforge_context>', '<accepted_variants>', '<validation_issues>']
    .map(tag => prompt.indexOf(tag))
    .filter(index => index >= 0));
  assert.ok(index > prompt.indexOf('目标模块：'), 'JSON 指令属于第 5 层');
  assert.ok(index < firstUntrusted, 'JSON 指令必须早于所有第 6 层块');
  assert.ok(prompt.trimEnd().endsWith(endsWith), `prompt 应以 ${endsWith} 结尾，尾部不得再追加指令`);
}

test('the initial non-structured fallback keeps the JSON requirement inside layer 5', async () => {
  fakeModel.reset();
  // 结构化请求一律 400（模拟不支持 response_format 的兼容接口），非结构化按候选数返回。
  let nonStructured = 0;
  fakeModel.setBehavior(body => {
    if (body.response_format) return { status: 400, json: { error: { message: 'response_format unsupported' } } };
    nonStructured += 1;
    return loreReply({ name: `第${nonStructured}份`, summary: '摘要' }, `candidate-${nonStructured}`);
  });
  const data = await (await fetch(`${baseUrl}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loreBody({ variantCount: 2 })) })).json();
  assert.equal(data.variants.length, 2);
  assert.equal(fakeModel.requests.length, 3, '结构化失败 + 非结构化成功 + 非结构化补生成');

  // 第二次（降级初次）与第三次（降级补生成）都必须保持 4→5→6。
  assertJsonInstructionInTaskLayer(fakeModel.requests[1].body.messages.filter(item => item.role === 'user').at(-1).content, { endsWith: '</worldforge_context>' });
  assertJsonInstructionInTaskLayer(fakeModel.requests[2].body.messages.filter(item => item.role === 'user').at(-1).content, { endsWith: '</validation_issues>' });
  const layer4 = text => text.slice(text.indexOf('<author_type_prompt>'), text.indexOf('</author_personalized_style>') + '</author_personalized_style>'.length);
  assert.equal(layer4(fakeModel.requests[2].body.messages.filter(item => item.role === 'user').at(-1).content), layer4(fakeModel.requests[1].body.messages.filter(item => item.role === 'user').at(-1).content), '降级补生成仍沿用同一第 4 层');
});

test('the supplement structured fallback keeps the JSON requirement inside layer 5', async () => {
  fakeModel.reset();
  let structuredCalls = 0;
  fakeModel.setBehavior(body => {
    if (body.response_format) {
      structuredCalls += 1;
      // 第一次结构化（初次）成功但少给一份，触发补生成；补生成的结构化请求失败 → 走降级。
      if (structuredCalls === 1) return loreReply({ name: '第一份', summary: '摘要' }, 'candidate-a');
      return { status: 400, json: { error: { message: 'response_format unsupported' } } };
    }
    return loreReply({ name: '第二份', summary: '摘要' }, 'candidate-b');
  });
  const data = await (await fetch(`${baseUrl}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loreBody({ variantCount: 2 })) })).json();
  assert.equal(data.variants.length, 2);
  assert.equal(fakeModel.requests.length, 3, '初次结构化 + 补生成结构化失败 + 补生成降级');
  assertJsonInstructionInTaskLayer(fakeModel.requests[2].body.messages.filter(item => item.role === 'user').at(-1).content, { endsWith: '</validation_issues>' });
});

test('the free entry keeps untrusted content out of the system instructions', async () => {
  fakeModel.reset();
  fakeModel.setBehavior(() => ({ status: 200, json: { choices: [{ message: { content: '可以从三个方向展开。' } }] } }));
  const body = {
    messages: [{ role: 'user', content: '帮我比较两套文明' }],
    relatedInformation: '作者补充：偏工业风',
    library: [{ id: 'CHR-W01-001', type: 'character', name: '测试人物', status: 'proposed', truthScope: 'unknown', worldId: 'W01', summary: '摘要正文' }],
    artAssets: []
  };
  const response = await fetch(`${baseUrl}/api/ai/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.toolMode, 'native');
  const profile = registry.get('free-creator');
  assert.deepEqual(data.agent, { presetId: profile.id, presetVersion: profile.version, presetHash: profile.hash, mode: profile.mode });

  const system = fakeModel.requests[0].system;
  assert.ok(system.includes(profile.systemPrompt.trim()), '必须包含 free preset 投影正文');
  assert.ok(system.includes('search_lore'), '必须包含工具协议');
  assert.ok(system.includes('可检索资料 1 条'), '必须包含本次可用范围（产品生成的元数据）');
  assert.ok(system.includes('<entry_contract>'), '入口契约层仍然存在');
  // P1：作者笔记属于第 6 层，只能出现在用户侧上下文。
  assert.ok(!system.includes('偏工业风'), 'system 不得包含 author_notes 正文');
  assert.ok(!system.includes('<author_notes>'), 'system 不得包含 author_notes 标记');
  const userMessage = fakeModel.requests[0].body.messages.filter(item => item.role === 'user').at(-1).content;
  assert.ok(userMessage.includes('<untrusted_context>'), '不可信层必须附在用户侧');
  assert.ok(userMessage.includes('偏工业风'), '作者笔记必须作为用户侧上下文传递');

  const offered = (fakeModel.requests[0].body.tools || []).map(tool => tool.function?.name);
  assert.deepEqual(offered.sort(), FREE_AGENT_TOOLS.map(tool => tool.name).sort(), '只提供白名单内的五个只读工具');
});

test('the free entry rejects presets from another surface', async () => {
  for (const presetId of ['lore-writer', 'card-designer', 'missing']) {
    fakeModel.reset();
    const response = await fetch(`${baseUrl}/api/ai/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: '你好' }], presetId }) });
    assert.equal(response.status, 400);
    assert.equal(fakeModel.requests.length, 0);
  }
});

test('tool-unavailable degradation keeps the same preset snapshot', async () => {
  fakeModel.reset();
  fakeModel.setBehavior((body) => {
    if (Array.isArray(body.tools) && body.tools.length) return { status: 400, json: { error: { message: 'tools not supported' } } };
    return { status: 200, json: { choices: [{ message: { content: '降级回答。' } }] } };
  });
  const body = {
    messages: [{ role: 'user', content: '检索一下现有势力' }],
    library: [{ id: 'FAC-W01-001', type: 'faction', name: '测试势力', status: 'proposed', truthScope: 'in_world_belief', worldId: 'W01', summary: '摘要' }]
  };
  const data = await (await fetch(`${baseUrl}/api/ai/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  assert.equal(data.toolMode, 'unavailable');
  assert.equal(data.reply, '降级回答。');
  const profile = registry.get('free-creator');
  assert.deepEqual(data.agent, { presetId: profile.id, presetVersion: profile.version, presetHash: profile.hash, mode: profile.mode });
  assert.equal(fakeModel.requests.length, 2, '一次带工具失败 + 一次不带工具重试');
  assert.ok(fakeModel.requests[1].system.includes(profile.systemPrompt.trim()), '降级路径必须保留同一 preset');
  // 降级的资料库索引同样属于第 6 层：只能进用户侧，不得进 system/entry_contract。
  assert.ok(!fakeModel.requests[1].system.includes('<library_context>'), 'system 不得包含 library_context');
  assert.ok(!fakeModel.requests[1].system.includes('测试势力'), 'system 不得包含资料库正文');
  const fallbackUser = fakeModel.requests[1].body.messages.filter(item => item.role === 'user').at(-1).content;
  assert.ok(fallbackUser.includes('<library_context>'), '降级路径把条目索引放进用户侧上下文');
  assert.ok(fallbackUser.includes('测试势力'));
});

test('the preset cannot widen the server hard limits', async () => {
  fakeModel.reset();
  // 只要服务端还提供工具就每轮请求 3 次工具；被强制收尾时返回文本。
  const threeCalls = () => ({ status: 200, json: { choices: [{ message: { content: '', tool_calls: [1, 2, 3].map(index => ({ id: `c${index}`, type: 'function', function: { name: 'list_lore', arguments: '{}' } })) } }] } });
  fakeModel.setBehavior(body => (Array.isArray(body.tools) && body.tools.length ? threeCalls() : { status: 200, json: { choices: [{ message: { content: '依据已取得资料作答。' } }] } }));
  const body = {
    messages: [{ role: 'user', content: '一直检索' }],
    library: [{ id: 'FAC-W01-001', type: 'faction', name: '测试势力', status: 'proposed', truthScope: 'unknown', worldId: 'W01', summary: '摘要' }]
  };
  const data = await (await fetch(`${baseUrl}/api/ai/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  assert.ok(data.rounds <= 6, `轮次应不超过 6，实际 ${data.rounds}`);
  assert.equal(data.toolCalls, 12, '工具调用应被硬上限截断在 12 次');
  assert.equal(data.stopped, 'tool_budget');
  assert.equal(AGENT_LIMITS.maxImages, 4, '单轮附图硬上限仍为 4');
  const profile = registry.get('free-creator');
  assert.deepEqual(data.agent, { presetId: profile.id, presetVersion: profile.version, presetHash: profile.hash, mode: profile.mode }, '硬上限耗尽后仍回显同一快照');
});
