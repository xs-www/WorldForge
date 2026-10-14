const ACTIONS = [
  { type: 'energy.request', description: '从城市公共储备申请能源。' },
  { type: 'energy.transfer', description: '把自身能源转交给另一主体。' },
  { type: 'energy.consume', description: '消耗自身能源完成本 Tick 的生产或公共服务。' }
];

function invalid(code, message = '行动当前不可执行') {
  return { ok: false, code, message };
}

function entity(context, id) {
  return context.state.entities.find(item => item.entityId === id);
}

function region(context, id) {
  return context.state.regions.find(item => item.regionId === id);
}

function amountFrom(action) {
  return action?.parameters?.amount;
}

function hasExactParameters(action, keys) {
  const actual = Object.keys(action?.parameters ?? {}).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

export function createEnergyCrisisMechanic({ resourceId = 'energy' } = {}) {
  return Object.freeze({
    id: 'MEC-001',
    version: '1.0.0',
    actionNamespace: 'energy',

    getAvailableActions(context) {
      if (!context.actor) return [];
      return ACTIONS.map(action => ({ ...action, parameters: { amount: 'positive_integer' } }));
    },

    validate(action, context) {
      if (!action || typeof action.actionId !== 'string' || !action.actionId.startsWith('ACT-')) return invalid('INVALID_ACTION');
      if (action.actorId !== context.actor?.entityId) return invalid('ACTOR_SCOPE_VIOLATION');
      if (action.expectedTick !== context.tick) return invalid('STALE_TICK');
      const amount = amountFrom(action);
      if (!Number.isSafeInteger(amount) || amount <= 0) return invalid('INVALID_AMOUNT');
      const actorBalance = context.actor.state.resources?.[resourceId];
      if (!Number.isSafeInteger(actorBalance) || actorBalance < 0) return invalid('INVALID_ACTOR_RESOURCE');

      if (action.type === 'energy.request') {
        if (!hasExactParameters(action, ['amount', 'regionId'])) return invalid('INVALID_PARAMETERS');
        const targetRegion = region(context, action.parameters.regionId);
        if (!targetRegion || targetRegion.regionId !== context.actor.regionId) return invalid('ACTION_UNAVAILABLE');
        if ((targetRegion.state.resources?.[resourceId]?.reserve ?? -1) < amount) return invalid('ACTION_UNAVAILABLE');
        return { ok: true };
      }
      if (action.type === 'energy.transfer') {
        if (!hasExactParameters(action, ['amount', 'targetId'])) return invalid('INVALID_PARAMETERS');
        const target = entity(context, action.parameters.targetId);
        if (!target || target.regionId !== context.actor.regionId || target.entityId === context.actor.entityId) return invalid('INVALID_TARGET');
        if (actorBalance < amount) return invalid('INSUFFICIENT_ACTOR_RESOURCE', '自身可用能源不足');
        return { ok: true };
      }
      if (action.type === 'energy.consume') {
        if (!hasExactParameters(action, ['amount', 'regionId'])) return invalid('INVALID_PARAMETERS');
        const targetRegion = region(context, action.parameters.regionId);
        if (!targetRegion || targetRegion.regionId !== context.actor.regionId) return invalid('INVALID_TARGET');
        if (actorBalance < amount) return invalid('INSUFFICIENT_ACTOR_RESOURCE', '自身可用能源不足');
        return { ok: true };
      }
      return invalid('UNKNOWN_ACTION_TYPE');
    },

    knowledgePolicy(action) {
      return {
        classification: 'restricted',
        ...(action.type === 'energy.request' ? { ttl: 1 } : {})
      };
    },

    resolve(action, context) {
      const amount = amountFrom(action);
      if (action.type === 'energy.request') {
        return [{
          type: 'resource.transfer', resourceId, amount,
          from: { kind: 'region-reserve', id: action.parameters.regionId },
          to: { kind: 'entity', id: action.actorId }
        }];
      }
      if (action.type === 'energy.transfer') {
        return [{
          type: 'resource.transfer', resourceId, amount,
          from: { kind: 'entity', id: action.actorId },
          to: { kind: 'entity', id: action.parameters.targetId }
        }];
      }
      return [{
        type: 'resource.transfer', resourceId, amount,
        from: { kind: 'entity', id: action.actorId },
        to: { kind: 'region-consumed', id: action.parameters.regionId }
      }];
    }
  });
}
