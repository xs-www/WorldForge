export const CONTENT_SCHEMA_VERSION = 2;

export class UnsupportedContentSchemaError extends Error {
  constructor(foundVersion) {
    super(`内容数据库版本 ${foundVersion} 高于当前服务支持的版本 ${CONTENT_SCHEMA_VERSION}`);
    this.name = 'UnsupportedContentSchemaError';
    this.foundVersion = foundVersion;
    this.supportedVersion = CONTENT_SCHEMA_VERSION;
  }
}

const CONTENT_MIGRATIONS = [
  {
    version: 1,
    name: 'content-core',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS lore_entries (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          truth_scope TEXT NOT NULL,
          world_id TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS lore_world_type_idx ON lore_entries(world_id, type);
        CREATE INDEX IF NOT EXISTS lore_status_idx ON lore_entries(status);
        CREATE TABLE IF NOT EXISTS card_drafts (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          name TEXT NOT NULL,
          card_type TEXT NOT NULL,
          status TEXT NOT NULL,
          world_id TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS cards_world_type_idx ON card_drafts(world_id, card_type);
        CREATE TABLE IF NOT EXISTS keywords (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          definition TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS notes (
          note_key TEXT PRIMARY KEY,
          body TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
      `);
    }
  },
  {
    version: 2,
    name: 'art-assets',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS art_assets (
          id TEXT PRIMARY KEY,
          card_id TEXT NOT NULL,
          prompt TEXT NOT NULL,
          model TEXT NOT NULL,
          size TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_name TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json))
        ) STRICT;
        CREATE INDEX IF NOT EXISTS art_assets_card_idx ON art_assets(card_id, created_at);
      `);
    }
  }
];

export function contentSchemaVersion(db) {
  return Number(db.prepare('PRAGMA user_version').get().user_version);
}

export function applyContentMigrations(db) {
  const startingVersion = contentSchemaVersion(db);
  if (startingVersion > CONTENT_SCHEMA_VERSION) throw new UnsupportedContentSchemaError(startingVersion);

  const applied = [];
  for (const migration of CONTENT_MIGRATIONS) {
    if (migration.version <= startingVersion) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
      applied.push({ version: migration.version, name: migration.name });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    startingVersion,
    currentVersion: contentSchemaVersion(db),
    applied
  };
}
