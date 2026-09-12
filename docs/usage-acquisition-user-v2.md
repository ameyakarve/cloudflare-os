# Actual private User → M acquisition V2

This replaces the **unwired User checkpoint**, not the outstanding Overseer/release gate.
`UserDurableObject` now imports and owns the existing receiver and journal through `UserUsageV2`.
The six private User entrypoints reach the actual M policy, and adoption returns an actual native
`DeploymentUsageRun` whose authority checks run in User. No browser interface or Overseer call site
is changed. V1 callers retain their signatures/behavior for V1 runs; a legacy-shaped User resume
of an owned V2 ID is refused so it cannot bypass User adoption while M activation is in flight.

## Contract and bounded ownership

- M `scripts/generate-os-usage-contract.mjs` emits declarations from the actual `os-budget.ts`,
  `os-usage-acquisition-v2.ts`, and all public `OsUsagePolicy` method signatures. The artifact is
  `packages/workshop-shared/src/os-usage.generated.d.ts`, with three source SHA-256 values.
  There are no RPC interface mirrors, double casts, embedded accounting implementation, or V1
  fallback. Explicit M return annotations remove transport-local `Disposable` intersections;
  discovery feature-array types preserve native RPC's tuple-to-array serialization.
- The existing 20 permanent receiver/journal fences remain authoritative. Twenty fixed KV keys
  additionally hold the current slot's original User DO owner, canonical case-preserved key,
  local identity incarnation, named deployment route, and complete generated-type M ticket.
  No per-attempt table/history, cleanup slot, or renewed role is allocated for cancellation.
- User claims before access awaits. Before M begin, it transactionally attaches the full remote
  tuple and original route, then persists an alarm. It rechecks the exact receiver ticket, local
  incarnation/key/owner, deployment pointer, role TTL and original deadline after awaited stages.
  Identity rebinding compares semantic fields, not property order, and publishes the identity and
  local incarnation/closure fences without yielding to cleanup in between.
  Snapshot corruption, role refusal, timeout and cancellation close the same original candidate.
- Pending is data, never a root. User persists `adopting` intent before M activation; only the
  matching timely reply may become durable `adopted`. Final alarm persistence and checks precede
  root publication. The fixed acquisition window is never refreshed; M fixes expiry from the
  original `issuedAt`. Interrupted non-adopted handoffs close on User wake.
- Root `getGrant` checks durable adoption plus fresh required access and **M getRunGrant**, not
  recovery status as permission. Reserve checks again around accounting awaits; late receipts
  cannot authorize dispatch. Finish locally fences first and retries durable cleanup, including
  repeated finish after failure. Known receipt settlement retains its original route even if the
  User slot is reused. Resume is exact adopted-run lookup only, including after acquireBy; it
  never sends begin/activation or renews expiry. Existing borrowed-scope behavior is unchanged.

## Routing and alarms

W adds a private binding named `DEPLOYMENT_USAGE_V2_ROUTE_<sha256(service-name)>` and a current-route
pointer only when the existing usage configuration is enabled. The journal retains the selected
binding name and M's per-account namespace, not the current pointer. Cleanup resolves **only that
original binding** and exact ticket, without identity lookup, role renewal or quota admission.
Missing original bindings retain cleaning rows; switching the current pointer never redirects
cleanup. Deployment retirement must preserve old service/binding aliases until obligations drain;
this is not an automatic deployment migration/drain tool. Never repoint an old immutable route
alias at another service or drop it as a way to clear an obligation. Current pins/config gates are
unchanged; no generated deployment file was written and no deployment was attempted.

The original User source had **no alarm handler or alarm duties** to merge. The added handler
runs bounded journal recovery/drain; wake recovery is installed only for Users with V2 tables.
Journal alarm scheduling now accepts the host's concurrency gate, covering both acquisition and
cleanup arming, and preserves an earlier existing shared alarm rather than replacing/deleting it.
Drains are serialized per User, scan at most twenty records, persist bounded retry/backoff before
awaits and bound each transport attempt to one second. Failed/lost/late acknowledgements do not
free a row. Storage failure cannot publish begin/root success.

The first experimental implementation tried persisting a raw cross-worker service binding and
hit native `DataCloneError` (even with a fixture flag). That approach was removed, not accepted
with a mock or hidden cast. Final tests use named original routes and do not add a persistence
compatibility flag to M. M production configuration remains untouched.

## Executed offline evidence

The dedicated config requires an explicit checked M worktree and bundles M's actual policy and
UsageDO into a **second native worker**. `BoundaryUsageDO` subclasses actual UsageDO only for
synthetic operator configuration, SQL inspection and transport faults before/after real methods.
K runs actual User, actual SQLite journal/receiver and actual roots. Only role authority is
synthetic. No provider dispatch, fake accounting grant, Map wallet or extracted User flow is used.

