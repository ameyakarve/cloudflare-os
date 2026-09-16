import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('actual User privately wires V2; Overseer uses paired acquisition and cleanup, never V1 fallback', () => {
  const user = source('packages/workshop-backend/src/user.ts');
  const coordinator = source('packages/workshop-backend/src/user-usage-v2.ts');
  const overseer = source('packages/workshop-backend/src/overseer.ts');
  const shared = source('packages/workshop-shared/src/api.ts');
  const acquisition = source('packages/workshop-backend/src/overseer-usage-acquisition.ts');
  // The sole direct V2 call is cleanup of an original-owner ticket, not acquisition authority.
  const cleanup = `if (target.deployment !== 'UserDurableObject' || target.key !== target.owner) return false;
        const ticket: UsageReceiverTicket = JSON.parse(target.ticket);
        const user = this.users.get(this.users.idFromString(target.owner));
        const status = await user.cancelDeploymentUsageAcquisitionV2(ticket);
        return status === 'terminal';`;
  assert.ok(overseer.includes(cleanup));
  const outsideCleanup = overseer.replace(cleanup, '');
  for (const method of ['readUsageAcquisitionSlotsV2', 'beginDeploymentUsageAcquisitionV2', 'adoptDeploymentUsageAcquisitionV2',
    'cancelDeploymentUsageAcquisitionV2', 'getDeploymentUsageAcquisitionStatusV2', 'resumeDeploymentUsageRunV2']) {
    assert.ok(user.includes(method));
    assert.ok(!shared.includes(method));
    assert.ok(!outsideCleanup.includes(method), `${method} must not bypass the paired acquisition boundary`);
  }
  assert.match(overseer, /new OverseerUsageAcquisition\(/);
  assert.match(acquisition, /\.beginDeploymentUsageAcquisitionV2\(ticket\)/);
  assert.match(acquisition, /\.adoptDeploymentUsageAcquisitionV2\(ticket\)/);
  assert.doesNotMatch(acquisition, /\.beginDeploymentUsageRun\s*\(/);
  // Legacy compatibility remains only outside required/funded and explicitly routed V2 modes.
  assert.match(overseer, /return this\.env\.DEPLOYMENT_USAGE_REQUIRED === 'true' \|\| this\.env\.DEPLOYMENT_USAGE_V2_ROUTE !== undefined\s*\? 'pairedV2' : 'transientV1'/);
  const pairedBranches = [...overseer.matchAll(/if \(this\.usageAcquisitionMode\(\) === 'pairedV2'\) \{([\s\S]*?)\n    \}/g)];
  assert.equal(pairedBranches.length, 2);
  for (const [, branch] of pairedBranches) {
    assert.doesNotMatch(branch, /beginDeploymentUsageRun|catch\s*\{[^}]*\}/);
    assert.match(branch, /await this\.pairedUsage\([^)]*\)\.open\(/);
    assert.match(branch, /acquired\.publish\(\); return (?:scope|acquired\.run);/);
    assert.match(branch, /catch \(error\) \{[^\n]*throw error; \}/);
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
