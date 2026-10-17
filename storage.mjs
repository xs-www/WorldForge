import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyContentMigrations, CONTENT_SCHEMA_VERSION } from './storage-migrations.mjs';

const MAX_ITEMS = 10000;
// 与 dist/lore-groups.js 的 MAX_GROUPS 保持一致：自定义资料组的上限。
const MAX_GROUPS = 40;

export class ContentConflictError extends Error {
  constructor(message = '内容已被其他页面更新，请刷新后重试') {
    super(message);
    this.name = 'ContentConflictError';
    this.status = 409;
  }
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value;
}

function stringField(value, fallback = '') { return typeof value === 'string' ? value : fallback; }

function validateItems(value, label, maximum = MAX_ITEMS) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} 必须是数组且不得超过 ${maximum} 项`);
  const ids = new Set();
  return value.map((raw, index) => {
    const item = plainObject(raw, `${label}[${index}]`);
    const id = stringField(item.id).trim();
    if (!id || id.length > 160) throw new Error(`${label}[${index}] 的 ID 无效`);
    if (ids.has(id)) throw new Error(`${label} 存在重复 ID：${id}`);
    ids.add(id);
    return JSON.parse(JSON.stringify(item));
  });
}

export function validateContentSnapshot(value) {
  const payload = plainObject(value, '内容快照');
  const notes = plainObject(payload.notes || {}, 'notes');
  const safeNotes = {};
  const noteEntries = Object.entries(notes);
  if (noteEntries.length > 200) throw new Error('notes 不得超过 200 项');
  for (const [key, body] of noteEntries) {
    if (!key || key.length > 160 || typeof body !== 'string' || body.length > 200000) throw new Error(`备注 ${key || '(empty)'} 无效`);
    safeNotes[key] = body;
  }
  return {
    loreEntries: validateItems(payload.loreEntries || [], 'loreEntries'),
    cardDrafts: validateItems(payload.cardDrafts || [], 'cardDrafts'),
    keywords: validateItems(payload.keywords || [], 'keywords'),
    // 自定义资料组：五项固定组由代码提供，不落库；这里只是作者新建的组，数量上限很小。
    loreGroups: validateItems(payload.loreGroups || [], 'loreGroups', MAX_GROUPS),
    notes: safeNotes
  };
}

export function createContentStore(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  let migration;
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
    `);
    migration = applyContentMigrations(db);
  } catch (error) {
    db.close();
    throw error;
  }

  const getMeta = db.prepare('SELECT value FROM metadata WHERE key = ?');
  const putMeta = db.prepare('INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const selectLore = db.prepare('SELECT payload_json FROM lore_entries ORDER BY position, id');
  const selectCards = db.prepare('SELECT payload_json FROM card_drafts ORDER BY position, id');
  const selectKeywords = db.prepare('SELECT payload_json FROM keywords ORDER BY position, id');
  const selectNotes = db.prepare('SELECT note_key, body FROM notes ORDER BY note_key');
  const selectLoreGroups = db.prepare('SELECT payload_json FROM lore_groups ORDER BY position, id');
  const insertLore = db.prepare('INSERT INTO lore_entries(id, position, name, type, status, truth_scope, world_id, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertCard = db.prepare('INSERT INTO card_drafts(id, position, name, card_type, status, world_id, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertKeyword = db.prepare('INSERT INTO keywords(id, position, name, status, definition, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertNote = db.prepare('INSERT INTO notes(note_key, body, updated_at) VALUES (?, ?, ?)');
  const insertLoreGroup = db.prepare('INSERT INTO lore_groups(id, position, label, form, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  const selectArtAssets = db.prepare('SELECT metadata_json FROM art_assets ORDER BY created_at DESC, id');
  const selectArtAsset = db.prepare('SELECT metadata_json FROM art_assets WHERE id = ?');
  const insertArtAsset = db.prepare('INSERT INTO art_assets(id, card_id, prompt, model, size, mime_type, file_name, status, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const updateArtAssetTarget = db.prepare('UPDATE art_assets SET card_id = ?, metadata_json = ? WHERE id = ?');

  function meta(key, fallback = null) { return getMeta.get(key)?.value ?? fallback; }

  function read() {
    return {
      schemaVersion: CONTENT_SCHEMA_VERSION,
      initialized: meta('initialized') === '1',
      revision: Number(meta('revision', '0')),
      updatedAt: meta('updated_at'),
      // 多人协作的署名：最后一次整库保存的账号。旧库没有该键时为 null，不代表数据损坏。
      lastSavedBy: meta('last_saved_by'),
      loreEntries: selectLore.all().map(row => JSON.parse(row.payload_json)),
      cardDrafts: selectCards.all().map(row => JSON.parse(row.payload_json)),
      keywords: selectKeywords.all().map(row => JSON.parse(row.payload_json)),
      notes: Object.fromEntries(selectNotes.all().map(row => [row.note_key, row.body])),
      loreGroups: selectLoreGroups.all().map(row => JSON.parse(row.payload_json))
    };
  }

  function replace(value, { actor = '' } = {}) {
    const snapshot = validateContentSnapshot(value);
    const expectedRevision = value.expectedRevision;
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const revision = Number(meta('revision', '0'));
      if (expectedRevision !== undefined && Number(expectedRevision) !== revision) throw new ContentConflictError();
      db.exec('DELETE FROM lore_entries; DELETE FROM card_drafts; DELETE FROM keywords; DELETE FROM notes; DELETE FROM lore_groups;');
      snapshot.loreEntries.forEach((item, position) => insertLore.run(item.id, position, stringField(item.name), stringField(item.type, 'world'), stringField(item.status, 'proposed'), stringField(item.truthScope, 'objective'), stringField(item.worldId), JSON.stringify(item), stringField(item.updatedAt, now)));
      snapshot.cardDrafts.forEach((item, position) => insertCard.run(item.id, position, stringField(item.name), stringField(item.type, 'unit'), stringField(item.status, 'proposed'), stringField(item.worldId), JSON.stringify(item), now));
      snapshot.keywords.forEach((item, position) => insertKeyword.run(item.id, position, stringField(item.name), stringField(item.status, 'proposed'), stringField(item.definition), JSON.stringify(item), now));
      for (const [key, body] of Object.entries(snapshot.notes)) insertNote.run(key, body, now);
      snapshot.loreGroups.forEach((item, position) => insertLoreGroup.run(item.id, position, stringField(item.label, item.id), stringField(item.form, 'generic'), JSON.stringify(item), now));
      putMeta.run('initialized', '1');
      putMeta.run('revision', String(revision + 1));
      putMeta.run('updated_at', now);
      putMeta.run('last_saved_by', actor || 'anonymous');
      db.exec('COMMIT');
      return read();
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function health() {
    return {
      ok: db.prepare('PRAGMA quick_check').get().quick_check === 'ok',
      databasePath,
      schemaVersion: CONTENT_SCHEMA_VERSION,
      migration
    };
  }

  function normalizeArtAsset(value){
    const asset=JSON.parse(JSON.stringify(value));
    // unbound 表示这张画作已与绑定目标解除关系，但仍留在素材库里（会显示为“未使用”）。
    const unbound=asset.unbound===true||asset.targetType==='';
    const targetType=unbound?'':(asset.targetType==='lore'?'lore':'card');
    const targetId=unbound?'':stringField(asset.targetId||asset.cardId).trim();
    return{...asset,unbound,targetType,targetId,worldId:unbound?'':stringField(asset.worldId).trim(),purpose:stringField(asset.purpose,targetType==='card'?'card_art':'concept'),cardId:targetType==='card'?targetId:''};
  }

  // target 为 null 或缺少 targetId 时解除绑定；否则重新绑定到指定目标。
  function setArtAssetTarget(id, target) {
    const current = getArtAsset(id);
    if (!current) return null;
    const targetId = target && stringField(target.targetId).trim();
    const next = normalizeArtAsset({ ...current, unbound: !targetId, targetType: targetId ? target.targetType : '', targetId: targetId || '', worldId: targetId ? stringField(target?.worldId ?? current.worldId).trim() : '' });
    updateArtAssetTarget.run(next.cardId || '', JSON.stringify(next), next.id);
    return next;
  }

  function createArtAsset(value) {
    const asset = plainObject(value, '美术资源');
    const normalized=normalizeArtAsset(asset);
    // 未绑定（unbound）的资产本来就没有 targetId；只有绑定态才要求目标非空，
    // 否则导入一份含「未使用原画」的库会整批注册失败。
    for (const field of ['id', 'prompt', 'model', 'size', 'mimeType', 'fileName', 'status', 'createdAt']) {
      if (!stringField(normalized[field]).trim()) throw new Error(`美术资源缺少 ${field}`);
    }
    if (!normalized.unbound && !stringField(normalized.targetId).trim()) throw new Error('美术资源缺少 targetId');
    if (!/^ART-[A-F0-9-]+$/i.test(normalized.id) || !/^[A-Za-z0-9._-]+$/.test(normalized.fileName)) throw new Error('美术资源 ID 或文件名无效');
    const safe = normalized;
    insertArtAsset.run(safe.id, safe.targetId, safe.prompt, safe.model, safe.size, safe.mimeType, safe.fileName, safe.status, safe.createdAt, JSON.stringify(safe));
    return safe;
  }

  function listArtAssets() { return selectArtAssets.all().map(row => normalizeArtAsset(JSON.parse(row.metadata_json))); }
  function getArtAsset(id) { const row = selectArtAsset.get(id); return row ? normalizeArtAsset(JSON.parse(row.metadata_json)) : null; }

  return { read, replace, health, createArtAsset, listArtAssets, getArtAsset, setArtAssetTarget, close: () => db.close() };
}
