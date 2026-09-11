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
  A missing controller does not prevent persistence. No active row means there is no durable
  execution to stop; any pending in-memory callback admission is still aborted.
* Stop aborts both the captured turn controller and its usage-scope controller, rejects queued
  and active callbacks, and **does not wait for accounting finalization**. A live specialist's
  Stop targets its captured coordinator execution, not a newer coordinator using the same chat.
* In a live turn the chat remains busy until cleanup. Missing-controller orphans become idle
  synchronously. After reopen, stopped rows never register, resolve a model, open usage, or
  enter a turn; the existing interrupted-metadata sweep makes them idle.
* Stopped rows remain after cleanup, fencing callback-initiated restarts. An explicit new turn
  replaces the row with a new UUID and fresh live context/controller. New starts reject queued
  work still owned by the previous context; callback batches already admitted into active
  callbacks retain their return channels. No permanent chat-wide stop epoch is introduced.

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

## Migration and rollback

* Legacy active rows have no identity. Recovery synchronously assigns/persists a UUID before
  registration or model lookup; Stop also assigns one if necessary. No global schema-version
  bump or bulk rewrite is needed. An unstopped legacy row retains its prior recovery behavior.
* Historical pre-patch Stop ACKs cannot be reconstructed: no durable evidence was written by
  that implementation. This guarantee starts with ACKs from this implementation.
* **Unsafe downgrade:** old kernels ignore `stopRequested` and would resume retained stopped
  rows. Wire compatibility is NOT cancellation compatibility. Do not roll back to pre-fix code
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

Validation for this patch:

```sh
pnpm --filter @gadgets/workshop-backend exec tsc --noEmit
pnpm --filter @gadgets/workshop-backend exec vitest run \
  __tests__/durable-stop.test.ts __tests__/deployment-usage.test.ts \
  __tests__/specialists.test.ts __tests__/managed-draft.test.ts \
  __tests__/managed-export.test.ts __tests__/vault-identity.test.ts
pnpm exec vp lint packages/workshop-backend/src/overseer.ts \
  packages/workshop-backend/__tests__/durable-stop.test.ts \
  packages/workshop-backend/scripts/durable-stop-proof.mjs
node packages/workshop-backend/scripts/durable-stop-proof.mjs
```

Focused backend run: **6 files / 48 tests passed**. Typecheck and owned-file lint passed
(existing warnings). Root `lint:check` was also attempted; unrelated existing mock-type errors
in `workshop-frontend/src/GadgetExportMenu.test.tsx` block it. An initial `test:run` invocation
unexpectedly selected the entire unit suite (its script places arguments on the later integration
command); it timed out at 120s, so it is not a full-suite pass. Direct focused commands above avoid
that script behavior.

No claim of recall of already-sent work, cancellation of approved external actions, all-provider
transport behavior, arbitrary persistent callbacks arriving after an explicit new start, or
full-fleet correctness. No live provider, private user data, journal service, push, deploy or
wrapper-pin advance was used. Vault and draft/export code are outside this patch.
