// WorldForge 产品侧 Agent Profile Registry（Sprint 1）。
//
// 职责：从固定根目录发现随仓库/镜像发布的 preset 产品投影，严格校验清单，
// 安全解析 prompt 路径，计算确定性指纹，并返回冻结的只读快照。
//
// 边界（ADR-0029 §1）：
// - 只读 worldforge.runtime.json 与其声明的 runtime/system.md；
// - 永不读取、解析或执行 agent.cordis.yml、preset.yml、skills/、!!js 或任何 DSH 插件；
// - 不扫描 ~/.dsh 用户 preset 目录；不接受绝对路径、`..` 穿越或符号链接逃逸；
// - 不引入第三方依赖；校验器只实现 agent-runtime.schema.json 实际使用的关键字。
//
// 错误：所有拒绝都以 AgentProfileError 抛出，error.code 取自
// agent-profile-contract.mjs 的 AGENT_PROFILE_ERROR_CODES。

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_PRESETS_DIRECTORY, AGENT_PROMPT_MAX_CHARS, AGENT_RUNTIME_MANIFEST, AGENT_RUNTIME_SCHEMA_VERSION, AGENT_SURFACES, AGENT_SURFACE_COMPATIBILITY } from './agent-profile-contract.mjs';

const moduleRoot = fileURLToPath(new URL('.', import.meta.url));

/** 部署副本：镜像不含 docs/，因此在仓库根保留一份内容完全一致的本文件由测试比对。 */
export const AGENT_RUNTIME_SCHEMA_PATH = resolve(moduleRoot, 'agent-runtime.schema.json');

/** 默认根目录：相对本模块定位，因此仓库移动或容器挂载都不需要改写路径。 */
export const AGENT_PRESETS_ROOT = resolve(moduleRoot, AGENT_PRESETS_DIRECTORY);

/** 允许覆盖根目录的环境变量，供测试与运维指向只读快照目录。 */
export const AGENT_PRESETS_ROOT_ENV = 'WORLDFORGE_AGENT_PRESETS_DIR';

/** 清单文本长度上限，防止超大 JSON 拖垮启动。 */
const MANIFEST_MAX_CHARS = 8192;

export class AgentProfileError extends Error {
  constructor(code, message, details = []) {
    super(`${code}: ${message}`);
    this.name = 'AgentProfileError';
    this.code = code;
    this.details = details;
  }
}

// ── 最小 JSON Schema 校验器 ─────────────────────────────────────────────────
// 只实现根 Schema 实际使用的关键字；遇到未支持的关键字直接失败，避免"看起来
// 校验通过"的静默降级。

function isSchemaType(value, type) {
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return false;
}

function equalJson(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => equalJson(item, right[index]));
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left), rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) && equalJson(left[key], right[key]));
  }
  return false;
}

