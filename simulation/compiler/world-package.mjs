import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const WORLD_PACKAGE_FORMAT_VERSION = 1;
export const WORLD_PACKAGE_COMPILER_VERSION = '0.1.0';

const ID_PATTERN = /^(?:W\d{2}|[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)$/;
const WORLD_ID_PATTERN = /^W\d{2}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
const STATUSES = new Set(['canon', 'proposed', 'deprecated']);
const TRUTH_SCOPES = new Set(['objective', 'in_world_belief', 'unknown']);

export class WorldPackageCompileError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorldPackageCompileError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new WorldPackageCompileError(code, message, details);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, field, pattern) {
  if (typeof value !== 'string' || !value.trim() || (pattern && !pattern.test(value))) {
    fail('INVALID_MANIFEST', `${field} 格式无效`, { field });
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function packageHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function validateManifest(manifest) {
  if (!plainObject(manifest)) fail('INVALID_MANIFEST', '发布清单必须是 JSON 对象');
  if (manifest.manifestVersion !== 1) fail('INVALID_MANIFEST', '仅支持 manifestVersion 1');
  requireString(manifest.worldId, 'worldId', WORLD_ID_PATTERN);
  requireString(manifest.definitionVersion, 'definitionVersion', VERSION_PATTERN);
  requireString(manifest.sourceCommit, 'sourceCommit', COMMIT_PATTERN);
  if (manifest.compilerVersion !== WORLD_PACKAGE_COMPILER_VERSION) {
    fail('COMPILER_VERSION_MISMATCH', `清单要求编译器 ${manifest.compilerVersion}，当前为 ${WORLD_PACKAGE_COMPILER_VERSION}`);
  }
  if (!plainObject(manifest.selection) || manifest.selection.defaultStatus !== 'canon') {
    fail('INVALID_MANIFEST', 'selection.defaultStatus 必须为 canon');
  }
  if (!Array.isArray(manifest.selection.experimentalIncludes)) {
    fail('INVALID_MANIFEST', 'selection.experimentalIncludes 必须是数组');
  }
  if (!Array.isArray(manifest.contentSources) || manifest.contentSources.length === 0) {
    fail('INVALID_MANIFEST', 'contentSources 至少需要一个 JSON 内容源');
  }
  if (!plainObject(manifest.mechanics) || !Array.isArray(manifest.mechanics.modules)) {
    fail('INVALID_MANIFEST', 'mechanics.modules 必须是数组');
  }
  if (!plainObject(manifest.initialState)) fail('INVALID_MANIFEST', 'initialState 必须是对象');
  for (const key of ['regions', 'entities', 'events']) {
    if (!Array.isArray(manifest.initialState[key])) fail('INVALID_MANIFEST', `initialState.${key} 必须是数组`);
  }
}

function validateContentEntry(entry, worldId) {
  if (!plainObject(entry)) fail('INVALID_CONTENT', '内容条目必须是对象');
  requireString(entry.id, 'entry.id', ID_PATTERN);
  requireString(entry.title, `${entry.id}.title`);
  requireString(entry.type, `${entry.id}.type`);
  if (!STATUSES.has(entry.status)) fail('INVALID_CONTENT', `${entry.id} 的 status 无效`);
  if (!TRUTH_SCOPES.has(entry.truthScope)) fail('INVALID_CONTENT', `${entry.id} 的 truthScope 无效`);
  if (entry.worldId !== worldId && entry.worldId !== 'UNIVERSE') {
    fail('WORLD_BOUNDARY', `${entry.id} 不属于 ${worldId}`, { id: entry.id, worldId: entry.worldId });
  }
  if (!Array.isArray(entry.refs)) fail('INVALID_CONTENT', `${entry.id}.refs 必须是数组`);
  if (new Set(entry.refs).size !== entry.refs.length || entry.refs.some(ref => typeof ref !== 'string' || !ID_PATTERN.test(ref))) {
    fail('INVALID_CONTENT', `${entry.id}.refs 包含重复或非法 ID`);
  }
  if (!plainObject(entry.payload)) fail('INVALID_CONTENT', `${entry.id}.payload 必须是对象`);
}

function collectEntries(contentSources, worldId) {
  const entries = [];
  const ids = new Set();
  for (const source of contentSources) {
    if (!plainObject(source) || source.sourceVersion !== 1 || !Array.isArray(source.entries)) {
      fail('INVALID_CONTENT', '内容源必须使用 sourceVersion 1 并包含 entries 数组');
    }
    for (const entry of source.entries) {
      validateContentEntry(entry, worldId);
      if (ids.has(entry.id)) fail('DUPLICATE_ID', `内容 ID 重复：${entry.id}`, { id: entry.id });
      ids.add(entry.id);
      entries.push(structuredClone(entry));
    }
  }
  return entries;
}

function selectEntries(entries, experimentalIncludes) {
  const requested = new Set(experimentalIncludes);
  if (requested.size !== experimentalIncludes.length) fail('INVALID_MANIFEST', 'experimentalIncludes 包含重复 ID');
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  for (const id of requested) {
    const entry = byId.get(id);
    if (!entry) fail('MISSING_EXPERIMENTAL_ENTRY', `实验条目不存在：${id}`, { id });
    if (entry.status !== 'proposed') fail('INVALID_EXPERIMENTAL_ENTRY', `实验清单只能显式加入 proposed 条目：${id}`, { id });
  }

  const selected = entries.filter(entry => entry.status === 'canon' || requested.has(entry.id));
  const selectedIds = new Set(selected.map(entry => entry.id));
  for (const entry of selected) {
    for (const ref of entry.refs) {
      if (!selectedIds.has(ref)) fail('MISSING_REFERENCE', `${entry.id} 引用了未发布条目 ${ref}`, { id: entry.id, ref });
    }
  }
  return selected;
}

function validateJsonSchemaValue(schema, value, path) {
  if (!plainObject(schema)) fail('INVALID_MECHANIC_SCHEMA', `${path} 的参数 Schema 无效`);
  if (schema.type === 'object') {
    if (!plainObject(value)) fail('INVALID_MECHANIC_PARAMETERS', `${path} 必须是对象`);
    const properties = plainObject(schema.properties) ? schema.properties : {};
    for (const key of schema.required ?? []) {
      if (!(key in value)) fail('INVALID_MECHANIC_PARAMETERS', `${path}.${key} 为必填参数`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) fail('INVALID_MECHANIC_PARAMETERS', `${path}.${key} 不是允许的参数`);
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (key in value) validateJsonSchemaValue(child, value[key], `${path}.${key}`);
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') fail('INVALID_MECHANIC_PARAMETERS', `${path} 必须是字符串`);
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value)) fail('INVALID_MECHANIC_PARAMETERS', `${path} 必须是整数`);
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('INVALID_MECHANIC_PARAMETERS', `${path} 必须是有限数值`);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') fail('INVALID_MECHANIC_PARAMETERS', `${path} 必须是布尔值`);
  } else {
    fail('INVALID_MECHANIC_SCHEMA', `${path} 使用了首版不支持的 Schema 类型`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) fail('INVALID_MECHANIC_PARAMETERS', `${path} 不在允许枚举中`);
  if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) {
    fail('INVALID_MECHANIC_PARAMETERS', `${path} 小于最小值 ${schema.minimum}`);
  }
  if (typeof value === 'number' && typeof schema.maximum === 'number' && value > schema.maximum) {
    fail('INVALID_MECHANIC_PARAMETERS', `${path} 大于最大值 ${schema.maximum}`);
  }
}

function compileMechanics(manifestMechanics, registry) {
  if (!plainObject(registry) || registry.registryVersion !== manifestMechanics.registryVersion || !Array.isArray(registry.mechanics)) {
    fail('MECHANIC_REGISTRY_MISMATCH', '机制注册表不存在或版本与发布清单不一致');
  }
  const definitions = new Map();
  const actionNamespaces = new Set();
  const effectNamespaces = new Set();
  for (const mechanic of registry.mechanics) {
    requireString(mechanic.id, 'mechanic.id', ID_PATTERN);
    requireString(mechanic.version, `${mechanic.id}.version`, VERSION_PATTERN);
    if (definitions.has(mechanic.id)) fail('DUPLICATE_MECHANIC', `机制 ID 重复：${mechanic.id}`);
    if (!Array.isArray(mechanic.dependencies)) fail('INVALID_MECHANIC', `${mechanic.id}.dependencies 必须是数组`);
    requireString(mechanic.actionNamespace, `${mechanic.id}.actionNamespace`);
    requireString(mechanic.effectNamespace, `${mechanic.id}.effectNamespace`);
    if (actionNamespaces.has(mechanic.actionNamespace)) fail('DUPLICATE_MECHANIC_NAMESPACE', `Action 命名空间重复：${mechanic.actionNamespace}`);
    if (effectNamespaces.has(mechanic.effectNamespace)) fail('DUPLICATE_MECHANIC_NAMESPACE', `Effect 命名空间重复：${mechanic.effectNamespace}`);
    actionNamespaces.add(mechanic.actionNamespace);
    effectNamespaces.add(mechanic.effectNamespace);
    for (const dependency of mechanic.dependencies) {
      if (!plainObject(dependency)) fail('INVALID_MECHANIC', `${mechanic.id}.dependencies 条目必须是对象`);
      requireString(dependency.id, `${mechanic.id}.dependencies.id`, ID_PATTERN);
      requireString(dependency.version, `${mechanic.id}.dependencies.version`, VERSION_PATTERN);
    }
    definitions.set(mechanic.id, mechanic);
  }

  const configured = new Map();
  for (const item of manifestMechanics.modules) {
    if (!plainObject(item)) fail('INVALID_MECHANIC', '机制配置必须是对象');
    requireString(item.id, 'mechanics.modules.id', ID_PATTERN);
    requireString(item.version, `${item.id}.version`, VERSION_PATTERN);
    if (!plainObject(item.parameters)) fail('INVALID_MECHANIC_PARAMETERS', `${item.id}.parameters 必须是对象`);
    const definition = definitions.get(item.id);
    if (!definition) fail('MISSING_MECHANIC', `机制未注册：${item.id}`, { id: item.id });
    if (definition.version !== item.version) fail('MECHANIC_VERSION_MISMATCH', `机制 ${item.id} 需要 ${item.version}，注册表提供 ${definition.version}`);
    if (configured.has(item.id)) fail('DUPLICATE_MECHANIC', `清单重复配置机制：${item.id}`);
    validateJsonSchemaValue(definition.parameterSchema, item.parameters, `mechanics.${item.id}.parameters`);
    configured.set(item.id, { definition, parameters: structuredClone(item.parameters) });
  }

  for (const { definition } of configured.values()) {
    for (const dependency of definition.dependencies) {
      const target = configured.get(dependency.id);
      if (!target) fail('MISSING_MECHANIC_DEPENDENCY', `${definition.id} 缺少依赖 ${dependency.id}`);
      if (target.definition.version !== dependency.version) {
        fail('MECHANIC_DEPENDENCY_VERSION_MISMATCH', `${definition.id} 要求 ${dependency.id}@${dependency.version}`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const ordered = [];
  function visit(id, trail) {
    if (visiting.has(id)) fail('MECHANIC_DEPENDENCY_CYCLE', `机制依赖形成循环：${[...trail, id].join(' -> ')}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const current = configured.get(id);
    for (const dependency of current.definition.dependencies) visit(dependency.id, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
    ordered.push({
      id,
      version: current.definition.version,
      actionNamespace: current.definition.actionNamespace,
      effectNamespace: current.definition.effectNamespace,
      parameters: current.parameters,
      dependencies: structuredClone(current.definition.dependencies)
    });
  }
  for (const id of configured.keys()) visit(id, []);
  return ordered;
}

function compileInitialState(initialState, selectedEntries) {
  const objectiveIds = new Set(selectedEntries.filter(entry => entry.truthScope === 'objective').map(entry => entry.id));
  const seen = new Set();
  const result = {};
  for (const [collection, idField] of [['regions', 'regionId'], ['entities', 'entityId'], ['events', 'eventId']]) {
    result[collection] = initialState[collection].map(item => {
      if (!plainObject(item)) fail('INVALID_INITIAL_STATE', `${collection} 条目必须是对象`);
      requireString(item[idField], `${collection}.${idField}`, ID_PATTERN);
      if (collection === 'regions' && !item[idField].startsWith('LOC-')) fail('INVALID_INITIAL_STATE', `${item[idField]} 不是地区 ID`);
      if (collection === 'events' && !item[idField].startsWith('EVT-')) fail('INVALID_INITIAL_STATE', `${item[idField]} 不是事件 ID`);
      if (seen.has(item[idField])) fail('DUPLICATE_INITIAL_STATE_ID', `初始状态 ID 重复：${item[idField]}`);
      seen.add(item[idField]);
      if (!objectiveIds.has(item.sourceId)) {
        fail('INVALID_INITIAL_STATE_SOURCE', `${item[idField]} 必须引用已发布的 objective 条目`, { sourceId: item.sourceId });
      }
      if ('state' in item && !plainObject(item.state)) fail('INVALID_INITIAL_STATE', `${item[idField]}.state 必须是对象`);
      if (collection === 'events') {
        requireString(item.type, `${item[idField]}.type`);
        if (item.tick != null && (!Number.isInteger(item.tick) || item.tick < 0)) fail('INVALID_INITIAL_STATE', `${item[idField]}.tick 必须是非负整数`);
        if ('payload' in item && !plainObject(item.payload)) fail('INVALID_INITIAL_STATE', `${item[idField]}.payload 必须是对象`);
      }
      return structuredClone(item);
    });
  }
  const regionIds = new Set(result.regions.map(region => region.regionId));
  for (const entity of result.entities) {
    if (entity.regionId != null && !regionIds.has(entity.regionId)) {
      fail('MISSING_INITIAL_REGION', `${entity.entityId} 引用了不存在的地区 ${entity.regionId}`);
    }
  }
  return result;
}

export function compileWorldPackage({ manifest, contentSources, mechanicRegistry }) {
  validateManifest(manifest);
  const entries = collectEntries(contentSources, manifest.worldId);
  const selected = selectEntries(entries, manifest.selection.experimentalIncludes);
  const mechanics = compileMechanics(manifest.mechanics, mechanicRegistry);
  const initialState = compileInitialState(manifest.initialState, selected);

  const definition = {
    formatVersion: WORLD_PACKAGE_FORMAT_VERSION,
    compilerVersion: WORLD_PACKAGE_COMPILER_VERSION,
    worldId: manifest.worldId,
    definitionVersion: manifest.definitionVersion,
    sourceCommit: manifest.sourceCommit,
    experimental: manifest.selection.experimentalIncludes.length > 0,
    experimentalIncludes: [...manifest.selection.experimentalIncludes].sort(),
    content: {
      objectiveDefinitions: selected.filter(entry => entry.truthScope === 'objective'),
      beliefSeeds: selected.filter(entry => entry.truthScope === 'in_world_belief'),
      unresolvedMetadata: selected.filter(entry => entry.truthScope === 'unknown')
    },
    mechanics: {
      registryVersion: manifest.mechanics.registryVersion,
      modules: mechanics
    },
    initialState
  };
  return deepFreeze({ ...definition, packageHash: packageHash(definition) });
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    fail('JSON_READ_ERROR', `无法读取${label}：${path}`, { cause: error.message });
  }
}

function resolveManifestDependency(root, base, dependencyPath, label) {
  if (typeof dependencyPath !== 'string' || !dependencyPath || isAbsolute(dependencyPath)) {
    fail('INVALID_MANIFEST_PATH', `${label}必须是相对 JSON 路径`);
  }
  const target = resolve(base, dependencyPath);
  const fromRoot = relative(root, target);
  if (fromRoot === '..' || fromRoot.startsWith('../') || fromRoot.startsWith('..\\') || isAbsolute(fromRoot)) {
    fail('MANIFEST_PATH_ESCAPE', `${label}超出清单允许目录：${dependencyPath}`);
  }
  return target;
}

export async function compileWorldPackageFile(manifestPath) {
  const absoluteManifestPath = resolve(manifestPath);
  const base = dirname(absoluteManifestPath);
  const allowedRoot = resolve(base, '..');
  const manifest = await readJson(absoluteManifestPath, '发布清单');
  validateManifest(manifest);
  const contentSources = [];
  for (const sourcePath of manifest.contentSources) {
    contentSources.push(await readJson(resolveManifestDependency(allowedRoot, base, sourcePath, '内容源路径'), '内容源'));
  }
  const mechanicRegistry = await readJson(resolveManifestDependency(allowedRoot, base, manifest.mechanics.registry, '机制注册表路径'), '机制注册表');
  return compileWorldPackage({ manifest, contentSources, mechanicRegistry });
}

export async function writeWorldPackageFile(manifestPath, outputPath) {
  const worldPackage = await compileWorldPackageFile(manifestPath);
  const absoluteOutputPath = resolve(outputPath);
  await mkdir(dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(worldPackage, null, 2)}\n`, 'utf8');
  return worldPackage;
}
