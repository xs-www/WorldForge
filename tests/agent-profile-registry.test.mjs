import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { test } from 'node:test';
import { AGENT_PROFILE_ERROR_CODES, AGENT_RUNTIME_MANIFEST } from '../agent-profile-contract.mjs';
import {
  AGENT_RUNTIME_SCHEMA_PATH,
  AgentProfileError,
  asAgentProfileError,
  agentPresetsRoot,
  deepFreeze,
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
  const source = new URL(`${sourceRelative}/`, fixturesRoot);
  const manifest = JSON.parse(await readFile(new URL(AGENT_RUNTIME_MANIFEST, source), 'utf8'));
  await cp(source, join(root, manifest.id), { recursive: true });
  return root;
}

/** 三个合法夹具分别覆盖 lore / free / card，用来搭建"完整根目录"。 */
const LEGAL_FIXTURES = ['legal/fixture-lore', 'legal/fixture-free', 'legal/fixture-card'];
/** 每个合法夹具的 manifest id，同时也是它在临时根目录里的目录名。 */
const LEGAL_FIXTURE_IDS = ['fixture-lore', 'fixture-free', 'fixture-card'];

/**
 * 搭建一个三个入口都覆盖的完整根目录。
 * 目录名一律等于 manifest id，否则会先触发 AGENT_ID_MISMATCH 而掩盖被考察的缺陷；
 * 覆盖不完整时 Registry 会报 AGENT_PROFILE_UNKNOWN，因此考察其他缺陷必须先补齐。
 */
async function completeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'worldforge-agent-complete-'));
  for (const relative of LEGAL_FIXTURES) {
    const source = new URL(`${relative}/`, fixturesRoot);
    const manifest = JSON.parse(await readFile(new URL(AGENT_RUNTIME_MANIFEST, source), 'utf8'));
    await cp(source, join(root, manifest.id), { recursive: true });
  }
  return root;
}

