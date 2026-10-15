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

function validateSchema(schema, value, path, code) {
  if (!plainObject(schema)) fail('INVALID_MECHANIC_CONTRACT', `${path} Schema 无效`);
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter(candidate => {
      try {
        validateSchema(candidate, value, path, code);
        return true;
      } catch (error) {
        if (error instanceof SimulationRuleError && error.code === code) return false;
        throw error;
      }
    });
    if (matches.length !== 1) fail(code, `${path} 不匹配唯一允许结构`);
    return;
  }
  if ('const' in schema && value !== schema.const) fail(code, `${path} 必须为 ${schema.const}`);
  if (schema.type === 'object') {
    if (!plainObject(value)) fail(code, `${path} 必须是对象`);
    const properties = plainObject(schema.properties) ? schema.properties : {};
    for (const key of schema.required ?? []) {
      if (!(key in value)) fail(code, `${path}.${key} 为必填字段`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) fail(code, `${path}.${key} 不是允许字段`);
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (key in value) validateSchema(child, value[key], `${path}.${key}`, code);
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || (schema.minLength != null && value.length < schema.minLength)) fail(code, `${path} 必须是有效字符串`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(code, `${path} 格式无效`);
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value)) fail(code, `${path} 必须是安全整数`);
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(code, `${path} 必须是有限数值`);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') fail(code, `${path} 必须是布尔值`);
  } else if (schema.type != null) {
    fail('INVALID_MECHANIC_CONTRACT', `${path} 使用了不支持的 Schema 类型`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) fail(code, `${path} 不在允许枚举中`);
  if (typeof value === 'number' && schema.minimum != null && value < schema.minimum) fail(code, `${path} 小于允许下限`);
  if (typeof value === 'number' && schema.maximum != null && value > schema.maximum) fail(code, `${path} 超过允许上限`);
}

const ACTION_ENVELOPE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['actionId', 'actorId', 'type', 'expectedTick', 'parameters'],
  properties: {
    actionId: { type: 'string', pattern: '^ACT-[A-Z0-9-]+$' },
    actorId: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    expectedTick: { type: 'integer', minimum: 0 },
    parameters: { type: 'object' }
  }
};

const ACCESS_PATH_PATTERN = /^(?:actor|knowledge|tick|regions\.\*\.state\.resources\.[a-z][a-z0-9-]*\.(?:reserve|consumed)|entities\.\*\.state\.resources\.[a-z][a-z0-9-]*)$/;

function validateContract(mechanic) {
  const contract = mechanic.contract;
  if (!plainObject(contract) || !Array.isArray(contract.actions) || !Array.isArray(contract.effects)
    || !plainObject(contract.access) || !Array.isArray(contract.access.reads) || !Array.isArray(contract.access.writes)
    || !plainObject(contract.knowledge) || !Array.isArray(contract.knowledge.classifications)) {
    fail('INVALID_MECHANIC_CONTRACT', `${mechanic.id} 缺少完整运行时契约`);
  }
  const actionTypes = new Set();
  for (const action of contract.actions) {
    if (!plainObject(action) || typeof action.type !== 'string' || !action.type.startsWith(`${mechanic.actionNamespace}.`)
      || actionTypes.has(action.type) || !plainObject(action.parametersSchema)) {
      fail('INVALID_MECHANIC_CONTRACT', `${mechanic.id} 的 Action 契约无效`);
    }
    actionTypes.add(action.type);
  }
  const effectTypes = new Set();
  for (const effect of contract.effects) {
    if (!plainObject(effect) || typeof effect.type !== 'string' || !effect.type.startsWith(`${mechanic.effectNamespace}.`)
      || effectTypes.has(effect.type) || !plainObject(effect.schema)) {
      fail('INVALID_MECHANIC_CONTRACT', `${mechanic.id} 的 Effect 契约无效`);
    }
    effectTypes.add(effect.type);
  }
  for (const path of [...contract.access.reads, ...contract.access.writes]) {
    if (typeof path !== 'string' || !ACCESS_PATH_PATTERN.test(path)) fail('INVALID_MECHANIC_CONTRACT', `${mechanic.id} 使用了无效访问路径：${path}`);
  }
  if (contract.knowledge.classifications.some(value => !['public', 'restricted', 'secret'].includes(value))
    || !Number.isInteger(contract.knowledge.maxTtl) || contract.knowledge.maxTtl < 0) {
    fail('INVALID_MECHANIC_CONTRACT', `${mechanic.id} 的知识权限无效`);
  }
  return clone(contract);
}

