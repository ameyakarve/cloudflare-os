# Gadget SDK paper defaults

This is separate from the opt-in management-frame contract in `embedded-paper-theme.md`.
`withGadgetKumo()` already supplies every Gadget UI read with the current SDK library and
stylesheet. Its modern and legacy helper styles now default to paper/ink/yellow, light/dark,
flat controls and bundled licensed Inter. No saved `client.js`, journal, artwork or authored
format is rewritten. Reopen or fully refresh to replace a mounted frame's old bundle.

`browser/gadget-kumo-styles.css` bundles upstream Kumo with low-priority paper defaults;
`gadget-kumo-legacy.css` retains the historical helper ABI. Normal unlayered authored CSS
wins. The targeted brand-button foreground important rule is an explicit exception needed
to beat Kumo's important white foreground; destructive buttons are not matched. It excludes
explicit inline color declarations. This is not an unconditional guarantee for custom
primary-button stylesheet colors. Arbitrary authored colors are not migrated.

`GadgetUI.tsx` permits only `data:` fonts in addition to the existing CSP. The opaque
sandbox, parent-source theme check and network/frame restrictions are unchanged. No new
RPC, authority, grant, save call or worker loader version is involved. The shared Beancount
editor observes mode updates without replacing the document or history; its diagnostic and
browser regression instructions are in `packages/workshop-backend/browser/beancount-editor.browser.md`.

From `packages/workshop-backend`, build with `node build-browser-runtime.mjs` and run
`browser/gadget-kumo-paper.browser.test.mjs` using `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH`
for an already-installed browser. It exercises actual wrapped modern/legacy clients, Kumo
controls, both modes/media, generic authored overrides and embedded fonts offline. The
editor fixture exercises rendered syntax, contrast, selection, editing, undo, completion,
controlled updates and read-only behavior. Save callbacks are synthetic, never service writes.

Integration verification: 880 backend tests, 380 frontend tests and kernel lint/type/build
passed. The host's 14-test GadgetUI suite includes data-font-only CSP assertions. Historical
Ledger clients and deployment-owned Ledger/Award/Points interiors additionally passed offline
browser fixtures in the wrapper repository. These are not live journal or provider checks.
