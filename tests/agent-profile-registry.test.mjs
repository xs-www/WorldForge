import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { AGENT_PROFILE_ERROR_CODES, AGENT_RUNTIME_MANIFEST } from '../agent-profile-contract.mjs';
import {
  AGENT_RUNTIME_SCHEMA_PATH,
  AgentProfileError,
  asAgentProfileError,
  agentPresetsRoot,
  loadAgentProfiles,
  profileFingerprint,
  publicAgentProfile,
  publicRegistryView,
  registryHealthSummary,
  resolveAgentPromptPath,
  stableStringify,
  validateAgentRuntimeManifest
} from '../agent-profile-registry.mjs';

// Sprint 1 只交付"发现能力"：Registry 加载、严格校验、安全路径、确定性哈希与脱敏投影。
// 本文件不触碰设定助手或自由创作的既有行为（那是 Sprint 2）。

const repositoryRoot = new URL('../', import.meta.url);
const presetsRoot = new URL('../.agent-presets/', import.meta.url);
const fixturesRoot = new URL('../tests/fixtures/agent-profiles/', import.meta.url);

async function expectError(run, code) {
  try { await run(); }
  catch (error) {
    assert.ok(error instanceof AgentProfileError, `应抛出 AgentProfileError，实际为 ${error?.name}`);
    assert.equal(error.code, code, `错误码应为 ${code}，实际为 ${error.code}：${error.message}`);
    return error;
  }
  assert.fail(`应当抛出 ${code}`);
}

/** 复制一个夹具到临时根目录，返回可直接交给 loadAgentProfiles 的路径。 */
async function temporaryRoot(sourceRelative) {
  const root = await mkdtemp(join(tmpdir(), 'worldforge-agent-root-'));
  await cp(new URL(sourceRelative, fixturesRoot), join(root, 'profile'), { recursive: true });
  return root;
}

/**
 * 与 temporaryRoot 相同，但把目录名改成 manifest 声明的 id。
 * 这样可以只暴露被考察的那个缺陷，避免目录名不符抢先触发 AGENT_ID_MISMATCH。
 */
async function temporaryRootWithMatchingId(sourceRelative) {
  const root = await mkdtemp(join(tmpdir(), 'worldforge-agent-root-'));
  const directoryName = sourceRelative.split('/').pop();
  const source = new URL(`${sourceRelative}/`, fixturesRoot);
  const manifest = JSON.parse(await readFile(new URL(AGENT_RUNTIME_MANIFEST, source), 'utf8'));
  await cp(source, join(root, directoryName), { recursive: true });
  // 目录名必须等于 manifest id，才能只暴露被考察的那个缺陷。
  await rename(join(root, directoryName), join(root, manifest.id));
  return root;
}

test('the deployed schema copy is byte-identical to the documented contract', async () => {
  const documented = await readFile(new URL('docs/schemas/agent-runtime.schema.json', repositoryRoot), 'utf8');
  const deployed = await readFile(AGENT_RUNTIME_SCHEMA_PATH, 'utf8');
  assert.equal(deployed, documented, '仓库根部署副本与 docs/schemas 真值必须完全一致；改动 Schema 时请同步两份');
  assert.equal(JSON.parse(deployed).$id, JSON.parse(documented).$id);
});

