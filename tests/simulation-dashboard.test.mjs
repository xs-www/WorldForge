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
