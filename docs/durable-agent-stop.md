# Durable agent Stop: bounded kernel contract

## API and review

Use the existing kernel capability `Overseer.stopAgent(chatId): Promise<void>` (defined in
`workshop-shared/src/api.ts`, implemented by `OverseerClientInterface`). It now awaits
`OverseerImpl.cancelAgent`. No wrapper-specific endpoint, duplicated RPC type, provider-specific
policy, or deploy-time source patch is required. Existing callers remain source/wire compatible.
The existing capability/role boundary is unchanged; these tests do not re-prove authentication.

This change received an implementation self-review against the counterexample and ownership
matrix below. **Independent kernel review remains required before deployment.** In particular,
the read-only Vault reviewer is not claimed as a Stop reviewer.

* Target: the execution current **at method entry**, not the execution visible when the caller
  originally rendered its UI. This API has no expected-execution-ID argument. Repeated Stop is
  idempotent for the same execution; a delayed/retried call after an explicit new start can stop
  that new execution. Do not treat a chat ID as an immutable execution handle.
* ACK: the execution's `stopRequested` row update has crossed actual DO SQLite
  `ctx.storage.sync()`. A failed barrier rejects, even if local memory already reflects Stop.
  A missing controller does not prevent persistence. Stop also durably revokes the chat's
  automatic-continuation generation, even when normal cleanup already removed the active row;
  any pending in-memory callback admission is still aborted.
* Stop aborts both the captured turn controller and its usage-scope controller, rejects queued
  and active callbacks, and **does not wait for accounting finalization**. A live specialist's
  Stop targets its captured coordinator execution, not a newer coordinator using the same chat.
* In a live turn the chat remains busy until cleanup. Missing-controller orphans become idle
  synchronously. After reopen, stopped rows never register, resolve a model, open usage, or
  enter a turn; the existing interrupted-metadata sweep makes them idle.
* Stopped rows remain after cleanup, fencing callback-initiated restarts. An explicit new turn
  replaces the row with a new UUID and fresh live context/controller. New starts reject queued
  work still owned by the previous context; callback batches already admitted into active
  callbacks retain their return channels. Explicit new Send/Retry remains authorized after cleanup;
  an approval or connection acceptance is **not** equivalent to explicit new-turn authority.

## Ownership / await review

`executionId` is independent of chat, model, usage grant and specialist root. Start persists it
before the first await; recovery retains it. Permission requires the same durable execution,
the same live-context object, no stop flag and a non-aborted controller. A missing/replaced row
fails closed, so deletion cannot make an old continuation runnable again.

| Boundary | Fence |
|---|---|
| Recovery traversal | Skip stopped rows before registration/model lookup |
| Recovery model lookup | Check before lookup and after success/failure, before turn entry |
| Usage admission | Check before opening scope and after await; re-read current row before grant put |
| Access watch, provisional materialization, balance/routing, affinity | Recheck after each await before next turn work |
| Outer agent loop | Recheck before and after each `runAgent` call |
| Pending callback model/preparation waits | Captured live identity and abort signal checked before/after waits |
| Approval/connection resume | Persisted creation generation checked before preparation/model lookup, after awaits, and immediately before metadata/start; never recapture latest ownership |
| Finalizer | Captured live context owns its scope and root; never look up root via a newer active row |
| Metadata, registry, alarms, idle waiters, live removal, callback continuation | Same execution/live identity, checked after cleanup awaits |
| Provisional reconciliation | Check ownership before starting and after returning; public new starts remain blocked while cleanup runs |

