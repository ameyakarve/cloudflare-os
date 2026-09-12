# Overseer usage lifecycle integration (not paired acceptance)

Actual `OverseerImpl` now owns `OverseerUsageLifecycle` and the reviewed twenty-row
`UsageAcquisitionJournal`. This supersedes only the historical statements that Overseer
has no journal owner. **Both `newUsageScope` and fresh `getUsageBudget` remain V1.**
No V2 acquisition, adoption publication, resume adapter, protocol selection or release
activation is introduced here; paired P2 remains blocked.

The usage-only SQL owner singleton persists a random incarnation across eviction, rotating
on every semantic owner change (including A→B→A). At most twenty execution-link rows pair
local slot/generation with the creation-owned chat/execution; controls have no resumable
execution. Owner changes, Stop, chat destruction, execution replacement and finalization
close retained intents synchronously. Wake closes interrupted non-adopted intents and any
adopted intent without the original current, non-stopped execution and owner incarnation.
These records are cleanup ownership, not reserve/dispatch authority. A future acquisition
adapter must perform live execution/access checks around every await and persist/arm its
complete User ticket before send; this leg does not claim those call-site checks exist.

Cleanup uses the stored `UserDurableObject` route and original User ID (`owner` and `key`
must match), sends the full private receiver ticket, and accepts only User's `terminal`
acknowledgement. Unknown routes, errors and lost acknowledgements retain the original row.
No current-owner lookup, access renewal, quota admission, browser approval or journal RPC
is involved. Workspace deletion clears typed-storage KV but retains independent usage SQL
fences and obligations; deleting all storage would orphan these obligations.

All host alarm writers recompute the minimum of journal cleanup/expiry and the existing
agent/delivery duties under the input gate. Ready responses retain their existing idle-agent
priority; delivered-record retention and alarm deletion cannot postpone/erase usage work.
The reviewed journal's arm operation uses the same gate. Alarm service drains at most twenty
rows (one-second transport attempt bounds, persisted bounded retry backoff) before any live
agent wait. With live agents, the handler returns to permit later retry alarms (including for
intents created after this alarm began), retaining at most one agent-idle delivery continuation. The agent keepalive deadline advances on alarm
service, avoiding a stale keepalive deadline spinning ahead of cleanup retries.

`__tests__/overseer-usage-lifecycle.test.ts` runs in the existing workerd-only actual Overseer
SQLite fixture. It covers persisted owner ABA, Stop/late transition refusal, interrupted wake,
original routes, unavailable/lost cleanup acknowledgement and retry, adopted execution
replacement, keepalive conflicts, delivered retention/deletion conflicts, and bounded cleanup
before a stalled live agent. Synthetic tickets and terminal callbacks are strictly local
lifecycle evidence, not User/M accounting, paired transport or final-root-loss acceptance.
Existing Stop creation-owned continuation semantics, legacy READ, User/M and W are unchanged.
