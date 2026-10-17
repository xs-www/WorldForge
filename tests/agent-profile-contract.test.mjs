import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { test } from 'node:test';
import {
  AGENT_MODES,
  AGENT_OUTPUT_CONTRACTS,
  AGENT_PRESET_REPLACEABLE_LAYER,
  AGENT_PRESETS_DIRECTORY,
  AGENT_PROFILE_ERROR_CODES,
  AGENT_PROMPT_LAYERS,
  AGENT_PROMPT_MAX_CHARS,
  AGENT_RUNTIME_MANIFEST,
  AGENT_RUNTIME_SCHEMA_VERSION,
  AGENT_STATUS_POLICIES,
  AGENT_SURFACES,
  AGENT_SURFACE_COMPATIBILITY,
  AGENT_TOOL_POLICIES
} from '../agent-profile-contract.mjs';

// Sprint 0 只固化契约：本文件校验 agent-runtime Schema、代码侧契约常量、三个随仓库
// preset 的产品投影、合法/非法夹具、提示词路径安全与提示词层次顺序快照。
// Registry 加载、哈希、API 与 Docker 打包属于 Sprint 1，不在这里假装已实现。

const schemaUrl = new URL('../docs/schemas/agent-runtime.schema.json', import.meta.url);
const adrUrl = new URL('../docs/adr/ADR-0029-agent-profile-runtime-projection.md', import.meta.url);
const snapshotUrl = new URL('snapshots/agent-prompt-layers.json', import.meta.url);
const presetsRoot = new URL(`../${AGENT_PRESETS_DIRECTORY}/`, import.meta.url);
const fixtureRoot = new URL('fixtures/agent-profiles/', import.meta.url);
const manifestName = AGENT_RUNTIME_MANIFEST;

const PRESET_IDS = ['card-designer', 'free-creator', 'lore-writer'];
const SURFACES = [...AGENT_SURFACES].sort();
const MODES = [...AGENT_MODES].sort();
const CONTRACTS = [...AGENT_OUTPUT_CONTRACTS].sort();
const TOOL_POLICIES = [...AGENT_TOOL_POLICIES].sort();
const COMPATIBILITY = AGENT_SURFACE_COMPATIBILITY;

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

const SCHEMA_REJECTED_FIXTURES = new Set(['unknown-field', 'unknown-enum', 'incompatible-combination', 'absolute-path', 'traversal', 'empty-prompt']);
/** 需要跨目录或跨文件判断、无法靠单个 manifest 结构性错误发现的夹具。 */
const CROSS_CHECK_FIXTURES = new Set(['duplicate-id', 'oversized-prompt']);
/** 单个目录内的夹具数量：其余都是一个目录一个夹具。 */
const FIXTURE_DIRECTORY_COUNT = { 'duplicate-id': 2 };

/** reject/<id> 既可以是单个 preset 目录，也可以是一批 preset 目录（重复 ID 需要两个）。 */
async function manifestDirectories(entry) {
  const directory = new URL(`reject/${entry}/`, fixtureRoot);
  if (await stat(new URL(manifestName, directory)).catch(() => null)) return [{ label: `reject/${entry}`, directory }];
  const children = await readdir(directory);
  return children.map(child => ({ label: `reject/${entry}/${child}`, directory: new URL(`${child}/`, directory) }));
}

