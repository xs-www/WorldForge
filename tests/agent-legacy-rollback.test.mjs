import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { composeAgentSystemPrompt, CARD_ENTRY_CONTRACT, FREE_ENTRY_CONTRACT, FREE_AGENT_TOOL_GUIDE, LORE_ENTRY_CONTRACT, SYSTEM_INSTRUCTIONS } from '../ai-harness.mjs';
import { FREE_AGENT_TOOLS } from '../ai-tools.mjs';
import { AGENT_SURFACES, AGENT_SURFACE_COMPATIBILITY } from '../agent-profile-contract.mjs';
import {
  LEGACY_PRESET_ID,
  LEGACY_PRESET_VERSION,
  LEGACY_PROMPTS_ENV,
  LEGACY_PROMPT_SOURCE,
  legacyAgentSnapshot,
  legacyDefaults,
  legacyPresetsView,
  legacyProfile,
  legacyPromptsEnabled,
  legacyRegistryHealth
} from '../agent-legacy.mjs';

// Sprint 5 回滚与冻结：计划 §12.0.1 第 1–7 条。
// 真实模型调用不在此覆盖：这里的模型是本地假接口，不产生外部费用。

const repositoryRoot = new URL('../', import.meta.url);
const fixtureRoot = new URL('../tests/fixtures/agent-profiles/legal/', import.meta.url);
const LORE_PROMPT = '【测试 persona】你是一位设定写作助手，先确认来源再提出候选。\n';

const lorePayload = { draft: { type: 'magic', name: '测试', worldId: 'W01' }, selectedBlocks: ['name', 'summary'], variantCount: 1 };
const freePayload = { messages: [{ role: 'user', content: '帮我看看灰烬城' }], library: [{ id: 'L1', name: '灰烬城', type: 'location', status: 'proposed', summary: '测试条目' }] };
const cardPayload = { action: 'brainstorm', variantCount: 1, selectedFields: ['name', 'cost'], draft: { name: '草案', type: 'minion', cost: 2, attack: 1, health: 1, rarity: 'common', rulesText: '', keywordIds: [], loreRefs: [] } };

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

/** 本地假模型：按请求内容分别返回设定候选、卡牌候选或自由对答，不访问外网。 */
function fakeModel() {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
    requests.push(parsed);
    const flat = JSON.stringify(parsed);
    const content = parsed.tools?.length
      ? '这是假模型对自由对话的回答。'
      : flat.includes('<card_draft>')
        ? JSON.stringify({ variants: [{ key: 'a', patch: { name: '灰烬匠', cost: 3 } }] })
        : JSON.stringify({ variants: [{ key: 'candidate-a', content: { name: '甲', summary: '乙' } }] });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    requests,
    close: () => new Promise(done => { server.closeAllConnections?.(); server.close(done); })
  })));
}

/**
 * 子进程环境：先剔除宿主可能存在的回滚开关，确保「默认路径」用例不会因为开发机
 * 的 .env 变量而误开回滚；需要回滚的用例再显式传入。
 */
function childEnv(env) {
  const base = { ...process.env };
  delete base[LEGACY_PROMPTS_ENV];
  return { ...base, ...env };
}