function validateNode(spec, value, path, errors) {
  if (spec.type !== undefined && !isSchemaType(value, spec.type)) {
    errors.push({ path, keyword: 'type', message: `${path}: 应为 ${spec.type}` });
    return;
  }
  if (spec.const !== undefined && !equalJson(value, spec.const)) errors.push({ path, keyword: 'const', message: `${path}: 必须等于 ${JSON.stringify(spec.const)}` });
  if (spec.enum !== undefined && !spec.enum.some(item => equalJson(item, value))) errors.push({ path, keyword: 'enum', message: `${path}: ${JSON.stringify(value)} 不是已登记枚举值` });
  if (typeof value === 'string') {
    if (spec.minLength !== undefined && value.length < spec.minLength) errors.push({ path, keyword: 'minLength', message: `${path}: 长度小于 ${spec.minLength}` });
    if (spec.maxLength !== undefined && value.length > spec.maxLength) errors.push({ path, keyword: 'maxLength', message: `${path}: 长度超过 ${spec.maxLength}` });
    if (spec.pattern !== undefined && !new RegExp(spec.pattern).test(value)) errors.push({ path, keyword: 'pattern', message: `${path}: 不符合格式要求` });
  }
  if (Array.isArray(value)) {
    if (spec.minItems !== undefined && value.length < spec.minItems) errors.push({ path, keyword: 'minItems', message: `${path}: 少于 ${spec.minItems} 项` });
    if (spec.maxItems !== undefined && value.length > spec.maxItems) errors.push({ path, keyword: 'maxItems', message: `${path}: 多于 ${spec.maxItems} 项` });
    if (spec.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) errors.push({ path, keyword: 'uniqueItems', message: `${path}: 存在重复项` });
    if (spec.items !== undefined) value.forEach((item, index) => validateNode(spec.items, item, `${path}[${index}]`, errors));
  }
  if (spec.not !== undefined) {
    const scratch = [];
    validateNode(spec.not, value, path, scratch);
    if (scratch.length === 0) errors.push({ path, keyword: 'not', message: `${path}: 命中禁止的取值` });
  }
  if (spec.anyOf !== undefined) {
    const matched = spec.anyOf.some(branch => { const scratch = []; validateNode(branch, value, path, scratch); return scratch.length === 0; });
    if (!matched) errors.push({ path, keyword: 'anyOf', message: `${path}: 不满足 anyOf 任一分支` });
  }
  if (isSchemaType(value, 'object')) {
    for (const key of spec.required || []) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push({ path, keyword: 'required', message: `${path}: 缺少必填字段 ${key}` });
    for (const [key, item] of Object.entries(value)) {
      if (spec.properties && Object.prototype.hasOwnProperty.call(spec.properties, key)) validateNode(spec.properties[key], item, `${path}.${key}`, errors);
      else if (spec.additionalProperties === false) errors.push({ path: `${path}.${key}`, keyword: 'additionalProperties', message: `${path}.${key}: 不允许的额外字段` });
    }
  }
  if (spec.contains !== undefined && Array.isArray(value)) {
    const matched = value.some(item => { const scratch = []; validateNode(spec.contains, item, path, scratch); return scratch.length === 0; });
    if (!matched) errors.push({ path, keyword: 'contains', message: `${path}: 没有任何一项满足 contains` });
  }
  if (spec.if !== undefined) {
    const scratch = [];
    validateNode(spec.if, value, path, scratch);
    if (scratch.length === 0) validateNode(spec.then ?? {}, value, path, errors);
  }
  for (const branch of spec.allOf || []) validateNode(branch, value, path, errors);
}

/**
 * 逐字段错误码映射（ADR-0029 §9）。
 * 结构与枚举类缺陷必须落回它们自己的错误码，不能因为"Schema 报错"就一律归到 ENUM：
 * - `systemPrompt` 的路径形态问题属于 MANIFEST_INVALID（路径安全性由解析层报 PATH_UNSAFE）；
 * - `surfaces` 元素与各枚举字段才是 ENUM_UNKNOWN；
 * - 条件分支（allOf/if/then）表达的是兼容矩阵，命中即 COMPAT_MISMATCH。
 */
const FIELD_ERROR_CODES = {
  schemaVersion: 'AGENT_MANIFEST_INVALID',
  id: 'AGENT_MANIFEST_INVALID',
  version: 'AGENT_MANIFEST_INVALID',
  displayName: 'AGENT_MANIFEST_INVALID',
  description: 'AGENT_MANIFEST_INVALID',
  surfaces: 'AGENT_ENUM_UNKNOWN',
  mode: 'AGENT_ENUM_UNKNOWN',
  toolPolicy: 'AGENT_ENUM_UNKNOWN',
  outputContract: 'AGENT_ENUM_UNKNOWN',
  statusPolicy: 'AGENT_ENUM_UNKNOWN',
  systemPrompt: 'AGENT_MANIFEST_INVALID'
};

