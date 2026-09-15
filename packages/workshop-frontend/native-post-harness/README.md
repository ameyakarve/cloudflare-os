# Native Post UI-layer harness

**Synthetic API responses, not native composition.** This mounts the production
`NativePostConnection`, `NativePostPanel`, generated admission/digest verification and complete
renderer. Only this test directory substitutes the AuthenticatedApi opener/native session. It does
not demonstrate real human authentication, native RPC authority, SQL effects, paired accounting,
processor completeness or deployment readiness. Production code never imports this directory.

## Production entry

`/native-post?workspaceId=…&workpieceId=…`, also linked from a workspace with a selected workpiece.
The page uses `useAuthenticatedApi().authenticatedApi.openNativePost(candidate)`. Candidates never
confer authority. No iframe, Doctor flag, installer or backend changes.

The production gate is default OFF. It requires deployment-owned
`VITE_NATIVE_POST_HUMAN_V2 === 'true'` and a 64-lowercase-hex
`VITE_NATIVE_POST_RENDERER_ARTIFACT_DIGEST`. The digest must be independently approved and match the
existing backend/service renderer pin; it is never learned from a response. The existing frontend
build task already fingerprints/forwards `VITE_*`. No deployment flags are set by this harness.

## Run locally (installed dependencies only)

From K (`cloudflare-os`):

```sh
pnpm exec tsc --noEmit -p packages/workshop-frontend/tsconfig.json
pnpm exec tsc --noEmit -p packages/workshop-frontend/tsconfig.vite.json
pnpm exec tsc --noEmit -p packages/workshop-frontend/native-post-harness/tsconfig.json
cd packages/workshop-frontend
pnpm exec vitest run src/features/native-post/NativePostPanel.test.tsx --maxWorkers=1
pnpm exec vite --config native-post-harness/vite.config.ts
```

Open `http://127.0.0.1:4317/native-post-harness/index.html`. Optional `?mode=malformed`,
`?mode=expired`, `?mode=lost-reply`, and `&dark=true` affect only the synthetic fixture.
The fixture is not part of the production Vite entry/build.

With that local server running, from K:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright/index.mjs \
CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/installed/chrome \
node packages/workshop-frontend/native-post-harness/browser.mjs
```

The runner refuses non-loopback browser requests, performs separate selection/edit, Prepare,
Review and keyboard Confirm; tests malformed review denial and lost-reply lookup without repeat
Confirm; checks desktop 1280×900, dark mobile-sized 390×844 and narrow 320×844 overflow. Nine
screenshots go to `/tmp/mv-native-post-ui-screenshots` (override `SCREENSHOT_DIR`). No downloads.
These are viewport tests, not physical-device or full accessibility acceptance.

## Safety and remaining gates

- Original deadlines are displayed and never renewed. Confirm is only an explicit click, consumed
  locally before RPC. Unknown results block new preparation; lookup acquires a fresh authorized
  session. Manual locator recovery supports a new page/root without browser persistence.
- Stop immediately fences UI decisions and late results. It does **not** claim to overtake a
  canonical commit. Cancel/Dismiss unlock editing only after a proved `closed` response. An
  uncertain Prepare can be stopped via the retained session; there is no invented pending-read API.
- All declared sections, ordered entries and 14 inventories render eagerly without disclosures,
  omitted rows or clipped hashes. Business text is JSON-escaped and never executed/linkified.
  Receipt counts and remainder do not imply full statement extraction.
- Tests cover production UI mechanics with a small synthetic admitted effect. Renderer-only
  all-column/reason traversal checks are not proof of a compound canonical effect or SQL equality.
- **Next gate:** mount these production components against actual K AuthRoot → W → M native
  composition; compare compound effects/receipts to actual SQLite and reconcile paired usage.
  Independent security review, actual owner/identity race matrix, live-auth acceptance, reviewed
  renderer artifact pin and deployment enablement remain outside this delivery.
- Lint: **DEFERRED BY USER**. No lint commands are part of these checks.
