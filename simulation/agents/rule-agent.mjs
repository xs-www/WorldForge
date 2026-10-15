const REQUEST_AMOUNT = 4;
const FLOW_AMOUNT = 2;

function energyOf(entity) {
  return Number(entity.state?.resources?.energy ?? 0);
}

export function proposeEnergyCrisisActions(instance) {
  const regionId = instance.regions[0]?.regionId;
  if (!regionId) return [];
  const entities = [...instance.entities].sort((left, right) => left.entityId.localeCompare(right.entityId));
  return entities.map(actor => {
    const balance = energyOf(actor);
    if (actor.state?.role === 'utility') {
      if (balance <= 0) return { actorId: actor.entityId, type: 'energy.request', parameters: { regionId, amount: REQUEST_AMOUNT } };
      const target = entities.find(entity => entity.entityId !== actor.entityId);
      return target
        ? { actorId: actor.entityId, type: 'energy.transfer', parameters: { targetId: target.entityId, amount: Math.min(FLOW_AMOUNT, balance) } }
        : { actorId: actor.entityId, type: 'energy.consume', parameters: { regionId, amount: Math.min(FLOW_AMOUNT, balance) } };
    }
    if (balance > 0) {
      return { actorId: actor.entityId, type: 'energy.consume', parameters: { regionId, amount: Math.min(FLOW_AMOUNT, balance) } };
    }
    return { actorId: actor.entityId, type: 'energy.request', parameters: { regionId, amount: REQUEST_AMOUNT } };
  });
}

export function energyCrisisProgress(instance) {
  const reserve = instance.regions.reduce((total, region) => total + Number(region.state?.resources?.energy?.reserve ?? 0), 0);
  const consumed = instance.regions.reduce((total, region) => total + Number(region.state?.resources?.energy?.consumed ?? 0), 0);
  const held = instance.entities.reduce((total, entity) => total + energyOf(entity), 0);
  return { reserve, held, consumed, total: reserve + held + consumed, completed: reserve === 0 && held === 0 };
}
