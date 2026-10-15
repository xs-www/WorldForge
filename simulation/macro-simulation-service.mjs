import { packageHash } from './compiler/world-package.mjs';
import { fallbackMacroProposal, parseMacroProposal } from './llm/macro-proposal.mjs';
import { advanceMacroWorld, MACRO_ACTIONS, macroSummary, validateMacroAction } from './rules/macro-world-engine.mjs';
import { deterministicSample } from './rules/mechanic-runtime.mjs';
import { createMacroContinentPackage } from './scenarios/m2-macro-continent.mjs';
import { createWorldInstanceStore } from './storage/instance-store.mjs';

const DEFAULT_INSTANCE_ID = 'INST-W98-MACRO';
const RANDOM_SEED = 'worldforge-macro-continent-v1';
const MAX_AUTO_QUARTERS = 40;

export class MacroSimulationError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'MacroSimulationError'; this.code = code; this.status = status; }
}

function fail(code, message, status) { throw new MacroSimulationError(code, message, status); }

function titlesFor(instance) {
  return new Map(instance.definition.content.objectiveDefinitions.map(item => [item.id, item.title]));
}

function normalizeActions(actions, instance) {
  if (!Array.isArray(actions) || actions.length > 3) fail('INVALID_ACTIONS', '每季度最多接受 3 个局部行动');
  return actions.map((action, index) => {
    const normalized = {
      actionId: `ACT-MACRO-${String(instance.currentTick + 1).padStart(6, '0')}-${String(index).padStart(2, '0')}`,
      actorId: String(action?.actorId || ''),
      type: String(action?.type || ''),
      parameters: structuredClone(action?.parameters || {})
    };
    return normalized;
  });
}

function clock(tick) {
  return { year: Math.floor(tick / 4) + 1, quarter: tick % 4 + 1, elapsedQuarters: tick };
}