/** 把某个缺陷夹具替换进完整根目录，保持另外两个入口可用。 */
async function completeRootWith(sourceRelative) {
  const root = await completeRoot();
  const source = new URL(`${sourceRelative}/`, fixturesRoot);
  const manifest = JSON.parse(await readFile(new URL(AGENT_RUNTIME_MANIFEST, source), 'utf8'));
  await rm(join(root, manifest.id), { recursive: true, force: true });
  await cp(source, join(root, manifest.id), { recursive: true });
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

test('the registry satisfies the deep-freeze requirement: no nested array is writable', async () => {
  const registry = await loadAgentProfiles();
  assert.ok(Object.isFrozen(registry.defaults));
  for (const profile of registry.profiles) {
    assert.ok(Object.isFrozen(profile), `${profile.id} 快照应冻结`);
    assert.ok(Object.isFrozen(profile.surfaces), `${profile.id}.surfaces 应冻结`);
    assert.ok(Object.isFrozen(profile.manifest), `${profile.id}.manifest 应冻结`);
    assert.ok(Object.isFrozen(profile.manifest.surfaces), `${profile.id}.manifest.surfaces 必须冻结`);
    assert.throws(() => { profile.manifest.surfaces.push('card'); }, TypeError, '嵌套数组不得可写');
    assert.throws(() => { profile.surfaces.push('card'); }, TypeError);
    assert.throws(() => { profile.manifest.mode = 'free_chat'; }, TypeError);
    assert.throws(() => { profile.systemPrompt = 'x'; }, TypeError);
  }
  // deepFreeze 自身：嵌套对象与数组都要被冻结。
  const deep = deepFreeze({ a: { b: [1, { c: 2 }] } });
  assert.ok(Object.isFrozen(deep.a) && Object.isFrozen(deep.a.b) && Object.isFrozen(deep.a.b[1]));
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

test('every frozen error code is actually produced by the registry, not just declared', async () => {
  // 逐个真实触发 ADR-0029 §9 的错误码。只比较手写集合无法证明可达性。
  const produced = new Map();
  const record = async (code, run) => produced.set(code, (await expectError(run, code)).code);
  const base = JSON.parse(await readFile(new URL(`../.agent-presets/lore-writer/${AGENT_RUNTIME_MANIFEST}`, import.meta.url), 'utf8'));
  const cleanup = [];

  try {
    await record('AGENT_ROOT_UNREADABLE', () => loadAgentProfiles(join(tmpdir(), 'worldforge-absent-root-xyz')));
    await record('AGENT_MANIFEST_INVALID', () => validateAgentRuntimeManifest({ ...base, plugins: [] }, 'lore-writer'));
    await record('AGENT_ENUM_UNKNOWN', () => validateAgentRuntimeManifest({ ...base, mode: 'agentic_shell' }, 'lore-writer'));
    await record('AGENT_ID_MISMATCH', () => validateAgentRuntimeManifest({ ...base }, 'free-creator'));
    await record('AGENT_COMPAT_MISMATCH', () => validateAgentRuntimeManifest({ ...base, surfaces: ['free'] }, 'lore-writer'));

    const incomplete = await completeRoot();
    cleanup.push(incomplete);
    await rm(join(incomplete, 'fixture-lore'), { recursive: true, force: true });
    await record('AGENT_PROFILE_UNKNOWN', () => loadAgentProfiles(incomplete));

    const brokenJson = await completeRoot();
    cleanup.push(brokenJson);
    await writeFile(join(brokenJson, 'fixture-lore', AGENT_RUNTIME_MANIFEST), '{ "id": "fixture-lore",', 'utf8');
    await record('AGENT_MANIFEST_UNREADABLE', () => loadAgentProfiles(brokenJson));

    const missingPrompt = await completeRootWith('reject/missing-prompt');
    cleanup.push(missingPrompt);
    await record('AGENT_PROMPT_MISSING', () => loadAgentProfiles(missingPrompt));

    const oversized = await completeRootWith('reject/oversized-prompt');
    cleanup.push(oversized);
    await record('AGENT_PROMPT_TOO_LARGE', () => loadAgentProfiles(oversized));

    // 路径不安全必须能从真实加载路径产生（Schema 的 not 约束先于路径解析）。
    const traversalRoot = await completeRootWith('reject/traversal');
    cleanup.push(traversalRoot);
    await record('AGENT_PROMPT_PATH_UNSAFE', () => loadAgentProfiles(traversalRoot));

    // 符号链接逃逸同样归 PATH_UNSAFE，作为第二条独立触发路径。
    const linked = await completeRoot();
    cleanup.push(linked);
    const outside = await mkdtemp(join(tmpdir(), 'worldforge-outside-'));
    cleanup.push(outside);
    await writeFile(join(outside, 'system.md'), '外部 prompt', 'utf8');
    await rm(join(linked, 'fixture-lore', 'runtime', 'system.md'));
    try {
      await symlink(join(outside, 'system.md'), join(linked, 'fixture-lore', 'runtime', 'system.md'));
      await expectError(() => loadAgentProfiles(linked), 'AGENT_PROMPT_PATH_UNSAFE');
    } catch (error) {
      if (error.code !== 'EPERM') throw error;
      // 无法创建符号链接时，用「逃出目录的同构路径」验证解析层，并如实记录差异。
      await expectError(() => resolveAgentPromptPath(join(linked, 'fixture-lore'), 'runtime/../../runtime/system.md'), 'AGENT_PROMPT_PATH_UNSAFE');
    }

    const registry = await loadAgentProfiles();
    await record('AGENT_PROFILE_INCOMPATIBLE', () => registry.resolve('lore-writer', 'card'));

    assert.deepEqual([...produced.keys()].sort(), [...AGENT_PROFILE_ERROR_CODES].sort(), '每个冻结错误码都必须由真实触发产生');
    const wrapped = asAgentProfileError(new Error('boom'));
    assert.ok(wrapped instanceof AgentProfileError);
    assert.ok(AGENT_PROFILE_ERROR_CODES.includes(wrapped.code));
    assert.equal(asAgentProfileError(wrapped), wrapped, '已是 AgentProfileError 时不应重新包装');
  } finally {
    for (const path of cleanup) await rm(path, { recursive: true, force: true });
  }
});

test('manifest validation classifies each defect with its own error code', async () => {
  const base = JSON.parse(await readFile(new URL(`../.agent-presets/lore-writer/${AGENT_RUNTIME_MANIFEST}`, import.meta.url), 'utf8'));
  const cases = [
    // 字段级结构问题
    ['额外字段', { plugins: [] }, 'AGENT_MANIFEST_INVALID'],
    ['非法 id 格式', { id: 'Not-Kebab' }, 'AGENT_MANIFEST_INVALID'],
    ['缺少必填字段', base => { const copy = { ...base }; delete copy.mode; return copy; }, 'AGENT_MANIFEST_INVALID'],
    ['不支持的 schemaVersion', { schemaVersion: 2 }, 'AGENT_MANIFEST_INVALID'],
    // ADR-0029 §9 冻结：路径形态问题归 PATH_UNSAFE，不是结构问题
    ['prompt 为空', { systemPrompt: '' }, 'AGENT_MANIFEST_INVALID'],
    ['prompt 类型错误', { systemPrompt: 5 }, 'AGENT_MANIFEST_INVALID'],
    ['prompt 超长', { systemPrompt: `runtime/${'a'.repeat(200)}.md` }, 'AGENT_MANIFEST_INVALID'],
    ['prompt Windows 绝对路径', { systemPrompt: 'C:\\worldforge\\secret\\system.md' }, 'AGENT_PROMPT_PATH_UNSAFE'],
    ['prompt Unix 根路径', { systemPrompt: '/etc/passwd' }, 'AGENT_PROMPT_PATH_UNSAFE'],
    ['prompt UNC 路径', { systemPrompt: '\\\\server\\share\\system.md' }, 'AGENT_PROMPT_PATH_UNSAFE'],
    ['prompt 相对穿越', { systemPrompt: '../../agent.cordis.yml' }, 'AGENT_PROMPT_PATH_UNSAFE'],
    ['prompt 中间段穿越', { systemPrompt: 'runtime/../../system.md' }, 'AGENT_PROMPT_PATH_UNSAFE'],
    // 枚举
    ['未知 mode', { mode: 'agentic_shell' }, 'AGENT_ENUM_UNKNOWN'],
    ['未知 surface', { surfaces: ['simulation'] }, 'AGENT_ENUM_UNKNOWN'],
    ['surface 数组为空', { surfaces: [] }, 'AGENT_ENUM_UNKNOWN'],
    ['未知 toolPolicy', { toolPolicy: 'full_access' }, 'AGENT_ENUM_UNKNOWN'],
    ['未知 outputContract', { outputContract: 'anything' }, 'AGENT_ENUM_UNKNOWN'],
    ['未知 statusPolicy', { statusPolicy: 'balanced' }, 'AGENT_ENUM_UNKNOWN'],
    // 兼容矩阵
    ['lore 配 free 行', { surfaces: ['free'] }, 'AGENT_COMPAT_MISMATCH'],
    ['契约与 surface 不符', { outputContract: 'card_patch_v1' }, 'AGENT_COMPAT_MISMATCH']
  ];
  for (const [label, patch, code] of cases) {
    // patch 可以是对象，也可以是基于 base 构造完整清单的函数（用于删除字段等场景）。
    const manifest = typeof patch === 'function' ? patch(base) : { ...base, ...patch };
    const error = await expectError(() => validateAgentRuntimeManifest(manifest, 'lore-writer'), code);
    assert.ok(error.message.includes(code), `${label} 的错误消息应带错误码`);
  }
  await expectError(() => validateAgentRuntimeManifest('not an object', 'lore-writer'), 'AGENT_MANIFEST_INVALID');
  await expectError(() => validateAgentRuntimeManifest(null), 'AGENT_MANIFEST_INVALID');
  assert.equal((await validateAgentRuntimeManifest({ ...base }, 'lore-writer')).id, 'lore-writer');
});

test('surface compatibility is enforced for multi-surface manifests too', async () => {
  const base = JSON.parse(await readFile(new URL(`../.agent-presets/lore-writer/${AGENT_RUNTIME_MANIFEST}`, import.meta.url), 'utf8'));
  // 一个 preset 同时服务多个入口时，Schema 的单行分支无法覆盖，必须由兼容矩阵逐行复核。
  const multi = { ...base, surfaces: ['lore'] };
  assert.equal((await validateAgentRuntimeManifest(multi, 'lore-writer')).surfaces.length, 1);
  const dual = { ...base, surfaces: ['lore', 'free'] };
  await expectError(() => validateAgentRuntimeManifest(dual, 'lore-writer'), 'AGENT_COMPAT_MISMATCH');
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

  // 未知枚举、额外字段、非法路径与不兼容组合：放进完整根目录，确认拒绝原因来自清单本身。
  const deviating = [
    ['reject/unknown-field', 'AGENT_MANIFEST_INVALID'],
    ['reject/unknown-enum', 'AGENT_ENUM_UNKNOWN'],
    ['reject/incompatible-combination', 'AGENT_COMPAT_MISMATCH'],
    ['reject/absolute-path', 'AGENT_PROMPT_PATH_UNSAFE'],
    ['reject/traversal', 'AGENT_PROMPT_PATH_UNSAFE'],
    ['reject/empty-prompt', 'AGENT_MANIFEST_INVALID'],
    ['reject/missing-prompt', 'AGENT_PROMPT_MISSING'],
    ['reject/oversized-prompt', 'AGENT_PROMPT_TOO_LARGE']
  ];
  for (const [relative, code] of deviating) {
    const root = await completeRootWith(relative);
    try { await expectError(() => loadAgentProfiles(root), code); }
    finally { await rm(root, { recursive: true, force: true }); }
  }

  // 完整根目录必须成功，证明上面的拒绝来自具体缺陷而不是环境。
  const complete = await completeRoot();
  try {
    const registry = await loadAgentProfiles(complete);
    assert.deepEqual(registry.profiles.map(profile => profile.id), ['fixture-card', 'fixture-free', 'fixture-lore']);
    assert.deepEqual(registry.defaults, { lore: 'fixture-lore', free: 'fixture-free', card: 'fixture-card' });
  } finally { await rm(complete, { recursive: true, force: true }); }
});

test('startup refuses when any entry point loses its preset', async () => {
  // 直接对应验收阻断项：删除默认 preset 后服务必须拒绝启动，而不是把该入口降级为 null。
  const surfaces = { 'fixture-lore': 'lore', 'fixture-free': 'free', 'fixture-card': 'card' };
  for (const [missingId, surface] of Object.entries(surfaces)) {
    const root = await mkdtemp(join(tmpdir(), 'worldforge-agent-incomplete-'));
    try {
      for (const relative of LEGAL_FIXTURES) {
        const source = new URL(`${relative}/`, fixturesRoot);
        const manifest = JSON.parse(await readFile(new URL(AGENT_RUNTIME_MANIFEST, source), 'utf8'));
        if (manifest.id === missingId) continue;
        await cp(source, join(root, manifest.id), { recursive: true });
      }
      const error = await expectError(() => loadAgentProfiles(root), 'AGENT_PROFILE_UNKNOWN');
      assert.ok(error.message.includes(surface), `诊断应指出缺失的入口 ${surface}：${error.message}`);
    } finally { await rm(root, { recursive: true, force: true }); }
  }

  // 只加载部分入口的夹具同样必须被拒绝。
  const partial = await temporaryRootWithMatchingId('legal/fixture-card');
  try { await expectError(() => loadAgentProfiles(partial), 'AGENT_PROFILE_UNKNOWN'); }
  finally { await rm(partial, { recursive: true, force: true }); }
});

test('preset directories, manifests and intermediate directories cannot be symlinks', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'worldforge-agent-outside-'));
  const root = await completeRoot();
  try {
    // 1) manifest 文件是符号链接（指向根目录之外的真实文件）。
    await writeFile(join(outside, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, id: 'fixture-lore', version: '9.9.9', displayName: '外部', description: '外部 manifest',
      surfaces: ['lore'], mode: 'structured_lore', systemPrompt: 'runtime/system.md',
      toolPolicy: 'none', outputContract: 'lore_blocks_v2', statusPolicy: 'proposed_only'
    }), 'utf8');
    const manifestTarget = join(root, 'fixture-lore', AGENT_RUNTIME_MANIFEST);
    await rm(manifestTarget);
    let linked = true;
    try { await symlink(join(outside, 'manifest.json'), manifestTarget); }
    catch (error) { if (error.code !== 'EPERM') throw error; linked = false; }
    if (linked) await expectError(() => loadAgentProfiles(root), 'AGENT_PROMPT_PATH_UNSAFE');
    else console.log('# 本机不允许创建符号链接（manifest 链接分支未验证）');
    await rm(manifestTarget, { force: true });
    await cp(new URL('legal/fixture-lore/worldforge.runtime.json', fixturesRoot), manifestTarget);

    // 2) 中间目录是符号链接：runtime/ 指向根目录之外。
    await mkdir(join(outside, 'runtime'), { recursive: true });
    await cp(new URL('legal/fixture-lore/runtime/system.md', fixturesRoot), join(outside, 'runtime', 'system.md'));
    const runtimeDirectory = join(root, 'fixture-lore', 'runtime');
    await rm(runtimeDirectory, { recursive: true, force: true });
    linked = true;
    try { await symlink(join(outside, 'runtime'), runtimeDirectory, 'dir'); }
    catch (error) { if (error.code !== 'EPERM') throw error; linked = false; }
    if (linked) await expectError(() => loadAgentProfiles(root), 'AGENT_PROMPT_PATH_UNSAFE');
    else console.log('# 本机不允许创建符号链接（中间目录链接分支未验证）');
    await rm(runtimeDirectory, { recursive: true, force: true });
    await cp(new URL('legal/fixture-lore/runtime/', fixturesRoot), runtimeDirectory, { recursive: true });

    // 3) preset 目录本身是符号链接。
    const realPreset = join(outside, 'fixture-lore');
    await cp(join(root, 'fixture-lore'), realPreset, { recursive: true });
    await rm(join(root, 'fixture-lore'), { recursive: true, force: true });
    linked = true;
    try { await symlink(realPreset, join(root, 'fixture-lore'), 'dir'); }
    catch (error) { if (error.code !== 'EPERM') throw error; linked = false; }
    if (linked) await expectError(() => loadAgentProfiles(root), 'AGENT_PROMPT_PATH_UNSAFE');
    else console.log('# 本机不允许创建符号链接（preset 目录链接分支未验证）');

    // 三种逃逸都恢复后，完整根目录必须重新可用。
    await rm(join(root, 'fixture-lore'), { recursive: true, force: true });
    await cp(new URL('legal/fixture-lore/', fixturesRoot), join(root, 'fixture-lore'), { recursive: true });
    const registry = await loadAgentProfiles(root);
    assert.deepEqual(registry.defaults, { lore: 'fixture-lore', free: 'fixture-free', card: 'fixture-card' });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
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
  // 仓库内不得出现指向本机目录的绝对路径：schema 路径是**运行时解析**的绝对路径，
  // 但不能假设它长得像 Windows 盘符——CI 在 Linux 上解析为 /home/runner/…。
  assert.equal(isAbsolute(AGENT_RUNTIME_SCHEMA_PATH), true, 'schema 路径在运行时解析为绝对路径（不写死）');
  const serialized = JSON.stringify(publicRegistryView({ schemaVersion: 1, profiles: [], defaults: {} }));
  assert.ok(!serialized.includes(AGENT_RUNTIME_SCHEMA_PATH), '对外视图不得泄露 schema 的绝对路径');
  assert.ok(!serialized.includes(resolve('.')), '对外视图不得泄露本机仓库根路径');
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