test('loading the shipped root exposes exactly the three contracted profiles', async () => {
  const registry = await loadAgentProfiles();
  assert.deepEqual(registry.profiles.map(profile => profile.id), ['card-designer', 'free-creator', 'lore-writer']);
  assert.deepEqual(registry.defaults, { lore: 'lore-writer', free: 'free-creator', card: 'card-designer' });
  assert.deepEqual(registry.summary.countBySurface, { lore: 1, free: 1, card: 1 });
  assert.deepEqual(registry.summary.diagnostics, [], '成功路径不应有诊断项');
  assert.equal(registry.summary.count, 3);
  for (const profile of registry.profiles) {
    assert.match(profile.hash, /^sha256:[0-9a-f]{64}$/);
    assert.match(profile.manifestHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(profile.systemPromptHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(profile.systemPromptPath, 'runtime/system.md');
    assert.ok(profile.systemPrompt.length > 40, `${profile.id} 应加载到真实 prompt 正文`);
    assert.equal(profile.schemaVersion, 1);
  }
});

test('the registry is frozen and does not expose mutation of loaded data', async () => {
  const registry = await loadAgentProfiles();
  assert.ok(Object.isFrozen(registry));
  assert.ok(Object.isFrozen(registry.profiles));
  assert.ok(Object.isFrozen(registry.profiles[0]));
  assert.ok(Object.isFrozen(registry.profiles[0].surfaces));
  assert.throws(() => { registry.profiles.push({ id: 'injected' }); }, TypeError);
  assert.throws(() => { registry.defaults.lore = 'card-designer'; }, TypeError);
  assert.equal((await loadAgentProfiles()).profiles.length, 3, '被拒绝的改动不应影响下一次加载');
});

test('hashes are deterministic and change when the manifest or the prompt changes', async () => {
  const first = await loadAgentProfiles();
  const second = await loadAgentProfiles();
  for (const id of ['card-designer', 'free-creator', 'lore-writer']) {
    assert.equal(first.get(id).hash, second.get(id).hash, `${id} 同内容必须同哈希`);
  }
  const lore = first.get('lore-writer');
  assert.equal(profileFingerprint(lore.manifest, lore.systemPrompt).hash, lore.hash, '指纹必须可由 manifest 与 prompt 重算');
  assert.notEqual(profileFingerprint({ ...lore.manifest, version: '9.9.9' }, lore.systemPrompt).hash, lore.hash, 'manifest 改动必须改变哈希');
  assert.notEqual(profileFingerprint(lore.manifest, `${lore.systemPrompt} `).hash, lore.hash, 'prompt 改动必须改变哈希');
  assert.notEqual(first.get('lore-writer').hash, first.get('card-designer').hash, '不同 preset 不应同哈希');

  // 稳定序列化：键序不影响结果，顺序不同的等价对象必须同哈希。
  assert.equal(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] }), stableStringify({ a: [2, { c: 4, d: 3 }], b: 1 }));
  assert.equal(stableStringify({ a: 1 }), '{"a":1}');
});

test('resolve enforces surface compatibility before any model call', async () => {
  const registry = await loadAgentProfiles();
  assert.equal(registry.resolve('lore-writer', 'lore').id, 'lore-writer');
  assert.equal(registry.resolve('free-creator', 'free').mode, 'free_chat');
  assert.equal(registry.resolve('card-designer', 'card').statusPolicy, 'proposed_or_untested');
  await expectError(() => registry.resolve('nope', 'lore'), 'AGENT_PROFILE_UNKNOWN');
  await expectError(() => registry.resolve('', 'lore'), 'AGENT_PROFILE_UNKNOWN');
  await expectError(() => registry.resolve('lore-writer', 'free'), 'AGENT_PROFILE_INCOMPATIBLE');
  await expectError(() => registry.resolve('lore-writer', 'card'), 'AGENT_PROFILE_INCOMPATIBLE');
  await expectError(() => registry.resolve('free-creator', 'lore'), 'AGENT_PROFILE_INCOMPATIBLE');
  await expectError(() => registry.resolve('card-designer', 'free'), 'AGENT_PROFILE_INCOMPATIBLE');
  await expectError(() => registry.profilesForSurface('simulation'), 'AGENT_PROFILE_INCOMPATIBLE');
  assert.deepEqual(registry.profilesForSurface('lore').map(profile => profile.id), ['lore-writer']);
  assert.deepEqual(registry.profilesForSurface('free').map(profile => profile.id), ['free-creator']);
  assert.deepEqual(registry.profilesForSurface('card').map(profile => profile.id), ['card-designer']);
});