function classifyManifestError(error) {
  // 必填字段缺失与对象类型错误属于清单结构问题，路径里没有可用的字段名。
  if (error.keyword === 'required' || error.path === '$' || error.keyword === 'type') return 'AGENT_MANIFEST_INVALID';
  const field = error.path.replace(/^\$\.?/, '').split(/[.[]/)[0];
  // schemaVersion 的 `const` 是结构版本约束，不是兼容矩阵分支。
  if (field === 'schemaVersion') return 'AGENT_MANIFEST_INVALID';
  if (error.keyword === 'const' || error.keyword === 'contains') return 'AGENT_COMPAT_MISMATCH';
  return FIELD_ERROR_CODES[field] ?? 'AGENT_MANIFEST_INVALID';
}

/** 把逐条错误合并成单一稳定错误码：兼容矩阵 > 枚举 > 其余结构问题。 */
function pickErrorCode(errors) {
  const codes = errors.map(classifyManifestError);
  if (codes.includes('AGENT_COMPAT_MISMATCH')) return 'AGENT_COMPAT_MISMATCH';
  if (codes.includes('AGENT_ENUM_UNKNOWN')) return 'AGENT_ENUM_UNKNOWN';
  return 'AGENT_MANIFEST_INVALID';
}

/** 只保留根 Schema 的字段级约束，跳过表达兼容矩阵的 allOf/if/then/contains。 */
function baseFieldSpecs(schema) {
  const specs = new Map();
  for (const [key, spec] of Object.entries(schema.properties || {})) {
    const { if: _if, then: _then, contains: _contains, allOf: _allOf, ...base } = spec;
    specs.set(key, base);
  }
  return specs;
}

function createSchemaValidator(schema) {
  const supported = new Set(['$schema', '$id', 'title', 'description', 'type', 'const', 'enum', 'pattern', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'items', 'required', 'properties', 'additionalProperties', 'allOf', 'if', 'then', 'contains', 'not', 'anyOf']);
  const unsupported = [];
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties') { for (const [name, sub] of Object.entries(value)) walk(sub, `${path}.properties.${name}`); continue; }
      if (['items', 'not', 'contains', 'if', 'then'].includes(key)) { walk(value, `${path}.${key}`); continue; }
      if (['allOf', 'anyOf'].includes(key)) { value.forEach((sub, index) => walk(sub, `${path}.${key}[${index}]`)); continue; }
      if (!supported.has(key)) unsupported.push(`${path}.${key}`);
    }
  };
  walk(schema, '$');
  const evaluate = value => { const errors = []; validateNode(schema, value, '$', errors); return errors; };
  const evaluateBase = value => {
    const errors = [];
    if (isSchemaType(value, 'object')) {
      for (const key of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push({ path: `$.${key}`, keyword: 'required', message: `$: 缺少必填字段 ${key}` });
      const specs = baseFieldSpecs(schema);
      for (const [key, item] of Object.entries(value)) {
        if (specs.has(key)) validateNode(specs.get(key), item, `$.${key}`, errors);
        else if (schema.additionalProperties === false) errors.push({ path: `$.${key}`, keyword: 'additionalProperties', message: `$.${key}: 不允许的额外字段` });
      }
      return errors;
    }
    if (schema.type !== undefined) validateNode({ type: schema.type }, value, '$', errors);
    return errors;
  };
  return { evaluate, evaluateBase, unsupported };
}

let cachedSchema = null;
async function loadRuntimeSchema() {
  if (cachedSchema) return cachedSchema;
  let source;
  try { source = await readFile(AGENT_RUNTIME_SCHEMA_PATH, 'utf8'); }
  catch (error) { throw new AgentProfileError('AGENT_MANIFEST_INVALID', `无法读取 agent-runtime.schema.json：${error.message}`); }
  let schema;
  try { schema = JSON.parse(source); }
  catch (error) { throw new AgentProfileError('AGENT_MANIFEST_INVALID', `agent-runtime.schema.json 不是有效 JSON：${error.message}`); }
  const validator = createSchemaValidator(schema);
  if (validator.unsupported.length) throw new AgentProfileError('AGENT_MANIFEST_INVALID', `校验器不支持 Schema 中的关键字：${validator.unsupported.join('、')}`);
  cachedSchema = validator;
  return cachedSchema;
}

/** 递归冻结纯数据，保证只读快照不能通过嵌套数组或对象被改写。 */
export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

// ── 确定性 JSON 与指纹 ──────────────────────────────────────────────────────

/** 稳定序列化：对象键按字典序排序，数组保持顺序。 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sha256(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * 计算 profile 指纹：manifest 规范化文本与 systemPrompt 文本各自哈希后合成。
 * 同内容必得同哈希；manifest 或 prompt 任一改动必变。
 */
export function profileFingerprint(manifest, systemPrompt) {
  return {
    manifestHash: sha256(stableStringify(manifest)),
    systemPromptHash: sha256(systemPrompt),
    hash: sha256(`${stableStringify(manifest)}\u0000${systemPrompt}`)
  };
}

// ── 校验与安全路径 ──────────────────────────────────────────────────────────

/**
 * 严格校验投影清单。返回规范化后的清单对象（只保留已登记字段）。
 * @param {unknown} value 解析后的 manifest
 * @param {string} directoryId 所在目录名，必须与 manifest.id 一致
 */
