import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile, cp } from 'node:fs/promises';
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

/** 三个合法夹具分别覆盖 lore / free / card；部署时目录名就是真实 preset id。 */
const LEGAL_FIXTURES = ['legal/fixture-lore', 'legal/fixture-free', 'legal/fixture-card'];
const LEGAL_FIXTURE_IDS = ['lore-writer', 'free-creator', 'card-designer'];

/**
 * 搭建一个三入口齐全的根目录，目录名使用真实 preset id；可选换入缺陷夹具或删掉某个入口。
 * 完整性门下，只放一个夹具会先报 AGENT_PROFILE_UNKNOWN，无法考察其他缺陷。
 */
async function completePresetRoot(base, defectRelative = null, omitId = null) {
  const root = join(base, 'presets-complete');
  for (const [index, relative] of LEGAL_FIXTURES.entries()) {
    const source = new URL(`${relative}/`, fixturesRoot);
    const manifest = JSON.parse(await readFile(new URL(RUNTIME_MARKER, source), 'utf8'));
    await cp(source, join(root, LEGAL_FIXTURE_IDS[index]), { recursive: true });
    // 夹具自身的 id 与真实 preset id 不同，替换成真实 id 后目录名仍然与 manifest 一致。
    const manifestPath = join(root, LEGAL_FIXTURE_IDS[index], RUNTIME_MARKER);
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, id: LEGAL_FIXTURE_IDS[index] }, null, 2)}\n`, 'utf8');
  }
  if (omitId) await rm(join(root, omitId), { recursive: true, force: true });
  if (defectRelative) {
    const source = new URL(`${defectRelative}/`, fixturesRoot);
    const manifest = JSON.parse(await readFile(new URL(RUNTIME_MARKER, source), 'utf8'));
    await rm(join(root, manifest.id), { recursive: true, force: true });
    await cp(source, join(root, manifest.id), { recursive: true });
  }
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
    // 版本来自 package.json，供前端识别「页面与运行实例是否同一版本」。
    assert.match(health.version, /^\d+\.\d+\.\d+/);
    assert.match(health.harnessVersion, /^\d+\.\d+\.\d+$/);
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
  // 每个缺陷夹具替换进一个三入口齐全的根目录，这样失败原因只能来自该缺陷本身。
  const cases = [
    ['reject/unknown-enum', ['AGENT_ENUM_UNKNOWN']],
    ['reject/absolute-path', ['AGENT_PROMPT_PATH_UNSAFE']],
    ['reject/traversal', ['AGENT_PROMPT_PATH_UNSAFE']],
    ['reject/incompatible-combination', ['AGENT_COMPAT_MISMATCH']],
    ['reject/oversized-prompt', ['AGENT_PROMPT_TOO_LARGE']],
    ['reject/missing-prompt', ['AGENT_PROMPT_MISSING']],
    ['reject/unknown-field', ['AGENT_MANIFEST_INVALID']],
    ['reject/empty-prompt', ['AGENT_MANIFEST_INVALID']]
  ];
  for (const [relative, codes] of cases) {
    const { base, env } = await temporaryPaths();
    try {
      const root = await completePresetRoot(base, relative);
      const { code, output } = await startServerExpectingFailure({ ...env, PORT: String(await freePort()), WORLDFORGE_AGENT_PRESETS_DIR: root });
      assert.notEqual(code, 0, `${relative} 应导致启动失败`);
      assert.ok(codes.some(marker => output.includes(marker)), `${relative} 的诊断应包含 ${codes.join(' 或 ')}：\n${output}`);
      assert.ok(output.includes('[agent-profiles]'), `${relative} 应打印 agent-profiles 诊断前缀`);
      assert.ok(output.includes('拒绝启动'), `${relative} 应说明拒绝启动：\n${output}`);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }

  // 目录名与 preset id 不一致。
  const mismatch = await temporaryPaths();
  try {
    const root = await placeFixture(mismatch.base, 'reject/directory-mismatch', 'source-name');
    const result = await startServerExpectingFailure({ ...mismatch.env, PORT: String(await freePort()), WORLDFORGE_AGENT_PRESETS_DIR: root });
    assert.notEqual(result.code, 0);
    assert.ok(result.output.includes('AGENT_ID_MISMATCH'), result.output);
  } finally {
    await rm(mismatch.base, { recursive: true, force: true });
  }

  // 删除任一入口的 preset：服务必须拒绝启动，而不是把该入口降级为 null。
  for (const [missingId, surface] of [['lore-writer', 'lore'], ['free-creator', 'free'], ['card-designer', 'card']]) {
    const incomplete = await temporaryPaths();
    try {
      const root = await completePresetRoot(incomplete.base, null, missingId);
      const result = await startServerExpectingFailure({ ...incomplete.env, PORT: String(await freePort()), WORLDFORGE_AGENT_PRESETS_DIR: root });
      assert.notEqual(result.code, 0, `缺少 ${missingId} 时应拒绝启动`);
      assert.ok(result.output.includes('AGENT_PROFILE_UNKNOWN'), result.output);
      assert.ok(result.output.includes(surface), `诊断应指出缺失的入口 ${surface}：\n${result.output}`);
    } finally {
      await rm(incomplete.base, { recursive: true, force: true });
    }
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

test('startup refuses symlinked preset directories and manifests', async t => {
  const symlinked = await temporaryPaths();
  try {
    const root = await completePresetRoot(symlinked.base);
    const outside = join(symlinked.base, 'outside');
    await mkdir(outside, { recursive: true });
    await cp(join(root, 'lore-writer'), join(outside, 'lore-writer'), { recursive: true });
    await rm(join(root, 'lore-writer'), { recursive: true, force: true });
    let linked = true;
    try { await symlink(join(outside, 'lore-writer'), join(root, 'lore-writer'), 'dir'); }
    catch (error) { if (error.code !== 'EPERM') throw error; linked = false; }
    if (!linked) {
      console.log('# 本机不允许创建符号链接，preset 目录链接的服务级拒绝未验证');
      return;
    }
    const result = await startServerExpectingFailure({ ...symlinked.env, PORT: String(await freePort()), WORLDFORGE_AGENT_PRESETS_DIR: root });
    assert.notEqual(result.code, 0);
    assert.ok(result.output.includes('AGENT_PROMPT_PATH_UNSAFE'), result.output);
  } finally {
    await rm(symlinked.base, { recursive: true, force: true });
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