test('the browser projection never leaks prompt text, paths or tool internals', async () => {
  const registry = await loadAgentProfiles();
  const view = publicRegistryView(registry);
  const serialized = JSON.stringify(view);
  assert.deepEqual(Object.keys(view).sort(), ['defaults', 'presets', 'schemaVersion']);
  for (const preset of view.presets) {
    assert.deepEqual(Object.keys(preset).sort(), ['description', 'displayName', 'hash', 'id', 'mode', 'outputContract', 'statusPolicy', 'surfaces', 'version']);
  }
  for (const leak of ['systemPrompt', 'systemPromptPath', 'toolPolicy', 'manifestHash', 'directory', '.agent-presets', 'agent.cordis.yml', 'skills/', 'runtime/system.md', repositoryRoot.pathname]) {
    assert.ok(!serialized.includes(leak), `浏览器投影不得包含 ${leak}`);
  }
  // 提示正文的整句绝不能出现在投影里。
  const lorePromptLine = registry.get('lore-writer').systemPrompt.split('\n').filter(Boolean)[0].slice(0, 20);
  assert.ok(!serialized.includes(lorePromptLine), '浏览器投影不得包含 prompt 正文');
  assert.deepEqual(publicAgentProfile(registry.get('lore-writer')).surfaces, ['lore']);
  assert.deepEqual(registryHealthSummary(registry).ids, ['card-designer', 'free-creator', 'lore-writer']);
  assert.ok(!JSON.stringify(registryHealthSummary(registry)).includes('runtime/system.md'));
});

test('every frozen error code is reachable from the registry surface', () => {
  const implemented = new Set([
    'AGENT_ROOT_UNREADABLE', 'AGENT_MANIFEST_UNREADABLE', 'AGENT_MANIFEST_INVALID', 'AGENT_ENUM_UNKNOWN', 'AGENT_ID_MISMATCH',
    'AGENT_COMPAT_MISMATCH', 'AGENT_PROMPT_MISSING', 'AGENT_PROMPT_PATH_UNSAFE', 'AGENT_PROMPT_TOO_LARGE', 'AGENT_PROFILE_UNKNOWN', 'AGENT_PROFILE_INCOMPATIBLE'
  ]);
  assert.deepEqual([...implemented].sort(), [...AGENT_PROFILE_ERROR_CODES].sort(), 'Registry 必须覆盖 ADR-0029 §9 的全部错误码');
  const wrapped = asAgentProfileError(new Error('boom'));
  assert.ok(wrapped instanceof AgentProfileError);
  assert.ok(AGENT_PROFILE_ERROR_CODES.includes(wrapped.code));
  assert.equal(asAgentProfileError(wrapped), wrapped, '已是 AgentProfileError 时不应重新包装');
});

test('manifest validation rejects unknown fields, enums, ids and unsafe prompt paths', async () => {
  const base = JSON.parse(await readFile(new URL(`../.agent-presets/lore-writer/${AGENT_RUNTIME_MANIFEST}`, import.meta.url), 'utf8'));
  assert.equal((await validateAgentRuntimeManifest({ ...base }, 'lore-writer')).id, 'lore-writer');
  await expectError(() => validateAgentRuntimeManifest({ ...base, plugins: [] }, 'lore-writer'), 'AGENT_MANIFEST_INVALID');
  await expectError(() => validateAgentRuntimeManifest({ ...base, mode: 'agentic_shell' }, 'lore-writer'), 'AGENT_ENUM_UNKNOWN');
  await expectError(() => validateAgentRuntimeManifest({ ...base, surfaces: ['simulation'] }, 'lore-writer'), 'AGENT_ENUM_UNKNOWN');
  await expectError(() => validateAgentRuntimeManifest({ ...base, surfaces: ['free'] }, 'lore-writer'), 'AGENT_ENUM_UNKNOWN');
  await expectError(() => validateAgentRuntimeManifest({ ...base }, 'free-creator'), 'AGENT_ID_MISMATCH');
  await expectError(() => validateAgentRuntimeManifest({ ...base, schemaVersion: 2 }, 'lore-writer'), 'AGENT_ENUM_UNKNOWN');
  await expectError(() => validateAgentRuntimeManifest({ ...base, systemPrompt: '' }, 'lore-writer'), 'AGENT_MANIFEST_INVALID');
  await expectError(() => validateAgentRuntimeManifest({ ...base, systemPrompt: 'C:\\evil\\system.md' }, 'lore-writer'), 'AGENT_ENUM_UNKNOWN');
  await expectError(() => validateAgentRuntimeManifest({ ...base, id: 'Not-Kebab' }, 'Not-Kebab'), 'AGENT_MANIFEST_INVALID');
  await expectError(() => validateAgentRuntimeManifest('not an object', 'lore-writer'), 'AGENT_MANIFEST_INVALID');
  await expectError(() => validateAgentRuntimeManifest(null), 'AGENT_MANIFEST_INVALID');
});

