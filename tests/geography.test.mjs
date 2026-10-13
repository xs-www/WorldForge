import test from 'node:test';
import assert from 'node:assert/strict';

await import('../dist/geography.js');
const geography = globalThis.WorldforgeGeography;

const location = (id, name, kind, parentId = '', worldId = 'W01') => ({
  id, name, type: 'location', worldId, summary: '', details: '', tags: [],
  location: { kind, parentId }
});

test('geography tree nests countries, cities and sites beneath their continent path', () => {
  const continent = location('LOC-CONTINENT', '岚洲', 'continent');
  const country = location('LOC-COUNTRY', '岚国', 'country', continent.id);
  const region = location('LOC-REGION', '北境', 'region', country.id);
  const city = location('LOC-CITY', '雾港', 'city', region.id);
  const site = location('LOC-SITE', '旧灯塔', 'site', city.id);
  const tree = geography.buildTree([site, city, country, region, continent]);

  assert.deepEqual(tree.roots.map(entry => entry.id), [continent.id]);
  assert.deepEqual(tree.children.get(continent.id).map(entry => entry.id), [country.id]);
  assert.deepEqual(tree.children.get(country.id).map(entry => entry.id), [region.id]);
  assert.deepEqual(tree.children.get(region.id).map(entry => entry.id), [city.id]);
  assert.deepEqual(tree.children.get(city.id).map(entry => entry.id), [site.id]);
  assert.equal(tree.orphans.length, 0);
});

test('geography search preserves ancestors and isolates entries with invalid parents', () => {
  const continent = location('LOC-CONTINENT', '岚洲', 'continent');
  const country = location('LOC-COUNTRY', '岚国', 'country', continent.id);
  const city = location('LOC-CITY', '雾港', 'city', country.id);
  const site = location('LOC-SITE', '旧灯塔', 'site', city.id);
  const orphan = location('LOC-ORPHAN', '无主遗迹', 'site', 'MISSING');
  const legacyCountry = location('LOC-LEGACY-COUNTRY', '旧国', 'country');
  const tree = geography.buildTree([continent, country, city, site, orphan, legacyCountry], '灯塔');

  assert.deepEqual([...tree.visibleIds], [site.id, city.id, country.id, continent.id]);
  assert.deepEqual(tree.orphans.map(entry => entry.id), [legacyCountry.id, orphan.id]);
  assert.equal(geography.canParent(continent, 'country', 'W01'), true);
  assert.equal(geography.canParent(country, 'city', 'W01'), true);
  assert.equal(geography.canParent(country, 'continent', 'W01'), false);
  assert.equal(geography.canParent(city, 'country', 'W01'), false);
  assert.equal(geography.canParent(country, 'city', 'W02'), false);
});
