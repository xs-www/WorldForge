import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { ContentConflictError } from '../storage.mjs';
import { CONTENT_SCHEMA_VERSION } from '../storage-migrations.mjs';
import { createPostgresContentStore, describePostgresTarget, POSTGRES_MIGRATIONS } from '../storage-postgres.mjs';

// 这个文件必须能在“机器上没有任何 PostgreSQL”的情况下通过：
// 只有显式设置 WORLDFORGE_TEST_PG_URL 时才会真的连库，其余断言全是纯函数。

test('createPostgresContentStore rejects a missing connection string without touching the network', async () => {
  // 空对象、无参、空串、非字符串四种形态都必须在建 pool 之前就失败。
  for (const options of [{}, undefined, { connectionString: '' }, { connectionString: '   ' }, { connectionString: 42 }]) {
    await assert.rejects(createPostgresContentStore(options), /connectionString/);
    await assert.rejects(createPostgresContentStore(options), /PostgreSQL 连接串/);
  }
});

test('describePostgresTarget keeps host:port/database and drops credentials', () => {
  const target = describePostgresTarget('postgres://user:secret@host:5432/db?sslmode=require');
  assert.equal(target, 'host:5432/db');
  assert.ok(!target.includes('secret'), '不能带出口令');
  assert.ok(!target.includes('user'), '不能带出用户名');
  assert.ok(!target.includes('sslmode'), '查询参数必须被抹掉');
  assert.ok(target.includes('host:5432'));
  assert.ok(target.includes('db'));

  // 省略端口时回落到 5432；百分号编码的口令同样不得出现。
  assert.equal(describePostgresTarget('postgresql://user:p%40ss@db.internal/worldforge'), 'db.internal:5432/worldforge');
  assert.ok(!describePostgresTarget('postgresql://user:p%40ss@db.internal/worldforge').includes('p%40ss'));

  // 解析不了的 libpq 形式：至少要把 password= 的值换成 ***。
  const fallback = describePostgresTarget('host=db.internal password=secret dbname=worldforge');
  assert.ok(!fallback.includes('secret'));
  assert.ok(fallback.includes('password=***'));

  assert.equal(describePostgresTarget(''), '(未配置连接串)');
});

test('POSTGRES_MIGRATIONS is ordered, unique and mirrors the SQLite migration set', () => {
  assert.ok(Array.isArray(POSTGRES_MIGRATIONS));
  assert.deepEqual(POSTGRES_MIGRATIONS.map(migration => migration.version), [1, 2, 3]);
  assert.deepEqual(POSTGRES_MIGRATIONS.map(migration => migration.name), ['content-core', 'art-assets', 'lore-groups']);
  // 严格递增：迁移只能追加，不能插队或重号。
  for (let index = 1; index < POSTGRES_MIGRATIONS.length; index += 1) {
    assert.ok(POSTGRES_MIGRATIONS[index].version > POSTGRES_MIGRATIONS[index - 1].version);
  }
  for (const migration of POSTGRES_MIGRATIONS) assert.equal(typeof migration.up, 'function');
  // 迁移不该超过 SQLite 侧声明的支持版本，否则 health() 报的 schemaVersion 会自相矛盾。
  assert.ok(POSTGRES_MIGRATIONS.at(-1).version <= CONTENT_SCHEMA_VERSION);
});

test('PostgreSQL content store round-trips against a live server', async t => {
  const connectionString = process.env.WORLDFORGE_TEST_PG_URL;
  if (!connectionString) return t.skip('未设置 WORLDFORGE_TEST_PG_URL，跳过真实 PostgreSQL 往返测试');
  if (!/^postgres(ql)?:\/\//i.test(connectionString)) return t.skip('WORLDFORGE_TEST_PG_URL 必须是 URL 形式，才能隔离到临时 schema');

  // 用一次性 schema 隔离，绝不碰 public 里的正式表；跑完 DROP SCHEMA ... CASCADE。
  const schema = `wf_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  let store;
  try {
    // search_path 只能通过连接串传；先单独探测一次，若驱动没生效就直接跳过，避免污染 public。
    const isolatedUrl = new URL(connectionString);
    isolatedUrl.searchParams.set('options', `-c search_path=${schema}`);
    const probe = new pg.Client({ connectionString: isolatedUrl.toString() });
    await probe.connect();
    const probeSchema = (await probe.query('SELECT current_schema() AS name')).rows[0].name;
    await probe.end();
    if (probeSchema !== schema) return t.skip(`驱动未生效 options=search_path（实际 schema: ${probeSchema}），跳过以免写入 public`);

    store = await createPostgresContentStore({ connectionString: isolatedUrl.toString() });

    const saved = await store.replace({
      expectedRevision: 0,
      loreEntries: [{ id: 'CHR-W01-001', name: '测试角色', type: 'character', status: 'proposed', truthScope: 'objective', worldId: 'W01' }],
      cardDrafts: [],
      keywords: [],
      loreGroups: [{ id: 'GRP-001', label: '自定义组', form: 'list' }],
      notes: { combat: '测试备注' }
    });
    assert.equal(saved.revision, 1);
    assert.equal(saved.loreGroups[0].id, 'GRP-001');

    const reread = await store.read();
    assert.equal(reread.loreEntries[0].name, '测试角色');
    assert.equal(reread.notes.combat, '测试备注');

    // 乐观锁沿用 storage.mjs 的同一个错误类：instanceof 与 status 必须与 SQLite 一致。
    await assert.rejects(
      store.replace({ expectedRevision: 0, loreEntries: [], cardDrafts: [], keywords: [], notes: {} }),
      error => error instanceof ContentConflictError && error.status === 409
    );

    const asset = await store.createArtAsset({ id: 'ART-1111-2222', targetType: 'lore', targetId: 'CHR-W01-001', prompt: '测试插画', model: 'seedream', size: '2K', mimeType: 'image/jpeg', fileName: 'ART-1111-2222.jpg', status: 'proposed', createdAt: '2026-10-15T00:00:00.000Z' });
    assert.equal((await store.getArtAsset(asset.id)).targetType, 'lore');
    assert.equal((await store.listArtAssets()).length, 1);
    assert.equal((await store.setArtAssetTarget(asset.id, null)).unbound, true);

    const health = await store.health();
    assert.equal(health.ok, true);
    assert.equal(health.driver, 'postgres');
    const password = new URL(connectionString).password;
    if (password) assert.ok(!health.target.includes(decodeURIComponent(password)), 'health.target 不能带出口令');
  } finally {
    if (store) await store.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
