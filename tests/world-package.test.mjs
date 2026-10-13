import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  compileWorldPackage,
  compileWorldPackageFile,
  packageHash,
  WorldPackageCompileError
} from '../simulation/compiler/world-package.mjs';
import { createWorldInstanceStore, WorldInstanceError } from '../simulation/storage/instance-store.mjs';

const baseManifest = {
  manifestVersion: 1,
  worldId: 'W01',
  definitionVersion: '0.1.0',
  sourceCommit: 'd8826ba',
  compilerVersion: '0.1.0',
  contentSources: ['content.json'],
  selection: { defaultStatus: 'canon', experimentalIncludes: [] },
  mechanics: { registry: 'mechanics.json', registryVersion: '0.1.0', modules: [] },
  initialState: { regions: [], entities: [], events: [] }
};

const baseEntries = [
  { id: 'W01', title: '测试世界', status: 'canon', truthScope: 'objective', worldId: 'W01', type: 'world', refs: [], payload: {} },
  { id: 'FAC-W01-001', title: '公开势力', status: 'canon', truthScope: 'in_world_belief', worldId: 'W01', type: 'faction', refs: ['W01'], payload: {} },
  { id: 'LOC-W01-001', title: '候选城市', status: 'proposed', truthScope: 'objective', worldId: 'W01', type: 'location', refs: ['W01'], payload: {} },
  { id: 'EVT-W01-001', title: '废弃事件', status: 'deprecated', truthScope: 'objective', worldId: 'W01', type: 'event', refs: ['W01'], payload: {} }
];

const emptyRegistry = { registryVersion: '0.1.0', mechanics: [] };

function compile(overrides = {}) {
  return compileWorldPackage({
    manifest: structuredClone(overrides.manifest ?? baseManifest),
    contentSources: overrides.contentSources ?? [{ sourceVersion: 1, entries: structuredClone(baseEntries) }],
    mechanicRegistry: overrides.mechanicRegistry ?? emptyRegistry
  });
}

test('World Package defaults to canon content and separates truth scopes', () => {
  const result = compile();
  assert.equal(result.experimental, false);
  assert.deepEqual(result.content.objectiveDefinitions.map(item => item.id), ['W01']);
  assert.deepEqual(result.content.beliefSeeds.map(item => item.id), ['FAC-W01-001']);
  assert.deepEqual(result.content.unresolvedMetadata, []);
  assert.equal(result.packageHash.length, 64);
  assert.equal(packageHash(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'packageHash'))), result.packageHash);
  assert.equal(Object.isFrozen(result), true);
});

test('World Package only includes proposed content through explicit experimental IDs', () => {
  const manifest = structuredClone(baseManifest);
  manifest.selection.experimentalIncludes = ['LOC-W01-001'];
  const result = compile({ manifest });
  assert.equal(result.experimental, true);
  assert.deepEqual(result.content.objectiveDefinitions.map(item => item.id), ['W01', 'LOC-W01-001']);
});

test('World Package rejects missing published references', () => {
  const entries = structuredClone(baseEntries);
  entries[0].refs = ['LOC-W01-999'];
  assert.throws(
    () => compile({ contentSources: [{ sourceVersion: 1, entries }] }),
    error => error instanceof WorldPackageCompileError && error.code === 'MISSING_REFERENCE'
  );
});

test('mechanic registry validates versions, parameters and dependency order', () => {
  const registry = {
    registryVersion: '0.1.0',
    mechanics: [
      {
        id: 'MEC-001', version: '1.0.0', actionNamespace: 'core', effectNamespace: 'core', dependencies: [],
        parameterSchema: { type: 'object', additionalProperties: false, required: ['limit'], properties: { limit: { type: 'integer', minimum: 1 } } }
      },
      {
        id: 'MEC-002', version: '1.0.0', actionNamespace: 'policy', effectNamespace: 'policy',
        dependencies: [{ id: 'MEC-001', version: '1.0.0' }],
        parameterSchema: { type: 'object', additionalProperties: false, properties: {} }
      }
    ]
  };
  const manifest = structuredClone(baseManifest);
  manifest.mechanics.modules = [
    { id: 'MEC-002', version: '1.0.0', parameters: {} },
    { id: 'MEC-001', version: '1.0.0', parameters: { limit: 2 } }
  ];
  assert.deepEqual(compile({ manifest, mechanicRegistry: registry }).mechanics.modules.map(item => item.id), ['MEC-001', 'MEC-002']);

  manifest.mechanics.modules = [{ id: 'MEC-002', version: '1.0.0', parameters: {} }];
  assert.throws(
    () => compile({ manifest, mechanicRegistry: registry }),
    error => error.code === 'MISSING_MECHANIC_DEPENDENCY'
  );
});

