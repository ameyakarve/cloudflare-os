# Deployment-defined specialists (opt-in runtime)

The Workshop coordinator exposes native `delegateSpecialist`, `listSpecialistRecords`, and
`readSpecialistRecord` tools when `DEPLOYMENT_SPECIALISTS` is configured. Nothing is enabled in
Wrangler defaults, production variables, or the admin UI by this change. Deployment, prompt text,
and domain API implementation remain the deploying application's responsibility.

## Configuration contract

The backend optional `DEPLOYMENT_SPECIALISTS` env binding accepts **a JSON string** or
**`@chunks:N`** with `DEPLOYMENT_SPECIALISTS_0` through `DEPLOYMENT_SPECIALISTS_{N-1}`.
Chunk counts are canonical decimal integers from 1 to 16; each chunk must be a nonempty string
of at most 4,000 UTF-8 bytes (below Cloudflare's 5 KB text-variable limit). Concatenate chunks
in index order to obtain the JSON. Missing, extra/malformed indices, invalid counts, oversized
chunks, invalid JSON, and invalid profile shapes fail closed. Deploy the manifest and chunks
together and remove stale chunk variables when reducing the count. Direct JSON remains compatible.
Exported types are in
`@gadgets/workshop-shared/specialists`:

```ts
interface DeploymentSpecialists {
  version: 1;
  profiles: SpecialistProfile[];
}
interface SpecialistProfile {
  id: string;
  name: string;
  instructions: string;
  intents: SpecialistIntent[];
  maxTurns: number;
}
interface SpecialistIntent {
  id: string;
  description: string;
  bindings: Record<string, string[]>;
}
```

For example (illustrative only; not installed):

```json
{
  "version": 1,
  "profiles": [{
    "id": "research",
    "name": "Research",
    "instructions": "Research only the assigned task. DATA.current({limit:number}) returns {rows:unknown[]}. Await calls sequentially. Return concise evidence and uncertainty.",
    "intents": [{
      "id": "current",
      "description": "Read current data",
      "bindings": {"DATA": ["current"]}
    }],
    "maxTurns": 4
  }]
}
```

Profile IDs and intent IDs are stable, unique in their respective scope, 1–64 letters/digits/
underscore/hyphen, starting with a letter or digit. Binding/method identifiers start with a letter
and otherwise contain letters/digits/underscores (max 64). RPC infrastructure names are rejected.
Limits: JSON 100,000 characters; eight profiles; name 120 characters; instructions 24,000 characters;
16 intents/profile; description 2,000 characters; eight bindings/intent; 16 methods/binding;
1–12 model turns. Invalid configuration fails closed. Empty/absent config disables delegation.
Existing saved records remain discoverable after disabling profiles.

The deployment must supply **accurate method signatures and bounded request examples in
`instructions`**. A specialist's `describeBinding({name})` returns only its allowed method names,
not the unrestricted session's TypeScript declaration. The kernel does not infer domain APIs.
The existing root `describeBinding` and all other root tools are unchanged.

A deployment can configure two profiles with independent intents, including methods named
`currentHoldings`, `listEntries`, `propose_edit`, `categoryRates`, `heldCategoryRates`, and
`earnMatrix`. These names have no special treatment in the kernel. An edit intent must point to
the existing approval-gated session's proposal method, **not** raw journal writes or the managed
browser editor. Domain prompt text, canonical resolver/formatter orchestration, and Graph method
implementations are not copied into this repository.

## Active execution and authority

`delegateSpecialist({profileId, intentId, task})` runs one child synchronously inside the original
coordinator turn. It creates a normal workspace child chat, with runtime-frozen profile/intent
context, and runs the existing `runAgent` loop. There is no new Durable Object, no generic-spawner
behavior override, and no new resource acquisition. The child has only `describeBinding` and
`executeCode`. It cannot delegate, acquire connections, edit files/gadgets, or use `self`.

Eligible bindings must already exist in the coordinator's chat map, be agent-visible, and have a
`gatekeeper` or `ambient` creation spec. Gadgets, worktrees, callback values, model bindings,
spawners, legacy unclassified bindings, and deployment-private managed UI resources are rejected.

Scoped Code Mode uses the existing loader and logging infrastructure with **an empty loader env**
and `globalOutbound: null`. Its transient argument is a `SpecialistDispatcher` RPC membrane, not
an original binding stub or a TypeScript-only narrowing. The harness builds
`env.NAME.method(...args)` wrappers for the selected intent. Every dispatch checks the frozen
binding/method allowlist, cancellation, revocation, single-flight state, and call count. Sessions
are opened in the host using the existing gatekeeper/approval infrastructure. Liveness is checked
again after session acquisition, immediately before the domain call. Returning from Code Mode
revokes the dispatcher immediately; unfinished prepared/running calls and their code/delegation
are marked `unknown`, never successful. Late completions cannot upgrade those records. Neither session
stubs nor capability-valued returns cross the membrane. Only bounded plain JSON-compatible data
is supported (undefined normalizes to null); functions, RPC capabilities, class instances, Dates,
streams, cycles, and accessors are rejected. Calls must be sequential, at most 32 per Code Mode
execution. Input/result data is bounded to 32,768 serialized characters, 10,000 nodes, depth 24.
Oversized upstream results fail closed; ask domain services for bounded results.

The same charged model handle and **same root `UsageScope`** are reused. Children never call
`beginDeploymentUsageRun`, open a new root scope, or finish the parent. Gatekeeper operations
borrow that root allowance using the existing queue API. Root response metadata is restored after
child dispatch so the parent's step accounting does not accidentally use the child's response ID.
Resuming a root grant now requires the exact original run ID and deadline; an expired persisted
grant is rejected before contacting the quota policy. One root may delegate at most eight children,
one at a time. Each child has a 120-second ceiling that cancels the root; quota expiry can cancel
sooner. The inherited cancellation race covers loader/getEntrypoint startup and `verify()`, not
only `run()`. Interrupted or detached runs do not wait for tail logs, which may themselves be
blocked by unfinished RPCs. Stopping either the root or its active child propagates through the shared controller.

Already-dispatched remote operations cannot be undone by cancellation. The membrane refuses
subsequent calls and the runtime retains uncertain outcomes; it never retries these operations.
Domain services must continue to enforce their own canonical authorization, budget, and approval
rules. The membrane is not a replacement for those rules.

## Durable evidence and later Gadget building

`SpecialistRecord` (exported from the same module) is runtime-owned workspace storage. Root,
delegation, code, and method-call records carry opaque IDs, root/child/parent linkage, timestamps,
intent and permission requirements, and bounded source/result text. Root and delegation records
also carry the original quota run ID/deadline when quotas are enabled. Profile instructions are
snapshotted in the child context. Method records contain the actual binding/method and JSON args;
code records contain the actual submitted module. Action IDs come only from host-captured actions.

Preparation is stored **before** child model/code/method dispatch, outside the chat-step buffer. Completed
calls/results remain even if the agent step aborts before its transcript barrier. On DO construction,
all old `prepared`/`running` records become `unknown`, including orphan preparations without an
active root. A resumed root with unknown evidence cannot delegate again. No child or Code Mode
operation is reconstructed/replayed after restart. A fresh user request may reconcile evidence and
explicitly start new work; historical IDs never restore capabilities.

Statuses are `prepared`, `running`, `completed`, `failed`, `unknown`, `pending-approval`.
A final answer without unresolved operations completes a child; exhaustion of its turn cap without
a final answer is `failed`. RPC errors are conservatively `unknown`, since an error does not prove
no effect occurred. Unknown or pending work prevents further delegation within that root and further
RPCs in that child. Source is at most 32,768 characters (delegation task 16,384); result is at most
16,384 characters with `truncated` set when shortened. Root request snapshots may be shortened.
Action references are capped at 128 per record; overflow sets `actionIdsTruncated` and forces
`unknown`, requiring reconciliation against the canonical workspace action history.

- `listSpecialistRecords({before?})`: at most 20 headers, reverse ID order (time-prefixed IDs).
  Pass the last ID as the next exclusive `before` cursor. Source/result/permission maps are omitted.
- `readSpecialistRecord({id})`: one record, including source/result and current canonical action
  states under `actions: [{id, state}]`. Missing actions report `unknown`. Workspace-local lookup
  prevents reading another workspace's records.

The store admits at most 256 records/root and 2,000 records/workspace. Exhaustion rejects new
specialist preparations, not normal coordinator tools or record reads. There is intentionally no
model-accessible deletion/overwrite/garbage-collection API. Retention/pruning UI is future work.
Child chats are execution history, not independently resumable conversations. Records do not depend
on the chat still existing. A later Gadget-building request uses the normal root file/worktree tools
and selected records; this implementation does not auto-create, publish, or mutate a Gadget.

## Approval semantics

A proposal is not a commit. Pending actions stay in the existing approval system and are visible
in the child's normal chat. The record's `pending-approval` status is historical; use
`readSpecialistRecord`'s current `actions` to distinguish pending/approved/rejected/unknown canonical
state. Canonical approval/application may append its normal confirmation message, but **does not
resume a specialist or obtain new model allowance**. A new explicit coordinator request is needed
for further reasoning. The original root budget is never reset by a child or its approval.
Normal non-specialist spawner and approval behavior is otherwise unchanged.

## Verification boundary

Workerd tests exercise the actual child agent loop, typed storage, canonical action capture,
root-scope borrowing, native RPC membrane, and existing tail delivery, using a deterministic fake
model and both simulated and actual local WorkerLoader execution of the production-generated
harness (no inference/network calls). Regressions cover delayed session acquisition after disposal,
detached prepared/running calls, interrupted running calls, and stalled simulated loader verification.
Local workerd rejects top-level timer I/O during native module startup itself; that fail-closed path
is also tested. Deployment-specific real session methods still require staging verification by the deployer.
No live deployment, production variable, paid model call, commit, or push is part of this change.
