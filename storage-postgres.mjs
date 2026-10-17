// PostgreSQL 版内容库：与 `storage.mjs` 的 SQLite 实现共用同一套公开 API、同一套表结构与同一套校验。
// 差异只有三处：
//   1) 所有方法都是 async（pg 是异步驱动），调用方必须 await；
//   2) 返回对象多一个 `driver = 'postgres'`，`health()` 报告脱敏后的连接目标而不是文件路径；
//   3) 迁移游标存在 `metadata.schema_version`（SQLite 用 `PRAGMA user_version`）。
// 内容校验、冲突错误、schema 版本号与“过高版本”错误一律从既有模块导入，本文件不复制这些规则。
import pg from 'pg';
import { ContentConflictError, validateContentSnapshot } from './storage.mjs';
import { CONTENT_SCHEMA_VERSION, UnsupportedContentSchemaError } from './storage-migrations.mjs';

const DRIVER = 'postgres';

// metadata 表里的 schema 版本键。它与业务键（initialized / revision / updated_at / last_saved_by）同居一张表，
// 读取时只按白名单取业务键，因此不会污染 read() 的返回值。
const SCHEMA_VERSION_KEY = 'schema_version';

// 迁移串行化用的 advisory lock 键：取任意固定数字，只为避免多个实例同时启动时并发建表。
const MIGRATION_LOCK_KEY = 9_472_100_001;

// 整库写入的事务级锁键。PostgreSQL 的 BEGIN 是延迟的，不像 SQLite 的 BEGIN IMMEDIATE 那样立刻拿写锁；
// 不加这把锁，两个并发保存可能都读到旧 revision 而同时通过乐观检查。
const CONTENT_WRITE_LOCK_KEY = 9_472_100_002;

// 每次 replace 都要清空的五张内容表；art_assets 属于素材库，不随整库保存被清空。
const CONTENT_TABLES = ['lore_entries', 'card_drafts', 'keywords', 'notes', 'lore_groups'];

