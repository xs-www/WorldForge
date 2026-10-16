import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, cp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Sprint 1 的接入面：GET /api/ai/presets、/api/health 摘要、启动拒绝语义，
// 以及 Docker 只打包 Registry 需要的 runtime 投影文件的闭包校验。

const repositoryRoot = new URL('../', import.meta.url);
const fixturesRoot = new URL('../tests/fixtures/agent-profiles/', import.meta.url);
const RUNTIME_MARKER = 'worldforge.runtime.json';

async function temporaryPaths() {
  const base = await mkdtemp(join(tmpdir(), 'worldforge-agent-api-'));
  return {
    base,
    env: {
      WORLDFORGE_DB_PATH: join(base, 'content.sqlite'),
      WORLDFORGE_SIM_DB_PATH: join(base, 'simulation.sqlite'),
      WORLDFORGE_ASSETS_PATH: join(base, 'assets'),
      WORLDFORGE_CONFIG_PATH: join(base, '.env.local'),
      WORLDFORGE_PROMPT_SETTINGS_PATH: join(base, 'prompt-settings.json'),
      WORLDFORGE_COMFY_WORKFLOW_PATH: join(base, 'comfyui-workflow.json')
    }
  };
}

/** 取一个空闲端口：server.mjs 监听 0.0.0.0，不能用 0 让内核分配后再探测。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * 把夹具复制到临时根目录下。
 * `layout: 'matching-id'` 让目录名等于 manifest id，只暴露被考察的那个缺陷；
 * `layout: 'source-name'` 保留夹具原目录名，用于重复 ID 与目录名不符这两类语义。
 */
async function placeFixture(base, relative, layout = 'matching-id') {
  const source = new URL(`${relative}/`, fixturesRoot);
  const manifest = JSON.parse(await readFile(new URL(RUNTIME_MARKER, source), 'utf8'));
  const directoryName = layout === 'source-name' ? relative.split('/').pop() : manifest.id;
  const root = join(base, `presets-${directoryName}`);
  await cp(source, join(root, directoryName), { recursive: true });
  return root;
}

/** 启动真实 server.mjs 子进程并等待它监听端口；失败时抛出收集到的 stderr。 */
function startServer(env) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', repositoryRoot),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务未在 15 秒内就绪\nstdout:\n${stdout}\nstderr:\n${stderr}`)), 15000);
    const poll = () => {
      const match = stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); return; }
      if (child.exitCode !== null) { clearTimeout(timer); reject(new Error(`服务提前退出（${child.exitCode}）\nstdout:\n${stdout}\nstderr:\n${stderr}`)); return; }
      setTimeout(poll, 25);
    };
    poll();
  });
  return { child, ready, output: () => `${stdout}\n${stderr}`, close: () => new Promise(resolve => { if (child.exitCode !== null) { resolve(); return; } child.once('exit', resolve); child.kill(); }) };
}

