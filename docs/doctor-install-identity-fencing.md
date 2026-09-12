# Doctor install preparation: identity fence (K)

This is an unoffered preparation repair, not an installer. Confirmation remains an
unconditional refusal. Parent review is required before any publication leg;
this change authorizes no allocation, opt-in, publication, UI or activation.

The authenticated root snapshots the existing User identity incarnation before
publisher/access awaits. The one durable attempt binds that incarnation as well
as the exact root session, canonical principal and validated descriptor digest.
The incarnation is the existing `usage-identity-v2` value, not the root's cancellation
generation. Its existing bind semantics are unchanged: equivalent subject/key
bindings preserve it; a newly bound identity rotates it. Legacy identities lazily
receive the same epoch through a shared helper, without initializing usage SQL.

After the root's last release/digest/access await, the User checks access and then
synchronously reads identity, incarnation and the exact live attempt. There is no
further policy/publisher await before the root's local cancellation/expiry fence
and preparation return (or unconditional confirmation refusal). Missing incarnation
in a pre-repair slot fails closed. Validation does not repair or renew a slot.

The slot remains one fixed key, with a server token and original 60-second expiry.
Cancellation retains it until expiry; expired replacement cannot be cancelled by
an old token. No alarm, tombstone collection or quota acquisition is introduced.

Native tests use the actual PublicApi/authenticated root and User. They exercise
supported Durable Object `storage.deleteAll()` followed by actual authentication
and `bindDeploymentIdentity`, equivalent rebind, plus separately labelled retained-
slot identity-removal/ABA fault injection. Paused affirmative policy responses
cover initial prepare, retry and confirm; cancellation, expiry and abort deny.
Initial publisher/access pauses also cannot adopt a replacement incarnation.
The suite asserts empty User/anchor gadget lists, no usage SQL tables and at most
one attempt slot, with a trap on root usage authority. Existing User V2 and paired
usage suites separately preserve owner, role/healthy-TTL and equivalent-identity
semantics. These are synthetic local tests, not evidence of provider or live-user
installation behavior.

This fence is a preparation decision at the final User read, not a distributed
publication transaction or a promise that identity cannot change after an RPC
response is sent. A future installer must fence its own actual writes/readiness
and publication after their last awaits, and obtain independent parent review.