export async function validateAgentRuntimeManifest(value, directoryId) {
  if (directoryId !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new AgentProfileError('AGENT_MANIFEST_INVALID', `${directoryId}/manifest 必须是 JSON 对象`);
  }
  const validator = await loadRuntimeSchema();
  // 两遍：字段级缺陷按字段映射错误码，兼容矩阵分支单独归类，避免一律归到 ENUM。
  const baseErrors = validator.evaluateBase(value);
  if (baseErrors.length) throw new AgentProfileError(pickErrorCode(baseErrors), baseErrors.map(error => error.message).join('；'), baseErrors.map(error => error.message));
  const conditionalErrors = validator.evaluate(value).filter(error => classifyManifestError(error) === 'AGENT_COMPAT_MISMATCH');
  if (conditionalErrors.length) throw new AgentProfileError('AGENT_COMPAT_MISMATCH', conditionalErrors.map(error => error.message).join('；'), conditionalErrors.map(error => error.message));
  const manifest = value;
  if (directoryId !== undefined && manifest.id !== directoryId) throw new AgentProfileError('AGENT_ID_MISMATCH', `manifest id「${manifest.id}」与目录名「${directoryId}」不一致`);
  return manifest;
}

/**
 * 校验 manifest 声明的每个 surface 都落在兼容矩阵内。
 * 单行组合由 Schema 的 allOf 分支保证；多行组合在此逐行校验。
 * surfaces 元素本身必须已是登记值（Schema 保证），因此这里只报兼容性问题。
 */
export function assertSurfaceCompatibility(manifest) {
  for (const surface of manifest.surfaces) {
    const expected = AGENT_SURFACE_COMPATIBILITY[surface];
    if (!expected) throw new AgentProfileError('AGENT_ENUM_UNKNOWN', `未登记的 surface：${surface}`);
    const mismatch = expected.mode !== manifest.mode || expected.outputContract !== manifest.outputContract || expected.toolPolicy !== manifest.toolPolicy || expected.statusPolicy !== manifest.statusPolicy;
    if (mismatch) {
      throw new AgentProfileError('AGENT_COMPAT_MISMATCH', `${surface} 需要 mode=${expected.mode}、outputContract=${expected.outputContract}、toolPolicy=${expected.toolPolicy}、statusPolicy=${expected.statusPolicy}，实际为 mode=${manifest.mode}、outputContract=${manifest.outputContract}、toolPolicy=${manifest.toolPolicy}、statusPolicy=${manifest.statusPolicy}`);
    }
  }
  return manifest;
}

function isInsideRoot(target, root) {
  const rel = relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..');
}

/**
 * 从一个可信目录出发，逐段确认目标路径的**真实路径**仍在 preset 目录内。
 * 这一条覆盖符号链接目录、符号链接文件以及中间目录链接三种逃逸形态：
 * 无论哪一段是链接，合并后的 realpath 都会离开 preset 目录。
 */
async function assertRealPathInside(target, presetReal, label) {
  let targetReal;
  try { targetReal = await realpath(target); }
  catch (error) { throw new AgentProfileError('AGENT_PROMPT_MISSING', `无法解析${label}路径：${error.message}`); }
  if (!isInsideRoot(targetReal, presetReal)) throw new AgentProfileError('AGENT_PROMPT_PATH_UNSAFE', `${label}经符号链接逃出 preset 目录：${target}`);
  return targetReal;
}

/**
 * 安全解析 prompt 路径：拒绝绝对路径、`..` 穿越与符号链接逃逸，只接受 preset 目录内的普通文件。
 * 目录自身与其祖先链也必须是 preset 目录内的真实目录。
 * @returns {Promise<{ path: string, relativePath: string, text: string }>}
 */