/** 启动一个预期失败的服务，返回退出码与输出。 */
function startServerExpectingFailure(env) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', repositoryRoot),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`服务在 15 秒内没有失败退出\n${output}`)); }, 15000);
    child.once('exit', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

test('GET /api/ai/presets returns sanitized metadata and defaults', async t => {
  const { base, env } = await temporaryPaths();
  const port = await freePort();
  const server = startServer({ ...env, PORT: String(port) });
  try {
    await server.ready;
    const response = await fetch(`http://127.0.0.1:${port}/api/ai/presets`);
    assert.equal(response.status, 200);
    const view = await response.json();
    assert.equal(view.schemaVersion, 1);
    assert.deepEqual(view.defaults, { lore: 'lore-writer', free: 'free-creator', card: 'card-designer' });
    assert.deepEqual(view.presets.map(preset => preset.id), ['card-designer', 'free-creator', 'lore-writer']);
    for (const preset of view.presets) {
      assert.deepEqual(Object.keys(preset).sort(), ['description', 'displayName', 'hash', 'id', 'mode', 'outputContract', 'statusPolicy', 'surfaces', 'version']);
      assert.match(preset.hash, /^sha256:[0-9a-f]{64}$/);
    }
    const serialized = JSON.stringify(view);
    for (const leak of ['systemPrompt', 'runtime/system.md', '.agent-presets', 'agent.cordis.yml', 'skills/', 'toolPolicy', 'D:\\', 'C:\\']) {
      assert.ok(!serialized.includes(leak), `列表响应不得包含 ${leak}`);
    }

    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.agentProfiles.count, 3);
    assert.deepEqual(health.agentProfiles.ids, ['card-designer', 'free-creator', 'lore-writer']);
    assert.deepEqual(health.agentProfiles.diagnostics, []);
    assert.ok(!JSON.stringify(health).includes('runtime/system.md'), '健康检查不得泄露 prompt 路径或正文');

    // 未实现的选择器不应凭空出现：Sprint 1 只新增发现能力。
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/ai/presets`, { method: 'POST' })).status, 405);
  } finally {
    await server.close();
    await rm(base, { recursive: true, force: true });
  }
});

test('startup refuses a corrupted projection instead of degrading silently', async t => {
  const cases = [
    ['reject/unknown-enum', 'matching-id', ['AGENT_ENUM_UNKNOWN']],
    ['reject/absolute-path', 'matching-id', ['AGENT_ENUM_UNKNOWN']],
    ['reject/traversal', 'matching-id', ['AGENT_ENUM_UNKNOWN']],
    ['reject/oversized-prompt', 'matching-id', ['AGENT_PROMPT_TOO_LARGE']],
    ['reject/missing-prompt', 'matching-id', ['AGENT_PROMPT_MISSING']],
    ['reject/unknown-field', 'matching-id', ['AGENT_MANIFEST_INVALID']],
    ['reject/empty-prompt', 'matching-id', ['AGENT_MANIFEST_INVALID']],
    ['reject/directory-mismatch', 'source-name', ['AGENT_ID_MISMATCH']]
  ];
  for (const [relative, layout, codes] of cases) {
    const { base, env } = await temporaryPaths();
    try {
      const root = await placeFixture(base, relative, layout);
      const { code, output } = await startServerExpectingFailure({ ...env, PORT: String(await freePort()), WORLDFORGE_AGENT_PRESETS_DIR: root });
      assert.notEqual(code, 0, `${relative} 应导致启动失败`);
      assert.ok(codes.some(marker => output.includes(marker)), `${relative} 的诊断应包含 ${codes.join(' 或 ')}：\n${output}`);
      assert.ok(output.includes('[agent-profiles]'), `${relative} 应打印 agent-profiles 诊断前缀`);
      assert.ok(output.includes('拒绝启动'), `${relative} 应说明拒绝启动：\n${output}`);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }

  // 不兼容组合：目录名与 id 对齐时 Schema 的三条分支最先拦下，
  // 若清单能通过 Schema，则由 Registry 的兼容矩阵二次拦截。两种情况都必须拒绝启动。
  const { base, env } = await temporaryPaths();
  try {
    const root = await placeFixture(base, 'reject/incompatible-combination', 'matching-id');
    const incompatible = await startServerExpectingFailure({ ...env, PORT: String(await freePort()), WORLDFORGE_AGENT_PRESETS_DIR: root });
    assert.notEqual(incompatible.code, 0);
    assert.ok(/AGENT_ENUM_UNKNOWN|AGENT_COMPAT_MISMATCH/.test(incompatible.output), incompatible.output);
  } finally {
    await rm(base, { recursive: true, force: true });
  }

  // 重复 id 与缺失根目录。
  const duplicatePaths = await temporaryPaths();
  try {
    const root = join(duplicatePaths.base, 'presets-duplicate');
    await cp(new URL('reject/duplicate-id/fixture-a/', fixturesRoot), join(root, 'fixture-a'), { recursive: true });
    await cp(new URL('reject/duplicate-id/fixture-b/', fixturesRoot), join(root, 'fixture-b'), { recursive: true });
    const duplicate = await startServerExpectingFailure({ ...duplicatePaths.env, PORT: String(await freePort()), WORLDFORGE_AGENT_PRESETS_DIR: root });
    assert.notEqual(duplicate.code, 0);
    assert.ok(duplicate.output.includes('AGENT_ID_MISMATCH'), duplicate.output);
    const missing = await startServerExpectingFailure({ ...duplicatePaths.env, PORT: String(await freePort()), WORLDFORGE_AGENT_PRESETS_DIR: join(duplicatePaths.base, 'absent') });
    assert.notEqual(missing.code, 0);
    assert.ok(missing.output.includes('AGENT_ROOT_UNREADABLE'), missing.output);
  } finally {
    await rm(duplicatePaths.base, { recursive: true, force: true });
  }
});

test('the image copies only the runtime projection files, never the DSH composition', async () => {
  const dockerfile = await readFile(new URL('Dockerfile', repositoryRoot), 'utf8');
  const dockerignore = await readFile(new URL('.dockerignore', repositoryRoot), 'utf8');
  const ignoreLines = dockerignore.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));

  const copyTargets = [...dockerfile.matchAll(/^COPY\s+(.+?)\s+(\S+)\s*$/gm)].map(match => ({ sources: match[1].split(/\s+/), destination: match[2] }));
  const copiedPresetPaths = copyTargets.flatMap(entry => entry.sources).filter(source => source.startsWith('.agent-presets/'));

  for (const id of ['card-designer', 'free-creator', 'lore-writer']) {
    assert.ok(copiedPresetPaths.includes(`.agent-presets/${id}/${RUNTIME_MARKER}`), `镜像应复制 ${id} 的 runtime manifest`);
    assert.ok(copiedPresetPaths.includes(`.agent-presets/${id}/runtime/system.md`), `镜像应复制 ${id} 的 runtime prompt`);
  }
  assert.ok(copiedPresetPaths.length >= 6, '应逐文件复制投影，而不是整个目录');

  // 绝不整体复制 preset 目录，也不复制 DSH 组装与设计文档。
  assert.ok(!copyTargets.some(entry => entry.sources.includes('.agent-presets') || entry.sources.includes('.agent-presets/')), '不得整体 COPY .agent-presets');
  for (const forbidden of ['agent.cordis.yml', 'preset.yml', 'skills', '.agent-presets/README.md']) {
    assert.ok(!dockerfile.includes(`COPY .agent-presets/*/${forbidden}`) && !copiedPresetPaths.some(path => path.includes(forbidden)), `镜像不得复制 ${forbidden}`);
  }
  assert.ok(!/^COPY\s+\.\s/m.test(dockerfile), '不得整体 COPY 构建上下文');

  // 构建上下文规则不得反过来排除这些投影文件。
  const blocks = path => ignoreLines.some(line => !line.startsWith('!') && (new RegExp(`^${line.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`).test(path) || path.startsWith(`${line}/`)));
  for (const path of copiedPresetPaths) assert.ok(!blocks(path), `.dockerignore 不应排除 ${path}`);

  // Registry 与其依赖必须在显式白名单内，否则容器启动即 ERR_MODULE_NOT_FOUND。
  const rootCopy = copyTargets.find(entry => entry.destination === './');
  for (const file of ['server.mjs', 'agent-runtime.schema.json', 'agent-profile-contract.mjs', 'agent-profile-registry.mjs']) {
    assert.ok(rootCopy?.sources.includes(file), `根目录 COPY 应包含 ${file}`);
  }
});

test('the deployed schema is the one the image carries, not the design-tree copy', async () => {
  const root = new URL('../', import.meta.url);
  const registry = await readFile(new URL('agent-profile-registry.mjs', root), 'utf8');
  const code = registry.split('\n').filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*')).join('\n');
  assert.ok(code.includes("resolve(moduleRoot, 'agent-runtime.schema.json')"), 'Registry 必须读取部署副本');
  assert.ok(!code.includes('docs/schemas'), 'Registry 不得依赖镜像外的 docs/ 路径');
  assert.ok(!/from\s+'[^']*\.agent-presets/.test(code), 'Registry 不得 import preset 目录内任何文件');
  // 注释里会说明"不读取 agent.cordis.yml"，可执行代码里不得出现该文件名。
  assert.ok(!code.includes('agent.cordis.yml'), 'Registry 不得引用 DSH 组装文件');
  for (const forbidden of ['dsh-', 'yaml', 'eval(', 'new Function']) {
    assert.ok(!code.includes(forbidden), `Registry 可执行代码不得出现 ${forbidden}`);
  }
});
