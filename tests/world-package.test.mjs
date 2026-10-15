import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
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

function mechanicContract(actionNamespace, effectNamespace) {
  return {
    actions: [{
      type: `${actionNamespace}.noop`,
      parametersSchema: { type: 'object', additionalProperties: false, required: [], properties: {} }
    }],
    effects: [{
      type: `${effectNamespace}.noop`,
      schema: {
        type: 'object', additionalProperties: false, required: ['type'],
        properties: { type: { const: `${effectNamespace}.noop` } }
      }
    }],
    access: { reads: ['actor', 'knowledge', 'tick'], writes: [] },
    knowledge: { classifications: ['restricted'], maxTtl: 1 }
  };
}

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
        contract: mechanicContract('core', 'core'),
        parameterSchema: { type: 'object', additionalProperties: false, required: ['limit'], properties: { limit: { type: 'integer', minimum: 1 } } }
      },
      {
        id: 'MEC-002', version: '1.0.0', actionNamespace: 'policy', effectNamespace: 'policy',
        dependencies: [{ id: 'MEC-001', version: '1.0.0' }],
        contract: mechanicContract('policy', 'policy'),
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
  const compiledContract = compile({ manifest, mechanicRegistry: registry }).mechanics.modules[0].contract;
  assert.equal(compiledContract.actions[0].type, 'core.noop');
  assert.deepEqual(compiledContract.access.reads, ['actor', 'knowledge', 'tick']);

  manifest.mechanics.modules = [{ id: 'MEC-002', version: '1.0.0', parameters: {} }];
  assert.throws(
    () => compile({ manifest, mechanicRegistry: registry }),
    error => error.code === 'MISSING_MECHANIC_DEPENDENCY'
  );
});

test('mechanic contracts reject invalid access paths and participate in package hashes', () => {
  const registry = {
    registryVersion: '0.1.0',
    mechanics: [{
      id: 'MEC-001', version: '1.0.0', actionNamespace: 'core', effectNamespace: 'core', dependencies: [],
      contract: mechanicContract('core', 'core'),
      parameterSchema: { type: 'object', additionalProperties: false, properties: {} }
    }]
  };
  const manifest = structuredClone(baseManifest);
  manifest.mechanics.modules = [{ id: 'MEC-001', version: '1.0.0', parameters: {} }];
  const first = compile({ manifest, mechanicRegistry: registry });
  registry.mechanics[0].contract.knowledge.maxTtl = 2;
  const second = compile({ manifest, mechanicRegistry: registry });
  assert.notEqual(first.packageHash, second.packageHash);

  registry.mechanics[0].contract.access.reads.push('state.**');
  assert.throws(
    () => compile({ manifest, mechanicRegistry: registry }),
    error => error instanceof WorldPackageCompileError && error.code === 'INVALID_MECHANIC_CONTRACT'
  );
});

test('mechanic registry rejects cyclic dependencies', () => {
  const registry = {
    registryVersion: '0.1.0',
    mechanics: [
      { id: 'MEC-001', version: '1.0.0', actionNamespace: 'a', effectNamespace: 'a', dependencies: [{ id: 'MEC-002', version: '1.0.0' }], contract: mechanicContract('a', 'a'), parameterSchema: { type: 'object', properties: {} } },
      { id: 'MEC-002', version: '1.0.0', actionNamespace: 'b', effectNamespace: 'b', dependencies: [{ id: 'MEC-001', version: '1.0.0' }], contract: mechanicContract('b', 'b'), parameterSchema: { type: 'object', properties: {} } }
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
      { id: 'MEC-001', version: '1.0.0', actionNamespace: 'a', effectNamespace: 'a', dependencies: [], contract: mechanicContract('a', 'a'), parameterSchema: { type: 'object', properties: {} } },
      { id: 'MEC-002', version: '1.0.0', actionNamespace: 'b', effectNamespace: 'b', dependencies: [{ id: 'MEC-001', version: '2.0.0' }], contract: mechanicContract('b', 'b'), parameterSchema: { type: 'object', properties: {} } }
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
    assert.equal(store.health().schemaVersion, 2);
    assert.deepEqual(store.health().migrations.map(migration => migration.version), [1, 2]);
    assert.throws(
      () => store.instantiate(worldPackage, { instanceId: 'INST-TEST-001', randomSeed: 'seed-002' }),
      error => error instanceof WorldInstanceError && error.code === 'INSTANCE_ALREADY_EXISTS'
    );
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('simulation schema v2 upgrades an M0B instance and backfills its current snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'worldforge-sim-v1-'));
  const databasePath = join(directory, 'simulation.sqlite');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE sim_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL) STRICT;
    CREATE TABLE sim_instances (
      instance_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, definition_version TEXT NOT NULL,
      definition_hash TEXT NOT NULL, definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
      random_seed TEXT NOT NULL, current_tick INTEGER NOT NULL DEFAULT 0 CHECK (current_tick >= 0), created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE sim_regions (
      instance_id TEXT NOT NULL, region_id TEXT NOT NULL, source_id TEXT NOT NULL,
      state_json TEXT NOT NULL CHECK (json_valid(state_json)), PRIMARY KEY(instance_id, region_id),
      FOREIGN KEY(instance_id) REFERENCES sim_instances(instance_id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE sim_entities (
      instance_id TEXT NOT NULL, entity_id TEXT NOT NULL, source_id TEXT NOT NULL, region_id TEXT,
      state_json TEXT NOT NULL CHECK (json_valid(state_json)), PRIMARY KEY(instance_id, entity_id),
      FOREIGN KEY(instance_id) REFERENCES sim_instances(instance_id) ON DELETE CASCADE,
      FOREIGN KEY(instance_id, region_id) REFERENCES sim_regions(instance_id, region_id)
    ) STRICT;
    CREATE TABLE sim_events (
      instance_id TEXT NOT NULL, event_id TEXT NOT NULL, source_id TEXT NOT NULL, tick INTEGER NOT NULL CHECK (tick >= 0),
      event_type TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)), PRIMARY KEY(instance_id, event_id),
      FOREIGN KEY(instance_id) REFERENCES sim_instances(instance_id) ON DELETE CASCADE
    ) STRICT;
    INSERT INTO sim_schema_migrations VALUES (1, 'instance-foundation', '2026-10-13T00:00:00.000Z');
    INSERT INTO sim_instances VALUES ('INST-LEGACY', 'W01', '0.1.0', 'legacy-hash', '{}', 'legacy-seed', 0, '2026-10-13T00:00:00.000Z');
    INSERT INTO sim_regions VALUES ('INST-LEGACY', 'LOC-W01-001', 'W01', '{"resources":{"energy":{"reserve":5,"consumed":0}}}');
  `);
  legacy.close();

  const store = createWorldInstanceStore(databasePath);
  try {
    assert.deepEqual(store.health().migrations.map(migration => migration.version), [1, 2]);
    assert.equal(store.read('INST-LEGACY').stateVersion, 0);
    assert.equal(store.readSnapshot('INST-LEGACY', 0).state.regions[0].state.resources.energy.reserve, 5);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
