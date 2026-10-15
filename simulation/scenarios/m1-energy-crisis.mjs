import { compileWorldPackage } from '../compiler/world-package.mjs';
import { createEnergyCrisisMechanic, ENERGY_CRISIS_CONTRACT } from '../rules/energy-crisis-mechanic.mjs';

const entries = [
  {
    id: 'W99', title: 'M1 合成测试世界', status: 'proposed', truthScope: 'objective', worldId: 'W99', type: 'world', refs: [],
    payload: { synthetic: true, summary: '仅用于验证纯规则模拟，不属于 WorldForge 正史。' }
  },
  {
    id: 'LOC-W99-001', title: '测试城市', status: 'proposed', truthScope: 'objective', worldId: 'W99', type: 'location', refs: ['W99'],
    payload: { synthetic: true }
  },
  {
    id: 'FAC-W99-001', title: '测试供能机构', status: 'proposed', truthScope: 'objective', worldId: 'W99', type: 'faction', refs: ['W99', 'LOC-W99-001'],
    payload: { synthetic: true }
  },
  {
    id: 'FAC-W99-002', title: '测试市政机构', status: 'proposed', truthScope: 'objective', worldId: 'W99', type: 'faction', refs: ['W99', 'LOC-W99-001'],
    payload: { synthetic: true }
  }
];

const mechanicRegistry = {
  registryVersion: '0.3.0',
  mechanics: [{
    id: 'MEC-001',
    version: '1.1.0',
    actionNamespace: 'energy',
    effectNamespace: 'resource',
    dependencies: [],
    contract: ENERGY_CRISIS_CONTRACT,
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['resourceId'],
      properties: { resourceId: { type: 'string', enum: ['energy'] } }
    }
  }]
};

export function createM1EnergyCrisisPackage({ reserve = 12 } = {}) {
  if (!Number.isSafeInteger(reserve) || reserve <= 0) throw new TypeError('reserve 必须是正整数');
  return compileWorldPackage({
    manifest: {
      manifestVersion: 1,
      worldId: 'W99',
      definitionVersion: '0.1.0',
      sourceCommit: '21e1982',
      compilerVersion: '0.1.0',
      contentSources: ['synthetic-inline'],
      selection: { defaultStatus: 'canon', experimentalIncludes: entries.map(entry => entry.id) },
      mechanics: {
        registry: 'synthetic-inline',
        registryVersion: '0.3.0',
        modules: [{ id: 'MEC-001', version: '1.1.0', parameters: { resourceId: 'energy' } }]
      },
      initialState: {
        regions: [{
          regionId: 'LOC-W99-001', sourceId: 'LOC-W99-001',
          state: { resources: { energy: { reserve, consumed: 0 } } }
        }],
        entities: [
          { entityId: 'FAC-W99-001', sourceId: 'FAC-W99-001', regionId: 'LOC-W99-001', state: { role: 'utility', resources: { energy: 0 } } },
          { entityId: 'FAC-W99-002', sourceId: 'FAC-W99-002', regionId: 'LOC-W99-001', state: { role: 'council', resources: { energy: 0 } } }
        ],
        events: []
      }
    },
    contentSources: [{ sourceVersion: 1, entries }],
    mechanicRegistry
  });
}

export function createM1EnergyCrisisMechanics() {
  return [createEnergyCrisisMechanic({ resourceId: 'energy' })];
}
