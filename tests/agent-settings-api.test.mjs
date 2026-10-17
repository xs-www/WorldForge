import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  AGENT_SETTINGS_FILENAME,
  AgentSettingsError,
  defaultAgentSelections,
  loadAgentSettings,
  normalizeAgentSettings,
  saveAgentSettings,
  validateAgentSelectionPatch
} from '../agent-settings.mjs';
import { loadAgentProfiles } from '../agent-profile-registry.mjs';

// Sprint 3：按 surface 保存的服务端默认 preset、请求快照与错误语义。

const repositoryRoot = new URL('../', import.meta.url);
const legalFixtures = new URL('../tests/fixtures/agent-profiles/legal/', import.meta.url);

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

/** 两个 lore preset + 一个 free + 一个 card，用来观察「按 surface 保存默认值」是否真的生效。 */
async function presetRoot(base) {
  const root = join(base, 'presets');
  const variants = [
    ['legal/fixture-lore', 'alpha-lore'],
    ['legal/fixture-free', 'fixture-free'],
    ['legal/fixture-card', 'fixture-card']
  ];
  for (const [relative, id] of variants) {
    const source = new URL(`${relative}/`, new URL('../tests/fixtures/agent-profiles/', import.meta.url));
    await cp(source, join(root, id), { recursive: true });
    const manifestPath = join(root, id, 'worldforge.runtime.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, id }, null, 2)}\n`, 'utf8');
  }
  // 第二个 lore preset：内容不同即可，用于区分「默认」与「作者选择」。
  await cp(join(root, 'alpha-lore'), join(root, 'zeta-lore'), { recursive: true });
  const zetaPath = join(root, 'zeta-lore', 'worldforge.runtime.json');
  const zeta = JSON.parse(await readFile(zetaPath, 'utf8'));
  await writeFile(zetaPath, `${JSON.stringify({ ...zeta, id: 'zeta-lore', displayName: 'Zeta 设定', version: '1.0.0' }, null, 2)}\n`, 'utf8');
  return root;
}

function fakeModel() {
  const state = { requests: [] };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    try { state.requests.push(JSON.parse(body || '{}')); } catch { state.requests.push({}); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ variants: [{ key: 'candidate-a', content: { name: '甲', summary: '乙' } }] }) } }] }));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, requests: state.requests, close: () => new Promise(done => { server.closeAllConnections?.(); server.close(done); }) })));
}

