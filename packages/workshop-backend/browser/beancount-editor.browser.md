# Beancount editor browser regression

Run from `packages/workshop-backend` with an already-installed Playwright and Chromium:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
CHROMIUM_PATH=/absolute/path/to/chrome \
node browser/beancount-editor.browser.test.mjs
```

Both overrides are optional when Playwright resolves locally and its matching browser is installed.
No dependency installation or browser download is performed by the test. It invokes the local
`build-browser-runtime.mjs`, then loads the actual generated SDK JavaScript and CSS into a blank
Chromium page. All browser network requests are aborted. Only synthetic journal text is used;
no credentials, backend, RPC, real journal, save API, or external service is involved. The save
callback increments a fixture counter. Only a pass summary is logged.

## Reproduced cause

The shipped component is `browser/gadget-kumo-runtime.ts`'s `GadgetUI.BeancountEditor`, built into
`src/generated/gadget-kumo-runtime.txt`. Its language/theme comes from
`workshop-shared/src/beancount-editor.ts` (also used by read-only Workshop reviews).

The existing Lezer grammar correctly parsed the fixture's date, accounts, currency, strings,
and comment. The defect was not an absent parser:

- The highlight style had no comment rule: Chromium rendered the comment as unstyled text,
  without a highlighted span.
- Dates and currencies both computed to `rgb(58, 114, 201)` in light mode.
- Account spans computed to the same `rgb(31, 29, 26)` as ordinary editor text.
- Several light syntax colors and both gutter palettes had insufficient normal-text contrast.
- The SDK set the host `color-scheme` only at startup, but reconfigured the editor's palette on
  subsequent `data-mode` changes. Kumo's `light-dark()` surfaces could remain in the old mode.
- Selection styling targeted descendants of `.cm-content`, not the content element itself, and
  the drawn-selection selector was weaker than CodeMirror's focused default. The regression
  caught the default lavender selection instead of the requested palette. The active-line fill
  was also opaque; it is now translucent so it cannot hide the drawn selection.

The fix retains the grammar and completion source, completes semantic tags/styles (including
comments, metadata, tags/links, booleans and transaction keywords), distinguishes token colors,
and synchronizes host mode. Editor chrome now has a definite themed background, readable gutters,
monospace text, visible focus, drawn selections/cursors, and focusable, labelled read-only content.
No template or update/migration behavior is changed.

## Assertions

The real rendered `.cm-line span` elements for date/account/currency/string/comment must all exist
and have five distinct computed colors in light, dark, and light again. Token/gutter/cursor colors
must meet 4.5:1 contrast against the computed editor background; the five principal syntax colors
also meet 4.5:1 on the computed selection background. Additional rendered spans cover directives,
flags, signed numbers, metadata/booleans, tags/links, and a semicolon inside a string. The test also checks monospace,
host/editor color schemes, visible focus and selection, no change callbacks from theme/selection
transactions or controlled replacements, typing, undo, save shortcut, keyboard account completion,
read-only mutation prevention and accessibility attributes, and unmount cleanup.

Supplementary checks: shared and backend `tsc --noEmit`, explicit DOM typecheck of the browser
runtime (the backend tsconfig only includes `src`), frontend read-only comparison tests, backend
completion/dependency tests, and lint of editor-owned files.
