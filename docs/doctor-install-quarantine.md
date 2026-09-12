# Private installer allocation / quarantine leg

**Public confirmation remains unconditionally closed. No offer, UI, installation success,
private READ provisioning, controls opt-in, operation, or publication is implemented here.**
This leg follows the preparation identity fence and frozen snapshot transport. It does not
replace either of them. Final publication and human host composition require a separate leg.

## Actual path and authority

The authenticated root has a kernel-local **own symbol property** for staging. It is not a
string/prototype RPC method, configuration flag, shared API member, or public-confirm branch.
Its only argument is the prepared attempt. The root derives the principal and session; User
checks its current stored identity/incarnation, access grant, attempt, digest, and original
60-second deadline. No workspace, owner, source, binding, or hash selector comes from a client.

User fetches/validates only the private publisher's frozen snapshot, then synchronously stores
one new random Overseer ID in its existing fixed attempt slot **before the initialization RPC**.
It never calls ordinary `newGadget`, registers a provisional workspace, or modifies the output
index. Concurrent staging and ambiguous/lost replies use that same ID and workpiece.

The actual Overseer admits only this User's exact mapped tuple. Before cross-DO/publisher/git
awaits it persists a quarantine record and the original expiry in the **existing shared alarm
writer**. It fetches the trusted snapshot itself and writes its projected three-file bootstrap
through the actual git store. A final User check precedes synchronous owner/default-workpiece
initialization. Commit time is derived from the original deadline, not the retry time.
`initialized` means inert content exists, **not ready or installed**. No authority marker is set.

The independently repaired snapshot validator projects bounded own-data DTOs. The auth root
now returns/stores its projected release, rather than retaining the raw publisher object.
Unknown publisher extras are discarded; public RPC arity/selector rejection is unchanged.

## Quarantine and cleanup protocol

| State | Behavior |
| --- | --- |
| User prepared, no ID | No target or operation authority. |
| User mapped / destination initializing | Exact retry ID; destination owns deadline cleanup. |
| Destination initialized | One inert workpiece; same quarantine and deadline. |
| User cancelled / expired / incarnation changed | No admission. Original target retained until cleanup ACK. |
| Destination cancelled | Content removed; temporary exact-ticket fence through original deadline. |
| Destination deadline passed | Alarm removes content and temporary fence. An expired admission is rejected even with no fence. |

Quarantined workspaces deny generic owner/shared open, output backfill, gadget acquisition,
saved/private UI bundle and session paths, sharing, restore, ordinary blueprint initialization,
READ provisioning, and opt-in. No new client can be minted during initialization. They cannot
fall back to legacy saved-source execution. User list/get/output visibility remains absent
because there is no registered workspace. Ordinary workspaces with no quarantine marker retain
the existing paths. After cleanup there is neither an owner nor a registered workspace to open.

This is **not a cross-DO transaction**. Destination input-gate serialization prevents local git
writes racing deletion, but User remains reentrant so cancel/reset/rebind can invalidate the
initializer's final callback. Identity change immediately closes the User slot and schedules
cleanup against its original target. Cleanup failure or a lost ACK leaves that exact ID in
User storage; a retry/expired preparation cannot allocate a replacement before ACK. Reopening
User or Overseer does not lose these fences. Root abort/disposal explicitly cancels; an ambiguous
init reply without cancellation is retryable, not a reason to allocate or discard the target.

Physical User `deleteAll()` necessarily erases its slot. Once destination admission has begun,
the destination's persisted deadline independently owns cleanup; it cannot initialize without
the old exact User mapping. If reset happens before the RPC, no content exists yet, and a late
RPC fails that same check. No cleanup resolves a replacement principal or target.

There is one fixed User slot and one destination record per allocation, no retry counters,
per-click User tombstones, or deadline renewal. A cancelled attempt cannot be replaced during
its original window. Destination tombstones are temporary and collected by the shared alarm;
its ordinary usage/agent updater must not erase that deadline. An expired initializer is refused
both before and inside its local input gate. This leg offers no way to release quarantine while
retaining content. Publication must establish a separately reviewed durable protocol first.

## Local evidence and limits

`__tests__/deployment-install-quarantine.test.ts` uses actual authenticated roots, User and
Overseer DOs, native RPC/storage, git initialization, native eviction, and the actual shared
alarm. Only publisher/access data and scheduling/transport faults are synthetic. It covers
concurrent retry, lost first init reply, guessed opens during initialization, changed tuple and
second-account rejection, cancel/abort/expiry/reset/real-bind ABA, cleanup failure/lost ACK,
late init after reopen/new generation, bounded alarm collection, and continued public closure.
It does not substitute a successful installer callback or an approval mock for this lifecycle.

Scoped legacy Doctor identity, access, Stop, usage-acquisition/lifecycle, and journal suites are
regression evidence, not new provider, paired canonical, browser-human, rollout, or fleet
acceptance. M-dependent suites are deliberately not run. Frozen W source and the snapshot
validator remain separately owned. Details/logs: `/tmp/mv-beta-doctor-install-quarantine-report.md`.