export async function resolveAgentPromptPath(presetDirectory, systemPrompt) {
  if (typeof systemPrompt !== 'string' || !systemPrompt.trim()) throw new AgentProfileError('AGENT_PROMPT_PATH_UNSAFE', 'systemPrompt 不能为空');
  if (isAbsolute(systemPrompt) || /^[A-Za-z]:/.test(systemPrompt) || systemPrompt.startsWith('\\')) {
    throw new AgentProfileError('AGENT_PROMPT_PATH_UNSAFE', `systemPrompt 不能是绝对路径：${systemPrompt}`);
  }
  const segments = systemPrompt.split(/[\\/]+/).filter(Boolean);
  if (!segments.length || segments.includes('..')) throw new AgentProfileError('AGENT_PROMPT_PATH_UNSAFE', `systemPrompt 不能包含路径穿越：${systemPrompt}`);

  let presetReal;
  try { presetReal = await realpath(presetDirectory); }
  catch (error) { throw new AgentProfileError('AGENT_PROMPT_PATH_UNSAFE', `无法解析 preset 目录：${error.message}`); }

  const target = resolve(presetReal, ...segments);
  if (!isInsideRoot(target, presetReal)) throw new AgentProfileError('AGENT_PROMPT_PATH_UNSAFE', `systemPrompt 逃出 preset 目录：${systemPrompt}`);

  // 逐段检查：任何一段（含中间目录）是符号链接即拒绝，避免出现有竞态的"只查最后一段"。
  let cursor = presetReal;
  for (const [index, segment] of segments.entries()) {
    cursor = resolve(cursor, segment);
    const info = await lstatOrNull(cursor);
    if (!info) throw new AgentProfileError('AGENT_PROMPT_MISSING', `prompt 路径不存在：${segments.slice(0, index + 1).join('/')}`);
    if (info.isSymbolicLink()) throw new AgentProfileError('AGENT_PROMPT_PATH_UNSAFE', `prompt 路径经符号链接：${segments.slice(0, index + 1).join('/')}`);
  }
  const targetReal = await assertRealPathInside(target, presetReal, 'prompt 文件');

  const info = await stat(targetReal);
  if (!info.isFile()) throw new AgentProfileError('AGENT_PROMPT_MISSING', `prompt 不是普通文件：${systemPrompt}`);
  if (info.size > AGENT_PROMPT_MAX_CHARS * 4) throw new AgentProfileError('AGENT_PROMPT_TOO_LARGE', `prompt 文件超过长度上限：${systemPrompt}`);

  const bytes = await readFile(targetReal);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new AgentProfileError('AGENT_PROMPT_MISSING', `prompt 不是有效 UTF-8 文本：${systemPrompt}`); }
  if (text.includes('\u0000')) throw new AgentProfileError('AGENT_PROMPT_MISSING', `prompt 含 NUL 字节：${systemPrompt}`);
  if (text.length > AGENT_PROMPT_MAX_CHARS) throw new AgentProfileError('AGENT_PROMPT_TOO_LARGE', `prompt 超过 ${AGENT_PROMPT_MAX_CHARS} 字符：${systemPrompt}`);

  return { path: targetReal, relativePath: segments.join('/'), text };
}

async function lstatOrNull(target) {
  try { return await lstat(target); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
}

// ── 浏览器安全投影 ──────────────────────────────────────────────────────────

/**
 * 生成浏览器可见的脱敏元数据：不含 prompt 正文、文件路径、DSH 插件明细或工具策略内部值。
 */
export function publicAgentProfile(profile) {
  return {
    id: profile.id,
    version: profile.version,
    displayName: profile.displayName,
    description: profile.description,
    surfaces: [...profile.surfaces],
    mode: profile.mode,
    outputContract: profile.outputContract,
    statusPolicy: profile.statusPolicy,
    hash: profile.hash
  };
}

// ── 加载 ────────────────────────────────────────────────────────────────────

/** 固定根目录：显式参数 > 环境变量 > 仓库/镜像内 `.agent-presets`。 */
export function agentPresetsRoot(override) {
  const candidate = override ?? process.env[AGENT_PRESETS_ROOT_ENV] ?? AGENT_PRESETS_ROOT;
  return resolve(candidate);
}

async function listPresetDirectories(root) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { throw new AgentProfileError('AGENT_ROOT_UNREADABLE', `无法读取 preset 根目录 ${root}：${error.message}`); }
  const names = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    // preset 目录本身也不能是符号链接：否则可以指向根目录之外的任意目录。
    if (entry.isSymbolicLink()) throw new AgentProfileError('AGENT_PROMPT_PATH_UNSAFE', `preset 目录不能是符号链接：${entry.name}`);
    names.push(entry.name);
  }
  return names.sort();
}

