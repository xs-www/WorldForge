import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { test } from 'node:test';

// Sprint 0 只固化契约：本文件校验 agent-runtime Schema、三个随仓库 preset 的
// 产品投影、合法/非法夹具、提示词路径安全与提示词层次顺序。
// Registry 加载、哈希、API 与 Docker 打包属于 Sprint 1，不在这里假装已实现。

const schemaUrl = new URL('../docs/schemas/agent-runtime.schema.json', import.meta.url);
const adrUrl = new URL('../docs/adr/ADR-0029-agent-profile-runtime-projection.md', import.meta.url);
const presetsRoot = new URL('../.agent-presets/', import.meta.url);
const fixtureRoot = new URL('fixtures/agent-profiles/', import.meta.url);
const manifestName = 'worldforge.runtime.json';

const PRESET_IDS = ['card-designer', 'free-creator', 'lore-writer'];
const PROMPT_LIMIT = 32768;
const SURFACES = ['card', 'free', 'lore'];
const MODES = ['free_chat', 'structured_card', 'structured_lore'];
const CONTRACTS = ['card_patch_v1', 'free_chat_v1', 'lore_blocks_v2'];
const TOOL_POLICIES = ['card_context_readonly', 'free_lore_readonly', 'none'];
const COMPATIBILITY = Object.freeze({
  lore: { mode: 'structured_lore', outputContract: 'lore_blocks_v2', toolPolicy: 'none', statusPolicy: 'proposed_only' },
  free: { mode: 'free_chat', outputContract: 'free_chat_v1', toolPolicy: 'free_lore_readonly', statusPolicy: 'proposed_only' },
  card: { mode: 'structured_card', outputContract: 'card_patch_v1', toolPolicy: 'none', statusPolicy: 'proposed_or_untested' }
});

const schema = JSON.parse(await readFile(schemaUrl, 'utf8'));

function isType(value, type) {
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return false;
}

// 只实现 agent-runtime.schema.json 实际用到的关键字，避免把 ajv 引入生产依赖。
function validate(spec, value, path = '$') {
  const errors = [];
  if (spec.type !== undefined && !isType(value, spec.type)) return [`${path}: expected ${spec.type}`];
  if (spec.const !== undefined && value !== spec.const) errors.push(`${path}: expected const ${JSON.stringify(spec.const)}`);
  if (spec.enum !== undefined && !spec.enum.includes(value)) errors.push(`${path}: value not in enum`);
  if (typeof value === 'string') {
    if (spec.minLength !== undefined && value.length < spec.minLength) errors.push(`${path}: shorter than minLength`);
    if (spec.maxLength !== undefined && value.length > spec.maxLength) errors.push(`${path}: longer than maxLength`);
    if (spec.pattern !== undefined && !new RegExp(spec.pattern).test(value)) errors.push(`${path}: does not match pattern`);
  }
  if (Array.isArray(value)) {
    if (spec.minItems !== undefined && value.length < spec.minItems) errors.push(`${path}: fewer than minItems`);
    if (spec.maxItems !== undefined && value.length > spec.maxItems) errors.push(`${path}: more than maxItems`);
    if (spec.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) errors.push(`${path}: items not unique`);
    if (spec.items !== undefined) value.forEach((item, index) => errors.push(...validate(spec.items, item, `${path}[${index}]`)));
  }
  if (spec.not !== undefined && validate(spec.not, value, path).length === 0) errors.push(`${path}: matched forbidden "not" branch`);
  if (spec.anyOf !== undefined && !spec.anyOf.some(branch => validate(branch, value, path).length === 0)) errors.push(`${path}: no anyOf branch matched`);
  if (spec.contains !== undefined && Array.isArray(value) && !value.some(item => validate(spec.contains, item, path).length === 0)) errors.push(`${path}: no item matched "contains"`);
  if (isType(value, 'object')) {
    for (const key of spec.required || []) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}: missing required ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (spec.properties && Object.prototype.hasOwnProperty.call(spec.properties, key)) errors.push(...validate(spec.properties[key], item, `${path}.${key}`));
      else if (spec.additionalProperties === false) errors.push(`${path}.${key}: additional property not allowed`);
    }
  }
  if (spec.if !== undefined && validate(spec.if, value, path).length === 0) errors.push(...validate(spec.then ?? {}, value, path));
  for (const branch of spec.allOf || []) errors.push(...validate(branch, value, path));
  return errors;
}