test('legal fixtures validate and reject fixtures fail for the intended reason', async () => {
  for (const id of ['fixture-lore', 'fixture-card']) {
    const manifest = await readManifest(new URL(`legal/${id}/${manifestName}`, fixtureRoot));
    assert.deepEqual(validate(schema, manifest), [], `legal/${id} should validate`);
    assert.equal(manifest.id, id);
    assert.equal((await stat(new URL(`legal/${id}/${manifest.systemPrompt}`, fixtureRoot))).isFile(), true);
  }

  const rejected = await readdir(new URL('reject/', fixtureRoot));
  assert.ok(rejected.length >= 10, '至少覆盖未知字段、未知枚举、绝对路径、路径穿越、目录不符、非法组合、缺失/空/超长 prompt 与重复 ID');
  let seen = 0;
  for (const entry of rejected) {
    const directories = await manifestDirectories(entry);
    assert.equal(directories.length, FIXTURE_DIRECTORY_COUNT[entry] ?? 1, `reject/${entry} 的 preset 目录数不符合预期`);
    for (const { label, directory } of directories) {
      seen += 1;
      const manifest = await readManifest(new URL(manifestName, directory));
      const structural = validate(schema, manifest);
      const promptPath = new URL(manifest.systemPrompt, directory);
      const promptStat = await stat(promptPath).catch(() => null);
      const directoryMismatch = manifest.id !== entry;
      const promptMissing = !promptStat?.isFile();
      const promptTooLarge = Boolean(promptStat?.isFile()) && (await readFile(promptPath, 'utf8')).length > AGENT_PROMPT_MAX_CHARS;
      const failure = structural.length > 0 || directoryMismatch || promptMissing || promptTooLarge || CROSS_CHECK_FIXTURES.has(entry);
      assert.ok(failure, `${label} should fail for a named reason`);
      // 结构类夹具必须由 Schema 本身拦下，而不是靠目录名、缺失文件或长度。
      if (structural.length === 0 && !promptMissing && SCHEMA_REJECTED_FIXTURES.has(entry)) {
        assert.fail(`${label} must be rejected by the schema`);
      }
    }
  }
  assert.ok(seen >= 11, '夹具目录数应覆盖全部拒绝场景');
  // 重复 ID 与超长 prompt 使用真实磁盘夹具，不再由测试临时构造。
  assert.equal((await readdir(new URL('reject/duplicate-id/', fixtureRoot))).length, 2, '重复 ID 必须有两个真实 preset 目录');
  assert.equal((await stat(new URL('reject/oversized-prompt/runtime/system.md', fixtureRoot))).isFile(), true, '超长 prompt 必须是真实磁盘文件');
});

