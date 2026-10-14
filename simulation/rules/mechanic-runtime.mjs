import { createHash } from 'node:crypto';

export class SimulationRuleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SimulationRuleError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new SimulationRuleError(code, message, details);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

export function deterministicSample(seed, tick, scope) {
  const digest = createHash('sha256').update(`${seed}\u0000${tick}\u0000${scope}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

export function createMechanicRuntime(mechanics) {
  const byNamespace = new Map();
  for (const mechanic of mechanics) {
    if (!mechanic || typeof mechanic.id !== 'string' || typeof mechanic.version !== 'string') {
      fail('INVALID_MECHANIC_RUNTIME', '运行时机制缺少 id 或 version');
    }
    if (typeof mechanic.actionNamespace !== 'string' || byNamespace.has(mechanic.actionNamespace)) {
      fail('DUPLICATE_ACTION_NAMESPACE', `Action 命名空间无效或重复：${mechanic.actionNamespace}`);
    }
    for (const method of ['getAvailableActions', 'validate', 'resolve']) {
      if (typeof mechanic[method] !== 'function') fail('INVALID_MECHANIC_RUNTIME', `${mechanic.id} 缺少 ${method}`);
    }
    byNamespace.set(mechanic.actionNamespace, mechanic);
  }

  function mechanicFor(action) {
    const namespace = typeof action?.type === 'string' ? action.type.split('.')[0] : '';
    const mechanic = byNamespace.get(namespace);
    if (!mechanic) fail('UNKNOWN_ACTION_TYPE', '行动类型未由启用机制注册');
    return mechanic;
  }

  return {
    getAvailableActions(context) {
      return mechanics.flatMap(mechanic => mechanic.getAvailableActions(context).map(clone));
    },
    validate(action, context) {
      return mechanicFor(action).validate(clone(action), context);
    },
    resolve(action, context) {
      return mechanicFor(action).resolve(clone(action), context).map(clone);
    },
    knowledgePolicy(action, context) {
      const mechanic = mechanicFor(action);
      const policy = typeof mechanic.knowledgePolicy === 'function'
        ? mechanic.knowledgePolicy(clone(action), context)
        : { classification: 'restricted' };
      return clone(policy);
    }
  };
}

function endpointBalance(state, endpoint, resourceId) {
  if (endpoint.kind === 'region-reserve' || endpoint.kind === 'region-consumed') {
    const region = state.regions.find(item => item.regionId === endpoint.id);
    if (!region) fail('MISSING_EFFECT_TARGET', '效果引用了不存在的地区');
    const resource = region.state?.resources?.[resourceId];
    if (!plainObject(resource)) fail('MISSING_RESOURCE', '地区未定义该资源');
    const key = endpoint.kind === 'region-reserve' ? 'reserve' : 'consumed';
    if (!Number.isSafeInteger(resource[key]) || resource[key] < 0) fail('INVALID_RESOURCE_STATE', '地区资源状态无效');
    return { get: () => resource[key], set: value => { resource[key] = value; } };
  }
  if (endpoint.kind === 'entity') {
    const entity = state.entities.find(item => item.entityId === endpoint.id);
    if (!entity) fail('MISSING_EFFECT_TARGET', '效果引用了不存在的实体');
    const resources = entity.state?.resources;
    if (!plainObject(resources) || !Number.isSafeInteger(resources[resourceId]) || resources[resourceId] < 0) {
      fail('INVALID_RESOURCE_STATE', '实体资源状态无效');
    }
    return { get: () => resources[resourceId], set: value => { resources[resourceId] = value; } };
  }
  fail('INVALID_EFFECT_ENDPOINT', '效果端点类型无效');
}

export function resourceTotal(state, resourceId) {
  let total = 0;
  for (const region of state.regions) {
    const resource = region.state?.resources?.[resourceId];
    if (resource) total += Number(resource.reserve ?? 0) + Number(resource.consumed ?? 0);
  }
  for (const entity of state.entities) total += Number(entity.state?.resources?.[resourceId] ?? 0);
  if (!Number.isSafeInteger(total) || total < 0) fail('INVALID_RESOURCE_STATE', '资源总量无效');
  return total;
}

export function applyWorldEffects(inputState, effects) {
  const state = clone(inputState);
  for (const effect of effects) {
    if (!plainObject(effect) || effect.type !== 'resource.transfer') fail('UNSUPPORTED_EFFECT', '首版 Resolver 只接受 resource.transfer');
    if (typeof effect.resourceId !== 'string' || !Number.isSafeInteger(effect.amount) || effect.amount <= 0) {
      fail('INVALID_EFFECT', '资源转移效果必须提供正整数数量');
    }
    const before = resourceTotal(state, effect.resourceId);
    const from = endpointBalance(state, effect.from, effect.resourceId);
    const to = endpointBalance(state, effect.to, effect.resourceId);
    if (from.get() < effect.amount) fail('RESOURCE_CONFLICT', '同 Tick 行动竞争导致资源不足');
    from.set(from.get() - effect.amount);
    to.set(to.get() + effect.amount);
    const after = resourceTotal(state, effect.resourceId);
    if (after !== before) fail('RESOURCE_CONSERVATION_VIOLATION', 'Resolver 拒绝不守恒的资源效果');
  }
  return state;
}
