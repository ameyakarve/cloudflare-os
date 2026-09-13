# LEG3a: authenticated native owner/queue prerequisite only

`AuthenticatedApi.openNativePost(candidate)` is wired to actual User registration/incarnation,
Overseer owner/readiness/canonical Ledger resource checks and root lifetime. It **always returns
null**, including ON. No W application binding, human authority, M receiver, host UI, preparation,
review, confirmation, close or receipt recovery has been attached. This is not full LEG3 delivery.
The private symbol is kernel-local (not RPC-addressable); only tests retain its real guard/queue.
There is intentionally no `checkNativePost` or successful approval helper to accidentally attach.

Only `NATIVE_POST_HUMAN_V2 === 'true'` permits prerequisite admission. The actual owner queue
also requires the existing required-usage mode and a named V2 route; it cannot fall back to V1.
No deployment configuration or Doctor flag is changed. Candidate fields are copied as own data
before awaits; unknown outer fields are ignored without traversal. Positional extras refuse.

The guard compares actual User `usage-identity-v2`, current registration, current owner,
canonical system binding/key, readiness, code revision and existing owner/Stop epoch.
Canonical binding identity replacement now increments that epoch, including A→B→A. Code updates
conservatively invalidate contexts even if unrelated. Reset/eviction breaks retained DO facets;
there is no persisted native consent. Session lifetime is fixed to at most fifteen minutes.
No namespace, queue, grant or guard is returned to the host. The root's local symbol is not a
new agent/Overseer/Gadget/source/export/share/iframe member.

Check order: local root → owner → User policy + final synchronous incarnation/registration →
owner → local root/deadlines. A remote reply is not a distributed lock. An identity change after
User computes its affirmative can still race delivery; the suite explicitly demonstrates this,
then verifies the next check refuses. Future M Post must retain its own last remote authority
and synchronous canonical fences: canonical close versus canonical transaction is the only
linearizable cancellation guarantee, not host Stop time or globally instantaneous role loss.

The queue delegates to the **actual ApprovalQueueImpl `{from:'user'}`**, without a chat/agent
lease, then actual OverseerUsageAcquisition/Lifecycle → User V2 → M OsUsagePolicy/UsageDO.
Native getGrant/reserve/settleTokens/finish are preserved unchanged. Both owner and root guard
finish acquired runs on failed postchecks; root guard also checks the acquired grant. Disposal
is not finish; durable original-route cleanup ownership survives lost replies and teardown.
A returned run is accounting capability, NOT financial authority. No run is held by the
public factory; future W must own each real operation through finally, enforce one busy UI
operation, consume its exact UI decision synchronously and implement the full M issuer protocol.
This prerequisite has no decision tokens, views, receipt adoption or automatic retries.

Tests use actual classes and native Workers RPC with synthetic local ingress/role data and
initial registered-workspace metadata. Canonical system binding and all usage admission,
receipts and cleanup are real. No successful owner/queue/accounting method is mocked. Fault
spies delay/drop/revoke **after actual operations**, and cannot fabricate successful admission.
The one test spending leaf reconciles admission + one capability leaf = two capability calls;
it is not a native Post method receipt table or M Post integration claim. No model/provider
leaf or token settlement success is claimed. Lost acquisition retains the exact durable route,
then drains after native eviction. Existing paired suites cover the broader lifecycle matrix.

Run with installed dependencies, no providers:

```
MILESVAULT_CANONICAL_ROOT=/home/exedev/projects/milesvault-os-beta \
  ./node_modules/.bin/vitest run -c vitest.native-post-human.config.ts
```

Mandatory continuation: actual W private service/issuer/control classes and exact detached
one-use decision evidence; K deployment pins/service checks and bounded issuer context;
actual K→W→M prepare/review/confirm/close/lookup with all final-await races and original-route
cleanup. Do not enable or attach M using this prerequisite alone. Generated native artifacts,
M business code/calendar-month decisions, Doctor frozen sources and parent gitlink are unchanged.