Native User→M suite: **44 passing tests**, independently rerun after resuming the stopped session.
The inherited 32-test suite also passed before expansion. Coverage includes:

- Native workerd assertion, real SQL charge/receipt/fence checks and C=1/4/20 V1/V2 shared limits.
- Persisted original ticket/route + alarm observed while real M begin reply is suspended;
  persisted adopting intent observed while real M is active and its activation reply is suspended.
- Cancel-before-begin, changed/losing/old User tickets, pending rejection through V1-shaped User
  resume, delayed snapshots, lost begin/activation replies and late original-window replies.
- Cancellation during access, snapshot, begin, activation, grant and reserve awaits; synthetic
  dispatch counter stays zero for late results. Local incarnation ABA and deployment-pointer
  replacement cannot reauthorize the original continuation or redirect cleanup.
- Role denial and role TTL expiry across snapshot/begin/activation/grant/reserve; cleanup needs
  no role. Adopted lookup-only resume after acquireBy and eviction preserves run ID/expiry.
- User eviction during begin/activation replies, pending wake cleanup, adopted wake resume,
  missing original binding, delayed cleanup timeout, lost cancel acknowledgement and repeated finish.
- All twenty slots cleaning at exhausted daily start quota, cleanup without new capacity or start
  refunds, malformed snapshot and pending replies, missing V2 route with a real V1 binding present,
  short actual M expiry, earlier shared-alarm preservation and native User alarm-persistence failure.
- Changed upstream owner/incarnation/operation/payload/timestamps cannot adopt, close or overwrite
  the pending winner. Changed activation/grant expiry fails closed; nonterminal cancellation replies
  retain the original obligation even if M already closed it.
- Actual borrowed UsageScope finish cannot close its adopted parent. Known receipt settlement after
  closure/slot reuse and role denial remains on its original run. Scope validation failure with lost
  cancellation acknowledgement retains durable cleanup. Equivalent identity rebind and healthy role
  renewal preserve adoption; mismatched resume closes without replacement allocation.

Other independently rerun gates: 21 native receiver/journal tests (including the preserved
`0574b4f` advanced-cleaning-fence repair), 40 existing access/identity/usage tests, 5 K Doctor identity
tests, 8+41 M Doctor tests, 51 M native V2/accounting tests, 36 W deploy-config tests, two bounded source-boundary tests,
and the generator's deterministic/full-declarations/stale-artifact test. Backend, shared,
fixture-inclusive, M full-tree and W scripts TypeScript checks pass, as does scoped K lint.
M TS fixture/policy lint passes; generator scripts were executed by their Node test.
W's root tsconfig has no inputs; the applicable
`scripts/tsconfig.json` check passes. Native fault tests log expected transport, eviction and
broken-input-gate diagnostics; passing runs have no Vitest unhandled-error count.

Reproduce (serial native suites):

```sh
# M
node scripts/generate-os-usage-contract.mjs <K>/packages/workshop-shared/src/os-usage.generated.d.ts --check
node --test scripts/generate-os-usage-contract.test.mjs
pnpm exec vitest run --config vitest.os-usage.config.ts
pnpm exec tsc --noEmit

# K/packages/workshop-backend
MILESVAULT_CANONICAL_ROOT=<M> pnpm exec vitest run --config vitest.user-usage-v2.config.ts
pnpm exec vitest run --config vitest.usage-journal.config.ts
pnpm exec vitest run __tests__/usage-acquisition.test.ts __tests__/deployment-identity.test.ts __tests__/deployment-usage.test.ts __tests__/deployment-access.test.ts

# K
node --test scripts/usage-v2-boundary.test.ts
pnpm exec tsc --noEmit -p packages/workshop-backend/tsconfig.json
pnpm exec tsc --noEmit -p packages/workshop-backend/tsconfig.user-usage-v2.json
pnpm exec tsc --noEmit -p packages/workshop-shared/tsconfig.json

# W
node --test scripts/deploy.test.ts
pnpm exec tsc --noEmit -p scripts/tsconfig.json
```

## Remaining gates / explicit limits

Parent owns independent review. **Paired durable P2 and activation remain blocked.** Neither
Overseer acquisition site nor its durable owner/Stop/adoption journal is changed/tested here.
The native fixture's synthetic host tickets prove the User boundary, not upstream host ownership,
final root-reply loss at both Overseer sites, deployed rolling-version compatibility, consent UX,
or production deployment acceptance. Existing role TTL semantics are retained, not replaced with
instantaneous revocation notification. Required protocol discovery is a trusted binding contract,
not protection against a policy deliberately lying about implemented methods. Original route
availability and eventual storage/RPC servicing remain cleanup-progress assumptions; failures
retain bounded obligations and never justify a V1 fallback or a replacement acquisition.
