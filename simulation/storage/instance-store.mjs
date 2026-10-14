import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { packageHash } from '../compiler/world-package.mjs';

export const SIMULATION_SCHEMA_VERSION = 2;
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
  if (!applied.has(2)) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        ALTER TABLE sim_instances ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0 CHECK (state_version >= 0);
        ALTER TABLE sim_instances ADD COLUMN status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('paused', 'running', 'replaying', 'archived'));
        CREATE TABLE sim_actions (
          instance_id TEXT NOT NULL,
          action_id TEXT NOT NULL,
          tick INTEGER NOT NULL CHECK (tick >= 0),
          actor_id TEXT NOT NULL,
          action_type TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
          validation_json TEXT NOT NULL CHECK (json_valid(validation_json)),
          random_sample REAL NOT NULL CHECK (random_sample >= 0 AND random_sample < 1),
          PRIMARY KEY(instance_id, action_id),
          FOREIGN KEY(instance_id) REFERENCES sim_instances(instance_id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX sim_actions_tick_idx ON sim_actions(instance_id, tick, action_id);
        CREATE TABLE sim_knowledge_records (
          instance_id TEXT NOT NULL,
          knowledge_id TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          proposition_json TEXT NOT NULL CHECK (json_valid(proposition_json)),
          source_event_ids_json TEXT NOT NULL CHECK (json_valid(source_event_ids_json)),
          observed_at_tick INTEGER NOT NULL CHECK (observed_at_tick >= 0),
          confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
          classification TEXT NOT NULL CHECK (classification IN ('public', 'restricted', 'secret')),
          knowledge_status TEXT NOT NULL CHECK (knowledge_status IN ('observed', 'inferred', 'reported', 'deception')),
          expires_at_tick INTEGER CHECK (expires_at_tick IS NULL OR expires_at_tick > observed_at_tick),
          PRIMARY KEY(instance_id, knowledge_id),
          FOREIGN KEY(instance_id) REFERENCES sim_instances(instance_id) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX sim_knowledge_subject_tick_idx ON sim_knowledge_records(instance_id, subject_id, observed_at_tick);
        CREATE TABLE sim_snapshots (
          instance_id TEXT NOT NULL,
          tick INTEGER NOT NULL CHECK (tick >= 0),
          state_json TEXT NOT NULL CHECK (json_valid(state_json)),
          knowledge_json TEXT NOT NULL CHECK (json_valid(knowledge_json)),
          state_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(instance_id, tick),
          FOREIGN KEY(instance_id) REFERENCES sim_instances(instance_id) ON DELETE CASCADE
        ) STRICT;
      `);
      const existingInstances = db.prepare('SELECT instance_id, current_tick, created_at FROM sim_instances').all();
      const readRegions = db.prepare('SELECT region_id, source_id, state_json FROM sim_regions WHERE instance_id = ? ORDER BY region_id');
      const readEntities = db.prepare('SELECT entity_id, source_id, region_id, state_json FROM sim_entities WHERE instance_id = ? ORDER BY entity_id');
      const backfillSnapshot = db.prepare(`INSERT INTO sim_snapshots(
        instance_id, tick, state_json, knowledge_json, state_hash, created_at
      ) VALUES (?, ?, ?, '[]', ?, ?)`);
      for (const instance of existingInstances) {
        const state = {
          regions: readRegions.all(instance.instance_id)
            .map(row => ({ regionId: row.region_id, sourceId: row.source_id, state: parseJson(row.state_json) })),
          entities: readEntities.all(instance.instance_id)
            .map(row => ({ entityId: row.entity_id, sourceId: row.source_id, regionId: row.region_id, state: parseJson(row.state_json) }))
        };
        backfillSnapshot.run(instance.instance_id, instance.current_tick, JSON.stringify(state), packageHash(state), instance.created_at);
      }
      db.prepare('INSERT INTO sim_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
        .run(2, 'tick-actions-snapshots-knowledge', new Date().toISOString());
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

  function stateRows(instanceId) {
    return {
      regions: db.prepare('SELECT region_id, source_id, state_json FROM sim_regions WHERE instance_id = ? ORDER BY region_id').all(instanceId)
        .map(row => ({ regionId: row.region_id, sourceId: row.source_id, state: parseJson(row.state_json) })),
      entities: db.prepare('SELECT entity_id, source_id, region_id, state_json FROM sim_entities WHERE instance_id = ? ORDER BY entity_id').all(instanceId)
        .map(row => ({ entityId: row.entity_id, sourceId: row.source_id, regionId: row.region_id, state: parseJson(row.state_json) }))
    };
  }

  function knowledgeRows(instanceId, atTick = Number.MAX_SAFE_INTEGER) {
    return db.prepare(`SELECT * FROM sim_knowledge_records
      WHERE instance_id = ? AND observed_at_tick <= ? ORDER BY observed_at_tick, knowledge_id`).all(instanceId, atTick)
      .map(row => ({
        knowledgeId: row.knowledge_id,
        subjectId: row.subject_id,
        proposition: parseJson(row.proposition_json),
        sourceEventIds: parseJson(row.source_event_ids_json),
        observedAtTick: row.observed_at_tick,
        confidence: row.confidence,
        classification: row.classification,
        status: row.knowledge_status,
        ...(row.expires_at_tick == null ? {} : { expiresAtTick: row.expires_at_tick })
      }));
  }

  function insertSnapshot(instanceId, tick, state, knowledge) {
    const stateHash = packageHash(state);
    db.prepare(`INSERT INTO sim_snapshots(instance_id, tick, state_json, knowledge_json, state_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(instanceId, tick, JSON.stringify(state), JSON.stringify(knowledge), stateHash, new Date().toISOString());
    return stateHash;
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
      insertSnapshot(instanceId, 0, {
        regions: worldPackage.initialState.regions.map(region => ({ regionId: region.regionId, sourceId: region.sourceId, state: structuredClone(region.state ?? {}) })),
        entities: worldPackage.initialState.entities.map(entity => ({ entityId: entity.entityId, sourceId: entity.sourceId, regionId: entity.regionId ?? null, state: structuredClone(entity.state ?? {}) }))
      }, []);
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
      stateVersion: instance.state_version,
      status: instance.status,
      createdAt: instance.created_at,
      ...stateRows(instanceId),
      events: db.prepare('SELECT event_id, source_id, tick, event_type, payload_json FROM sim_events WHERE instance_id = ? ORDER BY tick, event_id').all(instanceId)
        .map(row => ({ eventId: row.event_id, sourceId: row.source_id, tick: row.tick, type: row.event_type, payload: parseJson(row.payload_json) }))
    };
  }

  function commitTick({ instanceId, expectedTick, expectedStateVersion, nextTick, state, actions, events, knowledgeRecords }) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = db.prepare('SELECT current_tick, state_version FROM sim_instances WHERE instance_id = ?').get(instanceId);
      if (!current) throw new WorldInstanceError('INSTANCE_NOT_FOUND', `实例不存在：${instanceId}`);
      if (current.current_tick !== expectedTick || current.state_version !== expectedStateVersion || nextTick !== expectedTick + 1) {
        throw new WorldInstanceError('STALE_INSTANCE_STATE', '实例状态已变化，拒绝过期提交');
      }

      const updateRegion = db.prepare('UPDATE sim_regions SET state_json = ? WHERE instance_id = ? AND region_id = ?');
      for (const region of state.regions) {
        if (updateRegion.run(JSON.stringify(region.state), instanceId, region.regionId).changes !== 1) {
          throw new WorldInstanceError('STATE_SHAPE_MISMATCH', `地区状态不存在：${region.regionId}`);
        }
      }
      const updateEntity = db.prepare('UPDATE sim_entities SET state_json = ?, region_id = ? WHERE instance_id = ? AND entity_id = ?');
      for (const entity of state.entities) {
        if (updateEntity.run(JSON.stringify(entity.state), entity.regionId ?? null, instanceId, entity.entityId).changes !== 1) {
          throw new WorldInstanceError('STATE_SHAPE_MISMATCH', `实体状态不存在：${entity.entityId}`);
        }
      }

      const insertAction = db.prepare(`INSERT INTO sim_actions(
        instance_id, action_id, tick, actor_id, action_type, status, payload_json, validation_json, random_sample
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const action of actions) {
        insertAction.run(instanceId, action.actionId, nextTick, action.actorId, action.type, action.status,
          JSON.stringify(action.payload), JSON.stringify(action.validation), action.randomSample);
      }
      const insertEvent = db.prepare('INSERT INTO sim_events(instance_id, event_id, source_id, tick, event_type, payload_json) VALUES (?, ?, ?, ?, ?, ?)');
      for (const event of events) {
        insertEvent.run(instanceId, event.eventId, event.sourceId, event.tick, event.type, JSON.stringify(event.payload));
      }
      const insertKnowledge = db.prepare(`INSERT INTO sim_knowledge_records(
        instance_id, knowledge_id, subject_id, proposition_json, source_event_ids_json, observed_at_tick,
        confidence, classification, knowledge_status, expires_at_tick
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const record of knowledgeRecords) {
        insertKnowledge.run(instanceId, record.knowledgeId, record.subjectId, JSON.stringify(record.proposition),
          JSON.stringify(record.sourceEventIds), record.observedAtTick, record.confidence, record.classification,
          record.status, record.expiresAtTick ?? null);
      }

      const updated = db.prepare(`UPDATE sim_instances SET current_tick = ?, state_version = state_version + 1
        WHERE instance_id = ? AND current_tick = ? AND state_version = ?`)
        .run(nextTick, instanceId, expectedTick, expectedStateVersion);
      if (updated.changes !== 1) throw new WorldInstanceError('STALE_INSTANCE_STATE', '实例状态已变化，拒绝过期提交');
      insertSnapshot(instanceId, nextTick, state, knowledgeRows(instanceId, nextTick));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if (String(error.message).includes('UNIQUE constraint failed: sim_actions')) {
        throw new WorldInstanceError('DUPLICATE_ACTION', 'Action ID 已提交');
      }
      throw error;
    }
    return read(instanceId);
  }

  function readSnapshot(instanceId, tick) {
    const row = db.prepare('SELECT * FROM sim_snapshots WHERE instance_id = ? AND tick = ?').get(instanceId, tick);
    if (!row) return null;
    return { instanceId, tick, state: parseJson(row.state_json), knowledge: parseJson(row.knowledge_json), stateHash: row.state_hash, createdAt: row.created_at };
  }

  function readEvents(instanceId, afterTick = -1, throughTick = Number.MAX_SAFE_INTEGER) {
    return db.prepare(`SELECT event_id, source_id, tick, event_type, payload_json FROM sim_events
      WHERE instance_id = ? AND tick > ? AND tick <= ? ORDER BY tick, event_id`).all(instanceId, afterTick, throughTick)
      .map(row => ({ eventId: row.event_id, sourceId: row.source_id, tick: row.tick, type: row.event_type, payload: parseJson(row.payload_json) }));
  }

  function readKnowledge(instanceId, atTick = Number.MAX_SAFE_INTEGER) {
    return knowledgeRows(instanceId, atTick);
  }

  function readActions(instanceId, atTick = Number.MAX_SAFE_INTEGER) {
    return db.prepare(`SELECT * FROM sim_actions WHERE instance_id = ? AND tick <= ? ORDER BY tick, action_id`).all(instanceId, atTick)
      .map(row => ({
        actionId: row.action_id,
        tick: row.tick,
        actorId: row.actor_id,
        type: row.action_type,
        status: row.status,
        payload: parseJson(row.payload_json),
        validation: parseJson(row.validation_json),
        randomSample: row.random_sample
      }));
  }

  function health() {
    const migration = db.prepare('SELECT version, name, applied_at FROM sim_schema_migrations ORDER BY version').all();
    return { ok: db.prepare('PRAGMA quick_check').get().quick_check === 'ok', databasePath, schemaVersion: SIMULATION_SCHEMA_VERSION, migrations: migration };
  }

  return { instantiate, read, commitTick, readSnapshot, readEvents, readKnowledge, readActions, health, close: () => db.close() };
}
