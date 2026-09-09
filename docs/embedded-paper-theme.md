# Trusted embedded UI: paper skin

`@gadgets/workshop-shared/paper-theme.css` is a bundled, opt-in full skin for trusted
first-party UI. It maps Kumo surfaces/text, typography, radii and elevations to flat
paper/ink/yellow, in both modes. Inter and its OFL license are included in
`packages/workshop-shared/src/fonts/`. The font is inlined by the SPA/configurator
builds; frames need no network font access.

## Contract

`GatekeeperAppTheme` retains `mode` and `accentColor` and adds optional
`skin: "paper" | "base"`. `applyGatekeeperAppTheme(root, theme, defaultSkin)` selects
`data-skin` and manages the existing accent overrides. It does not install styles
or change mode; the receiver keeps its existing mode handling and subscriptions.
Load the CSS explicitly in the trusted receiver. `paper` fixes yellow action
backgrounds and ink foregrounds together, deliberately ignoring the accent seed
so old orange or yellow-derived dark accents cannot compromise contrast. `base`
restores legacy accent behavior. Omission uses the receiver's default (`base` in
the generic helper, `paper` in Context and Scheduler).

The optional field needs no new RPC methods, capability, identity or persisted
setting. Old hosts continue working with the bundled full skin. Existing receivers
that only understand mode/accent retain their old behavior.

Never inject this CSS into arbitrary user-authored gadgets. The new helper is used
only by Context and Scheduler, and the configurator builder loads the stylesheet
only into its own trusted UI shell. Sandbox attributes and network restrictions
remain unchanged; configurators permit only inline `data:` fonts, not remote fonts.

## Host integration (frontend owner; not edited here)

No host change is required for these three bundled first-party surfaces:

- `packages/gatekeeper-context/app/theme.ts` and Scheduler's corresponding module
  use paper by default and continue receiving mode on the existing subscription.
- `scripts/build-gatekeeper-configurator.ts` bundles the same CSS and font with
  `data-skin="paper"`. Its existing `prefers-color-scheme` handling uses the iframe
  element's host-resolved `colorScheme`; no new message transport is needed.

For an explicit host selection, edit only
`packages/workshop-frontend/src/SandboxedGatekeeperApp.tsx`: add `skin: "paper"` to
all three theme objects (the `themeRef` initializer, `themeRef.current` assignment,
and `hostRef.current?.updateTheme(...)`). If selection becomes dynamic, include it
in the update effect dependencies. The existing `subscribeTheme` return value and
`setTheme` updates already carry this typed object; do not create another channel.

`packages/workshop-frontend/src/SandboxedResourceConfigurator.tsx` already sets
`style.colorScheme = resolvedThemeMode` on its iframe. Keep this and its current
sandbox policy. It needs no skin transport for the shared fixed paper stylesheet.
Do not apply these changes through `SandboxedGadget` or a global iframe selector.

For other trusted first-party apps that opt in later: explicitly import the CSS,
retain their mode handler, and call the shared helper. Host CSS cannot reach opaque
frames, and the optional field alone cannot skin a receiver that hasn't opted in.

## Verification

Owned-package builds/typechecks passed for workshop-shared, workshop-backend,
gatekeeper-context and gatekeeper-scheduler. Script types passed. Context tests:
42 passed. Scheduler tests: 121 passed, 3 skipped. Configurator tests: 20 passed,
including bundled skin/font and CSP assertions. Targeted backend MilesVault
rules/provisioning tests: 7 passed. Changed-file lint passed (two existing no-shadow
warnings in server.ts). The full backend test run timed out after 240 seconds, so it is not a pass.
No browser visual verification, paid calls, commit, push or deployment was performed.
Before release, check both modes, initial paint, focus rings, dialogs/dropdowns,
Context editor and Scheduler expanded failures at desktop/mobile widths.