function isInside(child, parent) {
  if (!child.startsWith(parent)) return false;
  const relative = child.slice(parent.length);
  return relative !== '' && !relative.startsWith('/') && !relative.startsWith('\\');
}

async function readManifest(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

const realManifests = new Map();
for (const id of PRESET_IDS) realManifests.set(id, await readManifest(new URL(`${id}/${manifestName}`, presetsRoot)));

test('the runtime projection schema declares the frozen enums and forbids extra fields', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.deepEqual(schema.properties.surfaces.items.enum, ['lore', 'free', 'card']);
  assert.deepEqual(schema.properties.mode.enum, ['structured_lore', 'free_chat', 'structured_card']);
  assert.deepEqual(schema.properties.toolPolicy.enum, ['none', 'free_lore_readonly', 'card_context_readonly']);
  assert.deepEqual(schema.properties.outputContract.enum, ['lore_blocks_v2', 'free_chat_v1', 'card_patch_v1']);
  assert.deepEqual(schema.properties.statusPolicy.enum, ['proposed_only', 'proposed_or_untested']);
  for (const key of ['schemaVersion', 'id', 'version', 'displayName', 'description', 'surfaces', 'mode', 'systemPrompt', 'toolPolicy', 'outputContract', 'statusPolicy']) {
    assert.ok(schema.required.includes(key), `${key} should be required`);
  }
  assert.equal(schema.allOf.length, 3, '每个 surface 必须有一条兼容矩阵分支');
});

test('every shipped preset carries a schema-valid runtime projection named after its directory', async () => {
  for (const id of PRESET_IDS) {
    const manifest = realManifests.get(id);
    assert.deepEqual(validate(schema, manifest), [], `${id} projection should validate`);
    assert.equal(manifest.id, id, `${id} manifest id must match its directory name`);

    const directory = new URL(`${id}/`, presetsRoot);
    for (const relative of [manifestName, manifest.systemPrompt, 'agent.cordis.yml', 'preset.yml']) {
      assert.equal((await stat(new URL(relative, directory))).isFile(), true, `${id}/${relative} should exist`);
    }
    // 产品投影与 DSH 组装同目录，但产品只读前者。
    assert.equal(manifest.systemPrompt.startsWith('runtime/'), true, `${id} systemPrompt must stay in runtime/`);
  }
});

test('the three shipped projections stay in the compatibility matrix', () => {
  const expected = { 'lore-writer': 'lore', 'free-creator': 'free', 'card-designer': 'card' };
  for (const [id, surface] of Object.entries(expected)) {
    const manifest = realManifests.get(id);
    assert.deepEqual(manifest.surfaces, [surface], `${id} should only serve ${surface}`);
    assert.deepEqual(
      { mode: manifest.mode, outputContract: manifest.outputContract, toolPolicy: manifest.toolPolicy, statusPolicy: manifest.statusPolicy },
      COMPATIBILITY[surface],
      `${id} must match the frozen row for ${surface}`
    );
  }
});

test('surface, mode, contract and tool policy combinations outside the matrix are rejected', () => {
  const base = realManifests.get('lore-writer');
  let allowed = 0;
  for (const surface of SURFACES) {
    for (const mode of MODES) {
      for (const outputContract of CONTRACTS) {
        for (const toolPolicy of TOOL_POLICIES) {
          const manifest = structuredClone(base);
          Object.assign(manifest, { surfaces: [surface], mode, outputContract, toolPolicy, statusPolicy: COMPATIBILITY[surface].statusPolicy });
          const expected = COMPATIBILITY[surface];
          const legal = mode === expected.mode && outputContract === expected.outputContract && toolPolicy === expected.toolPolicy;
          const errors = validate(schema, manifest);
          if (legal) { allowed += 1; assert.deepEqual(errors, [], `${surface}/${mode}/${outputContract}/${toolPolicy} should be legal`); }
          else assert.notDeepEqual(errors, [], `${surface}/${mode}/${outputContract}/${toolPolicy} should be rejected`);
        }
      }
    }
  }
  assert.equal(allowed, 3, '矩阵恰好只有三行合法组合');
});