async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', repositoryRoot),
    env: { PORT: String(port), LLM_API_KEY: 'test-key', LLM_BASE_URL: 'http://127.0.0.1:1/v1', LLM_MODEL: 'fake', LLM_API_STYLE: 'chat', ...childEnv(env) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务未就绪\n${stdout}\n${stderr}`)), 15000);
    const poll = () => {
      if (/http:\/\/127\.0\.0\.1:\d+/.test(stdout)) { clearTimeout(timer); resolve(); return; }
      if (child.exitCode !== null) { clearTimeout(timer); reject(new Error(`服务提前退出（code=${child.exitCode}）\n${stdout}\n${stderr}`)); return; }
      setTimeout(poll, 25);
    };
    poll();
  });
  const base = `http://127.0.0.1:${port}`;
  return {
    port,
    base,
    output: () => `${stdout}\n${stderr}`,
    get: async path => { const response = await fetch(`${base}/api/${path}`); return { status: response.status, body: await response.json() }; },
    post: async (path, payload, headers = {}) => { const response = await fetch(`${base}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) }); return { status: response.status, body: await response.json() }; },
    close: () => new Promise(resolve => { if (child.exitCode !== null) { resolve(); return; } child.once('exit', resolve); child.kill(); })
  };
}

/** 等待进程自行退出：用于「必须拒绝启动」的两种默认路径。 */
async function runToExit(env) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', repositoryRoot),
    env: { PORT: String(await freePort()), LLM_API_KEY: 'test-key', LLM_BASE_URL: 'http://127.0.0.1:1/v1', LLM_MODEL: 'fake', LLM_API_STYLE: 'chat', ...childEnv(env) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`进程未退出\n${stdout}\n${stderr}`)); }, 15000);
    child.once('exit', value => { clearTimeout(timer); resolve(value); });
  });
  return { code, output: () => `${stdout}\n${stderr}` };
}

/** 三份合法 fixture，id 保留原值：fixture-lore / fixture-free / fixture-card。 */
async function presetRoot(base, name = 'presets') {
  const root = join(base, name);
  for (const relative of ['fixture-lore', 'fixture-free', 'fixture-card']) {
    await cp(new URL(`${relative}/`, fixtureRoot), join(root, relative), { recursive: true });
  }
  await writeFile(join(root, 'fixture-lore', 'runtime', 'system.md'), LORE_PROMPT, 'utf8');
  return root;
}

/** 目录结构合法但 manifest 是坏 JSON：默认必须拒绝启动（S5-01/S5-07 的启动侧表现）。 */
async function brokenPresetRoot(base) {
  const root = join(base, 'broken-presets');
  const preset = join(root, 'broken-lore');
  await cp(new URL('fixture-lore/', fixtureRoot), preset, { recursive: true });
  await writeFile(join(preset, 'worldforge.runtime.json'), '{ "id": "broken-lore", ', 'utf8');
  return root;
}

function presetById(view, id) {
  return (view.presets || []).find(item => item.id === id) || null;
}

function systemOf(request) {
  return request.messages?.[0]?.role === 'system' ? request.messages[0].content : request.instructions;
}

let base, paths;
before(async () => {
  base = await mkdtemp(join(tmpdir(), 'worldforge-sprint5-'));
  const presets = await presetRoot(base);
  const broken = await brokenPresetRoot(base);
  paths = {
    presets,
    broken,
    env: root => ({
      WORLDFORGE_AGENT_PRESETS_DIR: root,
      WORLDFORGE_AGENT_SETTINGS_PATH: join(base, 'agent-settings.json'),
      WORLDFORGE_DB_PATH: join(base, 'content.sqlite'),
      WORLDFORGE_SIM_DB_PATH: join(base, 'simulation.sqlite'),
      WORLDFORGE_ASSETS_PATH: join(base, 'assets'),
      WORLDFORGE_CONFIG_PATH: join(base, '.env.local'),
      WORLDFORGE_PROMPT_SETTINGS_PATH: join(base, 'prompt-settings.json'),
      WORLDFORGE_COMFY_WORKFLOW_PATH: join(base, 'comfyui-workflow.json')
    })
  };
});
after(async () => { if (base) await rm(base, { recursive: true, force: true }); });

test('the rollback switch only accepts the exact value 1', () => {
  assert.equal(legacyPromptsEnabled({ [LEGACY_PROMPTS_ENV]: '1' }), true);
  for (const value of ['0', '', 'true', 'TRUE', 'yes', ' 1', '1 ', '2', null, undefined]) {
    assert.equal(legacyPromptsEnabled({ [LEGACY_PROMPTS_ENV]: value }), false, `值 ${JSON.stringify(value)} 不得打开回滚`);
  }
  assert.equal(legacyPromptsEnabled({}), false);
});

test('legacy profiles keep the frozen compatibility matrix but carry no preset prompt', () => {
  for (const surface of AGENT_SURFACES) {
    const profile = legacyProfile(surface);
    const compatibility = AGENT_SURFACE_COMPATIBILITY[surface];
    assert.equal(profile.mode, compatibility.mode);
    assert.equal(profile.outputContract, compatibility.outputContract);
    assert.equal(profile.toolPolicy, compatibility.toolPolicy);
    assert.equal(profile.statusPolicy, compatibility.statusPolicy);
    assert.equal(profile.systemPrompt, '', 'legacy 不得携带 preset 提示词');
    assert.equal(profile.legacy, true);
    assert.deepEqual(legacyAgentSnapshot(surface), {
      presetId: LEGACY_PRESET_ID,
      presetVersion: LEGACY_PRESET_VERSION,
      presetHash: '',
      mode: compatibility.mode
    });
  }
  assert.throws(() => legacyProfile('simulation'), error => error.code === 'AGENT_PROFILE_INCOMPATIBLE' && error.status === 400);
  assert.deepEqual(legacyDefaults(), { lore: LEGACY_PRESET_ID, free: LEGACY_PRESET_ID, card: LEGACY_PRESET_ID });
  // 空目录响应仍是既有结构：schemaVersion / presets / defaults + fallback 说明。
  assert.deepEqual(legacyPresetsView(), { schemaVersion: 1, presets: [], defaults: legacyDefaults(), fallback: LEGACY_PROMPT_SOURCE });
  const degraded = legacyRegistryHealth({ code: 'AGENT_MANIFEST_UNREADABLE', message: '坏 JSON' });
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.promptSource, LEGACY_PROMPT_SOURCE);
  assert.equal(degraded.count, 0);
  assert.deepEqual(degraded.countBySurface, { lore: 0, free: 0, card: 0 });
  assert.deepEqual(degraded.diagnostics, [{ code: 'AGENT_MANIFEST_UNREADABLE', message: '坏 JSON' }]);
});

test('the default path is unchanged: healthy registry, real presets, no fallback flag', async () => {
  const server = await startServer(paths.env(paths.presets));
  try {
    const health = await server.get('health');
    assert.equal(health.status, 200);
    assert.equal(health.body.agentProfiles.count, 3);
    assert.equal(health.body.agentProfiles.degraded, undefined, '默认路径不得出现 degraded 字段');
    assert.equal(health.body.agentProfiles.promptSource, undefined, '默认路径不得出现 promptSource 字段');
    assert.deepEqual(health.body.agentProfiles.ids, ['fixture-card', 'fixture-free', 'fixture-lore']);

    const presets = await server.get('ai/presets');
    assert.equal(presets.status, 200);
    assert.equal(presets.body.fallback, undefined, '默认路径不得带 fallback');
    assert.deepEqual(presets.body.defaults, { lore: 'fixture-lore', free: 'fixture-free', card: 'fixture-card' });
    assert.match(presetById(presets.body, 'fixture-lore').hash, /^sha256:[0-9a-f]{64}$/);

    const settings = await server.get('settings');
    assert.equal(settings.body.agentPromptSource, undefined, '默认路径不得新增设置字段');
    assert.deepEqual(settings.body.agentPresets, { lore: 'fixture-lore', free: 'fixture-free', card: 'fixture-card' });
  } finally {
    await server.close();
  }
});

test('explicit legacy startup reports the fallback instead of a missing configuration', async () => {
  const model = await fakeModel();
  const server = await startServer({ ...paths.env(paths.presets), LLM_BASE_URL: `http://127.0.0.1:${model.port}/v1`, [LEGACY_PROMPTS_ENV]: '1' });
  try {
    const health = await server.get('health');
    assert.equal(health.status, 200, '回滚模式健康检查仍是 200');
    assert.equal(health.body.agentProfiles.promptSource, LEGACY_PROMPT_SOURCE);
    assert.equal(health.body.agentProfiles.degraded, undefined, 'Registry 正常时不算降级');
    assert.deepEqual(health.body.agentProfiles.ids, ['fixture-card', 'fixture-free', 'fixture-lore']);

    const presets = await server.get('ai/presets');
    assert.equal(presets.status, 200);
    assert.equal(presets.body.fallback, LEGACY_PROMPT_SOURCE);
    assert.deepEqual(presets.body.presets, [], '回滚模式不按 preset 解析，因此不展示可选预设');
    assert.deepEqual(presets.body.defaults, legacyDefaults());
    assert.equal(presets.body.schemaVersion, 1, '既有结构字段仍然存在');

    const settings = await server.get('settings');
    assert.equal(settings.body.agentPromptSource, LEGACY_PROMPT_SOURCE);
    assert.deepEqual(settings.body.agentPresets, legacyDefaults());

    // 回滚模式不接受 preset 选择：静默保存只会让界面与真实行为不一致。
    const rejected = await server.post('settings', { baseUrl: 'https://api.openai.com/v1', model: 'fake', style: 'chat', agentPresets: { lore: 'fixture-lore' } }, { 'X-Worldforge-Settings': '1' });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error, /AGENT_SETTINGS_INVALID/);

    const lore = await server.post('ai', { ...lorePayload, presetId: 'fixture-lore', presetVersion: '9.9.9', presetHash: 'sha256:forged' });
    assert.equal(lore.status, 200, JSON.stringify(lore.body));
    assert.deepEqual(lore.body.agent, { presetId: LEGACY_PRESET_ID, presetVersion: LEGACY_PRESET_VERSION, presetHash: '', mode: 'structured_lore' });
    assert.equal(systemOf(model.requests[0]), SYSTEM_INSTRUCTIONS, '第 1 层产品边界与第 3 层入口契约必须与固定基线一致');
  } finally {
    await server.close();
    await model.close();
  }
});

test('rollback replaces only the persona: boundary, contracts, tools and schema stay identical', async () => {
  const model = await fakeModel();
  const env = { ...paths.env(paths.presets), LLM_BASE_URL: `http://127.0.0.1:${model.port}/v1` };
  const presetText = (await readFile(join(paths.presets, 'fixture-lore', 'runtime', 'system.md'), 'utf8')).trim();
  const legacyServer = await startServer({ ...env, [LEGACY_PROMPTS_ENV]: '1' });
  try {
    const legacyLore = await legacyServer.post('ai', lorePayload);
    const legacyFree = await legacyServer.post('ai/free', freePayload);
    const legacyCard = await legacyServer.post('ai/card', cardPayload);
    assert.equal(legacyLore.status, 200, JSON.stringify(legacyLore.body));
    assert.equal(legacyFree.status, 200, JSON.stringify(legacyFree.body));
    assert.equal(legacyCard.status, 200, JSON.stringify(legacyCard.body));

    const [loreRequest, freeRequest, cardRequest] = model.requests;
    const loreSystem = systemOf(loreRequest);
    const freeSystem = systemOf(freeRequest);
    const cardSystem = systemOf(cardRequest);
    // 第 2 层退回代码内固定 persona：没有 <agent_preset>，其余层逐字相同。
    for (const system of [loreSystem, freeSystem, cardSystem]) assert.ok(!system.includes('<agent_preset>'), '回滚模式不得注入 preset 层');
    assert.equal(loreSystem, SYSTEM_INSTRUCTIONS);
    assert.equal(cardSystem, composeAgentSystemPrompt({ entryContract: CARD_ENTRY_CONTRACT }));
    assert.equal(freeSystem, composeAgentSystemPrompt({
      entryContract: FREE_ENTRY_CONTRACT,
      extraContracts: ['本次可用范围：作者提供了可检索资料 1 条。', FREE_AGENT_TOOL_GUIDE]
    }), '自由入口只保留第 1、3 层与工具指南');
    assert.ok(freeSystem.includes(FREE_AGENT_TOOL_GUIDE), '工具指南仍然保留');
    for (const system of [loreSystem, cardSystem]) {
      assert.ok(system.includes('<product_boundary>'), '第 1 层安全边界必须保留');
      assert.ok(system.includes('<entry_contract>'), '第 3 层入口契约必须保留');
    }
    // 工具白名单不变：仍是同一组只读资料工具。
    assert.deepEqual((freeRequest.tools || []).map(item => item.function?.name).sort(), FREE_AGENT_TOOLS.map(item => item.name).sort());
    assert.equal(legacyFree.body.toolMode, 'native');
    assert.equal(legacyFree.body.agent.presetId, LEGACY_PRESET_ID);
    // Schema 不变：同一 payload 下结构化请求体的 schema 完全一致。
    const legacyLoreSchema = JSON.stringify(loreRequest.response_format);
    const legacyCardSchema = JSON.stringify(cardRequest.response_format);
    assert.match(legacyLoreSchema, /"json_schema"/);

    const presetsServer = await startServer(env);
    try {
      const presetLore = await presetsServer.post('ai', lorePayload);
      const presetCard = await presetsServer.post('ai/card', cardPayload);
      assert.equal(presetLore.status, 200, JSON.stringify(presetLore.body));
      assert.equal(presetCard.status, 200, JSON.stringify(presetCard.body));
      const presetRequest = model.requests.at(-2);
      // 对照：默认路径注入 preset 层，且第 1、3 层与回滚模式一致。
      assert.ok(systemOf(presetRequest).includes('<agent_preset>'));
      assert.equal(systemOf(presetRequest), composeAgentSystemPrompt({ presetPrompt: presetText, entryContract: LORE_ENTRY_CONTRACT }));
      assert.equal(JSON.stringify(presetRequest.response_format), legacyLoreSchema, 'Schema 不因 persona 来源而改变');
      assert.equal(JSON.stringify(model.requests.at(-1).response_format), legacyCardSchema, '卡牌 Schema 同样不受回滚影响');
      assert.equal(presetLore.body.agent.presetId, 'fixture-lore');
      assert.equal(presetCard.body.agent.presetId, 'fixture-card');
    } finally {
      await presetsServer.close();
    }
  } finally {
    await legacyServer.close();
    await model.close();
  }
});

test('a corrupt registry still refuses to start without the flag', async () => {
  const result = await runToExit(paths.env(paths.broken));
  assert.equal(result.code, 1, result.output());
  assert.match(result.output(), /AGENT_MANIFEST_UNREADABLE/);
  assert.match(result.output(), /拒绝启动/);
});

test('a near-miss flag value does not enable the degraded path', async () => {
  const result = await runToExit({ ...paths.env(paths.broken), [LEGACY_PROMPTS_ENV]: 'true' });
  assert.equal(result.code, 1, result.output());
  assert.match(result.output(), /拒绝启动/);
});

test('a corrupt registry starts degraded only with the explicit flag', async () => {
  const model = await fakeModel();
  const server = await startServer({ ...paths.env(paths.broken), LLM_BASE_URL: `http://127.0.0.1:${model.port}/v1`, [LEGACY_PROMPTS_ENV]: '1' });
  try {
    const health = await server.get('health');
    assert.equal(health.status, 200, '健康检查保持 200');
    assert.equal(health.body.agentProfiles.degraded, true);
    assert.equal(health.body.agentProfiles.promptSource, LEGACY_PROMPT_SOURCE);
    assert.equal(health.body.agentProfiles.count, 0);
    assert.equal(health.body.agentProfiles.diagnostics[0].code, 'AGENT_MANIFEST_UNREADABLE');
    assert.match(server.output(), /降级启动/);

    const presets = await server.get('ai/presets');
    assert.equal(presets.status, 200);
    assert.equal(presets.body.fallback, LEGACY_PROMPT_SOURCE);
    assert.deepEqual(presets.body.presets, []);

    const lore = await server.post('ai', lorePayload);
    assert.equal(lore.status, 200, JSON.stringify(lore.body));
    assert.equal(lore.body.agent.presetId, LEGACY_PRESET_ID);
    assert.equal(systemOf(model.requests[0]), SYSTEM_INSTRUCTIONS);
  } finally {
    await server.close();
    await model.close();
  }
});

test('S5-03: a booted process keeps its frozen snapshot until restart', async () => {
  const root = await presetRoot(base, 'frozen-presets');
  const env = paths.env(root);
  const manifestPath = join(root, 'fixture-lore', 'worldforge.runtime.json');
  const promptPath = join(root, 'fixture-lore', 'runtime', 'system.md');

  const first = await startServer(env);
  let beforeRestart;
  try {
    const initial = await first.get('ai/presets');
    beforeRestart = presetById(initial.body, 'fixture-lore');
    assert.equal(beforeRestart.version, '0.1.0');
    // 启动后同时改 manifest 与 prompt：当前进程必须继续使用冻结快照。
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, version: '9.9.9' }, null, 2)}\n`, 'utf8');
    await writeFile(promptPath, '被替换的提示词（本进程不应读取）\n', 'utf8');
    const frozen = presetById((await first.get('ai/presets')).body, 'fixture-lore');
    assert.equal(frozen.version, beforeRestart.version, '运行中进程不得读到新版本');
    assert.equal(frozen.hash, beforeRestart.hash, '运行中进程不得重算哈希');
  } finally {
    await first.close();
  }

  const second = await startServer(env);
  let afterManifest;
  try {
    afterManifest = presetById((await second.get('ai/presets')).body, 'fixture-lore');
    assert.equal(afterManifest.version, '9.9.9', '重启后才读取新 manifest');
    assert.notEqual(afterManifest.hash, beforeRestart.hash, 'manifest 变化必须改变指纹');
  } finally {
    await second.close();
  }

  // 只改 prompt：版本不变，指纹仍必须变化，证明提示正文参与冻结哈希。
  await writeFile(promptPath, '第二次替换的提示词\n', 'utf8');
  const third = await startServer(env);
  try {
    const afterPrompt = presetById((await third.get('ai/presets')).body, 'fixture-lore');
    assert.equal(afterPrompt.version, afterManifest.version, '只改 prompt 时版本不变');
    assert.notEqual(afterPrompt.hash, afterManifest.hash, 'prompt 变化必须改变指纹');
  } finally {
    await third.close();
    await rm(root, { recursive: true, force: true });
  }
});