test('prompt path resolution refuses escapes that bypass the schema', async () => {
  const base = JSON.parse(await readFile(new URL(`../.agent-presets/lore-writer/${AGENT_RUNTIME_MANIFEST}`, import.meta.url), 'utf8'));
  const directory = await temporaryRoot('legal/fixture-lore');
  const presetDirectory = join(directory, 'profile');
  try {
    // Schema 层已拦下最常见的 `..`，这里直接验证解析层对同构路径同样拒绝。
    const escaping = `${base.systemPrompt.split('/')[0]}/../../agent.cordis.yml`;
    await expectError(() => resolveAgentPromptPath(presetDirectory, escaping), 'AGENT_PROMPT_PATH_UNSAFE');
    await expectError(() => resolveAgentPromptPath(presetDirectory, '/etc/passwd'), 'AGENT_PROMPT_PATH_UNSAFE');
    await expectError(() => resolveAgentPromptPath(presetDirectory, 'C:\\evil.md'), 'AGENT_PROMPT_PATH_UNSAFE');
    await expectError(() => resolveAgentPromptPath(presetDirectory, ''), 'AGENT_PROMPT_PATH_UNSAFE');
    await expectError(() => resolveAgentPromptPath(presetDirectory, 'runtime/absent.md'), 'AGENT_PROMPT_MISSING');
    await expectError(() => resolveAgentPromptPath(presetDirectory, 'runtime'), 'AGENT_PROMPT_MISSING');

    // 符号链接：即使指向 preset 内部也拒绝，指向外部更必须拒绝。
    // Windows 未开启开发者模式时创建符号链接会 EPERM，此时跳过并如实说明未验证。
    await writeFile(join(presetDirectory, 'escape.md'), '外部内容', 'utf8');
    await mkdir(join(presetDirectory, 'nested'), { recursive: true });
    await writeFile(join(presetDirectory, 'nested', 'inside.md'), '内部内容', 'utf8');
    let symlinksSupported = true;
    try {
      await symlink(join(presetDirectory, 'escape.md'), join(presetDirectory, 'link-outside.md'));
      await symlink(join(presetDirectory, 'nested', 'inside.md'), join(presetDirectory, 'link-inside.md'));
    } catch (error) {
      if (error.code !== 'EPERM') throw error;
      symlinksSupported = false;
    }
    if (symlinksSupported) {
      await expectError(() => resolveAgentPromptPath(presetDirectory, 'link-inside.md'), 'AGENT_PROMPT_PATH_UNSAFE');
      await expectError(() => resolveAgentPromptPath(presetDirectory, 'link-outside.md'), 'AGENT_PROMPT_PATH_UNSAFE');
    } else {
      console.log('# 本机不允许创建符号链接，符号链接逃逸分支未验证（逻辑仍由 lstat/realpath 覆盖）');
    }

    // 长度上限：真实超长文件与同内容的合法文件。
    const oversized = await readFile(new URL('reject/oversized-prompt/runtime/system.md', fixturesRoot), 'utf8');
    await writeFile(join(presetDirectory, 'oversized.md'), oversized, 'utf8');
    await expectError(() => resolveAgentPromptPath(presetDirectory, 'oversized.md'), 'AGENT_PROMPT_TOO_LARGE');

    const ok = await resolveAgentPromptPath(presetDirectory, 'runtime/system.md');
    assert.equal(ok.relativePath, 'runtime/system.md');
    assert.equal(ok.text.trim().length > 0, true);

    // 非 UTF-8 与 NUL 字节不得被当作合法 prompt。
    await writeFile(join(presetDirectory, 'binary.md'), Buffer.from([0xff, 0xfe, 0x00, 0x41]));
    await expectError(() => resolveAgentPromptPath(presetDirectory, 'binary.md'), 'AGENT_PROMPT_MISSING');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('startup refuses a broken root instead of silently switching persona', async () => {
  await expectError(() => loadAgentProfiles(join(tmpdir(), 'worldforge-missing-root-0000')), 'AGENT_ROOT_UNREADABLE');

  const empty = await mkdtemp(join(tmpdir(), 'worldforge-agent-empty-'));
  try { await expectError(() => loadAgentProfiles(empty), 'AGENT_ROOT_UNREADABLE'); }
  finally { await rm(empty, { recursive: true, force: true }); }

  // 重复 id：两个真实目录声明同一个 preset id。
  const duplicate = await mkdtemp(join(tmpdir(), 'worldforge-agent-dup-'));
  try {
    await cp(new URL('reject/duplicate-id/fixture-a', fixturesRoot), join(duplicate, 'fixture-a'), { recursive: true });
    await cp(new URL('reject/duplicate-id/fixture-b', fixturesRoot), join(duplicate, 'fixture-b'), { recursive: true });
    const error = await expectError(() => loadAgentProfiles(duplicate), 'AGENT_ID_MISMATCH');
    assert.match(error.message, /duplicate-id/);
  } finally { await rm(duplicate, { recursive: true, force: true }); }

  // 目录名与 id 不一致。
  const mismatch = await temporaryRoot('reject/directory-mismatch');
  try { await expectError(() => loadAgentProfiles(mismatch), 'AGENT_ID_MISMATCH'); }
  finally { await rm(mismatch, { recursive: true, force: true }); }

  // 损坏的 JSON 与缺失的 manifest。
  const corrupt = await temporaryRoot('legal/fixture-lore');
  try {
    await writeFile(join(corrupt, 'profile', AGENT_RUNTIME_MANIFEST), '{ "id": "fixture-lore",', 'utf8');
    await expectError(() => loadAgentProfiles(corrupt), 'AGENT_MANIFEST_UNREADABLE');
    await rm(join(corrupt, 'profile', AGENT_RUNTIME_MANIFEST));
    await expectError(() => loadAgentProfiles(corrupt), 'AGENT_MANIFEST_UNREADABLE');
  } finally { await rm(corrupt, { recursive: true, force: true }); }

  // 未知枚举、额外字段与不兼容组合：目录名与 id 对齐，用于确认拒绝原因来自清单本身。
  const unknown = await temporaryRootWithMatchingId('reject/unknown-field');
  try { await expectError(() => loadAgentProfiles(unknown), 'AGENT_MANIFEST_INVALID'); }
  finally { await rm(unknown, { recursive: true, force: true }); }
  const unknownEnum = await temporaryRootWithMatchingId('reject/unknown-enum');
  try { await expectError(() => loadAgentProfiles(unknownEnum), 'AGENT_ENUM_UNKNOWN'); }
  finally { await rm(unknownEnum, { recursive: true, force: true }); }
  const incompatible = await temporaryRootWithMatchingId('reject/incompatible-combination');
  try { await expectError(() => loadAgentProfiles(incompatible), 'AGENT_ENUM_UNKNOWN'); }
  finally { await rm(incompatible, { recursive: true, force: true }); }
  const absolutePath = await temporaryRootWithMatchingId('reject/absolute-path');
  try { await expectError(() => loadAgentProfiles(absolutePath), 'AGENT_ENUM_UNKNOWN'); }
  finally { await rm(absolutePath, { recursive: true, force: true }); }
  const traversal = await temporaryRootWithMatchingId('reject/traversal');
  try { await expectError(() => loadAgentProfiles(traversal), 'AGENT_ENUM_UNKNOWN'); }
  finally { await rm(traversal, { recursive: true, force: true }); }
  const emptyPrompt = await temporaryRootWithMatchingId('reject/empty-prompt');
  try { await expectError(() => loadAgentProfiles(emptyPrompt), 'AGENT_MANIFEST_INVALID'); }
  finally { await rm(emptyPrompt, { recursive: true, force: true }); }
  const missingPrompt = await temporaryRootWithMatchingId('reject/missing-prompt');
  try { await expectError(() => loadAgentProfiles(missingPrompt), 'AGENT_PROMPT_MISSING'); }
  finally { await rm(missingPrompt, { recursive: true, force: true }); }

  // 超大 prompt 真实文件。
  const oversized = await temporaryRootWithMatchingId('reject/oversized-prompt');
  try { await expectError(() => loadAgentProfiles(oversized), 'AGENT_PROMPT_TOO_LARGE'); }
  finally { await rm(oversized, { recursive: true, force: true }); }

  // 合法夹具仍然可以加载，证明上面的拒绝来自具体缺陷而不是环境。
  const legal = await temporaryRootWithMatchingId('legal/fixture-card');
  try {
    const registry = await loadAgentProfiles(legal);
    assert.deepEqual(registry.profiles.map(profile => profile.id), ['fixture-card']);
    assert.deepEqual(registry.defaults, { lore: null, free: null, card: 'fixture-card' });
  } finally { await rm(legal, { recursive: true, force: true }); }
});

test('the presets root is resolved without machine absolute paths', () => {
  assert.equal(agentPresetsRoot('/tmp/only-for-test'), resolve('/tmp/only-for-test'));
  assert.equal(agentPresetsRoot().endsWith('.agent-presets'), true, '默认根目录应指向仓库/镜像内的 .agent-presets');
  const previous = process.env.WORLDFORGE_AGENT_PRESETS_DIR;
  try {
    process.env.WORLDFORGE_AGENT_PRESETS_DIR = '/tmp/env-root';
    assert.equal(agentPresetsRoot(), resolve('/tmp/env-root'), '环境变量应可覆盖根目录');
    assert.equal(agentPresetsRoot('/tmp/explicit'), resolve('/tmp/explicit'), '显式参数优先于环境变量');
  } finally {
    if (previous === undefined) delete process.env.WORLDFORGE_AGENT_PRESETS_DIR;
    else process.env.WORLDFORGE_AGENT_PRESETS_DIR = previous;
  }
  // 仓库内不得出现指向本机目录的绝对路径。
  assert.equal(/[A-Za-z]:\\/.test(AGENT_RUNTIME_SCHEMA_PATH), true, 'schema 路径在本机是绝对路径（运行时解析，不写死）');
  assert.ok(!JSON.stringify(publicRegistryView({ schemaVersion: 1, profiles: [], defaults: {} })).includes(':\\'));
});

test('shipped projections carry the same hashes the registry reports', async () => {
  const registry = await loadAgentProfiles();
  for (const id of ['card-designer', 'free-creator', 'lore-writer']) {
    const directory = new URL(`${id}/`, presetsRoot);
    const manifest = JSON.parse(await readFile(new URL(AGENT_RUNTIME_MANIFEST, directory), 'utf8'));
    const prompt = await readFile(new URL(manifest.systemPrompt, directory), 'utf8');
    assert.equal(profileFingerprint(manifest, prompt).hash, registry.get(id).hash, `${id} 的哈希必须可直接从随仓库文件复算`);
    assert.equal(prompt, registry.get(id).systemPrompt);
  }
  assert.equal((await readFile(new URL('README.md', presetsRoot), 'utf8')).includes('worldforge.runtime.json'), true, 'preset 根目录 README 应说明投影契约');
});
