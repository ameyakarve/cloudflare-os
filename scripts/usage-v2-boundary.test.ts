import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('actual User privately wires V2 and retains the V1 method; no Overseer switch or V1 fallback', () => {
  const user = source('packages/workshop-backend/src/user.ts');
  const coordinator = source('packages/workshop-backend/src/user-usage-v2.ts');
  const overseer = source('packages/workshop-backend/src/overseer.ts');
  const shared = source('packages/workshop-shared/src/api.ts');
  for (const method of ['readUsageAcquisitionSlotsV2', 'beginDeploymentUsageAcquisitionV2', 'adoptDeploymentUsageAcquisitionV2',
    'cancelDeploymentUsageAcquisitionV2', 'getDeploymentUsageAcquisitionStatusV2', 'resumeDeploymentUsageRunV2']) {
    assert.ok(user.includes(method));
    assert.ok(!shared.includes(method));
    assert.ok(!overseer.includes(method));
  }
  assert.match(user, /new UserUsageV2\(this.ctx/);
  assert.match(user, /async beginDeploymentUsageRun\(existingRunId\?: string\)/);
  assert.doesNotMatch(coordinator, /\.beginRun\(|as unknown as|#finished/);
  assert.match(coordinator, /getRunGrant\(route.key, route.ticket.runId\)/);
  assert.ok(coordinator.indexOf('journal.attach(ticket') < coordinator.indexOf('.beginAcquisitionV2(route.key'));
  assert.ok(coordinator.indexOf('journal.adopting(ticket') < coordinator.indexOf('.activateAcquisitionV2(route.key'));
});

test('native acceptance bundles actual checked M, asserts Workers, and never replaces quota accounting', () => {
  const config = source('packages/workshop-backend/vitest.user-usage-v2.config.ts');
  const worker = source('packages/workshop-backend/__tests__/user-usage-v2/worker.ts');
  assert.match(config, /MILESVAULT_CANONICAL_ROOT/);
  assert.match(config, /src\/durable\/__tests__\/os-usage\/user-boundary-worker.ts/);
  assert.match(config, /BoundaryUsageDO.*useSQLite: true/);
  assert.match(config, /assert-workerd/);
  assert.doesNotMatch(worker, /beginAcquisition|reserveOsUsage|os_budget|new Map/);
});
