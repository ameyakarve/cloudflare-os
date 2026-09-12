# Private Doctor installation publication (slice K)

Backend protocol implemented; **independent publication acceptance pending**. Public
`confirmDeploymentInstall` retains its unconditional refusal and there is no UI/offer or
activation switch. The kernel-local own-symbol entry `publishDeploymentInstall` is trusted
composition infrastructure, **not human consent**; it is absent from all shared RPC APIs,
agent tools, authored gadgets and exporters. No successful approval fixture is involved.

This extends the accepted allocation/quarantine protocol in `doctor-install-quarantine.md`.
The existing W private frozen publisher is used unchanged. Nothing reads the mutable catalog,
chooses latest, upgrades an old workspace, rewrites historical sources, starts a Doctor
operation, obtains a usage budget, or connects a provider during installation.

## Protocol

1. Actual authenticated root preparation binds the original principal, User incarnation,
   session, attempt, descriptor digest and immutable 60-second deadline. The existing User
   allocator claims one random new workspace before RPC. Destination initialization projects
   and validates the publisher snapshot, writes the exact three files, and assigns one workpiece.
2. `readyDeploymentInstallQuarantine` accepts only that exact existing quarantine ticket. It
   validates the current projected descriptor and rechecks the User after publisher awaits.
   Under the destination input gate, synchronous private helpers provision only the owner's
   Doctor READ binding, pin V1 controls, and persist `ready` with the exact workpiece/release/hash.
   There is deliberately **no opt-in RPC await** between binding, pin and ready persistence.
   The public/private historical provisioning and opt-in methods still reject quarantine.
   Installer provisioning skips the ordinary asynchronous last-active notification; it has no
   live clients and must not publish indirectly. Ready is still unusable and unlisted.
3. User receives the ready tuple, rechecks the exact target, then calls the actual root's final
   authority check (liveness, projected descriptor digest, fresh access policy, deadline).
   The callback returns only the checked access deadline, not consent or operation authority.
   After that last await, User synchronously rechecks the slot, cancellation, identity
   incarnation, principal, target and both deadlines. A synchronous storage transaction writes
   the workspace registration, exact output index, private workspace receipt and bounded slot
   result together. No external await occurs in this commit section.
4. Destination readiness resolution requires the durable User receipt and exact tuple, current
   User access/incarnation, owner, private binding and pin. It changes `ready` to `published`,
   retaining the marker permanently with the workspace (never removing it into a legacy path).
   Root open and direct owner open resolve this proof before normal gadget ingress. A foreign
   owner cannot resolve it. The existing pinned host bundle/session path still verifies actual
   UI bytes and refuses a missing V1 factory; saved bootstrap code is not a fallback.

## LINEARIZATION and cancellation

**Publication linearizes at User's synchronous transaction. Cancellation linearizes at User's
synchronous close write.** User is reentrant throughout preceding remote awaits. A cancellation
that wins this ordering prevents commit; no stale callback can overwrite its closed slot.
If publication wins, cancellation is a no-op for that completed installation, never a request
for quarantine deletion. Concurrent confirmations return the same stored result.

A root abort/disposal or Cancel immediately fences its local generation and dispatches durable
cancellation. The final callback checks that generation too. These are separate objects:
**socket-abort wall-clock time is not a distributed transaction or an instantaneous revocation
claim**. A callback already returned and a cancellation RPC not yet delivered can race; User's
commit/close order decides. Cancellation acknowledgement establishes that order. This is also
why a post-commit root check must not turn a real success into “cancelled/no app created”.
Existing affirmative User grant caching remains bounded by its original TTL; the final root
check reads fresh policy and its returned deadline is checked at commit. No new live upstream
cookie-revocation claim is made.

## Recovery, retention and cleanup

- Before commit, a lost initialization/ready reply retries the original allocated target; no
  new ID, expiry renewal, per-call journal or retry counter is added. All write authority expires
  at the original deadline. Destination input-gate/runtime and publisher/policy timeouts remain
  in force; this is not a guarantee of transport availability.
- After commit, result lookup precedes root liveness. A lost commit reply is resolved once by
  lookup; caller retries are also lookup-only. Final destination ACK failure does not undo
  publication. The result is exact workspace/workpiece/release IDs, never a capability, and
  later revocation may deny opening those IDs.
- The reply-recovery slot is one fixed User key. Its result remains recoverable until a new
  preparation replaces the expired slot, including native User/Overseer eviction. Once replaced,
  the old root cannot scan history to rediscover it or create another installation. Failure then
  means unavailable, not proof that nothing committed. The private per-workspace receipt survives
  slot replacement and is deleted with ordinary User workspace deletion. It never appears in
  public gadget metadata or exports. This is workspace state, not a per-click tombstone.
- Before any blanket quarantine deletion, destination asks User to atomically resolve a receipt
  or close the original slot. Thus cleanup and publication cannot both win. A committed receipt
  prevents deletion even if its final ACK was lost. A locally published target never uses blanket
  `deleteAll`; ordinary workspace/usage cleanup remains unchanged.
- At expiry the shared alarm recognizes a committed ready receipt and preserves/promotes the
  target. Published markers no longer take quarantine alarm priority: ordinary usage/agent
  cleanup owns the alarm again. Uncommitted targets retain the original generation-fenced
  deletion and temporary-tombstone collection behavior. Failed/lost cleanup ACK retains the
  original mapping, and old cancellation cannot erase a newer slot.

## Local evidence and limits

`deployment-install-quarantine.test.ts` exercises actual PublicApi/auth root, User, Overseer,
SQLite storage and git. Publisher bytes and policy are synthetic; scheduling wrappers delay or
lose native replies without replacing commit/initialization/opt-in logic. The matrix covers
initialization, pre-binding, ready reply, and final pre-publication check awaits with cancellation,
root abort, physical User reset, actual-bind ABA, expiry, access revoke and descriptor change.
It checks guessed open/bundle/connect denial and empty lists until commit. Further cases cover
two actual roots, concurrent confirmation, lost init/ready/commit/final ACK, User/target reopen,
slot replacement, receipt deletion and expiry cleanup of an already committed ready target.
An additional physical destination-reset fault pauses the alarm's receipt reply: the alarm
rereads its exact local marker after that await and cannot resurrect removed state or run
ordinary SQL cleanup through the stale pre-reset instance.

No actual W/M/control-operation/human-click chain is claimed by this fixture. The successful
installer host test intentionally has **no successful control factory**: missing pinned UI
and connect-before-pinned-UI deny rather than executing the frozen bootstrap. Existing Doctor
identity/READ/Stop, access, User usage lifecycle and journal regressions are separate evidence.
No frontend, frozen bytes, W bridge, shared API, canonical model, quota policy or deployment
configuration changes are required by this slice. Independent backend review must precede any
public confirmation implementation; host human composition remains a separate gate.
