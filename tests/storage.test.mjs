import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { ContentConflictError, createContentStore } from '../storage.mjs';
import { CONTENT_SCHEMA_VERSION, UnsupportedContentSchemaError } from '../storage-migrations.mjs';

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), 'worldforge-sqlite-'));
  const store = createContentStore(join(directory, 'worldforge.sqlite'));
  try { await run(store); } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
}

test('art assets can be unbound and rebound without losing the file record', async () => withStore(store => {
  const base = { id: 'ART-1111-2222', targetType: 'lore', targetId: 'CHR-W01-001', purpose: 'portrait', prompt: '提示词', model: 'seedream', size: '2K', mimeType: 'image/jpeg', fileName: 'ART-1111-2222.jpg', status: 'proposed', createdAt: '2026-10-15T00:00:00.000Z' };
  store.createArtAsset(base);
  assert.equal(store.getArtAsset(base.id).targetType, 'lore');
  assert.equal(store.getArtAsset(base.id).unbound, false);

  const unbound = store.setArtAssetTarget(base.id, null);
  assert.equal(unbound.unbound, true);
  assert.equal(unbound.targetType, '');
  assert.equal(unbound.targetId, '');
  // 图片本体与文件记录保留，解除的只是绑定关系
  const reread = store.getArtAsset(base.id);
  assert.equal(reread.fileName, 'ART-1111-2222.jpg');
  assert.equal(reread.unbound, true);
  // 重新读取列表时不能被 normalize 退回成 card 目标
  assert.equal(store.listArtAssets().find(asset => asset.id === base.id).targetType, '');
  assert.equal(store.listArtAssets().find(asset => asset.id === base.id).cardId, '');

  const rebound = store.setArtAssetTarget(base.id, { targetType: 'lore', targetId: 'CHR-W01-002' });
  assert.equal(rebound.unbound, false);
  assert.equal(rebound.targetType, 'lore');
  assert.equal(rebound.targetId, 'CHR-W01-002');

  const cardBound = store.setArtAssetTarget(base.id, { targetType: 'card', targetId: 'CARD-W01-0001' });
  assert.equal(cardBound.targetType, 'card');
  assert.equal(cardBound.cardId, 'CARD-W01-0001');

  assert.equal(store.setArtAssetTarget('ART-NOPE', null), null);
}));

test('SQLite content store persists structured world data', async () => withStore(store => {
  assert.equal(store.read().initialized, false);
  const saved = store.replace({
    expectedRevision: 0,
    loreEntries: [
      { id: 'CHR-W01-001', name: '测试角色', type: 'character', status: 'proposed', truthScope: 'objective', worldId: 'W01' },
      { id: 'STORY-W01-001', name: '测试传记', type: 'story', status: 'proposed', truthScope: 'unknown', worldId: 'W01', relationIds: ['CHR-W01-001'] }
    ],
    cardDrafts: [{ id: 'CARD-W01-0001', name: '测试卡', type: 'unit', status: 'proposed', worldId: 'W01' }],
    keywords: [{ id: 'KEY-001', name: '测试词', status: 'proposed', definition: '仅用于测试。' }],
    notes: { combat: '测试备注' }
  });
  assert.equal(saved.revision, 1);
  assert.equal(saved.loreEntries[0].name, '测试角色');
  assert.deepEqual(saved.loreEntries[1].relationIds, ['CHR-W01-001']);
  assert.equal(saved.cardDrafts[0].id, 'CARD-W01-0001');
  assert.equal(saved.keywords[0].definition, '仅用于测试。');
  assert.equal(saved.notes.combat, '测试备注');
  assert.equal(store.health().ok, true);
  const asset = store.createArtAsset({ id: 'ART-00000000-0000-0000-0000-000000000001', cardId: 'CARD-W01-0001', prompt: '测试插画', model: 'doubao-seedream-test', size: '1872x1248', mimeType: 'image/png', fileName: 'asset.png', status: 'proposed', createdAt: '2026-10-13T00:00:00.000Z', provenance: 'ai_generated', clientRequestId: 'request-0001' });
  assert.equal(store.getArtAsset(asset.id).prompt, '测试插画');
  assert.equal(store.getArtAsset(asset.id).clientRequestId, 'request-0001');
  assert.equal(store.listArtAssets().length, 1);
  const loreAsset=store.createArtAsset({id:'ART-00000000-0000-0000-0000-000000000002',targetType:'lore',targetId:'CHR-W01-001',purpose:'portrait',prompt:'人物原型',model:'test',size:'2K',mimeType:'image/png',fileName:'lore.png',status:'proposed',createdAt:'2026-10-13T00:00:01.000Z'});
  assert.equal(loreAsset.targetId,'CHR-W01-001');
  assert.equal(store.listArtAssets()[0].targetType,'lore');
}));

test('SQLite content store rejects stale revisions and duplicate IDs', async () => withStore(store => {
  store.replace({ expectedRevision: 0, loreEntries: [], cardDrafts: [], keywords: [], notes: {} });
  assert.throws(() => store.replace({ expectedRevision: 0, loreEntries: [], cardDrafts: [], keywords: [], notes: {} }), ContentConflictError);
  assert.throws(() => store.replace({ expectedRevision: 1, loreEntries: [{ id: 'W01' }, { id: 'W01' }], cardDrafts: [], keywords: [], notes: {} }), /重复 ID/);
}));

test('SQLite content store applies ordered migrations and reports them', async () => withStore(store => {
  const health = store.health();
  assert.equal(health.schemaVersion, CONTENT_SCHEMA_VERSION);
  assert.equal(health.migration.startingVersion, 0);
  assert.deepEqual(health.migration.applied.map(item => item.version), [1, 2, 3]);
}));

test('SQLite content store upgrades a version 1 database without losing content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'worldforge-sqlite-v1-'));
  const databasePath = join(directory, 'worldforge.sqlite');
  let store = createContentStore(databasePath);
  store.replace({
    expectedRevision: 0,
    loreEntries: [{ id: 'W01', name: '测试世界', type: 'world', status: 'canon', truthScope: 'objective', worldId: 'W01' }],
    cardDrafts: [],
    keywords: [],
    notes: {}
  });
  store.close();
  store = null;

  const legacy = new DatabaseSync(databasePath);
  legacy.exec('DROP TABLE art_assets; PRAGMA user_version = 1;');
  legacy.close();

  try {
    store = createContentStore(databasePath);
    assert.equal(store.read().loreEntries[0].id, 'W01');
    assert.equal(store.health().migration.startingVersion, 1);
    assert.deepEqual(store.health().migration.applied.map(item => item.version), [2, 3]);
    assert.deepEqual(store.listArtAssets(), []);
  } finally {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('SQLite content store rejects databases from a newer schema version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'worldforge-sqlite-future-'));
  const databasePath = join(directory, 'worldforge.sqlite');
  const future = new DatabaseSync(databasePath);
  future.exec(`PRAGMA user_version = ${CONTENT_SCHEMA_VERSION + 1}`);
  future.close();
  try {
    assert.throws(() => createContentStore(databasePath), UnsupportedContentSchemaError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
