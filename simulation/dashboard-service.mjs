import { createSimulationRuntime } from './runtime/simulation-runtime.mjs';
import { createM1EnergyCrisisMechanics, createM1EnergyCrisisPackage } from './scenarios/m1-energy-crisis.mjs';
import { createWorldInstanceStore } from './storage/instance-store.mjs';
import { energyCrisisProgress, proposeEnergyCrisisActions } from './agents/rule-agent.mjs';

const DEFAULT_INSTANCE_ID = 'INST-W99-DASHBOARD';
const MAX_ACTIONS_PER_TICK = 10;
const MAX_AUTO_TICKS = 50;
const RANDOM_SEED = 'worldforge-dashboard-seed';

export class SimulationDashboardError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'SimulationDashboardError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new SimulationDashboardError(code, message, status);
}

function titleIndex(definition) {
  return new Map([
    ...definition.content.objectiveDefinitions,
    ...definition.content.beliefSeeds,
    ...definition.content.unresolvedMetadata
  ].map(item => [item.id, item.title]));
}

function normalizeProposals(proposals, instance) {
  if (!Array.isArray(proposals) || proposals.length > MAX_ACTIONS_PER_TICK) {
    fail('INVALID_PROPOSALS', `actions 必须是数组且每 Tick 不超过 ${MAX_ACTIONS_PER_TICK} 项`);
  }
  const actorIds = new Set(instance.entities.map(entity => entity.entityId));
  return proposals.map((proposal, index) => {
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) fail('INVALID_PROPOSAL', 'Action 提案必须是对象');
    if (!actorIds.has(proposal.actorId)) fail('INVALID_ACTOR', 'Action 主体不属于当前实验实例');
    if (typeof proposal.type !== 'string' || !proposal.type.startsWith('energy.')) fail('INVALID_ACTION_TYPE', '当前观察台只接受 W99 energy Action');
    if (!proposal.parameters || typeof proposal.parameters !== 'object' || Array.isArray(proposal.parameters)) fail('INVALID_PARAMETERS', 'Action parameters 必须是对象');
    return {
      actionId: `ACT-UI-${String(instance.currentTick + 1).padStart(6, '0')}-${String(index).padStart(2, '0')}`,
      actorId: proposal.actorId,
      type: proposal.type,
      expectedTick: instance.currentTick,
      parameters: structuredClone(proposal.parameters)
    };
  });
}

export function createSimulationDashboardService(databasePath, { instanceId = DEFAULT_INSTANCE_ID } = {}) {
  const store = createWorldInstanceStore(databasePath);
  const runtime = createSimulationRuntime({ store, mechanics: createM1EnergyCrisisMechanics() });
  if (!store.read(instanceId)) store.instantiate(createM1EnergyCrisisPackage(), { instanceId, randomSeed: RANDOM_SEED });

  function view() {
    const instance = store.read(instanceId);
    const titles = titleIndex(instance.definition);
    const knowledge = Object.fromEntries(instance.entities.map(entity => [entity.entityId, runtime.knowledgeView(instanceId, entity.entityId)]));
    const allActions = store.readActions(instanceId, instance.currentTick);
    const allEvents = store.readEvents(instanceId, -1, instance.currentTick);
    const actions = allActions.slice(-30).reverse();
    const events = allEvents.slice(-30).reverse();
    const regionEnergy = instance.regions.reduce((total, region) => total
      + Number(region.state?.resources?.energy?.reserve ?? 0)
      + Number(region.state?.resources?.energy?.consumed ?? 0), 0);
    const entityEnergy = instance.entities.reduce((total, entity) => total + Number(entity.state?.resources?.energy ?? 0), 0);
    const progress = energyCrisisProgress(instance);
    const replay = runtime.replay(instanceId, instance.currentTick);
    return {
      experimental: true,
      instance: {
        instanceId: instance.instanceId,
        worldId: instance.worldId,
        title: titles.get(instance.worldId) ?? instance.worldId,
        currentTick: instance.currentTick,
        stateVersion: instance.stateVersion,
        definitionHash: instance.definitionHash,
        status: instance.status
      },
      mechanics: instance.definition.mechanics.modules.map(module => ({
        id: module.id, version: module.version,
        actions: module.contract.actions.map(action => ({ type: action.type, parametersSchema: action.parametersSchema }))
      })),
      regions: instance.regions.map(region => ({ ...region, title: titles.get(region.regionId) ?? region.regionId })),
      entities: instance.entities.map(entity => ({ ...entity, title: titles.get(entity.entityId) ?? entity.entityId })),
      totals: { energy: regionEnergy + entityEnergy },
      progress,
      verification: { replayVerified: true, stateHash: replay.stateHash },
      counts: { actions: allActions.length, events: allEvents.length },
      knowledge,
      actions,
      events
    };
  }

  function advance(payload) {
    const instance = store.read(instanceId);
    if (!Number.isInteger(payload?.expectedStateVersion) || payload.expectedStateVersion !== instance.stateVersion) {
      fail('STALE_STATE_VERSION', '页面状态已经过期，请刷新后重试', 409);
    }
    const actions = normalizeProposals(payload.actions, instance);
    try {
      runtime.advance(instanceId, { expectedStateVersion: payload.expectedStateVersion, actions });
    } catch (error) {
      if (error?.code === 'STALE_STATE_VERSION' || error?.code === 'STALE_INSTANCE_STATE') {
        fail(error.code, '页面状态已经过期，请刷新后重试', 409);
      }
      if (typeof error?.code === 'string') fail(error.code, error.message || 'Action 提案被拒绝');
      throw error;
    }
    return view();
  }

  function run(payload) {
    let instance = store.read(instanceId);
    const startingTick = instance.currentTick;
    if (!Number.isInteger(payload?.expectedStateVersion) || payload.expectedStateVersion !== instance.stateVersion) {
      fail('STALE_STATE_VERSION', '页面状态已经过期，请刷新后重试', 409);
    }
    const maxTicks = payload.maxTicks ?? 20;
    if (!Number.isInteger(maxTicks) || maxTicks < 1 || maxTicks > MAX_AUTO_TICKS) {
      fail('INVALID_MAX_TICKS', `maxTicks 必须是 1 到 ${MAX_AUTO_TICKS} 的整数`);
    }
    let ticksAdvanced = 0;
    while (!energyCrisisProgress(instance).completed && ticksAdvanced < maxTicks) {
      const actions = normalizeProposals(proposeEnergyCrisisActions(instance), instance);
      instance = runtime.advance(instanceId, { expectedStateVersion: instance.stateVersion, actions });
      ticksAdvanced += 1;
    }
    const result = view();
    const runActions = store.readActions(instanceId, result.instance.currentTick).filter(action => action.tick > startingTick);
    return {
      ...result,
      run: {
        ticksAdvanced,
        stopReason: result.progress.completed ? 'completed' : 'tick_limit',
        acceptedActions: runActions.filter(action => action.status === 'accepted').length,
        rejectedActions: runActions.filter(action => action.status === 'rejected').length,
        replayVerified: result.verification.replayVerified
      }
    };
  }

  function reset(payload) {
    const instance = store.read(instanceId);
    if (!Number.isInteger(payload?.expectedStateVersion) || payload.expectedStateVersion !== instance.stateVersion) {
      fail('STALE_STATE_VERSION', '页面状态已经过期，请刷新后重试', 409);
    }
    store.reset(createM1EnergyCrisisPackage(), { instanceId, randomSeed: RANDOM_SEED });
    return view();
  }

  return { view, advance, run, reset, health: () => store.health(), close: () => store.close() };
}