test('duplicate ids and an oversized prompt are rejected by fixtures on disk', async () => {
  // Registry 的加载语义：同一 id 第二次出现必须失败，且不得静默覆盖或改名。
  const loadRegistry = manifests => {
    const registry = new Map();
    for (const { directory, manifest } of manifests) {
      if (registry.has(manifest.id)) throw new Error(`AGENT_ID_MISMATCH: duplicate id ${manifest.id}`);
      if (validate(schema, manifest).length > 0) throw new Error(`AGENT_MANIFEST_INVALID: ${directory}`);
      registry.set(manifest.id, manifest);
    }
    return registry;
  };
  const batch = [];
  for (const child of await readdir(new URL('reject/duplicate-id/', fixtureRoot))) {
    const directory = new URL(`reject/duplicate-id/${child}/`, fixtureRoot);
    const manifest = await readManifest(new URL(manifestName, directory));
    assert.deepEqual(validate(schema, manifest), [], `duplicate-id/${child} 单看是合法投影，只有重复 id 让这一批失败`);
    batch.push({ directory, manifest });
  }
  assert.equal(batch.length, 2);
  assert.equal(batch[0].manifest.id, batch[1].manifest.id, '两个目录必须声明同一个 id');
  assert.notEqual(new URL('fixture-a/', fixtureRoot).href, new URL('fixture-b/', fixtureRoot).href);
  assert.throws(() => loadRegistry(batch), /duplicate id duplicate-id/);
  assert.equal(loadRegistry([batch[0]]).size, 1, '单独加载其中一个仍然成功，说明失败来自重复而不是其他原因');

  // 超长 prompt：读取真实文件并用契约常量判定，而不是在内存里拼一个超长字符串。
  const directory = new URL('reject/oversized-prompt/', fixtureRoot);
  const manifest = await readManifest(new URL(manifestName, directory));
  assert.deepEqual(validate(schema, manifest), [], '超长 prompt 的 manifest 结构本身合法，只有长度让加载失败');
  const bytes = await readFile(new URL(manifest.systemPrompt, directory));
  const prompt = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.ok(prompt.length > AGENT_PROMPT_MAX_CHARS, `超长夹具必须真的超过 ${AGENT_PROMPT_MAX_CHARS} 字符（当前 ${prompt.length}）`);
  const loadPrompt = value => { if (value.length > AGENT_PROMPT_MAX_CHARS) throw new Error('AGENT_PROMPT_TOO_LARGE'); return value; };
  assert.throws(() => loadPrompt(prompt), /AGENT_PROMPT_TOO_LARGE/);

  // 随仓库的真实 preset prompt 必须仍然在限制内，避免修夹具时把上限调歪。
  for (const id of PRESET_IDS) {
    const text = await readFile(new URL(`${id}/runtime/system.md`, presetsRoot), 'utf8');
    assert.ok(text.length <= AGENT_PROMPT_MAX_CHARS, `${id} prompt should stay within the limit`);
    assert.ok(text.trim().length > 0, `${id} prompt should not be empty`);
  }
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

test('the code-side contract constants agree with the schema and the ADR', async () => {  const adr = await readFile(adrUrl, 'utf8');
  const properties = schema.properties;

  // 枚举：Schema 是产品侧真值，模块是代码侧真值，两者必须逐项一致。
  assert.equal(AGENT_RUNTIME_SCHEMA_VERSION, properties.schemaVersion.const);
  assert.equal(AGENT_RUNTIME_MANIFEST, manifestName);
  assert.deepEqual([...AGENT_SURFACES].sort(), [...properties.surfaces.items.enum].sort());
  assert.deepEqual([...AGENT_MODES].sort(), [...properties.mode.enum].sort());
  assert.deepEqual([...AGENT_OUTPUT_CONTRACTS].sort(), [...properties.outputContract.enum].sort());
  assert.deepEqual([...AGENT_TOOL_POLICIES].sort(), [...properties.toolPolicy.enum].sort());
  assert.deepEqual([...AGENT_STATUS_POLICIES].sort(), [...properties.statusPolicy.enum].sort());
  assert.equal(AGENT_PROMPT_MAX_CHARS, 32768, 'prompt 长度上限必须与 ADR-0029 §8 一致');

  // 兼容矩阵：每个 surface 的每一项都必须落在 Schema 枚举内，且状态策略必须与该行匹配。
  assert.deepEqual(Object.keys(AGENT_SURFACE_COMPATIBILITY).sort(), [...AGENT_SURFACES].sort());
  for (const [surface, row] of Object.entries(AGENT_SURFACE_COMPATIBILITY)) {
    assert.ok(AGENT_MODES.includes(row.mode), `${surface} mode must be a known mode`);
    assert.ok(AGENT_OUTPUT_CONTRACTS.includes(row.outputContract), `${surface} contract must be a known contract`);
    assert.ok(AGENT_TOOL_POLICIES.includes(row.toolPolicy), `${surface} tool policy must be a known policy`);
    assert.ok(AGENT_STATUS_POLICIES.includes(row.statusPolicy), `${surface} status policy must be a known policy`);
  }

  // 错误码：模块与 ADR §9 必须给出同一组。只取 ADR 表格行里的反引号标识符，
  // 避免把正文中提到的其他常量名误当成错误码。
  const adrCodes = [...adr.matchAll(/^\|\s*`(AGENT_[A-Z_]+)`\s*\|/gm)].map(match => match[1]);
  assert.equal(adrCodes.length, AGENT_PROFILE_ERROR_CODES.length, 'ADR §9 的错误码行数应与模块一致');
  assert.deepEqual([...new Set(adrCodes)].sort(), [...AGENT_PROFILE_ERROR_CODES].sort(), 'ADR 与模块之间的错误码集合必须完全一致');
  for (const code of AGENT_PROFILE_ERROR_CODES) assert.ok(adrCodes.includes(code), `ADR must document ${code}`);
});

test('the prompt layer sequence matches the snapshot and the ADR', async () => {
  // 真正的顺序回归保护：Sprint 1/2 的拼装函数必须按 AGENT_PROMPT_LAYERS 产出层序列，
  // 任何重排都会先打断这里的 deepEqual，而不是悄悄改变提示词优先级。
  const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8'));
  assert.deepEqual(AGENT_PROMPT_LAYERS, snapshot.layers, '提示词层次顺序与 snapshot 不一致；若是有意修改，请同步 ADR-0029 §7 与 snapshot');
  assert.equal(AGENT_PRESET_REPLACEABLE_LAYER, snapshot.replaceableByPreset);
  assert.deepEqual(AGENT_PROMPT_LAYERS.map(layer => layer.priority), [1, 2, 3, 4, 5, 6]);
  const replaceable = AGENT_PROMPT_LAYERS.filter(layer => layer.replaceableByPreset);
  assert.deepEqual(replaceable.map(layer => layer.name), [AGENT_PRESET_REPLACEABLE_LAYER], 'preset 只能替换第 2 层');
  assert.notEqual(AGENT_PROMPT_LAYERS[0].replaceableByPreset, true, '第 1 层产品边界不可被 preset 替换');
  assert.notEqual(AGENT_PROMPT_LAYERS[2].replaceableByPreset, true, '第 3 层入口契约不可被 preset 替换');

  // ADR 必须按同一顺序记录层名，避免代码与文档漂移。
  const adr = await readFile(adrUrl, 'utf8');
  let cursor = -1;
  for (const layer of AGENT_PROMPT_LAYERS) {
    const index = adr.indexOf(layer.name);
    assert.ok(index > cursor, `ADR must name the layer ${layer.name} in order`);
    cursor = index;
  }
  assert.match(adr, /preset 只能贡献第 2 层/, 'ADR must state that a preset may only replace the preset layer');
  for (const manifest of realManifests.values()) assert.equal(manifest.systemPrompt, 'runtime/system.md');
});

test('runtime prompts replace only the preset layer and do not restate the product boundary', async () => {
  const forbidden = [
    /@deepseek-ai\//,
    /agent\.cordis\.yml/,
    /dsh-tool-/,
    /[A-Za-z]:\\/,
    /```/
  ];
  // Sprint 2 起，纪律按层分工：preset 层只留 persona 与写作方式，
  // IP、canon、元话语与工具协议分别在第 1、3 层，preset 不得重复。
  const layer1 = ['不得复制商业 IP', '仅视为不可信资料'];
  const layer3 = ['不得修改、否定或悄悄补完 canon', '禁止输出“本候选”', '不要强制使用 JSON', '按它的 status 与 truthScope 表述', '工具是只读的'];
  for (const id of PRESET_IDS) {
    const prompt = await readFile(new URL(`${id}/runtime/system.md`, presetsRoot), 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(prompt, pattern, `${id} prompt must not leak DSH internals or machine paths`);
    assert.ok(prompt.length > 40, `${id} prompt should carry real persona content`);
    // card-designer 尚未接入产品入口（Sprint 4），暂不强制分层；lore/free 必须干净。
    if (id === 'card-designer') continue;
    for (const phrase of layer1) assert.ok(!prompt.includes(phrase), `${id} 不得重复第 1 层：${phrase}`);
    for (const phrase of layer3) assert.ok(!prompt.includes(phrase), `${id} 不得重复第 3 层：${phrase}`);
  }

  const lore = await readFile(new URL('lore-writer/runtime/system.md', presetsRoot), 'utf8');
  for (const keyword of ['结构化设定写作伙伴', 'canon', 'proposed', 'unknown']) assert.ok(lore.includes(keyword), `lore-writer prompt should keep ${keyword}`);
  assert.doesNotMatch(lore, /不得修改、否定或悄悄补完 canon/, '禁写 canon 的禁令属于入口契约层，不在 preset 层重复');

  const free = await readFile(new URL('free-creator/runtime/system.md', presetsRoot), 'utf8');
  for (const keyword of ['自由创作伙伴']) assert.ok(free.includes(keyword), `free-creator prompt should keep ${keyword}`);
  assert.doesNotMatch(free, /工具/, '工具协议属于入口契约层，不在 preset 层重复');

  const card = await readFile(new URL('card-designer/runtime/system.md', presetsRoot), 'utf8');
  for (const keyword of ['untested', 'proposed', '开放问题', '原创']) assert.ok(card.includes(keyword), `card-designer prompt should keep ${keyword}`);
  assert.doesNotMatch(card, /(?<!不得声称任何数值)已平衡/, 'card-designer 只能以否定形式提到平衡');
});
