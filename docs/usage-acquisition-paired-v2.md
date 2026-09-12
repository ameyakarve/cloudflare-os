# Paired Overseer usage acquisition (review required; activation not authorized)

The private caller adapter in `src/overseer-usage-acquisition.ts` completes the two actual
Overseer entry sites: `newUsageScope` and the fresh-root branch of `getUsageBudget`.
It composes the previously reviewed Overseer lifecycle/journal and actual User V2 methods;
it does not replace User, the receiver, M accounting, lifecycle cancellation, or the alarm scheduler.
No public/browser contract, service binding, installer selection, release pin or activation is added.

## Selection and ownership

- Required accounting (`DEPLOYMENT_USAGE_REQUIRED=true`) or an explicitly configured named V2 route
  selects `pairedV2`. Missing/malformed V2 fails closed. No V1 retry exists on this branch.
- An optional legacy policy binding without either protected selector retains `transientV1` for
  pinned legacy READ installations. Genuinely disabled accounting retains optional behavior.
  The two old synthetic V1 regression fixtures now explicitly use this optional legacy configuration;
  required-control acceptance uses actual User/M, not those V1-only mocks.
- Each call claims the existing twenty-slot journal before authority awaits. It uses one original
  `issuedAt` / `acquireBy = issuedAt + 5000`, including access, snapshot, SHA-256 and storage waits.
  It persists and arms the complete original User candidate/ticket before User begin. The digest
  covers immutable host intent/execution. Pending grant and adoption intent precede User adoption.
- Durable grant metadata uses one additional bounded table keyed by journal slot/generation
  (at most twenty rows, each grant JSON capped at 512 characters). It stores only run/expiry,
  not prompts, content, credentials, or an RPC capability. The existing execution-link table gains
  an exact lookup helper; no lifecycle transition or alarm algorithm changes.
- The existing active-agent row gets a `deploymentUsageV2Attempted` bit **before the first authority
  await**. This is necessary even after journal cleanup: if the final scope reply is lost before
  the agent caller persists its grant, wake must not mistake the missing grant for permission to
  start a replacement with another five-second window. Explicit new executions get new rows/bits.

## Publication, roots, and recovery

Every authority continuation compares the original journal generation/state/intent/remote/expiry,
owner/incarnation (including ABA), current creation-owned execution/Stop and the access grant TTL.
The adapter checks again after User root lookup and final arm. Both actual call sites check at output;
`newUsageScope` additionally checks after `UsageScope.open` without double-disposing failed opens.
The wrapper keeps the original handoff deadline through that extra grant lookup; only final
publication switches it to ordinary lease-bounded root operations, so scope opening cannot renew
the original five-second window.

The returned native root is an Overseer-owned wrapper, not the bare User root. Every grant/reserve
requires current durable adoption and role validation before dispatch and after its awaits/output.
Known receipt settlement uses only the original root and requires the original owner/incarnation;
Stop/closure does not forbid accounting-only settlement. Unknown receipts and changed owners fail.
Finish closes locally first and uses lifecycle cleanup. Repeated finish and old-generation finish
cannot erase or close a replacement obligation. Borrowed roots still cannot finish their parent.

Resume requires the exact persisted adopted ticket, saved run/expiry, execution link, current
non-stopped execution and the active-agent grant. It calls only `resumeDeploymentUsageRunV2` and
grant lookup, never begin/adoption. A missing/partial/closed handoff cannot allocate a replacement.
A healthy renewed role may outlive its previous role TTL without changing the original run expiry.

Cleanup remains the reviewed lifecycle's original `UserDurableObject` namespace/owner/full-ticket
transport and terminal acknowledgement. Shared alarms retain keepalive/delivery priority and retry
merging. No new scheduler or cleanup outbox is introduced. The bounded grant table, like the existing
usage SQL fences/linkage, survives workspace KV deletion; these retained usage identifiers are a
bounded cleanup/recovery exception, not workspace content retention or complete identifier erasure.

## Native evidence and limits

`vitest.overseer-usage-paired.config.ts` composes actual Overseer and the existing actual User fixture,
with the existing M `user-boundary-worker.ts` bundled from `MILESVAULT_CANONICAL_ROOT`.
All accounting decisions reach actual `OsUsagePolicy` / `UsageDO` / SQLite. Synthetic roles, fault
injection and model-resolution pauses do not implement accounting. No provider is invoked.

Tests drive both actual sites, real `startAgent`, actual agent borrowing, local-arm/role/hash and
remote boundary cancellation, alarm failures, owner ABA, Stop/replacement, malformed responses,
original-window expiry, lost final root replies and terminal acknowledgements, retained cleanup,
actual eviction/resume, healthy role TTL, and legacy compatibility. A test-only subclass adds native
probe entrypoints delegating to the unchanged actual methods for in-flight eviction; this avoids
aborting a `runInDurableObject` test callback while it owns its own RPC continuation. Both agent and
control native probes are evicted during M begin, M activation and the final actual User root reply.
The independent lifecycle and User/M suites remain separate regression evidence, not copied models.

Run serially from `packages/workshop-backend`:

```
MILESVAULT_CANONICAL_ROOT=/path/to/reviewed/M pnpm exec vitest run --config vitest.overseer-usage-paired.config.ts
MILESVAULT_CANONICAL_ROOT=/path/to/reviewed/M pnpm exec vitest run --config vitest.user-usage-v2.config.ts
pnpm exec vitest run --config vitest.usage-journal.config.ts
```

This is local implementation evidence, not independent review, a universal schedule proof, consent
acceptance, or deployment authorization. Named User/M routes must remain pinned to their original
authorities until obligations drain. Storage/RPC/alarm eventual recovery remains a progress assumption.
Activation remains disabled pending independent integrated review and parent-owned release decisions.
