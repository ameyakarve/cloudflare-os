# Usage acquisition V2 — local caller journal checkpoint ONLY

P2 remains blocked. No production acquisition path imports this module. This is the explicitly
bounded durable-module alternative, **not paired User/Overseer implementation**, not a timeout-only
repair, and not a controls-release/consent/install-UX gate.

## Scope and contract provenance

Read the full `/tmp/mv-beta-usage-acquisition-plan.md`, K AGENTS, M delivery report, M
`45fd4cf95020dce9005e4d2e582fa6bf349132b9` design and actual
`src/lib/os-usage-acquisition-v2.ts`, and both current Overseer sites plus User acquisition.
M is under independent review and is not modified. Its unrelated working changes are not part
of this checkpoint. W, shared/browser APIs, existing transient acquisition code, borrowing,
lookup-only agent resume, READ P1 selection and explicit controls pins remain unchanged.

`packages/workshop-backend/src/usage-acquisition-journal.ts` is a **local caller** SQLite journal.
It is not the receiving User slot protocol, and its `UsageCandidate` must not be exposed as a
cross-owner cancellation capability. Only the owning host's private continuation may close it.
In particular, receiving User cancel-before-begin must compare the full upstream immutable
owner/operation ticket, including losing-candidate conflict semantics; this journal does not
implement that remote receiver CAS.

No hand-written M RPC interface, copied M decision engine, or double cast is introduced. The
journal stores bounded opaque complete ticket bytes plus original deployment/owner/key. It does
not parse those bytes, perform protocol discovery, validate a remote reply, or grant authority.
Twenty rows match M's existing `OS_MAX_CONCURRENT_RUNS = 20`, not a new concurrency/attempt quota.
An integration must verify compatible actual discovery and derive ticket/result types from M's
single source. The journal's local metadata types are not claimed to be that wire contract.

## Implemented invariant

Each of twenty permanent SQL rows owns at most one intent and one remote cleanup obligation.
Generations are SQL signed integers read as decimal strings; BigInt comparisons never round
through Number. Close advances the fence immediately but keeps the original obligation in that
same row as `cleaning`. The row is not reusable until the transport adapter proves terminal
remote state. Maximum generation seals, never wraps, and cleanup can still acknowledge it.
No history, new-capacity allocation, role grant, usage refund, current identity lookup or UUID
tombstone is required by local close/retry.

Transitions are acquiring → pending → adopting → adopted, or cleaning. Pending and adoption
records are **recovery information only**, not dispatch permission. The original issue/acquisition
deadline is immutable; pending expiry can be shorter than five seconds under an existing M config.
Adoption duplicates cannot acknowledge late. Adopted expiry is never renewed. Wake recovery
conservatively closes non-adopted invocations; adopted records need real host execution lookup
before any resumed work. Ordinary synchronous recovery closes due records.

Cleanup retries are durably scheduled before remote awaits, use the original target, scan at most
twenty rows, cap the exponent/backoff, and bound each transport attempt at one second. A failed,
never-settling or lost acknowledgement retains the row. The adapter must return true **only for
an exact validated terminal proof**; a generic successful RPC or different namespace is not proof.
An old acknowledgement cannot clear a newer local generation. A late acknowledgement after the
bounded attempt is ignored and retried, not treated as permission to recycle the row.

`arm()` never postpones an earlier existing shared alarm. It does not own the DO's alarm handler.
The host must serialize journal drain calls and merge `nextAlarm()` into its existing scheduler.
It must not delete other subsystems' alarms or use this module's fixture alarm as production code.

## Required integration ordering (NOT implemented here)

1. Host fixes issue/deadline and incarnation before any await. Claim the local record before access
   or remote snapshot awaits. Incarnation changes on Stop/owner replacement, including A→B→A.
2. Read-only remote discovery/snapshot; validate actual V2 types/features and exact namespace.
   Persist complete original routing/ticket with `attach`, then **await `arm()` before begin**.
   Re-read exact journal state/deadline AND current incarnation/access after every await, including
   arm. A false journal transition is refusal, never permission to continue. Storage failure must
   publish neither remote begin nor authority. Mere synchronous claim/attach is not a send permit.
3. Receive only a validated pending descriptor; persist it. Persist host adoption before User
   adoption/M activation. Recheck original owner/access/Stop/deadline and exact response after each
   await; persist final adoption before constructing a usable root. No automatic generation retry.
4. Timeout, Stop, role loss, response mismatch or identity replacement: close first, arm, and drain.
   Keep cleanup bound to stored original owner/key/deployment even when the current binding changes.
   Deploy/identity retirement must retain a close-only route to old authority until acknowledged.
5. Root reserve/getGrant must validate durable adopted ownership, current access, original expiry
   and M active linkage. Root finish must durably close before remote cleanup. Borrowed scopes must
   not finish parents. Existing agent resume stays lookup-only with exact persisted grant equality;
   unknown protocol state cannot start a replacement run or fall back to V1.
6. Wire both real `newUsageScope` and fresh `getUsageBudget`, User's receiving fenced slot array,
   wake recovery and shared alarms. Preserve role TTL renewal independently from fixed run expiry.

## Local evidence and remaining gates

Dedicated `vitest.usage-journal.config.ts` uses an isolated real SQLite DO and asserts workerd.
Twelve passing tests cover immutable intent/target, cancel-before-local-claim, stale continuations,
ordered/duplicate adoption, short expiry and exact deadlines, all twenty cleaning slots, failed and
never-settling cleanup, actual eviction/reopen, max-generation sealing, SQL rollback, alarm failure
before publication, 100 reuse cycles and earlier shared-alarm preservation.
These are **journal tests**, not actual User→M UsageDO or Overseer paired acceptance. The cleanup
callback in these tests proves journal retention only; it is not a substitute M accounting store.
The full late/lost/reordered remote matrix, accounting conservation/config 1/4/20, actual native
User/Overseer integrations, role TTL, owner ABA, Stop, malformed responses and native alarm delivery
remain unimplemented/unproven. No providers or external service calls were used.

Commands (from K):

```sh
(cd packages/workshop-backend && pnpm exec vitest run --config vitest.usage-journal.config.ts)
pnpm exec tsc --noEmit -p packages/workshop-backend/tsconfig.json
pnpm exec tsc --noEmit -p packages/workshop-shared/tsconfig.json
```

Parent generator follow-up: provide a narrow private usage contract generator, like the existing
M Doctor/Vault generators, exporting actual V2 ticket/result/discovery declarations and method
signatures from M's TypeScript source/checker with source provenance. Regenerate W's private bridge
only after M review; do not manually extend the legacy shared policy interface with lookalike V2
methods. No such generator/bridge or runtime V2 rollout is delivered here. Independent parent
review, compatible K/M/W controls pins, real consent/install UX and release activation remain gates.
