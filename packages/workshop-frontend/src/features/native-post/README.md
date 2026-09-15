# Native statement UI

NativePostPanel connects explicit local PDF reading → text source admission → explicit background
processing → bounded current-capture polling → the existing Prepare / Review / explicit Confirm flow.
Neither upload nor processing requests a Post. OFF mode remains lookup-only.

The PDF implementation remains M-owned. The deployment build supplies an **absolute**
`VITE_NATIVE_STATEMENT_READER_PATH` pointing to its reviewed `src/lib/pdf/extract.ts`.
`nativeStatementReaderPlugin` exposes that client module as `virtual:native-statement-reader`;
without it the reader is unavailable. No reader source is copied into Workshop. Builds using an
external reader disable bundle-task caching because a path fingerprint cannot track external edits.
A deployment embedding the product with its own Vite config can install the same plugin directly.
This is a build integration, not an activation flag; existing native admission flags still default OFF.

Only the explicit `text_layer_only` mode is offered. Images are not uploaded or processed, OCR is
unsupported, and text-layer coverage is not full PDF equivalence or proof of transaction completeness.
Every page must contain text; 15-page and 131072 UTF-8 text-byte bounds are checked without truncation.
The M reader additionally enforces its 15 MB file bound and owns PDF task/render cleanup. Passwords
are transient local reader arguments only. Cancel, replacement and unmount abort the reader.

Admission and processing starts are single explicit mutations, never auto-retried after uncertainty.
Polling permits one outstanding read, stops after the earlier of the original attempt deadline and
two minutes, and fences late results on Stop, context replacement and unmount. Capture Stop can
interrupt a pending process start; its acknowledgement, not cancellation of local rendering, determines
whether editing may resume. Connection teardown still revokes the receiver through session `stop()`.

Closing-capable reviews use independent axes review3/effect3/renderer2/receipt3. The M-generated
codec admits only supported complete typed selections; unknown versions or selected semantics fail
closed before Confirm. Historical V2 review/receipt grammar remains accepted unchanged. The renderer
shows each V3 closing as a **pad + balance assertion, not a transaction**, retaining original/effective
pad date, balance date, account, exact amount, currency, plug account and directive reference alongside
all fourteen physical before/after inventories, assertions and plug consequences. A closing-only review
does not invent a transaction. Selected-item receipt counts must not be described as transaction counts.
Prepare, complete Review and one-use Confirm remain separate actions; all deployment flags remain OFF.

`NativePostClosing.test.tsx` covers synthetic closing-only/mixed rendering, strict admission failures
and the explicit panel lifecycle/receipt. It is not a writer or connected browser proof.
`NativeStatementUpload.test.tsx` is a UI-layer synthetic-transport test, not an actual processor,
accounting or SQLite proof. The deployment's native-post-host connected browser proof owns the real
K/W/M composition and public-PDF browser extraction checks. Lint is deferred by user for this delivery.
