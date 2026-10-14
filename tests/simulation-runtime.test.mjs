import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSimulationRuntime, SimulationRuntimeError } from '../simulation/runtime/simulation-runtime.mjs';
import { resourceTotal } from '../simulation/rules/mechanic-runtime.mjs';
import { createM1EnergyCrisisMechanics, createM1EnergyCrisisPackage } from '../simulation/scenarios/m1-energy-crisis.mjs';
import { createWorldInstanceStore } from '../simulation/storage/instance-store.mjs';

async function withRuntime(run) {
  const directory = await mkdtemp(join(tmpdir(), 'worldforge-m1-'));
  const store = createWorldInstanceStore(join(directory, 'simulation.sqlite'));
  const runtime = createSimulationRuntime({ store, mechanics: createM1EnergyCrisisMechanics() });
  const worldPackage = createM1EnergyCrisisPackage();
  try {
    await run({ store, runtime, worldPackage });
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const competingRequests = [
  {
    actionId: 'ACT-REQUEST-UTILITY', actorId: 'FAC-W99-001', type: 'energy.request', expectedTick: 0,
    parameters: { regionId: 'LOC-W99-001', amount: 8 }
  },
  {
    actionId: 'ACT-REQUEST-COUNCIL', actorId: 'FAC-W99-002', type: 'energy.request', expectedTick: 0,
    parameters: { regionId: 'LOC-W99-001', amount: 8 }
  }
];

test('M1 exposes exactly three energy actions through an actor-scoped context', async () => withRuntime(({ store, runtime, worldPackage }) => {
  store.instantiate(worldPackage, { instanceId: 'INST-ACTIONS', randomSeed: 'm1-seed' });
  assert.deepEqual(
    runtime.availableActions('INST-ACTIONS', 'FAC-W99-001').map(action => action.type),
    ['energy.request', 'energy.transfer', 'energy.consume']
  );
  assert.deepEqual(runtime.knowledgeView('INST-ACTIONS', 'FAC-W99-001'), []);
}));

test('M1 resolves same-tick resource conflicts deterministically and preserves energy', async () => withRuntime(({ store, runtime, worldPackage }) => {
  store.instantiate(worldPackage, { instanceId: 'INST-A', randomSeed: 'm1-seed' });
  store.instantiate(worldPackage, { instanceId: 'INST-B', randomSeed: 'm1-seed' });

  const first = runtime.advance('INST-A', { expectedStateVersion: 0, actions: competingRequests });
  const second = runtime.advance('INST-B', { expectedStateVersion: 0, actions: competingRequests });
  const firstActions = store.readActions('INST-A', 1);
  const secondActions = store.readActions('INST-B', 1);
  assert.equal(firstActions.filter(action => action.status === 'accepted').length, 1);
  assert.equal(firstActions.filter(action => action.status === 'rejected').length, 1);
  assert.equal(
    firstActions.find(action => action.status === 'accepted').actionId,
    secondActions.find(action => action.status === 'accepted').actionId
  );
  assert.equal(resourceTotal({ regions: first.regions, entities: first.entities }, 'energy'), 12);
  assert.deepEqual(first.regions, second.regions);
  assert.deepEqual(first.entities, second.entities);
}));

test('M1 rejects stale writes and keeps rejection reasons free of hidden reserve values', async () => withRuntime(({ store, runtime, worldPackage }) => {
  store.instantiate(worldPackage, { instanceId: 'INST-STALE', randomSeed: 'm1-seed' });
  runtime.advance('INST-STALE', { expectedStateVersion: 0, actions: competingRequests });
  assert.throws(
    () => runtime.advance('INST-STALE', { expectedStateVersion: 0, actions: [] }),
    error => error instanceof SimulationRuntimeError && error.code === 'STALE_STATE_VERSION'
  );
  const rejected = store.readActions('INST-STALE', 1).find(action => action.status === 'rejected');
  assert.equal(rejected.validation.message.includes('4'), false);
  assert.equal(rejected.validation.message.includes('reserve'), false);
}));

test('M1 isolates actor knowledge, expires records, and replays committed events from tick zero', async () => withRuntime(({ store, runtime, worldPackage }) => {
  store.instantiate(worldPackage, { instanceId: 'INST-REPLAY', randomSeed: 'm1-seed' });
  const tickOne = runtime.advance('INST-REPLAY', { expectedStateVersion: 0, actions: competingRequests });
  const accepted = store.readActions('INST-REPLAY', 1).find(action => action.status === 'accepted');
  const winnerId = accepted.actorId;
  const otherId = winnerId === 'FAC-W99-001' ? 'FAC-W99-002' : 'FAC-W99-001';
  assert.equal(runtime.knowledgeView('INST-REPLAY', winnerId, 1).length, 1);
  assert.equal(runtime.knowledgeView('INST-REPLAY', otherId, 1).length, 0);

  const tickTwoActions = [
    {
      actionId: 'ACT-SHARE', actorId: winnerId, type: 'energy.transfer', expectedTick: 1,
      parameters: { targetId: otherId, amount: 3 }
    },
    {
      actionId: 'ACT-CONSUME', actorId: winnerId, type: 'energy.consume', expectedTick: 1,
      parameters: { regionId: 'LOC-W99-001', amount: 2 }
    }
  ];
  const current = runtime.advance('INST-REPLAY', { expectedStateVersion: tickOne.stateVersion, actions: tickTwoActions });
  assert.equal(runtime.knowledgeView('INST-REPLAY', winnerId, 2).some(record => record.proposition.actionId === accepted.actionId), false);
  assert.equal(runtime.knowledgeView('INST-REPLAY', otherId, 2).some(record => record.proposition.actionId === 'ACT-CONSUME'), false);
  assert.equal(runtime.knowledgeView('INST-REPLAY', otherId, 2).some(record => record.proposition.actionId === 'ACT-SHARE'), true);

  const replayed = runtime.replay('INST-REPLAY', 2, { snapshotTick: 0 });
  assert.deepEqual(replayed.state.regions, current.regions);
  assert.deepEqual(replayed.state.entities, current.entities);
  assert.equal(replayed.stateHash, store.readSnapshot('INST-REPLAY', 2).stateHash);
  assert.deepEqual(replayed.knowledge, store.readKnowledge('INST-REPLAY', 2));
  assert.equal(store.readEvents('INST-REPLAY', 1, 2).some(event => event.type === 'simulation.tick_committed'), true);
  assert.equal(resourceTotal(replayed.state, 'energy'), 12);
}));