export function createMacroSimulationService(databasePath, { instanceId = DEFAULT_INSTANCE_ID } = {}) {
  const store = createWorldInstanceStore(databasePath);
  if (!store.read(instanceId)) store.instantiate(createMacroContinentPackage(), { instanceId, randomSeed: RANDOM_SEED });

  function replay(instance) {
    let state = store.readSnapshot(instanceId, 0)?.state;
    for (const entry of store.readEvents(instanceId, -1, instance.currentTick)) {
      if (entry.type === 'macro.state_committed') state = entry.payload.state;
    }
    const snapshot = store.readSnapshot(instanceId, instance.currentTick);
    const replayHash = packageHash(state);
    return { replayVerified: replayHash === snapshot.stateHash, stateHash: snapshot.stateHash, replayHash };
  }

  function localContext(regionId) {
    const instance = store.read(instanceId);
    const titles = titlesFor(instance);
    const region = instance.regions.find(item => item.regionId === regionId);
    if (!region) fail('REGION_NOT_FOUND', '地区不存在', 404);
    const owner = instance.entities.find(item => item.entityId === region.state.ownerId);
    const neighborSet = new Set(region.state.neighbors);
    const recent = store.readEvents(instanceId, Math.max(-1, instance.currentTick - 4), instance.currentTick)
      .filter(item => item.sourceId === regionId || item.payload?.regionId === regionId || neighborSet.has(item.sourceId))
      .slice(-8).map(item => ({ tick: item.tick, type: item.type, summary: item.payload.summary }));
    return {
      world: { worldId: instance.worldId, experimental: true, tick: instance.currentTick, clock: clock(instance.currentTick) },
      selectedRegion: { regionId, title: titles.get(regionId), ...structuredClone(region.state) },
      owner: { polityId: owner.entityId, title: titles.get(owner.entityId), treasury: owner.state.treasury, legitimacy: owner.state.legitimacy },
      neighbors: instance.regions.filter(item => neighborSet.has(item.regionId)).map(item => ({ regionId: item.regionId, title: titles.get(item.regionId), ownerId: item.state.ownerId, terrain: item.state.terrain, population: item.state.population, food: item.state.food, stability: item.state.stability, garrison: item.state.garrison })),
      relations: Object.entries(owner.state.relations).map(([polityId, value]) => ({ polityId, title: titles.get(polityId), value })),
      recentEvents: recent,
      availableActions: MACRO_ACTIONS.map(item => ({ ...item }))
    };
  }

  function view() {
    const instance = store.read(instanceId);
    const titles = titlesFor(instance);
    const allEvents = store.readEvents(instanceId, -1, instance.currentTick);
    const history = allEvents.filter(item => item.type === 'macro.quarter_summary').map(item => ({ tick: item.tick, ...item.payload }));
    const totals = macroSummary(instance);
    return {
      experimental: true,
      architecture: { macro: 'deterministic_rules', local: 'llm_proposal_then_rule_validation' },
      instance: { instanceId, worldId: instance.worldId, title: titles.get(instance.worldId), currentTick: instance.currentTick, stateVersion: instance.stateVersion, status: instance.status },
      clock: clock(instance.currentTick),
      totals,
      polities: totals.polities.map(item => ({ ...item, title: titles.get(item.polityId), relations: structuredClone(instance.entities.find(entity => entity.entityId === item.polityId).state.relations) })),
      regions: instance.regions.map(item => ({ regionId: item.regionId, title: titles.get(item.regionId), ...structuredClone(item.state) })),
      actions: MACRO_ACTIONS,
      history,
      recentEvents: allEvents.filter(item => item.type !== 'macro.state_committed').slice(-24).reverse(),
      verification: replay(instance)
    };
  }

  function step(payload = {}) {
    const instance = store.read(instanceId);
    if (payload.expectedStateVersion !== instance.stateVersion) fail('STALE_STATE_VERSION', '页面状态已经过期，请刷新后重试', 409);
    const proposals = normalizeActions(payload.actions || [], instance);
    const outcome = advanceMacroWorld(instance, proposals);
    const tick = instance.currentTick + 1;
    const actions = outcome.actions.map((action, index) => ({
      actionId: action.actionId, actorId: action.actorId, type: action.type, status: action.status,
      payload: { parameters: action.parameters }, validation: action.validation,
      randomSample: deterministicSample(instance.randomSeed, tick, `${action.actionId}:${index}`)
    }));
    const events = outcome.events.map((item, index) => ({ eventId: `EVT-W98-${String(tick).padStart(6, '0')}-${String(index).padStart(3, '0')}`, sourceId: item.sourceId, tick, type: item.type, payload: item.payload }));
    events.push({ eventId: `EVT-W98-${String(tick).padStart(6, '0')}-998`, sourceId: instance.worldId, tick, type: 'macro.state_committed', payload: { state: outcome.state } });
    store.commitTick({ instanceId, expectedTick: instance.currentTick, expectedStateVersion: instance.stateVersion, nextTick: tick, state: outcome.state, actions, events, knowledgeRecords: [] });
    return view();
  }

  function run(payload = {}) {
    let instance = store.read(instanceId);
    if (payload.expectedStateVersion !== instance.stateVersion) fail('STALE_STATE_VERSION', '页面状态已经过期，请刷新后重试', 409);
    const quarters = payload.quarters ?? 4;
    if (!Number.isInteger(quarters) || quarters < 1 || quarters > MAX_AUTO_QUARTERS) fail('INVALID_QUARTERS', `quarters 必须是 1 到 ${MAX_AUTO_QUARTERS} 的整数`);
    for (let index = 0; index < quarters; index += 1) {
      step({ expectedStateVersion: instance.stateVersion, actions: [] });
      instance = store.read(instanceId);
    }
    return { ...view(), run: { quartersAdvanced: quarters } };
  }

  function reset(payload = {}) {
    const instance = store.read(instanceId);
    if (payload.expectedStateVersion !== instance.stateVersion) fail('STALE_STATE_VERSION', '页面状态已经过期，请刷新后重试', 409);
    store.reset(createMacroContinentPackage(), { instanceId, randomSeed: RANDOM_SEED });
    return view();
  }

  function fallbackProposal(regionId) {
    const instance = store.read(instanceId);
    const context = localContext(regionId);
    return { ...fallbackMacroProposal(context, instance), context };
  }

  function parseModelProposal(raw, regionId) {
    const instance = store.read(instanceId);
    const context = localContext(regionId);
    return { ...parseMacroProposal(raw, context, instance), context };
  }

  function validateProposal(proposal, regionId) {
    const instance = store.read(instanceId);
    if (proposal?.action?.parameters?.regionId !== regionId) fail('REGION_SCOPE_VIOLATION', '提案越过了选中地区边界');
    const validation = validateMacroAction(proposal.action, instance);
    if (!validation.ok) fail(validation.code, validation.message);
    return { ...proposal, validation };
  }

  return { view, step, run, reset, localContext, fallbackProposal, parseModelProposal, validateProposal, health: () => store.health(), close: () => store.close() };
}