test('mechanic registry rejects cyclic dependencies', () => {
  const registry = {
    registryVersion: '0.1.0',
    mechanics: [
      { id: 'MEC-001', version: '1.0.0', actionNamespace: 'a', effectNamespace: 'a', dependencies: [{ id: 'MEC-002', version: '1.0.0' }], parameterSchema: { type: 'object', properties: {} } },
      { id: 'MEC-002', version: '1.0.0', actionNamespace: 'b', effectNamespace: 'b', dependencies: [{ id: 'MEC-001', version: '1.0.0' }], parameterSchema: { type: 'object', properties: {} } }
    ]
  };
  const manifest = structuredClone(baseManifest);
  manifest.mechanics.modules = registry.mechanics.map(item => ({ id: item.id, version: item.version, parameters: {} }));
  assert.throws(
    () => compile({ manifest, mechanicRegistry: registry }),
    error => error.code === 'MECHANIC_DEPENDENCY_CYCLE'
  );
});

test('mechanic registry rejects incompatible dependency versions', () => {
  const registry = {
    registryVersion: '0.1.0',
    mechanics: [
      { id: 'MEC-001', version: '1.0.0', actionNamespace: 'a', effectNamespace: 'a', dependencies: [], parameterSchema: { type: 'object', properties: {} } },
      { id: 'MEC-002', version: '1.0.0', actionNamespace: 'b', effectNamespace: 'b', dependencies: [{ id: 'MEC-001', version: '2.0.0' }], parameterSchema: { type: 'object', properties: {} } }
    ]
  };
  const manifest = structuredClone(baseManifest);
  manifest.mechanics.modules = registry.mechanics.map(item => ({ id: item.id, version: item.version, parameters: {} }));
  assert.throws(
    () => compile({ manifest, mechanicRegistry: registry }),
    error => error.code === 'MECHANIC_DEPENDENCY_VERSION_MISMATCH'
  );
});

test('checked-in JSON manifest compiles deterministically', async () => {
  const manifestPath = fileURLToPath(new URL('../simulation/manifests/w01-0.1.0.json', import.meta.url));
  const first = await compileWorldPackageFile(manifestPath);
  const second = await compileWorldPackageFile(manifestPath);
  assert.equal(first.packageHash, second.packageHash);
  assert.equal(first.worldId, 'W01');
  assert.deepEqual(first.content.objectiveDefinitions.map(item => item.id), ['W01']);
});

test('compiled package instantiates into an independent readable SQLite save', async () => {
  const manifest = structuredClone(baseManifest);
  manifest.initialState = {
    regions: [{ regionId: 'LOC-W01-001', sourceId: 'W01', state: { label: '测试区' } }],
    entities: [{ entityId: 'FAC-W01-001', sourceId: 'W01', regionId: 'LOC-W01-001', state: { active: true } }],
    events: [{ eventId: 'EVT-W01-001', sourceId: 'W01', tick: 0, type: 'world.created', payload: {} }]
  };
  const worldPackage = compile({ manifest });
  const directory = await mkdtemp(join(tmpdir(), 'worldforge-instance-'));
  const databasePath = join(directory, 'instance.sqlite');
  const store = createWorldInstanceStore(databasePath);
  try {
    const tampered = structuredClone(worldPackage);
    tampered.worldId = 'W02';
    assert.throws(
      () => store.instantiate(tampered, { instanceId: 'INST-TAMPERED', randomSeed: 'seed-000' }),
      error => error instanceof WorldInstanceError && error.code === 'WORLD_PACKAGE_HASH_MISMATCH'
    );
    const created = store.instantiate(worldPackage, { instanceId: 'INST-TEST-001', randomSeed: 'seed-001' });
    assert.equal(created.definitionHash, worldPackage.packageHash);
    assert.equal(created.currentTick, 0);
    assert.equal(created.regions[0].regionId, 'LOC-W01-001');
    assert.equal(created.entities[0].state.active, true);
    assert.equal(created.events[0].type, 'world.created');
    assert.equal(store.health().schemaVersion, 1);
    assert.throws(
      () => store.instantiate(worldPackage, { instanceId: 'INST-TEST-001', randomSeed: 'seed-002' }),
      error => error instanceof WorldInstanceError && error.code === 'INSTANCE_ALREADY_EXISTS'
    );
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