/** 读取 manifest 文件，并确认 preset 目录与 manifest 文件的真实路径都在根目录内。 */
async function loadManifestFile(root, directory, directoryId) {
  let rootReal, directoryReal;
  try { rootReal = await realpath(root); }
  catch (error) { throw new AgentProfileError('AGENT_ROOT_UNREADABLE', `无法解析 preset 根目录 ${root}：${error.message}`); }
  try { directoryReal = await realpath(directory); }
  catch (error) { throw new AgentProfileError('AGENT_PROMPT_PATH_UNSAFE', `无法解析 preset 目录 ${directoryId}：${error.message}`); }
  if (!isInsideRoot(directoryReal, rootReal)) throw new AgentProfileError('AGENT_PROMPT_PATH_UNSAFE', `preset 目录经符号链接逃出根目录：${directoryId}`);

  const manifestPath = resolve(directory, AGENT_RUNTIME_MANIFEST);
  const manifestInfo = await lstatOrNull(manifestPath);
  if (!manifestInfo) throw new AgentProfileError('AGENT_MANIFEST_UNREADABLE', `${directoryId} 缺少 ${AGENT_RUNTIME_MANIFEST}`);
  if (manifestInfo.isSymbolicLink()) throw new AgentProfileError('AGENT_PROMPT_PATH_UNSAFE', `${directoryId}/${AGENT_RUNTIME_MANIFEST} 不能是符号链接`);
  let manifestReal;
  try { manifestReal = await realpath(manifestPath); }
  catch (error) { throw new AgentProfileError('AGENT_MANIFEST_UNREADABLE', `无法解析 ${directoryId}/${AGENT_RUNTIME_MANIFEST}：${error.message}`); }
  if (!isInsideRoot(manifestReal, rootReal)) throw new AgentProfileError('AGENT_PROMPT_PATH_UNSAFE', `${directoryId}/${AGENT_RUNTIME_MANIFEST} 经符号链接逃出根目录`);

  let raw;
  try { raw = await readFile(manifestReal, 'utf8'); }
  catch (error) { throw new AgentProfileError('AGENT_MANIFEST_UNREADABLE', `无法读取 ${directoryId}/${AGENT_RUNTIME_MANIFEST}：${error.message}`); }
  if (raw.length > MANIFEST_MAX_CHARS) throw new AgentProfileError('AGENT_MANIFEST_INVALID', `${directoryId}/${AGENT_RUNTIME_MANIFEST} 超过 ${MANIFEST_MAX_CHARS} 字符`);
  if (raw.includes('\u0000')) throw new AgentProfileError('AGENT_MANIFEST_INVALID', `${directoryId}/${AGENT_RUNTIME_MANIFEST} 含 NUL 字节`);
  let value;
  try { value = JSON.parse(raw); }
  catch (error) { throw new AgentProfileError('AGENT_MANIFEST_UNREADABLE', `${directoryId}/${AGENT_RUNTIME_MANIFEST} 不是有效 JSON：${error.message}`); }
  return value;
}

async function loadProfile(root, directoryId) {
  const directory = resolve(root, directoryId);
  const manifest = assertSurfaceCompatibility(await validateAgentRuntimeManifest(await loadManifestFile(root, directory, directoryId), directoryId));
  const prompt = await resolveAgentPromptPath(directory, manifest.systemPrompt);
  const fingerprint = profileFingerprint(manifest, prompt.text);
  // 深度冻结：manifest 与其嵌套数组也必须只读，否则可以通过 manifest.surfaces 改写快照。
  return deepFreeze({
    id: manifest.id,
    version: manifest.version,
    displayName: manifest.displayName,
    description: manifest.description,
    surfaces: [...manifest.surfaces],
    mode: manifest.mode,
    toolPolicy: manifest.toolPolicy,
    outputContract: manifest.outputContract,
    statusPolicy: manifest.statusPolicy,
    schemaVersion: manifest.schemaVersion,
    directory,
    manifest: structuredClone(manifest),
    systemPrompt: prompt.text,
    systemPromptPath: prompt.relativePath,
    manifestHash: fingerprint.manifestHash,
    systemPromptHash: fingerprint.systemPromptHash,
    hash: fingerprint.hash
  });
}

/**
 * 扫描固定根目录并返回冻结的只读 Registry。
 *
 * 启动语义（ADR-0029 §9 与计划 §12.1）：任何无效、损坏、重复或不兼容的 preset，
 * 以及**任一 surface 缺少可用 preset**，都会让本函数抛出 AgentProfileError，调用方
 * 应拒绝启动并打印诊断，而不是跳过或静默换用其他 persona。失败是 fail-fast 的：
 * 抛出即代表整个 Registry 不可用，因此 summary.diagnostics 在成功路径上恒为空数组。
 *
 * @param {string} [rootOverride] 固定根目录；缺省取环境变量或仓库内 `.agent-presets`
 */