function effectWritePaths(effect) {
  if (effect.type !== 'resource.transfer') return [];
  return [effect.from, effect.to].map(endpoint => {
    if (endpoint?.kind === 'region-reserve') return `regions.*.state.resources.${effect.resourceId}.reserve`;
    if (endpoint?.kind === 'region-consumed') return `regions.*.state.resources.${effect.resourceId}.consumed`;
    if (endpoint?.kind === 'entity') return `entities.*.state.resources.${effect.resourceId}`;
    return '';
  });
}

function scopedContext(contract, context) {
  const scoped = {};
  if (contract.access.reads.includes('tick')) scoped.tick = context.tick;
  if (contract.access.reads.includes('actor')) scoped.actor = clone(context.actor);
  if (contract.access.reads.includes('knowledge')) scoped.knowledge = clone(context.knowledge);

  const regionPaths = contract.access.reads.filter(path => path.startsWith('regions.'));
  const entityPaths = contract.access.reads.filter(path => path.startsWith('entities.'));
  if (regionPaths.length > 0 || entityPaths.length > 0) {
    scoped.state = { regions: [], entities: [] };
    if (regionPaths.length > 0) {
      scoped.state.regions = (context.state?.regions ?? []).map(region => {
        const resources = {};
        for (const path of regionPaths) {
          const [, , , , resourceId, field] = path.split('.');
          const value = region.state?.resources?.[resourceId]?.[field];
          if (value !== undefined) resources[resourceId] = { ...(resources[resourceId] ?? {}), [field]: clone(value) };
        }
        return { regionId: region.regionId, state: { resources } };
      });
    }
    if (entityPaths.length > 0) {
      scoped.state.entities = (context.state?.entities ?? []).map(entity => {
        const resources = {};
        for (const path of entityPaths) {
          const [, , , , resourceId] = path.split('.');
          const value = entity.state?.resources?.[resourceId];
          if (value !== undefined) resources[resourceId] = clone(value);
        }
        return { entityId: entity.entityId, regionId: entity.regionId, state: { resources } };
      });
    }
  }
  return scoped;
}

export function deterministicSample(seed, tick, scope) {
  const digest = createHash('sha256').update(`${seed}\u0000${tick}\u0000${scope}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

export function createMechanicRuntime(mechanics) {
  const byNamespace = new Map();
  const contracts = new Map();
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
    contracts.set(mechanic, validateContract(mechanic));
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
      const mechanic = mechanicFor(action);
      const contract = contracts.get(mechanic);
      validateSchema(ACTION_ENVELOPE_SCHEMA, action, 'action', 'INVALID_ACTION_CONTRACT');
      const actionContract = contract.actions.find(item => item.type === action.type);
      if (!actionContract) fail('UNKNOWN_ACTION_TYPE', '行动类型未在机制契约中注册');
      validateSchema(actionContract.parametersSchema, action.parameters, 'action.parameters', 'INVALID_ACTION_CONTRACT');
      return mechanic.validate(clone(action), scopedContext(contract, context));
    },
    resolve(action, context) {
      const mechanic = mechanicFor(action);
      const contract = contracts.get(mechanic);
      const effects = mechanic.resolve(clone(action), scopedContext(contract, context));
      if (!Array.isArray(effects)) fail('INVALID_EFFECT_CONTRACT', '机制必须返回 Effect 数组');
      for (const effect of effects) {
        const effectContract = contract.effects.find(item => item.type === effect?.type);
        if (!effectContract) fail('UNAUTHORIZED_EFFECT', `机制返回未授权 Effect：${effect?.type}`);
        validateSchema(effectContract.schema, effect, 'effect', 'INVALID_EFFECT_CONTRACT');
        for (const path of effectWritePaths(effect)) {
          if (!path || !contract.access.writes.includes(path)) fail('UNAUTHORIZED_EFFECT_WRITE', `Effect 写入未授权路径：${path || 'unknown'}`);
        }
      }
      return effects.map(clone);
    },
    knowledgePolicy(action, context) {
      const mechanic = mechanicFor(action);
      const policy = typeof mechanic.knowledgePolicy === 'function'
        ? mechanic.knowledgePolicy(clone(action), scopedContext(contracts.get(mechanic), context))
        : { classification: 'restricted' };
      if (!contractKnowledgeAllows(contracts.get(mechanic).knowledge, policy)) {
        fail('UNAUTHORIZED_KNOWLEDGE_POLICY', '机制返回的知识策略超出契约权限');
      }
      return clone(policy);
    }
  };
}

function contractKnowledgeAllows(permission, policy) {
  return plainObject(policy)
    && permission.classifications.includes(policy.classification)
    && (policy.ttl == null || (Number.isInteger(policy.ttl) && policy.ttl > 0 && policy.ttl <= permission.maxTtl));
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