async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', repositoryRoot),
    env: { ...process.env, PORT: String(port), LLM_API_KEY: 'test-key', LLM_BASE_URL: 'http://127.0.0.1:1/v1', LLM_MODEL: 'fake', LLM_API_STYLE: 'chat', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务未就绪\n${stdout}\n${stderr}`)), 15000);
    const poll = () => {
      if (/http:\/\/127\.0\.0\.1:\d+/.test(stdout)) { clearTimeout(timer); resolve(); return; }
      if (child.exitCode !== null) { clearTimeout(timer); reject(new Error(`服务提前退出\n${stderr}`)); return; }
      setTimeout(poll, 25);
    };
    poll();
  });
  return { child, port, output: () => `${stdout}\n${stderr}`, close: () => new Promise(resolve => { if (child.exitCode !== null) { resolve(); return; } child.once('exit', resolve); child.kill(); }) };
}

let base, env, presetsRoot;
before(async () => {
  base = await mkdtemp(join(tmpdir(), 'worldforge-sprint3-'));
  presetsRoot = await presetRoot(base);
  env = {
    WORLDFORGE_AGENT_PRESETS_DIR: presetsRoot,
    WORLDFORGE_AGENT_SETTINGS_PATH: join(base, AGENT_SETTINGS_FILENAME),
    WORLDFORGE_DB_PATH: join(base, 'content.sqlite'),
    WORLDFORGE_SIM_DB_PATH: join(base, 'simulation.sqlite'),
    WORLDFORGE_ASSETS_PATH: join(base, 'assets'),
    WORLDFORGE_CONFIG_PATH: join(base, '.env.local'),
    WORLDFORGE_PROMPT_SETTINGS_PATH: join(base, 'prompt-settings.json'),
    WORLDFORGE_COMFY_WORKFLOW_PATH: join(base, 'comfyui-workflow.json')
  };
});
after(async () => { if (base) await rm(base, { recursive: true, force: true }); });

test('normalize and validate settings fail closed on unknown input', async () => {
  const registry = await loadAgentProfiles(presetsRoot);
  const defaults = defaultAgentSelections(registry);
  assert.deepEqual(defaults, { lore: 'alpha-lore', free: 'fixture-free', card: 'fixture-card' });
  // 旧安装 / 缺字段 / 未知字段都回落到默认值。
  assert.deepEqual(normalizeAgentSettings(null, { defaults }).selections, defaults);
  assert.deepEqual(normalizeAgentSettings({ selections: { lore: 'zeta-lore', bogus: 'x' } }, { defaults }).selections, { ...defaults, lore: 'zeta-lore' });
  assert.equal(normalizeAgentSettings({ schemaVersion: 99 }, { defaults }).schemaVersion, 1);
  // 只接受已登记 surface 与兼容 preset。
  assert.deepEqual(validateAgentSelectionPatch({ lore: 'zeta-lore' }, { registry }), { lore: 'zeta-lore' });
  for (const [label, patch, code] of [
    ['未知 surface', { simulation: 'alpha-lore' }, 'AGENT_SETTINGS_INVALID'],
    ['未知 id', { lore: 'nope' }, 'AGENT_PROFILE_UNKNOWN'],
    ['跨入口误用', { lore: 'fixture-free' }, 'AGENT_PROFILE_INCOMPATIBLE'],
    ['空值', { lore: '' }, 'AGENT_SETTINGS_INVALID']
  ]) {
    try { validateAgentSelectionPatch(patch, { registry }); assert.fail(`${label} 应被拒绝`); }
    catch (error) { assert.equal(error.code, code, `${label} 的错误码应为 ${code}`); }
  }
  assert.throws(() => validateAgentSelectionPatch({ lore: 'zeta-lore' }), AgentSettingsError.constructor ? Error : Error);
});

test('the settings file is atomic, survives corruption, and reports its source', async () => {
  const path = join(base, 'unit-agent-settings.json');
  const defaults = { lore: 'alpha-lore', free: 'fixture-free', card: 'fixture-card' };
  await saveAgentSettings(path, { selections: { lore: 'zeta-lore' } });
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.selections.lore, 'zeta-lore');
  assert.equal(stored.selections.free, null, '未提交的项写成 null，而不是猜测');
  const loaded = await loadAgentSettings(path, { defaults });
  assert.equal(loaded.source, 'file');
  assert.equal(loaded.selections.lore, 'zeta-lore');
  // 损坏文件不抛错，回落到默认并标记原因。
  await writeFile(path, '{ broken', 'utf8');
  const corrupt = await loadAgentSettings(path, { defaults });
  assert.equal(corrupt.source, 'defaults');
  assert.equal(corrupt.reason, 'corrupt');
  assert.deepEqual(corrupt.selections, defaults);
  // 缺失文件同理。
  const missing = await loadAgentSettings(join(base, 'absent.json'), { defaults });
  assert.equal(missing.reason, 'missing');
});

test('GET/POST /api/settings expose and persist per-surface selections', async () => {
  const server = await startServer(env);
  const model = await fakeModel();
  try {
    const initial = await (await fetch(`http://127.0.0.1:${server.port}/api/settings`)).json();
    assert.deepEqual(initial.agentPresets, { lore: 'alpha-lore', free: 'fixture-free', card: 'fixture-card' });
    assert.deepEqual(initial.agentPresetDefaults, initial.agentPresets);
    assert.equal(initial.agentSettingsSource, 'missing');

    const saved = await fetch(`http://127.0.0.1:${server.port}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worldforge-Settings': '1' },
      body: JSON.stringify({ baseUrl: 'https://api.openai.com/v1', model: 'fake', style: 'chat', agentPresets: { lore: 'zeta-lore' } })
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.agentPresets.lore, 'zeta-lore');
    assert.equal(savedBody.agentPresets.free, 'fixture-free', '只提交的入口才更新');
    assert.equal(JSON.parse(await readFile(join(base, AGENT_SETTINGS_FILENAME), 'utf8')).selections.lore, 'zeta-lore');

    // 非法选择被拒绝，且不写盘。
    const before = await readFile(join(base, AGENT_SETTINGS_FILENAME), 'utf8');
    for (const [patch, code] of [[{ lore: 'fixture-free' }, 'AGENT_PROFILE_INCOMPATIBLE'], [{ lore: 'nope' }, 'AGENT_PROFILE_UNKNOWN'], [{ bogus: 'alpha-lore' }, 'AGENT_SETTINGS_INVALID']]) {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worldforge-Settings': '1' },
        body: JSON.stringify({ baseUrl: 'https://api.openai.com/v1', model: 'fake', style: 'chat', agentPresets: patch })
      });
      assert.equal(response.status, 400, `${JSON.stringify(patch)} 应返回 400`);
      assert.ok((await response.json()).error.includes(code));
    }
    assert.equal(await readFile(join(base, AGENT_SETTINGS_FILENAME), 'utf8'), before, '被拒绝的请求不得改写设置文件');
  } finally {
    await server.close();
    await model.close();
  }
});

test('a saved selection drives requests, an explicit snapshot overrides, and restart persists', async () => {
  const model = await fakeModel();
  // 用独立的配置文件，避免上一条用例保存的 baseUrl 覆盖本用例的假模型地址。
  const isolated = { ...env, WORLDFORGE_CONFIG_PATH: join(base, 'ai.env.local') };
  let server = await startServer({ ...isolated, LLM_BASE_URL: `http://127.0.0.1:${model.port}/v1` });
  try {
    const body = { draft: { type: 'magic', name: '测试', worldId: 'W01' }, selectedBlocks: ['name', 'summary'], variantCount: 1 };
    const callAi = async extra => {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...extra }) });
      const data = await response.json();
      assert.equal(response.status, 200, `请求失败：${JSON.stringify(data)}`);
      return data;
    };
    // 未带 presetId：使用服务端保存的 zeta-lore。
    const byDefault = await callAi({});
    assert.equal(byDefault.agent.presetId, 'zeta-lore');
    // 带 presetId：请求快照优先。
    const bySnapshot = await callAi({ presetId: 'alpha-lore' });
    assert.equal(bySnapshot.agent.presetId, 'alpha-lore');
    // 客户端伪造的版本/哈希不被采信：响应只回显服务端解析结果。
    const forged = await callAi({ presetId: 'alpha-lore', presetVersion: '9.9.9', presetHash: 'sha256:fake' });
    assert.equal(forged.agent.presetVersion, bySnapshot.agent.presetVersion, '版本必须来自服务端');
    assert.notEqual(forged.agent.presetVersion, '9.9.9');
    assert.match(forged.agent.presetHash, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(forged.agent.presetHash, 'sha256:fake');
    assert.equal(forged.agent.presetHash, bySnapshot.agent.presetHash);
  } finally {
    await server.close();
  }
  // 重启后仍使用保存的选择。
  server = await startServer({ ...isolated, LLM_BASE_URL: `http://127.0.0.1:${model.port}/v1` });
  try {
    const settings = await (await fetch(`http://127.0.0.1:${server.port}/api/settings`)).json();
    assert.equal(settings.agentPresets.lore, 'zeta-lore');
    assert.equal(settings.agentSettingsSource, 'file');
    const body = { draft: { type: 'magic', name: '测试', worldId: 'W01' }, selectedBlocks: ['name'], variantCount: 1 };
    const response = await (await fetch(`http://127.0.0.1:${server.port}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    assert.equal(response.agent.presetId, 'zeta-lore');
  } finally {
    await server.close();
    await model.close();
  }
});

test('a saved preset that disappeared is reported, never silently replaced', async () => {
  const path = join(base, 'gone-agent-settings.json');
  await saveAgentSettings(path, { selections: { lore: 'removed-preset' } });
  const server = await startServer({ ...env, WORLDFORGE_AGENT_SETTINGS_PATH: path });
  try {
    const settings = await (await fetch(`http://127.0.0.1:${server.port}/api/settings`)).json();
    assert.equal(settings.agentPresets.lore, 'removed-preset', '设置值保持原样，不自动改选');
    const response = await fetch(`http://127.0.0.1:${server.port}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: { type: 'magic', name: '测试', worldId: 'W01' }, selectedBlocks: ['name'], variantCount: 1 })
    });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error.includes('AGENT_PROFILE_UNKNOWN'));
  } finally {
    await server.close();
    await rm(path, { force: true });
  }
});