export async function loadAgentProfiles(rootOverride) {
  const root = agentPresetsRoot(rootOverride);
  const directoryIds = await listPresetDirectories(root);
  if (!directoryIds.length) throw new AgentProfileError('AGENT_ROOT_UNREADABLE', `preset 根目录 ${root} 内没有任何 preset`);

  const profiles = [];
  const diagnostics = [];
  const seen = new Map();
  for (const directoryId of directoryIds) {
    const profile = await loadProfile(root, directoryId);
    if (seen.has(profile.id)) throw new AgentProfileError('AGENT_ID_MISMATCH', `preset id 重复：${profile.id}（${seen.get(profile.id)} 与 ${directoryId}）`);
    seen.set(profile.id, directoryId);
    profiles.push(profile);
  }
  profiles.sort((left, right) => left.id.localeCompare(right.id));

  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  // 完整性门依据契约里登记的 surface 列表，而不是已加载 profile 的 key，
  // 这样即使清单被篡改也不会漏掉某个入口。缺少任意一个就拒绝启动——
  // 这等价于「删除默认 preset 时服务拒绝启动」，而不是把该入口降级为 null。
  const defaults = {};
  for (const surface of AGENT_SURFACES) defaults[surface] = profiles.find(profile => profile.surfaces.includes(surface))?.id ?? null;
  const uncovered = AGENT_SURFACES.filter(surface => defaults[surface] === null);
  if (uncovered.length) {
    throw new AgentProfileError('AGENT_PROFILE_UNKNOWN', `入口 ${uncovered.join('、')} 没有可用的 preset；已加载 ${profiles.map(profile => profile.id).join('、') || '（空）'}`);
  }
  Object.freeze(defaults);

  const countBySurface = Object.freeze(Object.fromEntries(AGENT_SURFACES.map(surface => [surface, profiles.filter(profile => profile.surfaces.includes(surface)).length])));
  const summary = Object.freeze({ count: profiles.length, countBySurface, diagnostics: Object.freeze(diagnostics), root });
  const registry = {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    profiles: Object.freeze(profiles),
    summary,
    defaults,
    get: id => byId.get(id) ?? null,
    profilesForSurface: surface => {
      if (!(surface in AGENT_SURFACE_COMPATIBILITY)) throw new AgentProfileError('AGENT_PROFILE_INCOMPATIBLE', `未登记的 surface：${surface}`);
      return profiles.filter(profile => profile.surfaces.includes(surface));
    },
    resolve: (id, surface) => {
      if (!id) throw new AgentProfileError('AGENT_PROFILE_UNKNOWN', '缺少 presetId');
      const profile = byId.get(id);
      if (!profile) throw new AgentProfileError('AGENT_PROFILE_UNKNOWN', `未找到 preset：${id}`);
      if (surface !== undefined && !profile.surfaces.includes(surface)) {
        throw new AgentProfileError('AGENT_PROFILE_INCOMPATIBLE', `preset ${id} 不支持入口 ${surface}；它只服务 ${profile.surfaces.join('、')}`);
      }
      return profile;
    }
  };
  return Object.freeze(registry);
}

/** 供 `/api/ai/presets` 与 `/api/health` 使用的脱敏快照。 */
export function publicRegistryView(registry) {
  return {
    schemaVersion: registry.schemaVersion,
    presets: registry.profiles.map(publicAgentProfile),
    defaults: registry.defaults
  };
}

/** 供 `/api/health` 使用的摘要：只有数量与诊断码，不含正文。 */
export function registryHealthSummary(registry) {
  return {
    schemaVersion: registry.schemaVersion,
    count: registry.summary.count,
    countBySurface: registry.summary.countBySurface,
    ids: registry.profiles.map(profile => profile.id),
    diagnostics: registry.summary.diagnostics.map(item => ({ code: item.code, message: item.message }))
  };
}

/** 把未知异常规范化为 AgentProfileError，保证诊断总是带稳定错误码。 */
export function asAgentProfileError(error) {
  if (error instanceof AgentProfileError) return error;
  return new AgentProfileError('AGENT_MANIFEST_INVALID', String(error?.message || error));
}
