import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSimulationDashboardService, SimulationDashboardError } from '../simulation/dashboard-service.mjs';

async function withDashboard(run) {
  const directory = await mkdtemp(join(tmpdir(), 'worldforge-dashboard-'));
  const service = createSimulationDashboardService(join(directory, 'simulation.sqlite'));
  try { await run(service); }
  finally { service.close(); await rm(directory, { recursive: true, force: true }); }
}

test('simulation dashboard exposes the W99 experiment without promoting it to canon', async () => withDashboard(service => {
  const view = service.view();
  assert.equal(view.experimental, true);
  assert.equal(view.instance.worldId, 'W99');
  assert.equal(view.instance.currentTick, 0);
  assert.equal(view.totals.energy, 12);
  assert.deepEqual(view.mechanics[0].actions.map(action => action.type), ['energy.request', 'energy.transfer', 'energy.consume']);
  assert.equal(view.entities.length, 2);
}));

test('simulation dashboard advances through contracts and returns auditable actor views', async () => withDashboard(service => {
  const initial = service.view();
  const advanced = service.advance({
    expectedStateVersion: initial.instance.stateVersion,
    actions: [
      { actorId: 'FAC-W99-001', type: 'energy.request', parameters: { regionId: 'LOC-W99-001', amount: 8 } },
      { actorId: 'FAC-W99-002', type: 'energy.request', parameters: { regionId: 'LOC-W99-001', amount: 8 } }
    ]
  });
  assert.equal(advanced.instance.currentTick, 1);
  assert.equal(advanced.actions.filter(action => action.status === 'accepted').length, 1);
  assert.equal(advanced.actions.filter(action => action.status === 'rejected').length, 1);
  assert.equal(advanced.totals.energy, 12);
  assert.deepEqual(Object.values(advanced.knowledge).map(records => records.length).sort(), [0, 1]);
  assert.throws(
    () => service.advance({ expectedStateVersion: initial.instance.stateVersion, actions: [] }),
    error => error instanceof SimulationDashboardError && error.status === 409
  );
  assert.throws(
    () => service.advance({
      expectedStateVersion: advanced.instance.stateVersion,
      actions: [{ actorId: 'FAC-W99-001', type: 'energy.consume', parameters: { regionId: 'LOC-W99-001', amount: 0 } }]
    }),
    error => error instanceof SimulationDashboardError && error.status === 400 && error.code === 'INVALID_ACTION_CONTRACT'
  );
}));

test('rule agents run the energy crisis to completion and reset it reproducibly', async () => withDashboard(service => {
  const initial = service.view();
  const completed = service.run({ expectedStateVersion: initial.instance.stateVersion, maxTicks: 20 });
  assert.equal(completed.run.stopReason, 'completed');
  assert.equal(completed.run.ticksAdvanced, 7);
  assert.equal(completed.instance.currentTick, 7);
  assert.deepEqual(completed.progress, { reserve: 0, held: 0, consumed: 12, total: 12, completed: true });
  assert.equal(completed.verification.replayVerified, true);
  assert.equal(completed.run.replayVerified, true);
  assert.equal(completed.run.acceptedActions, 13);
  assert.equal(completed.run.rejectedActions, 1);
  assert.equal(completed.counts.actions, 14);
  assert.equal(completed.actions.filter(action => action.status === 'rejected').length, 1);

  assert.throws(
    () => service.run({ expectedStateVersion: initial.instance.stateVersion, maxTicks: 20 }),
    error => error instanceof SimulationDashboardError && error.status === 409
  );
  assert.throws(
    () => service.run({ expectedStateVersion: completed.instance.stateVersion, maxTicks: 51 }),
    error => error instanceof SimulationDashboardError && error.code === 'INVALID_MAX_TICKS'
  );
  assert.throws(
    () => service.reset({ expectedStateVersion: initial.instance.stateVersion }),
    error => error instanceof SimulationDashboardError && error.status === 409
  );
  const reset = service.reset({ expectedStateVersion: completed.instance.stateVersion });
  assert.equal(reset.instance.currentTick, 0);
  assert.equal(reset.counts.actions, 0);
  assert.deepEqual(reset.progress, { reserve: 12, held: 0, consumed: 0, total: 12, completed: false });
  const repeated = service.run({ expectedStateVersion: reset.instance.stateVersion, maxTicks: 20 });
  assert.equal(repeated.instance.currentTick, 7);
  assert.equal(repeated.verification.stateHash, completed.verification.stateHash);
}));