The existing metered stream checks its combined signal after reservation, immediately before
transport (or before invoking Google's adapter). Stop now also aborts that scope. The reservation
policy and eligibility logic are unchanged. A late grant is disposed, not written over Stop.

Reconciliation itself is not made execution-indexed: an adversarial internal replacement **inside**
its own asynchronous implementation is not covered. Public starts remain excluded during that
interval. The synthetic replacement fixtures replace before reconciliation begins or after the
accounting await; they do not prove arbitrary internal storage mutation safe.

## Suspended approval / connection ownership (P1 repair, parent `0845aeb`)

`agentContinuations` stores one generation per chat, separate from the active/recovery row.
`startAgent` synchronously rotates it to the new execution UUID; normal cleanup leaves it intact.
Recovery of an unstopped active row restores that same execution's generation for newly created
requests; it never stamps historical requests.
Stop deletes it before its durability barrier, including no-controller/no-active-row suspension.
Deleting a chat also removes it. A subsequent new start cannot revive an old generation.

Agent gatekeeper clients capture this generation when minted, pass it through the approval queue,
and persist it on the action; neither `submitAction`'s access/charging awaits nor approval's
profile/application awaits infer ownership from the latest row. Stale submissions can retain their
canonical pending action but do not attach to or suspend a newer turn. Connection creation captures
before vendor lookup, checks after it, and persists the generation on the request message.

Decision handlers use only the persisted request/action generation. All awaited siblings must
have the same ownership. The resume helper preserves that captured value across initial preparation,
model lookup, and recursive late-preparation waits, checking before any fresh inference admission.
The final check and metadata/start are synchronous; start checks again before rotating authority.
`callbackInitiated` is not used to infer permission (approval resumes also pass `false`). Existing
specialist no-fresh-budget semantics remain unchanged. Canonical action application and connection
acceptance can succeed after Stop without starting inference; nothing here undoes an applied action.

Missing/legacy ownership fails closed, even if an unstopped/newer row exists. There is no migration
that guesses which historical pending request belongs to the latest execution. Users can explicitly
Send/Retry to authorize a new turn after cleanup. The generation is fencing state, not a billing
allowance; it never restores a stopped grant or renews an old specialist budget.

## Migration and rollback

* Legacy active rows have no identity. Recovery synchronously assigns/persists a UUID before
  registration or model lookup; Stop also assigns one if necessary. No global schema-version
  bump or bulk rewrite is needed. An unstopped legacy row retains its prior recovery behavior.
* Historical pre-patch Stop ACKs cannot be reconstructed: no durable evidence was written by
  that implementation. This guarantee starts with ACKs from this implementation.
* **Unsafe downgrade:** pre-Stop kernels ignore `stopRequested` and would resume retained stopped
  rows. The intermediate `b896c3f` / `0845aeb` kernels honor that flag during recovery but ignore
  continuation generations and can replace it on approval/connection acceptance. Those builds
  are also unsafe rollback targets. Wire compatibility is NOT cancellation compatibility. Do not roll back to pre-fix code
  with these rows present. A rollback requires quiescing old continuations and separately
  reviewed offline retirement/archive of stopped rows and metadata, or retaining this fence in
  the rollback build. No rollback migration is shipped or claimed tested here.
* Stopped rows retain known grant/root evidence until chat deletion or an explicit new start
  replaces them. They are not a durable accounting journal. Recovery deliberately does not
  reopen accounting merely to finish a stopped execution. Unknown/late usage is bounded by the
  existing grant expiry; exact settlement, accounting repair and indefinite evidence retention
  are outside this patch.

## Reproducible evidence (all synthetic)

`__tests__/durable-stop.test.ts` uses the real Overseer implementation, Workers SQLite,
native RPC usage targets and `abortAllDurableObjects()`:

1. Missing controller + legacy row + repeated Stop, then actual abort/reopen: stopped row
   retained, idle metadata, no model/error recovery (invalid synthetic initiator cannot contact
   a User service).
2. Actual `UsageScope.finish` stalled after ACK, then actual DO abort/reopen: stopped row
   survives and is not resumed.
3. Injected `storage.sync()` rejection: Stop rejects, rather than falsely ACKing. This is an
   injected method failure, not physical disk corruption or a replicated-storage failover.
4. Stop during synthetic usage-grant await: no stale grant put or pre-dispatch materialization;
   busy start rejected; old cleanup leaves an adversarial newer row/metadata untouched.
   Deletion separately unregisters synchronously because the fenced finalizer no longer owns it.
5. Stop during actual metered reservation await: native synthetic OpenAI-style fetch path
   admits **zero transport calls**; Google path admits **zero adapter entries**. Neither calls
   an actual SDK/provider endpoint. The OpenAI-style synthetic adapter is entered before Stop;
   its later receipt cannot authorize transport.

`node packages/workshop-backend/scripts/durable-stop-proof.mjs` mechanically extracts current
production Stop/RPC, identity guards, recovery, callback admission and the whole finalizer.
It updates `/tmp/mv-beta-stop-reopen-proof/repro.mjs`'s original counterexample: stalled finish +
ACK + snapshot reopen now produces zero model lookups and zero stub turns, including at 4,999ms;
actual `UsageScope` disposal is exercised through its 5,000ms virtual timeout. It also asserts
Stop during recovery-model await, missing/repeated Stop, old finalizer vs new row/meta/live,
**old root vs new root**, legacy identity assignment, stale callback admissions and specialist
Stop vs captured/new coordinator identity. It prints
source/extraction hashes. The shell, tables, timers, model resolver and turn entry are synthetic;
this is not native paid-provider acceptance. The original historical reproduction is not edited.

`__tests__/stop-continuations.test.ts` adds real session approval/connection decision methods in
Workers SQLite, with synthetic profile/model resolution and canonical action application:

* Approval/acceptance after acknowledged Stop, with neither active row nor controller; orphan
  active metadata clears. No model lookup/start, but the canonical action is approved.
* Old persisted requests after a newer generation, plus missing legacy request ownership:
  no inference and no mutation of the newer generation.
* Stop/replacement during action application, initial preparation, model resolution, and late
  preparation: canonical resolution can finish, but metadata remains idle and no turn starts.
* Positive same-owner automatic admission and real explicit Send/Retry admission after cleanup:
  fresh identities, old requests cannot subsequently attach. Usage admission is synthetically
  rejected before any model construction/transport; these are admission tests, not paid inference.
* Real approval-queue creation and connection creation/vendor-lookup race: capture ownership before
  awaits; an old queue cannot suspend/attach to a replacement turn. New connection message
  persistence retains its creation identity.
* Suspended Stop then actual DO abort/reopen: revocation survives with no active row at all.

`stop-continuation-proof.mjs` is the review's `/tmp/mv-beta-stop-review-suspended.mjs` promoted into
an executable safety regression. The original review artifact asserts the **bug** and has an exact
old-signature extractor; it is preserved, not silently rewritten. The checked-in version extracts
both signatures, supplies captured creation ownership and asserts zero turns / retained fence.
`--parent` reads `0845aeb` directly from Git (no checkout mutation) and **fails with `1 !== 0`**;
current source passes both ACK-before-resume and Stop-during-model cases. Both print source and
extraction hashes on success. This is synthetic control-flow proof, not native transport proof.

Validation for the P1 repair:

```sh
pnpm --filter @gadgets/workshop-backend exec tsc --noEmit
pnpm --filter @gadgets/workshop-backend exec vitest run \
  __tests__/stop-continuations.test.ts __tests__/durable-stop.test.ts __tests__/deployment-usage.test.ts \
  __tests__/specialists.test.ts __tests__/managed-draft.test.ts \
  __tests__/managed-export.test.ts __tests__/vault-identity.test.ts
pnpm exec vp lint packages/workshop-backend/src/overseer.ts \
  packages/workshop-backend/__tests__/durable-stop.test.ts \
  packages/workshop-backend/__tests__/stop-continuations.test.ts \
  packages/workshop-backend/scripts/durable-stop-proof.mjs \
  packages/workshop-backend/scripts/stop-continuation-proof.mjs
node packages/workshop-backend/scripts/durable-stop-proof.mjs
node packages/workshop-backend/scripts/stop-continuation-proof.mjs
# Expected assertion failure on the reviewed parent (one forbidden turn):
! node packages/workshop-backend/scripts/stop-continuation-proof.mjs --parent
```

P1 focused backend run: **7 files / 52 tests passed**. Backend `tsc --noEmit` and owned-file lint
passed (existing warnings); root `pnpm lint:check` also passed. Both mechanical safety proofs passed;
the same suspended safety
assertion against `0845aeb` failed with one forbidden turn as expected. The specialist pending-
approval test is unchanged and passes: canonical suspension does not resume or renew its budget.
The parent `0845aeb` frontend mock-type repair is untouched. These results supersede the earlier
6-file/48-test Stop baseline, not the parent's full integration or independent review gate.
Final verified `overseer.ts` SHA-256:
`f7d152af24773973a7849507767ec71047005c7daab8fd8757706a0530e6c0bc`.
The final seven-file native run completed in 50.65s. Expected synthetic quota/deadline refusals
are printed by workerd; the completed result is 52 passed, not a timeout or partial run.

**Hold the parent pin until independent review; no deployment or downgrade is approved by this proof.**

No claim of recall of already-sent work, cancellation of approved external actions, all-provider
transport behavior, arbitrary persistent callbacks arriving after an explicit new start, or
full-fleet correctness. No live provider, private user data, journal service, push, deploy or
wrapper-pin advance was used. Vault and draft/export code are outside this patch.
