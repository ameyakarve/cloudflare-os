# Deployment install host — source wiring, offering OFF

The accepted private publication protocol at `8c1f294` now has an actual trusted Outputs
card/dialog and a public auth-root confirmation branch. **This is not activation approval.**
Neither deployment nor staging configuration has been changed.

## Boundary

- Backend `DEPLOYMENT_INSTALL_OFFERING` and frontend build-time
  `VITE_DEPLOYMENT_INSTALL_OFFERING` must each equal the literal string `true` to offer a new
  installation. Both default OFF. These are deployment-owned settings, not AdminConfig,
  catalog metadata, URL parameters, agent inputs or user preferences. Do not enable them on
  the strength of these tests. Existing committed-result lookup remains available while OFF.
- The host reads at most one projected deployment descriptor. Opening review prepares only;
  the dialog displays the **prepared** root-derived account, release/version, full selectable
  client hash and publisher-owned plain text. Kumo initially focuses Cancel (first control).
- Only deliberate Install invokes `confirmDeploymentInstall(attempt)`. No caller-selected
  owner, existing workspace, bindings, source or callback is accepted. It calls the reviewed
  private publisher, retaining its descriptor/principal/incarnation/deadline fences and new-only
  User/Overseer publication. The offering is checked again by the final root check.
- The card neither receives nor forwards iframe messages. AuthenticatedApi stays in trusted
  host context. No agent/exporter/GadgetClient or approval contract changes.
- Same-root retries use the same token and exact committed IDs. Open is a separate link to
  `/workspace/<returned workspace>?w=<returned workpiece>`, not default selection or a title match.

## Cancellation and root lifetime

`cancelDeploymentInstall` now returns null only when User has synchronously closed the exact
uncommitted slot. A result means already committed; missing/replaced state and failed/lost
replies throw, not a claim that no app exists. Cleanup acknowledgement can be delayed after the
close write. Once Cancel is requested the host never offers confirmation again for that attempt,
even if the cancellation request itself was lost. It offers only cancellation retry.

Publication and cancellation still linearize at User, not at browser wall-clock time. Disconnection
is not instantaneous distributed revocation. Root replacement unmounts the old host incarnation;
late replies cannot navigate or render into the new account. Unmount cleanup is best effort only.
No token or action is persisted in URL/storage, and no action is replayed after reconnect/reload.
A new root cannot recover the prior root's attempt; UI explicitly warns that an earlier request
may have committed and to inspect Outputs before considering another installation. No history
scan or latest-release substitution was added to recover unknown outcomes.

## Evidence / remaining gates

The W-owned local fixture `packages/custom-gatekeeper/doctor-install-host/` drives this production
card over WebSocket into production PublicApi authentication, actual User/Overseer SQLite and
actual W DoctorApplication frozen descriptor/snapshot. Synthetic ingress/accounts and policy are
local-only. A resource-less synthetic Ledger account satisfies ordinary owner-open provisioning;
it supplies no operation or approval authority. Canonical operations are traps, not success mocks.

Browser coverage includes two contexts, mount/deep-link/reload non-installation, exact text/hash,
Cancel initial focus and Escape, deliberate install, exact navigation, revoke, real committed
result with its first reply discarded followed by same-attempt retry, cancellation-request loss,
and frontend OFF. An owner-host check loads the exact W raw client inside the returned bundle,
connects the actual W V1 session, completes actual Stop and refuses an unreviewed confirmation;
that check repeats after reload. It is not the full production GadgetUI iframe rendering chain.

Native tests cover public OFF, public publication/retry, committed-result recovery while OFF,
cancel-before-commit, offering withdrawal during initialization, revoke and descriptor changes,
plus the existing private publication/race/identity/Stop/access suites. The old READ archive and
frozen generator checks establish repository-byte preservation, not a live-history inspection.

**Uncompleted gates:** full production GadgetUI iframe composition and retained-frame account
switch/reconnect fencing; actual metered Recheck → evidence Review → one-use Confirm with canonical
SQLite/paired usage; composed old READ browser history/pins; mobile/dark install-dialog matrix;
real upstream session invalidation and fleet/rollback acceptance. No successful approval mock is
credited for these gates. Keep offering OFF pending these gates and independent review. No M,
provider, private-data, secrets, push or deployment work is required or authorized by this document.
