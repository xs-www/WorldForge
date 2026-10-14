import { packageHash } from '../compiler/world-package.mjs';
import {
  applyWorldEffects,
  createMechanicRuntime,
  deterministicSample,
  SimulationRuleError
} from '../rules/mechanic-runtime.mjs';
import { compileKnowledgeView, knowledgeRecipients } from './knowledge-view.mjs';

export class SimulationRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SimulationRuntimeError';
    this.code = code;
    this.details = details;
  }
}

function stateFromInstance(instance) {
  return { regions: structuredClone(instance.regions), entities: structuredClone(instance.entities) };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function contextFor(state, action, tick, knowledge) {
  const actor = state.entities.find(item => item.entityId === action.actorId);
  return deepFreeze({
    tick,
    actor: actor ? structuredClone(actor) : null,
    state: structuredClone(state),
    knowledge: structuredClone(knowledge)
  });
}

function eventId(tick, index) {
  return `EVT-SIM-${String(tick).padStart(6, '0')}-${String(index).padStart(4, '0')}`;
}

function knowledgeId(tick, index) {
  return `KNOW-${String(tick).padStart(6, '0')}-${String(index).padStart(4, '0')}`;
}

function validateBatch(actions, expectedTick) {
  if (!Array.isArray(actions)) throw new SimulationRuntimeError('INVALID_ACTION_BATCH', 'actions 必须是数组');
  const ids = new Set();
  for (const action of actions) {
    if (!action || typeof action.actionId !== 'string' || ids.has(action.actionId)) {
      throw new SimulationRuntimeError('DUPLICATE_OR_INVALID_ACTION_ID', 'Action ID 缺失或重复');
    }
    ids.add(action.actionId);
    if (action.expectedTick !== expectedTick) throw new SimulationRuntimeError('STALE_TICK', 'Action 基于过期 Tick');
  }
}

function rejection(action, validation, randomSample) {
  return {
    actionId: action.actionId,
    actorId: action.actorId,
    type: action.type,
    status: 'rejected',
    payload: structuredClone(action),
    validation,
    randomSample
  };
}

export function replayCommittedEvents(snapshot, events, targetTick) {
  let state = structuredClone(snapshot.state);
  const knowledge = structuredClone(snapshot.knowledge);
  for (const event of events) {
    if (event.tick > targetTick) break;
    if (event.type === 'simulation.action_committed') state = applyWorldEffects(state, event.payload.effects);
    if (event.type === 'knowledge.observed') knowledge.push(structuredClone(event.payload.record));
  }
  return { tick: targetTick, state, knowledge };
}

export function createSimulationRuntime({ store, mechanics }) {
  const mechanicRuntime = createMechanicRuntime(mechanics);

  function knowledgeView(instanceId, subjectId, atTick) {
    const instance = store.read(instanceId);
    if (!instance) throw new SimulationRuntimeError('INSTANCE_NOT_FOUND', `实例不存在：${instanceId}`);
    const tick = atTick ?? instance.currentTick;
    if (!Number.isInteger(tick) || tick < 0 || tick > instance.currentTick) throw new SimulationRuntimeError('INVALID_KNOWLEDGE_TICK', '知识视图 Tick 无效');
    return compileKnowledgeView(store.readKnowledge(instanceId, tick), subjectId, tick);
  }

  function availableActions(instanceId, subjectId) {
    const instance = store.read(instanceId);
    if (!instance) throw new SimulationRuntimeError('INSTANCE_NOT_FOUND', `实例不存在：${instanceId}`);
    const actor = instance.entities.find(item => item.entityId === subjectId);
    const context = deepFreeze({
      tick: instance.currentTick,
      actor: actor ? structuredClone(actor) : null,
      knowledge: knowledgeView(instanceId, subjectId)
    });
    return mechanicRuntime.getAvailableActions(context);
  }

  function advance(instanceId, { expectedStateVersion, actions }) {
    const instance = store.read(instanceId);
    if (!instance) throw new SimulationRuntimeError('INSTANCE_NOT_FOUND', `实例不存在：${instanceId}`);
    if (expectedStateVersion !== instance.stateVersion) throw new SimulationRuntimeError('STALE_STATE_VERSION', '提交基于过期状态版本');
    validateBatch(actions, instance.currentTick);

    const nextTick = instance.currentTick + 1;
    let workingState = stateFromInstance(instance);
    const ordered = actions.map(action => ({
      action: structuredClone(action),
      sample: deterministicSample(instance.randomSeed, nextTick, action.actionId)
    })).sort((left, right) => left.sample - right.sample || left.action.actionId.localeCompare(right.action.actionId));

    const committedActions = [];
    const events = [];
    const knowledgeRecords = [];
    let eventIndex = 0;
    let knowledgeIndex = 0;

    for (const { action, sample } of ordered) {
      const actorKnowledge = compileKnowledgeView(store.readKnowledge(instanceId, instance.currentTick), action.actorId, instance.currentTick);
      const context = contextFor(workingState, action, instance.currentTick, actorKnowledge);
      let validation;
      try {
        validation = mechanicRuntime.validate(action, context);
      } catch (error) {
        if (!(error instanceof SimulationRuleError) || error.code !== 'UNKNOWN_ACTION_TYPE') throw error;
        validation = { ok: false, code: error.code, message: error.message };
      }
      if (!validation?.ok) {
        committedActions.push(rejection(action, validation ?? { ok: false, code: 'INVALID_ACTION', message: '行动当前不可执行' }, sample));
        continue;
      }

      let effects;
      try {
        effects = mechanicRuntime.resolve(action, context);
        workingState = applyWorldEffects(workingState, effects);
      } catch (error) {
        if (!(error instanceof SimulationRuleError) || error.code !== 'RESOURCE_CONFLICT') throw error;
        committedActions.push(rejection(action, { ok: false, code: 'CONFLICT_REJECTED', message: '行动与同 Tick 的其他已接受行动冲突' }, sample));
        continue;
      }
      const knowledgePolicy = mechanicRuntime.knowledgePolicy(action, context);
      if (!['public', 'restricted', 'secret'].includes(knowledgePolicy.classification)
        || (knowledgePolicy.ttl != null && (!Number.isInteger(knowledgePolicy.ttl) || knowledgePolicy.ttl <= 0))) {
        throw new SimulationRuntimeError('INVALID_KNOWLEDGE_POLICY', '机制返回的知识策略无效');
      }

      const actionEventId = eventId(nextTick, eventIndex++);
      committedActions.push({
        actionId: action.actionId,
        actorId: action.actorId,
        type: action.type,
        status: 'accepted',
        payload: action,
        validation: { ok: true },
        randomSample: sample
      });
      events.push({
        eventId: actionEventId,
        tick: nextTick,
        type: 'simulation.action_committed',
        sourceId: action.actorId,
        payload: {
          actionId: action.actionId,
          actorId: action.actorId,
          targetIds: [action.parameters?.targetId, action.parameters?.regionId].filter(value => typeof value === 'string'),
          causeEventIds: [],
          effects,
          randomSample: sample
        }
      });

      for (const subjectId of knowledgeRecipients(action, workingState, { broadcast: knowledgePolicy.classification === 'public' })) {
        const record = {
          knowledgeId: knowledgeId(nextTick, knowledgeIndex++),
          subjectId,
          proposition: { kind: 'action_result', actionId: action.actionId, actionType: action.type, actorId: action.actorId, status: 'accepted' },
          sourceEventIds: [actionEventId],
          observedAtTick: nextTick,
          confidence: 1,
          classification: knowledgePolicy.classification,
          status: 'observed',
          ...(Number.isInteger(knowledgePolicy.ttl) && knowledgePolicy.ttl > 0 ? { expiresAtTick: nextTick + knowledgePolicy.ttl } : {})
        };
        knowledgeRecords.push(record);
        events.push({
          eventId: eventId(nextTick, eventIndex++),
          tick: nextTick,
          type: 'knowledge.observed',
          sourceId: action.actorId,
          payload: { record }
        });
      }
    }

    events.push({
      eventId: eventId(nextTick, eventIndex++),
      tick: nextTick,
      type: 'simulation.tick_committed',
      sourceId: instance.worldId,
      payload: {
        acceptedActionIds: committedActions.filter(action => action.status === 'accepted').map(action => action.actionId),
        rejectedActionIds: committedActions.filter(action => action.status === 'rejected').map(action => action.actionId),
        stateHash: packageHash(workingState)
      }
    });

    return store.commitTick({
      instanceId,
      expectedTick: instance.currentTick,
      expectedStateVersion,
      nextTick,
      state: workingState,
      actions: committedActions,
      events,
      knowledgeRecords
    });
  }

  function replay(instanceId, targetTick, { snapshotTick = 0 } = {}) {
    const instance = store.read(instanceId);
    if (!instance) throw new SimulationRuntimeError('INSTANCE_NOT_FOUND', `实例不存在：${instanceId}`);
    if (!Number.isInteger(targetTick) || targetTick < snapshotTick || targetTick > instance.currentTick) {
      throw new SimulationRuntimeError('INVALID_REPLAY_RANGE', '重放 Tick 范围无效');
    }
    const snapshot = store.readSnapshot(instanceId, snapshotTick);
    if (!snapshot) throw new SimulationRuntimeError('SNAPSHOT_NOT_FOUND', `快照不存在：${snapshotTick}`);
    const replayed = replayCommittedEvents(snapshot, store.readEvents(instanceId, snapshotTick, targetTick), targetTick);
    const expected = store.readSnapshot(instanceId, targetTick);
    const replayHash = packageHash(replayed.state);
    if (expected && replayHash !== expected.stateHash) throw new SimulationRuntimeError('REPLAY_DIVERGENCE', '事件重放结果与权威快照不一致');
    return { ...replayed, stateHash: replayHash };
  }

  return { advance, availableActions, knowledgeView, replay };
}
