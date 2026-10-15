import { compileWorldPackage } from '../compiler/world-package.mjs';

const polityDefinitions = [
  ['FAC-W98-001', '岚脊盟约'],
  ['FAC-W98-002', '澄河公国'],
  ['FAC-W98-003', '赤曜议会']
];

const regionDefinitions = [
  ['LOC-W98-001', '霜冠原', 0, 0, 'FAC-W98-001', 'upland', 80, 15, 10, 5, 2, 72, 14],
  ['LOC-W98-002', '高风谷', 1, 0, 'FAC-W98-001', 'hills', 95, 8, 7, 8, 2, 62, 15],
  ['LOC-W98-003', '焰潮岸', 2, 0, 'FAC-W98-003', 'coast', 120, 20, 8, 14, 3, 68, 20],
  ['LOC-W98-004', '赤帆港', 3, 0, 'FAC-W98-003', 'coast', 100, 14, 10, 12, 3, 70, 18],
  ['LOC-W98-005', '河门地', 0, 1, 'FAC-W98-002', 'river', 110, 12, 12, 9, 2, 64, 16],
  ['LOC-W98-006', '铁隘', 1, 1, 'FAC-W98-001', 'hills', 70, 5, 5, 13, 2, 42, 9],
  ['LOC-W98-007', '盐泽', 2, 1, 'FAC-W98-003', 'marsh', 85, 18, 11, 6, 1, 58, 12],
  ['LOC-W98-008', '曜阳平原', 3, 1, 'FAC-W98-003', 'plains', 130, 10, 14, 10, 2, 60, 19],
  ['LOC-W98-009', '西镜湖', 0, 2, 'FAC-W98-002', 'lake', 90, 22, 13, 5, 2, 75, 12],
  ['LOC-W98-010', '青穗盆地', 1, 2, 'FAC-W98-002', 'plains', 140, 16, 15, 7, 3, 69, 14],
  ['LOC-W98-011', '古渡', 2, 2, 'FAC-W98-002', 'river', 75, 7, 8, 8, 1, 50, 10],
  ['LOC-W98-012', '灰烬台地', 3, 2, 'FAC-W98-003', 'steppe', 65, 6, 5, 11, 1, 45, 16]
];

const entries = [
  {
    id: 'W98', title: '群陆演化实验世界', status: 'proposed', truthScope: 'objective', worldId: 'W98', type: 'world', refs: [],
    payload: { synthetic: true, summary: '宏观地图与局部精细化技术实验，不属于 WorldForge 正史。' }
  },
  ...polityDefinitions.map(([id, title]) => ({
    id, title, status: 'proposed', truthScope: 'objective', worldId: 'W98', type: 'faction', refs: ['W98'], payload: { synthetic: true }
  })),
  ...regionDefinitions.map(([id, title, , , ownerId]) => ({
    id, title, status: 'proposed', truthScope: 'objective', worldId: 'W98', type: 'location', refs: ['W98', ownerId], payload: { synthetic: true }
  }))
];

function neighborsFor(q, r) {
  const even = [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
  const odd = [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]];
  const deltas = r % 2 ? odd : even;
  return deltas.map(([dq, dr]) => regionDefinitions.find(item => item[2] === q + dq && item[3] === r + dr)?.[0]).filter(Boolean).sort();
}

export function createMacroContinentPackage() {
  return compileWorldPackage({
    manifest: {
      manifestVersion: 1,
      worldId: 'W98',
      definitionVersion: '0.1.0',
      sourceCommit: '4138b29',
      compilerVersion: '0.1.0',
      contentSources: ['synthetic-macro-inline'],
      selection: { defaultStatus: 'canon', experimentalIncludes: entries.map(entry => entry.id) },
      mechanics: { registry: 'synthetic-macro-inline', registryVersion: '0.1.0', modules: [] },
      initialState: {
        regions: regionDefinitions.map(([regionId, , q, r, ownerId, terrain, population, food, foodOutput, industry, infrastructure, stability, garrison]) => ({
          regionId,
          sourceId: regionId,
          state: { map: { q, r }, ownerId, terrain, neighbors: neighborsFor(q, r), population, food, foodOutput, industry, infrastructure, stability, garrison }
        })),
        entities: [
          { entityId: 'FAC-W98-001', sourceId: 'FAC-W98-001', regionId: 'LOC-W98-001', state: { role: 'polity', treasury: 55, legitimacy: 68, relations: { 'FAC-W98-002': 15, 'FAC-W98-003': -38 } } },
          { entityId: 'FAC-W98-002', sourceId: 'FAC-W98-002', regionId: 'LOC-W98-010', state: { role: 'polity', treasury: 50, legitimacy: 72, relations: { 'FAC-W98-001': 15, 'FAC-W98-003': 20 } } },
          { entityId: 'FAC-W98-003', sourceId: 'FAC-W98-003', regionId: 'LOC-W98-004', state: { role: 'polity', treasury: 70, legitimacy: 66, relations: { 'FAC-W98-001': -38, 'FAC-W98-002': 20 } } }
        ],
        events: []
      }
    },
    contentSources: [{ sourceVersion: 1, entries }],
    mechanicRegistry: { registryVersion: '0.1.0', mechanics: [] }
  });
}