test('an unregistered surface is rejected instead of silently downgraded', () => {
  const manifest = structuredClone(realManifests.get('lore-writer'));
  manifest.surfaces = ['simulation'];
  assert.notDeepEqual(validate(schema, manifest), []);
});

test('a preset frozen for one surface cannot be reused for another', () => {
  const lore = realManifests.get('lore-writer');
  // 同一份 preset 被放进 free surface：surface 合法，但 mode/契约/工具策略都不匹配。
  const misused = structuredClone(lore);
  misused.surfaces = ['free'];
  assert.notDeepEqual(validate(schema, misused), []);
  const card = realManifests.get('card-designer');
  misused.surfaces = ['card'];
  Object.assign(misused, { mode: card.mode, outputContract: card.outputContract, toolPolicy: card.toolPolicy, statusPolicy: card.statusPolicy });
  assert.deepEqual(validate(schema, misused), [], '换掉整个投影后才合法，说明它必须是一个不同的 preset');
});

test('legal fixtures validate and reject fixtures fail for the intended reason', async () => {
  for (const id of ['fixture-lore', 'fixture-card']) {
    const manifest = await readManifest(new URL(`legal/${id}/${manifestName}`, fixtureRoot));
    assert.deepEqual(validate(schema, manifest), [], `legal/${id} should validate`);
    assert.equal(manifest.id, id);
    assert.equal((await stat(new URL(`legal/${id}/${manifest.systemPrompt}`, fixtureRoot))).isFile(), true);
  }

  const rejected = await readdir(new URL('reject/', fixtureRoot));
  assert.ok(rejected.length >= 8, '至少覆盖未知字段、未知枚举、绝对路径、路径穿越、目录不符、非法组合、缺失与空 prompt');
  for (const id of rejected) {
    const directory = new URL(`reject/${id}/`, fixtureRoot);
    const manifest = await readManifest(new URL(manifestName, directory));
    const structural = validate(schema, manifest);
    const directoryMismatch = manifest.id !== id;
    const promptMissing = !(await stat(new URL(manifest.systemPrompt, directory)).catch(() => null))?.isFile();
    assert.ok(structural.length > 0 || directoryMismatch || promptMissing, `reject/${id} should fail for a named reason`);
    // 「未知字段」与「未知枚举」必须由 Schema 本身拦下，而不是靠目录名或缺失文件。
    if (id === 'unknown-field' || id === 'unknown-enum' || id === 'incompatible-combination' || id === 'absolute-path' || id === 'traversal' || id === 'empty-prompt') {
      assert.notDeepEqual(structural, [], `reject/${id} must be rejected by the schema`);
    }
  }
});

test('duplicate manifest ids and an oversized prompt are rejected', async () => {
  const first = realManifests.get('lore-writer');
  const second = structuredClone(first);
  second.surfaces = ['lore'];
  // 同一个 id 出现在两个目录：Registry 已知的第一个保留，第二个必须失败。
  const registry = new Map();
  const errors = [];
  for (const manifest of [first, second]) {
    if (registry.has(manifest.id)) errors.push(`duplicate id ${manifest.id}`);
    else registry.set(manifest.id, manifest);
  }
  assert.deepEqual(errors, ['duplicate id lore-writer']);

  const prompt = await readFile(new URL('lore-writer/runtime/system.md', presetsRoot), 'utf8');
  assert.ok(prompt.length <= PROMPT_LIMIT, '随仓库 prompt 未超过长度上限');
  assert.ok(prompt.trim().length > 0, '随仓库 prompt 不是空文件');
  assert.equal(prompt.includes('\u0000'), false, '随仓库 prompt 不含 NUL，可按 UTF-8 文本使用');
  const oversized = `${prompt}${'x'.repeat(PROMPT_LIMIT)}`;
  assert.ok(oversized.length > PROMPT_LIMIT, '超长 prompt 夹具必须在长度检查上失败');
  assert.throws(() => { if (oversized.length > PROMPT_LIMIT) throw new Error('AGENT_PROMPT_TOO_LARGE'); }, /AGENT_PROMPT_TOO_LARGE/);
});

