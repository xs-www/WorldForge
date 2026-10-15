import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMacroSimulationService, MacroSimulationError } from '../simulation/macro-simulation-service.mjs';

async function withMacro(run) {
  const directory = await mkdtemp(join(tmpdir(), 'worldforge-macro-'));
  const service = createMacroSimulationService(join(directory, 'simulation.sqlite'));
  try { await run(service); }
  finally { service.close(); await rm(directory, { recursive: true, force: true }); }
}

test('W98 exposes a synthetic macro map without promoting it to canon', async () => withMacro(service => {
  const view = service.view();
  assert.equal(view.experimental, true);
  assert.equal(view.instance.worldId, 'W98');
  assert.equal(view.regions.length, 12);
  assert.equal(view.polities.length, 3);
  assert.equal(view.totals.population, 1160);
  assert.deepEqual(view.architecture, { macro: 'deterministic_rules', local: 'llm_proposal_then_rule_validation' });
  assert.equal(view.verification.replayVerified, true);
}));

test('macro quarters evolve deterministically and replay from committed state events', async () => withMacro(service => {
  const initial = service.view();
  const advanced = service.run({ expectedStateVersion: initial.instance.stateVersion, quarters: 4 });
  assert.equal(advanced.instance.currentTick, 4);
  assert.equal(advanced.history.length, 4);
  assert.equal(advanced.verification.replayVerified, true);
  assert.equal(advanced.totals.polities.reduce((sum, polity) => sum + polity.regionCount, 0), 12);
  assert.ok(advanced.recentEvents.some(event => event.type === 'macro.border_change'));
  assert.throws(() => service.step({ expectedStateVersion: initial.instance.stateVersion, actions: [] }), error => error instanceof MacroSimulationError && error.status === 409);
  const firstHash = advanced.verification.stateHash;
  const reset = service.reset({ expectedStateVersion: advanced.instance.stateVersion });
  const repeated = service.run({ expectedStateVersion: reset.instance.stateVersion, quarters: 4 });
  assert.equal(repeated.verification.stateHash, firstHash);
}));

test('local proposals receive bounded context and remain subject to rule validation', async () => withMacro(service => {
  const context = service.localContext('LOC-W98-006');
  assert.equal(context.selectedRegion.regionId, 'LOC-W98-006');
  assert.equal(context.neighbors.length, context.selectedRegion.neighbors.length);
  assert.equal('regions' in context, false);
  const fallback = service.fallbackProposal('LOC-W98-006');
  assert.equal(fallback.action.parameters.regionId, 'LOC-W98-006');
  assert.equal(fallback.validation.ok, true);
  const parsed = service.parseModelProposal(JSON.stringify({ title: '赈济铁隘', rationale: '缓解低稳定与供给压力。', expectedOutcome: '降低短缺风险。', action: { type: 'macro.relief', parameters: { regionId: 'LOC-W98-006' } } }), 'LOC-W98-006');
  assert.equal(parsed.action.actorId, 'FAC-W98-001');
  const initial = service.view();
  const advanced = service.step({ expectedStateVersion: initial.instance.stateVersion, actions: [parsed.action] });
  assert.equal(advanced.instance.currentTick, 1);
  assert.ok(advanced.recentEvents.some(event => event.type === 'macro.local_action'));
  assert.throws(() => service.parseModelProposal(JSON.stringify({ title: '越界', rationale: '无', expectedOutcome: '无', action: { type: 'macro.relief', parameters: { regionId: 'LOC-W98-007' } } }), 'LOC-W98-006'), /越过了选中地区边界/);
}));
