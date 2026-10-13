import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { packageHash } from '../compiler/world-package.mjs';

export const SIMULATION_SCHEMA_VERSION = 1;
const INSTANCE_ID_PATTERN = /^INST-[A-Z0-9][A-Z0-9-]*$/;

export class WorldInstanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorldInstanceError';
    this.code = code;
  }
}

function applySimulationMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sim_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const applied = new Set(db.prepare('SELECT version FROM sim_schema_migrations').all().map(row => row.version));
  const newestVersion = Math.max(0, ...applied);
  if (newestVersion > SIMULATION_SCHEMA_VERSION) {
    throw new WorldInstanceError('UNSUPPORTED_SIMULATION_SCHEMA', `模拟存档版本 ${newestVersion} 高于当前支持版本 ${SIMULATION_SCHEMA_VERSION}`);
  }
  if (!applied.has(1)) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE sim_instances (
          instance_id TEXT PRIMARY KEY,
          world_id TEXT NOT NULL,
          definition_version TEXT NOT NULL,
          definition_hash TEXT NOT NULL,
          definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
          random_seed TEXT NOT NULL,
          current_tick INTEGER NOT NULL DEFAULT 0 CHECK (current_tick >= 0),
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE sim_regions (
          instance_id TEXT NOT NULL,
          region_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          state_json TEXT NOT NULL CHECK (json_valid(state_json)),
          PRIMARY KEY(instance_id, region_id),
          FOREIGN KEY(instance_id) REFERENCES sim_instances(instance_id) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE sim_entities (
          instance_id TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          region_id TEXT,
          state_json TEXT NOT NULL CHECK (json_valid(state_json)),
          PRIMARY KEY(instance_id, entity_id),
          FOREIGN KEY(instance_id) REFERENCES sim_instances(instance_id) ON DELETE CASCADE,
          FOREIGN KEY(instance_id, region_id) REFERENCES sim_regions(instance_id, region_id)
        ) STRICT;
        CREATE TABLE sim_events (
          instance_id TEXT NOT NULL,
          event_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          tick INTEGER NOT NULL CHECK (tick >= 0),
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
          PRIMARY KEY(instance_id, event_id),
          FOREIGN KEY(instance_id) REFERENCES sim_instances(instance_id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX sim_events_tick_idx ON sim_events(instance_id, tick, event_id);
      `);
      db.prepare('INSERT INTO sim_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
        .run(1, 'instance-foundation', new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function parseJson(value) {
  return JSON.parse(value);
}

export function createWorldInstanceStore(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    applySimulationMigrations(db);
  } catch (error) {
    db.close();
    throw error;
  }

  function instantiate(worldPackage, { instanceId, randomSeed }) {
    if (!INSTANCE_ID_PATTERN.test(instanceId ?? '')) throw new WorldInstanceError('INVALID_INSTANCE_ID', 'instanceId 格式无效');
    if (typeof randomSeed !== 'string' || !randomSeed) throw new WorldInstanceError('INVALID_RANDOM_SEED', 'randomSeed 必须是非空字符串');
    if (!worldPackage || worldPackage.formatVersion !== 1 || typeof worldPackage.packageHash !== 'string'
      || !worldPackage.initialState || !Array.isArray(worldPackage.initialState.regions)
      || !Array.isArray(worldPackage.initialState.entities) || !Array.isArray(worldPackage.initialState.events)) {
      throw new WorldInstanceError('INVALID_WORLD_PACKAGE', 'World Package 格式无效');
    }
    const { packageHash: expectedHash, ...definition } = worldPackage;
    if (packageHash(definition) !== expectedHash) throw new WorldInstanceError('WORLD_PACKAGE_HASH_MISMATCH', 'World Package 内容哈希不匹配');

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO sim_instances(
        instance_id, world_id, definition_version, definition_hash, definition_json, random_seed, current_tick, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
        .run(instanceId, worldPackage.worldId, worldPackage.definitionVersion, expectedHash, JSON.stringify(worldPackage), randomSeed, new Date().toISOString());
      const insertRegion = db.prepare('INSERT INTO sim_regions(instance_id, region_id, source_id, state_json) VALUES (?, ?, ?, ?)');
      for (const region of worldPackage.initialState.regions) {
        insertRegion.run(instanceId, region.regionId, region.sourceId, JSON.stringify(region.state ?? {}));
      }
      const insertEntity = db.prepare('INSERT INTO sim_entities(instance_id, entity_id, source_id, region_id, state_json) VALUES (?, ?, ?, ?, ?)');
      for (const entity of worldPackage.initialState.entities) {
        insertEntity.run(instanceId, entity.entityId, entity.sourceId, entity.regionId ?? null, JSON.stringify(entity.state ?? {}));
      }
      const insertEvent = db.prepare('INSERT INTO sim_events(instance_id, event_id, source_id, tick, event_type, payload_json) VALUES (?, ?, ?, ?, ?, ?)');
      for (const event of worldPackage.initialState.events) {
        insertEvent.run(instanceId, event.eventId, event.sourceId, event.tick ?? 0, event.type, JSON.stringify(event.payload ?? {}));
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if (String(error.message).includes('UNIQUE constraint failed: sim_instances.instance_id')) {
        throw new WorldInstanceError('INSTANCE_ALREADY_EXISTS', `实例已存在：${instanceId}`);
      }
      throw error;
    }
    return read(instanceId);
  }

  function read(instanceId) {
    const instance = db.prepare('SELECT * FROM sim_instances WHERE instance_id = ?').get(instanceId);
    if (!instance) return null;
    return {
      instanceId: instance.instance_id,
      worldId: instance.world_id,
      definitionVersion: instance.definition_version,
      definitionHash: instance.definition_hash,
      definition: parseJson(instance.definition_json),
      randomSeed: instance.random_seed,
      currentTick: instance.current_tick,
      createdAt: instance.created_at,
      regions: db.prepare('SELECT region_id, source_id, state_json FROM sim_regions WHERE instance_id = ? ORDER BY region_id').all(instanceId)
        .map(row => ({ regionId: row.region_id, sourceId: row.source_id, state: parseJson(row.state_json) })),
      entities: db.prepare('SELECT entity_id, source_id, region_id, state_json FROM sim_entities WHERE instance_id = ? ORDER BY entity_id').all(instanceId)
        .map(row => ({ entityId: row.entity_id, sourceId: row.source_id, regionId: row.region_id, state: parseJson(row.state_json) })),
      events: db.prepare('SELECT event_id, source_id, tick, event_type, payload_json FROM sim_events WHERE instance_id = ? ORDER BY tick, event_id').all(instanceId)
        .map(row => ({ eventId: row.event_id, sourceId: row.source_id, tick: row.tick, type: row.event_type, payload: parseJson(row.payload_json) }))
    };
  }

  function health() {
    const migration = db.prepare('SELECT version, name, applied_at FROM sim_schema_migrations ORDER BY version').all();
    return { ok: db.prepare('PRAGMA quick_check').get().quick_check === 'ok', databasePath, schemaVersion: SIMULATION_SCHEMA_VERSION, migrations: migration };
  }

  return { instantiate, read, health, close: () => db.close() };
}