export const POSTGRES_MIGRATIONS = [
  {
    version: 1,
    name: 'content-core',
    // 与 SQLite v1 逐表逐列对应。PostgreSQL 没有 json_valid，所以只用
    // `CHECK (payload_json IS NOT NULL)` 表达“非空”，JSON 合法性交给写入前的 validateContentSnapshot。
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS lore_entries (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          truth_scope TEXT NOT NULL,
          world_id TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK (payload_json IS NOT NULL),
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS lore_world_type_idx ON lore_entries(world_id, type);
        CREATE INDEX IF NOT EXISTS lore_status_idx ON lore_entries(status);
        CREATE TABLE IF NOT EXISTS card_drafts (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          name TEXT NOT NULL,
          card_type TEXT NOT NULL,
          status TEXT NOT NULL,
          world_id TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK (payload_json IS NOT NULL),
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS cards_world_type_idx ON card_drafts(world_id, card_type);
        CREATE TABLE IF NOT EXISTS keywords (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          definition TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK (payload_json IS NOT NULL),
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notes (
          note_key TEXT PRIMARY KEY,
          body TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    }
  },
  {
    version: 2,
    name: 'art-assets',
    async up(client) {
      await client.query(`
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
          metadata_json TEXT NOT NULL CHECK (metadata_json IS NOT NULL)
        );
        CREATE INDEX IF NOT EXISTS art_assets_card_idx ON art_assets(card_id, created_at);
      `);
    }
  },
  {
    // 资料组：五项固定组不落库（由代码提供），这里只存作者自定义的组。
    version: 3,
    name: 'lore-groups',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS lore_groups (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          label TEXT NOT NULL,
          form TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK (payload_json IS NOT NULL),
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS lore_groups_position_idx ON lore_groups(position, id);
      `);
    }
  }
];

// 脱敏后的连接目标：只保留 host:port/database。
// 用户名、口令、查询参数（可能含 sslmode/password 之类）一律不出现，避免 health() 或日志泄露凭据。
export function describePostgresTarget(connectionString) {
  const raw = typeof connectionString === 'string' ? connectionString.trim() : '';
  if (!raw) return '(未配置连接串)';
  let url;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  if (!url) {
    // 解析失败（例如 libpq 的 `host=... password=...` 形式）时退化为最小脱敏：抹掉口令与查询参数。
    return raw
      .replace(/(password\s*=\s*)\S+/gi, '$1***')
      .replace(/\/\/[^@/\s]*@/, '//')
      .replace(/\?.*$/, '') || '(无法解析的连接串)';
  }
  const host = url.hostname || 'localhost';
  const port = url.port || '5432';
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || '(未指定数据库)';
  return `${host}:${port}/${database}`;
}

// schema 版本存在 metadata.schema_version；metadata 表本身要等 v1 迁移才建，所以先探测表是否存在。
async function readSchemaVersion(client) {
  const existing = await client.query('SELECT to_regclass($1) AS table_name', ['metadata']);
  if (!existing.rows[0]?.table_name) return 0;
  const version = await client.query('SELECT value FROM metadata WHERE key = $1', [SCHEMA_VERSION_KEY]);
  return Number(version.rows[0]?.value ?? 0);
}

async function writeSchemaVersion(client, version) {
  await client.query(
    'INSERT INTO metadata(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [SCHEMA_VERSION_KEY, String(version)]
  );
}

// 与 applyContentMigrations 同构：跳过已应用版本、每条迁移单独一个事务、失败即回滚并中止后续版本。
export async function applyPostgresMigrations(client) {
  const startingVersion = await readSchemaVersion(client);
  if (startingVersion > CONTENT_SCHEMA_VERSION) throw new UnsupportedContentSchemaError(startingVersion);

  const applied = [];
  for (const migration of POSTGRES_MIGRATIONS) {
    if (migration.version <= startingVersion) continue;
    await client.query('BEGIN');
    try {
      // 事务级 advisory lock：并发启动时让迁移排队，而不是同时撞 IF NOT EXISTS 的竞态。
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
      await migration.up(client);
      await writeSchemaVersion(client, migration.version);
      await client.query('COMMIT');
      applied.push({ version: migration.version, name: migration.name });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  }

  return {
    startingVersion,
    currentVersion: await readSchemaVersion(client),
    applied
  };
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value;
}

function stringField(value, fallback = '') { return typeof value === 'string' ? value : fallback; }

// storage.mjs 的 normalizeArtAsset 没有导出，这里按原样复刻（同样的字段推导顺序）。
// 一旦 SQLite 版本改了规则，两边会分叉——所以只搬必要的推导，不额外加分支。
function normalizeArtAsset(value) {
  const asset = JSON.parse(JSON.stringify(value));
  // unbound 表示这张画作已与绑定目标解除关系，但仍留在素材库里（会显示为“未使用”）。
  const unbound = asset.unbound === true || asset.targetType === '';
  const targetType = unbound ? '' : (asset.targetType === 'lore' ? 'lore' : 'card');
  const targetId = unbound ? '' : stringField(asset.targetId || asset.cardId).trim();
  return { ...asset, unbound, targetType, targetId, purpose: stringField(asset.purpose, targetType === 'card' ? 'card_art' : 'concept'), cardId: targetType === 'card' ? targetId : '' };
}

export async function createPostgresContentStore(options = {}) {
  const connectionString = typeof options?.connectionString === 'string' ? options.connectionString.trim() : '';
  // 先失败再动手：没有连接串就不建 pool，保证零副作用。
  if (!connectionString) throw new Error('createPostgresContentStore 需要 { connectionString }：缺少 PostgreSQL 连接串');

  const target = describePostgresTarget(connectionString);
  const pool = new pg.Pool({ connectionString });
  // 空闲连接被服务端断开时 pool 会 emit('error')；没有监听器会直接终止进程。
  // 这里只吞掉该事件，真实可用性一律由 health() 的 SELECT 1 表示。
  pool.on('error', () => {});

  let migration;
  try {
    const client = await pool.connect();
    try {
      migration = await applyPostgresMigrations(client);
    } finally {
      client.release();
    }
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }

  // executor 既可以是 pool 也可以是事务里的 client（两者都有 query）。
  async function loadMeta(executor) {
    const { rows } = await executor.query('SELECT key, value FROM metadata');
    const values = new Map(rows.map(row => [row.key, row.value]));
    return (key, fallback = null) => values.get(key) ?? fallback;
  }

  async function putMeta(executor, key, value) {
    await executor.query(
      'INSERT INTO metadata(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      [key, value]
    );
  }

  async function read() {
    const meta = await loadMeta(pool);
    const [lore, cards, keywords, notes, groups] = await Promise.all([
      pool.query('SELECT payload_json FROM lore_entries ORDER BY position, id'),
      pool.query('SELECT payload_json FROM card_drafts ORDER BY position, id'),
      pool.query('SELECT payload_json FROM keywords ORDER BY position, id'),
      pool.query('SELECT note_key, body FROM notes ORDER BY note_key'),
      pool.query('SELECT payload_json FROM lore_groups ORDER BY position, id')
    ]);
    return {
      schemaVersion: CONTENT_SCHEMA_VERSION,
      initialized: meta('initialized') === '1',
      revision: Number(meta('revision', '0')),
      updatedAt: meta('updated_at'),
      // 多人协作的署名：最后一次整库保存的账号。旧库没有该键时为 null，不代表数据损坏。
      lastSavedBy: meta('last_saved_by'),
      loreEntries: lore.rows.map(row => JSON.parse(row.payload_json)),
      cardDrafts: cards.rows.map(row => JSON.parse(row.payload_json)),
      keywords: keywords.rows.map(row => JSON.parse(row.payload_json)),
      notes: Object.fromEntries(notes.rows.map(row => [row.note_key, row.body])),
      loreGroups: groups.rows.map(row => JSON.parse(row.payload_json))
    };
  }

  async function replace(value, { actor = '' } = {}) {
    const snapshot = validateContentSnapshot(value);
    const expectedRevision = value.expectedRevision;
    const now = new Date().toISOString();
    // 整库重写必须落在同一条连接上，事务才完整；finally 里必须归还连接，否则池会被慢慢耗尽。
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 与 SQLite 的 BEGIN IMMEDIATE 对齐：先拿写锁，后面的乐观检查才不会被并发绕过。
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [CONTENT_WRITE_LOCK_KEY]);
      const meta = await loadMeta(client);
      const revision = Number(meta('revision', '0'));
      if (expectedRevision !== undefined && Number(expectedRevision) !== revision) throw new ContentConflictError();
      // 表名来自模块内常量白名单，不拼接任何外部输入。
      for (const table of CONTENT_TABLES) await client.query(`DELETE FROM ${table}`);
      // 逐行插入：与 SQLite 的预编译语句逐条 run() 行为一一对应（同样的默认值、同样的 position 口径）。
      for (const [position, item] of snapshot.loreEntries.entries()) {
        await client.query(
          'INSERT INTO lore_entries(id, position, name, type, status, truth_scope, world_id, payload_json, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [item.id, position, stringField(item.name), stringField(item.type, 'world'), stringField(item.status, 'proposed'), stringField(item.truthScope, 'objective'), stringField(item.worldId), JSON.stringify(item), stringField(item.updatedAt, now)]
        );
      }
      for (const [position, item] of snapshot.cardDrafts.entries()) {
        await client.query(
          'INSERT INTO card_drafts(id, position, name, card_type, status, world_id, payload_json, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [item.id, position, stringField(item.name), stringField(item.type, 'unit'), stringField(item.status, 'proposed'), stringField(item.worldId), JSON.stringify(item), now]
        );
      }
      for (const [position, item] of snapshot.keywords.entries()) {
        await client.query(
          'INSERT INTO keywords(id, position, name, status, definition, payload_json, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [item.id, position, stringField(item.name), stringField(item.status, 'proposed'), stringField(item.definition), JSON.stringify(item), now]
        );
      }
      // 旧快照可能没有 loreGroups 字段，按空数组处理；label/form 的兜底值与 storage.mjs 保持一致。
      for (const [position, item] of (snapshot.loreGroups || []).entries()) {
        await client.query(
          'INSERT INTO lore_groups(id, position, label, form, payload_json, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [item.id, position, stringField(item.label, item.id), stringField(item.form, 'generic'), JSON.stringify(item), now]
        );
      }
      for (const [key, body] of Object.entries(snapshot.notes)) {
        await client.query('INSERT INTO notes(note_key, body, updated_at) VALUES ($1, $2, $3)', [key, body, now]);
      }
      await putMeta(client, 'initialized', '1');
      await putMeta(client, 'revision', String(revision + 1));
      await putMeta(client, 'updated_at', now);
      await putMeta(client, 'last_saved_by', actor || 'anonymous');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    // 提交之后再读一次，返回与 SQLite 一致的“提交后快照”。
    return read();
  }

  async function health() {
    let ok = false;
    try {
      // ok 必须来自真实往返，而不是“pool 建成功了”这种静态判断。
      const { rows } = await pool.query('SELECT 1 AS ok');
      ok = Number(rows[0]?.ok) === 1;
    } catch {
      ok = false;
    }
    return { ok, driver: DRIVER, target, schemaVersion: CONTENT_SCHEMA_VERSION, migration };
  }

  async function createArtAsset(value) {
    const asset = plainObject(value, '美术资源');
    const normalized = normalizeArtAsset(asset);
    // 与 SQLite 版一致：未绑定（unbound）的资产本来就没有 targetId，只有绑定态才要求目标非空。
    for (const field of ['id', 'prompt', 'model', 'size', 'mimeType', 'fileName', 'status', 'createdAt']) {
      if (!stringField(normalized[field]).trim()) throw new Error(`美术资源缺少 ${field}`);
    }
    if (!normalized.unbound && !stringField(normalized.targetId).trim()) throw new Error('美术资源缺少 targetId');
    if (!/^ART-[A-F0-9-]+$/i.test(normalized.id) || !/^[A-Za-z0-9._-]+$/.test(normalized.fileName)) throw new Error('美术资源 ID 或文件名无效');
    const safe = normalized;
    await pool.query(
      'INSERT INTO art_assets(id, card_id, prompt, model, size, mime_type, file_name, status, created_at, metadata_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [safe.id, safe.targetId, safe.prompt, safe.model, safe.size, safe.mimeType, safe.fileName, safe.status, safe.createdAt, JSON.stringify(safe)]
    );
    return safe;
  }

  async function listArtAssets() {
    const { rows } = await pool.query('SELECT metadata_json FROM art_assets ORDER BY created_at DESC, id');
    return rows.map(row => normalizeArtAsset(JSON.parse(row.metadata_json)));
  }

  async function getArtAsset(id) {
    const { rows } = await pool.query('SELECT metadata_json FROM art_assets WHERE id = $1', [id]);
    return rows.length ? normalizeArtAsset(JSON.parse(rows[0].metadata_json)) : null;
  }

  // target 为 null 或缺少 targetId 时解除绑定；否则重新绑定到指定目标。
  async function setArtAssetTarget(id, target) {
    const current = await getArtAsset(id);
    if (!current) return null;
    const targetId = target && stringField(target.targetId).trim();
    const next = normalizeArtAsset({ ...current, unbound: !targetId, targetType: targetId ? target.targetType : '', targetId: targetId || '' });
    await pool.query('UPDATE art_assets SET card_id = $1, metadata_json = $2 WHERE id = $3', [next.cardId || '', JSON.stringify(next), next.id]);
    return next;
  }

  return { driver: DRIVER, read, replace, health, createArtAsset, listArtAssets, getArtAsset, setArtAssetTarget, close: () => pool.end() };
}
