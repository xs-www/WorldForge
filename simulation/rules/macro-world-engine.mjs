import { deterministicSample } from './mechanic-runtime.mjs';

export const MACRO_ACTIONS = Object.freeze([
  { type: 'macro.relief', label: '粮食赈济', cost: 12, description: '向本国地区调拨粮食并恢复稳定度。' },
  { type: 'macro.invest', label: '基础设施投资', cost: 15, description: '提升本国地区的基础设施与工业。' },
  { type: 'macro.mobilize', label: '边境动员', cost: 10, description: '增加本国地区驻军，但短期降低稳定度。' },
  { type: 'macro.negotiate', label: '邻国谈判', cost: 8, description: '改善与相邻政体的关系。' }
]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function relationOf(polity, otherId) {
  return Number(polity?.state?.relations?.[otherId] ?? 0);
}

function setRelation(polities, leftId, rightId, value) {
  const normalized = clamp(Math.round(value), -100, 100);
  const left = polities.find(item => item.entityId === leftId);
  const right = polities.find(item => item.entityId === rightId);
  if (left) left.state.relations[rightId] = normalized;
  if (right) right.state.relations[leftId] = normalized;
}

function ownerBorders(state, leftId, rightId) {
  const regions = new Map(state.regions.map(region => [region.regionId, region]));
  return state.regions.some(region => region.state.ownerId === leftId
    && region.state.neighbors.some(id => regions.get(id)?.state.ownerId === rightId));
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function validateMacroAction(action, state) {
  const spec = MACRO_ACTIONS.find(item => item.type === action?.type);
  if (!spec) return { ok: false, code: 'UNKNOWN_MACRO_ACTION', message: '未知的局部行动' };
  const actor = state.entities.find(item => item.entityId === action.actorId && item.state?.role === 'polity');
  const region = state.regions.find(item => item.regionId === action?.parameters?.regionId);
  if (!actor || !region || region.state.ownerId !== actor.entityId) return { ok: false, code: 'ACTOR_SCOPE_VIOLATION', message: '政体只能干预自己控制的地区' };
  const expectedKeys = action.type === 'macro.negotiate' ? ['regionId', 'targetPolityId'] : ['regionId'];
  if (!exactKeys(action.parameters, expectedKeys)) return { ok: false, code: 'INVALID_PARAMETERS', message: '局部行动参数无效' };
  if (actor.state.treasury < spec.cost) return { ok: false, code: 'INSUFFICIENT_TREASURY', message: '政体财政不足' };
  if (action.type === 'macro.invest' && region.state.infrastructure >= 8) return { ok: false, code: 'INFRASTRUCTURE_LIMIT', message: '地区基础设施已达实验上限' };
  if (action.type === 'macro.negotiate') {
    const targetId = action.parameters.targetPolityId;
    if (!state.entities.some(item => item.entityId === targetId) || targetId === actor.entityId || !ownerBorders(state, actor.entityId, targetId)) {
      return { ok: false, code: 'INVALID_DIPLOMATIC_TARGET', message: '谈判对象必须是当前相邻政体' };
    }
  }
  return { ok: true, cost: spec.cost };
}

function applyMacroAction(action, state) {
  const validation = validateMacroAction(action, state);
  if (!validation.ok) return { validation };
  const actor = state.entities.find(item => item.entityId === action.actorId);
  const region = state.regions.find(item => item.regionId === action.parameters.regionId);
  actor.state.treasury -= validation.cost;
  let summary;
  if (action.type === 'macro.relief') {
    region.state.food += 18;
    region.state.stability = clamp(region.state.stability + 6, 0, 100);
    summary = `${region.regionId} 获得粮食赈济`;
  } else if (action.type === 'macro.invest') {
    region.state.infrastructure += 1;
    region.state.industry += 2;
    summary = `${region.regionId} 完成基础设施投资`;
  } else if (action.type === 'macro.mobilize') {
    region.state.garrison += 8;
    region.state.stability = clamp(region.state.stability - 2, 0, 100);
    summary = `${region.regionId} 完成边境动员`;
  } else {
    const targetId = action.parameters.targetPolityId;
    setRelation(state.entities, actor.entityId, targetId, relationOf(actor, targetId) + 12);
    summary = `${actor.entityId} 与 ${targetId} 展开谈判`;
  }
  return { validation, summary };
}

function event(type, sourceId, summary, detail = {}) {
  return { type, sourceId, payload: { summary, ...detail } };
}

function stateTotals(state) {
  return {
    population: state.regions.reduce((sum, region) => sum + region.state.population, 0),
    food: state.regions.reduce((sum, region) => sum + region.state.food, 0),
    industry: state.regions.reduce((sum, region) => sum + region.state.industry, 0),
    treasury: state.entities.reduce((sum, polity) => sum + polity.state.treasury, 0),
    averageStability: Math.round(state.regions.reduce((sum, region) => sum + region.state.stability, 0) / state.regions.length)
  };
}

export function macroSummary(instanceOrState) {
  const state = { regions: instanceOrState.regions, entities: instanceOrState.entities };
  const totals = stateTotals(state);
  const polities = state.entities.map(polity => {
    const regions = state.regions.filter(region => region.state.ownerId === polity.entityId);
    return {
      polityId: polity.entityId,
      regionCount: regions.length,
      population: regions.reduce((sum, region) => sum + region.state.population, 0),
      food: regions.reduce((sum, region) => sum + region.state.food, 0),
      industry: regions.reduce((sum, region) => sum + region.state.industry, 0),
      military: regions.reduce((sum, region) => sum + region.state.garrison, 0),
      treasury: polity.state.treasury,
      legitimacy: polity.state.legitimacy
    };
  });
  return { ...totals, polities };
}

export function advanceMacroWorld(instance, proposals = []) {
  const state = { regions: structuredClone(instance.regions), entities: structuredClone(instance.entities) };
  const nextTick = instance.currentTick + 1;
  const events = [];
  const actions = [];

  for (const proposal of proposals) {
    const outcome = applyMacroAction(proposal, state);
    actions.push({ ...proposal, status: outcome.validation.ok ? 'accepted' : 'rejected', validation: outcome.validation });
    if (outcome.validation.ok) events.push(event('macro.local_action', proposal.actorId, outcome.summary, { actionId: proposal.actionId, actionType: proposal.type, regionId: proposal.parameters.regionId }));
  }

  for (const region of [...state.regions].sort((a, b) => a.regionId.localeCompare(b.regionId))) {
    const variance = Math.floor(deterministicSample(instance.randomSeed, nextTick, `${region.regionId}:food`) * 3) - 1;
    region.state.food += Math.max(0, region.state.foodOutput + region.state.infrastructure + variance);
  }

  const regionById = new Map(state.regions.map(region => [region.regionId, region]));
  for (const receiver of [...state.regions].sort((a, b) => a.regionId.localeCompare(b.regionId))) {
    if (receiver.state.food >= 16) continue;
    const donors = receiver.state.neighbors.map(id => regionById.get(id)).filter(Boolean)
      .filter(donor => donor.state.food > 30)
      .filter(donor => donor.state.ownerId === receiver.state.ownerId
        || relationOf(state.entities.find(item => item.entityId === receiver.state.ownerId), donor.state.ownerId) > 15)
      .sort((a, b) => b.state.food - a.state.food || a.regionId.localeCompare(b.regionId));
    const donor = donors[0];
    if (!donor) continue;
    const amount = Math.min(6, donor.state.food - 30, 16 - receiver.state.food);
    if (amount <= 0) continue;
    donor.state.food -= amount;
    receiver.state.food += amount;
    const crossBorder = donor.state.ownerId !== receiver.state.ownerId;
    if (crossBorder) {
      const current = relationOf(state.entities.find(item => item.entityId === donor.state.ownerId), receiver.state.ownerId);
      setRelation(state.entities, donor.state.ownerId, receiver.state.ownerId, current + 2);
    }
    events.push(event('macro.trade', donor.regionId, `${donor.regionId} 向 ${receiver.regionId} 输送 ${amount} 单位粮食`, { fromRegionId: donor.regionId, toRegionId: receiver.regionId, amount, crossBorder }));
  }

  for (const region of [...state.regions].sort((a, b) => a.regionId.localeCompare(b.regionId))) {
    const consumption = Math.max(1, Math.ceil(region.state.population / 12));
    const shortage = Math.max(0, consumption - region.state.food);
    region.state.food = Math.max(0, region.state.food - consumption);
    if (shortage > 0) {
      region.state.population = Math.max(10, region.state.population - Math.ceil(shortage / 2));
      region.state.stability = clamp(region.state.stability - Math.min(8, shortage * 2), 0, 100);
      events.push(event('macro.shortage', region.regionId, `${region.regionId} 出现粮食短缺`, { regionId: region.regionId, shortage }));
    } else {
      if (region.state.food > 22 && region.state.stability >= 55) region.state.population += 1;
      region.state.stability = clamp(region.state.stability + (region.state.food > 12 ? 1 : 0), 0, 100);
    }
    if (region.state.stability >= 65 && deterministicSample(instance.randomSeed, nextTick, `${region.regionId}:industry`) > 0.55) region.state.industry += 1;
  }

  const migrated = new Set();
  for (const source of [...state.regions].sort((a, b) => a.regionId.localeCompare(b.regionId))) {
    if (source.state.stability >= 50 || source.state.population <= 20 || migrated.has(source.regionId)) continue;
    const target = source.state.neighbors.map(id => regionById.get(id)).filter(Boolean)
      .filter(region => region.state.stability >= source.state.stability + 15)
      .sort((a, b) => b.state.stability - a.state.stability || a.regionId.localeCompare(b.regionId))[0];
    if (!target) continue;
    source.state.population -= 1;
    target.state.population += 1;
    migrated.add(source.regionId);
    events.push(event('macro.migration', source.regionId, `人口从 ${source.regionId} 迁往 ${target.regionId}`, { fromRegionId: source.regionId, toRegionId: target.regionId, population: 1 }));
  }

  for (const polity of state.entities) {
    const owned = state.regions.filter(region => region.state.ownerId === polity.entityId);
    const revenue = owned.reduce((sum, region) => sum + Math.floor(region.state.industry / 4) + Math.floor(region.state.population / 60), 0);
    const upkeep = Math.floor(owned.reduce((sum, region) => sum + region.state.garrison, 0) / 18);
    polity.state.treasury = Math.max(0, polity.state.treasury + revenue - upkeep);
    const averageStability = owned.length ? owned.reduce((sum, region) => sum + region.state.stability, 0) / owned.length : 0;
    polity.state.legitimacy = clamp(polity.state.legitimacy + (averageStability >= 65 ? 1 : averageStability < 45 ? -2 : 0), 0, 100);
  }

  for (let leftIndex = 0; leftIndex < state.entities.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < state.entities.length; rightIndex += 1) {
      const left = state.entities[leftIndex], right = state.entities[rightIndex];
      if (!ownerBorders(state, left.entityId, right.entityId)) continue;
      const current = relationOf(left, right.entityId);
      const pressure = current < -20 ? -1 : current > 25 ? 1 : 0;
      setRelation(state.entities, left.entityId, right.entityId, current + pressure);
    }
  }

  if (nextTick % 4 === 0) {
    const powers = new Map(state.entities.map(polity => [polity.entityId,
      state.regions.filter(region => region.state.ownerId === polity.entityId).reduce((sum, region) => sum + region.state.garrison, 0)]));
    const candidates = [];
    for (const target of state.regions) {
      for (const neighborId of target.state.neighbors) {
        const attackerRegion = regionById.get(neighborId);
        if (!attackerRegion || attackerRegion.state.ownerId === target.state.ownerId) continue;
        const attackerId = attackerRegion.state.ownerId;
        const attacker = state.entities.find(item => item.entityId === attackerId);
        if (relationOf(attacker, target.state.ownerId) > -30) continue;
        const advantage = (powers.get(attackerId) ?? 0) - (powers.get(target.state.ownerId) ?? 0);
        if (advantage > 20 && target.state.stability < 55) candidates.push({ target, attackerId, advantage });
      }
    }
    candidates.sort((a, b) => a.target.state.stability - b.target.state.stability || b.advantage - a.advantage || a.target.regionId.localeCompare(b.target.regionId));
    const capture = candidates[0];
    if (capture) {
      const previousOwnerId = capture.target.state.ownerId;
      capture.target.state.ownerId = capture.attackerId;
      capture.target.state.stability = clamp(capture.target.state.stability - 12, 20, 100);
      capture.target.state.garrison = Math.max(6, Math.floor(capture.target.state.garrison / 2));
      const attacker = state.entities.find(item => item.entityId === capture.attackerId);
      const defender = state.entities.find(item => item.entityId === previousOwnerId);
      attacker.state.legitimacy = clamp(attacker.state.legitimacy + 2, 0, 100);
      defender.state.legitimacy = clamp(defender.state.legitimacy - 4, 0, 100);
      events.push(event('macro.border_change', capture.attackerId, `${capture.target.regionId} 的控制权发生变化`, { regionId: capture.target.regionId, previousOwnerId, ownerId: capture.attackerId }));
    }
  }

  const summary = stateTotals(state);
  events.push(event('macro.quarter_summary', instance.worldId, `第 ${nextTick} 季度宏观结算完成`, { tick: nextTick, ...summary }));
  return { state, actions, events, summary };
}
