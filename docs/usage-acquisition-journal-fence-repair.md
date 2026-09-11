# Caller-journal cleanup fence repair

Independent review of `3f95e50` found a local P1 invariant defect: after close advanced a slot fence, closing that advanced generation could clear the older retained cleanup record without a remote acknowledgement. This was reproduced at ordinary and maximum generations; it was not a demonstrated browser exploit.

`close()` now checks the SQL row's cleaning state before the empty-slot path. Exact original and already-fenced stale closes remain idempotent; an unmatched current/advanced candidate is refused without changing the row. Only acknowledged cleanup may remove the original route, owner, key, complete ticket and retry obligation.

Validation:

- Actual Workers/SQLite committed suite: 14 tests passed.
- The two added cases against original `3f95e50`: 2 failed, 12 passed (negative control).
- Repaired source with the independent review's three adversarial cases: 17 tests passed.
- Backend TypeScript and scoped lint passed.

This repairs the local journal only. Receiving User integration, both Overseer sites, real paired remote terminal-proof validation, shared alarms and activation acceptance remain separate gates. No deployment or controls activation occurred.