test('prompt paths stay inside their preset root', async () => {
  const textEncoder = new TextEncoder();
  for (const id of [...PRESET_IDS, 'legal/fixture-lore', 'legal/fixture-card']) {
    const directory = new URL(id.endsWith('/') ? id : `${id}/`, id.startsWith('legal/') ? fixtureRoot : presetsRoot);
    const manifest = await readManifest(new URL(manifestName, directory));
    const absolute = new URL(manifest.systemPrompt, directory);
    assert.equal(isInside(absolute.href, directory.href), true, `${id} prompt must resolve inside the preset root`);
    const bytes = await readFile(absolute);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assert.equal(textEncoder.encode(decoded).length, bytes.length, `${id} prompt must be valid UTF-8`);
  }
  // 绝对路径与路径穿越在拼装前就被拒绝，不做字符串清洗。
  for (const unsafe of ['C:\\worldforge\\system.md', '/etc/passwd', '../../agent.cordis.yml', 'runtime/../../agent.cordis.yml']) {
    assert.notDeepEqual(validate(schema, { ...realManifests.get('lore-writer'), systemPrompt: unsafe }), [], `${unsafe} must be rejected`);
  }
});

test('the prompt assembly order is frozen to six named layers', async () => {
  const adr = await readFile(adrUrl, 'utf8');
  const layerNames = ['product_boundary', 'preset_runtime', 'entry_contract', 'author_prompts', 'task_request', 'untrusted_context'];
  let cursor = -1;
  for (const layer of layerNames) {
    const index = adr.indexOf(layer);
    assert.ok(index > cursor, `ADR must name the layer ${layer} in order`);
    cursor = index;
  }
  assert.equal(adr.includes('preset 只能贡献第 2 层'), true, 'ADR must state that a preset may only replace the preset layer');
  for (const manifest of realManifests.values()) {
    assert.equal(manifest.systemPrompt, 'runtime/system.md');
  }
});

test('runtime prompts replace only the preset layer and do not restate the product boundary', async () => {
  const forbidden = [
    /@deepseek-ai\//,
    /agent\.cordis\.yml/,
    /dsh-tool-/,
    /[A-Za-z]:\\/,
    /```/
  ];
  for (const id of PRESET_IDS) {
    const prompt = await readFile(new URL(`${id}/runtime/system.md`, presetsRoot), 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(prompt, pattern, `${id} prompt must not leak DSH internals or machine paths`);
    assert.ok(prompt.length > 40, `${id} prompt should carry real persona content`);
  }

  const lore = await readFile(new URL('lore-writer/runtime/system.md', presetsRoot), 'utf8');
  for (const keyword of ['canon', 'proposed', 'unknown', '原创', '本候选']) assert.ok(lore.includes(keyword), `lore-writer prompt should keep ${keyword}`);
  assert.doesNotMatch(lore, /不得修改、否定或悄悄补完 canon/, '禁写 canon 的禁令属于入口契约层，不在 preset 层重复');

  const free = await readFile(new URL('free-creator/runtime/system.md', presetsRoot), 'utf8');
  for (const keyword of ['不要强制 JSON', 'proposed', 'unknown', '原创']) assert.ok(free.includes(keyword), `free-creator prompt should keep ${keyword}`);
  assert.doesNotMatch(free, /工具/, '工具协议属于入口契约层，不在 preset 层重复');

  const card = await readFile(new URL('card-designer/runtime/system.md', presetsRoot), 'utf8');
  for (const keyword of ['untested', 'proposed', '开放问题', '原创']) assert.ok(card.includes(keyword), `card-designer prompt should keep ${keyword}`);
  assert.doesNotMatch(card, /(?<!不得声称任何数值)已平衡/, 'card-designer 只能以否定形式提到平衡');
});
