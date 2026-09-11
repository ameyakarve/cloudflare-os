# Internal receiver-fence checkpoint — requested User boundary INCOMPLETE

This is an internal split, not completion of the requested User receiver + User→M integration.
Nothing imports this receiver in production. Existing User/Overseer acquisitions remain V1-compatible
transient paths. P2 and controls activation remain blocked, including the outstanding Overseer gate.

## Scope

`src/usage-acquisition-receiver.ts` adds exact upstream-ticket fencing over the unchanged
`UsageAcquisitionJournal`. Each of the twenty journal slots has one bounded ticket metadata row;
a singleton persists the receiver epoch. Metadata never grows with attempts. Journal generations
remain the only allocation fences and are never reset. This is a K-owned upstream ticket type,
not a mirror of M's contract. No M calls or generated policy contract are added.

The receiver supports payload-free candidate reads, atomic full-ticket claim, exact recovery status,
full-ticket continuation matching and cancellation. A changed same-generation ticket cannot inherit
the winner's claim or cancel it. Cancel-before-begin advances the journal fence. Cancellation retains
an existing downstream obligation in its original journal row, without allocating cleanup capacity.
The receiver does not weaken or edit the journal under independent review.

Claim and upstream-ticket persistence share a SQLite transaction. Current full-ticket metadata may
remain after a terminal transition; it occupies the same fixed row and is overwritten only when a
later journal generation is successfully claimed. Old generations are resolved by the permanent
journal fence, never by retained ticket history. Status is recovery data, not authority; only
`matches(ticket, now)` performs synchronous local expiry recovery. Neither can replace required
role, identity/incarnation, adoption or remote-active checks.

## Executed local evidence

- Existing dedicated native journal configuration: 2 files / 19 tests pass (12 unchanged journal,
  7 receiver). Workerd asserted, SQLite transactions, rollback trigger and actual DO eviction used.
- Receiver tests cover losing full-ticket cancellation, changed retries, cancel-before-begin,
  old cancellation versus next generation, fixed deadline, malformed/epoch/future fences,
  twenty cleaning slots, acknowledgement failure/recovery, and maximum-generation close/seal.
- Backend and shared `tsc --noEmit` and scoped lint pass.
- A concurrent reviewer modified the journal's cleaning-row close guard during this run. That diff
  was inspected read-only and is excluded from this checkpoint; the final tests used that working
  tree. This leg made no journal edits.
- The cleanup callback test is explicitly synthetic journal evidence, NOT User→real M proof.

## Remaining work — not implemented or claimed

1. Mechanically derive M V2 declarations and actual policy method signatures with provenance;
   wire W's private policy bridge without a hand-written mirror or V1 fallback.
2. Integrate the receiver into actual User methods, including explicit adopt and lookup-only resume.
   Add a coordinator that derives canonical identity and run ID, persists the downstream M ticket
   and arms the journal before M begin, persists adoption before M activation, and validates every
   reply and continuation against the original window, full ticket, access and identity incarnation.
3. Preserve original deployment/owner/key cleanup routes after identity changes; merge User wake
   and alarm recovery, bounded serialized drain and retry. This primitive installs no alarm handler.
4. Make actual User roots validate durable adoption and exact active M linkage for getGrant/reserve;
   make finish durable and retryable instead of relying on a transient flag. Preserve V1 compatibility.
5. Test actual native User→real M UsageDO SQLite boundary, with late/lost/reordered transport,
   access TTL, identity ABA, reopen, cleanup failure and full-slot recovery. These seven local tests
   are not an alternative to that acceptance gate.
6. Later integrate both actual Overseer sites and perform independent paired review. Overseer is
   explicitly outside the requested smaller User leg, but remains a P2 release gate.

No User, W, M, shared/generated contracts, provider/network code, public browser API, Ledger logic,
legacy Overseer wiring or gitlink is changed by this checkpoint. No deployment or release claim.
