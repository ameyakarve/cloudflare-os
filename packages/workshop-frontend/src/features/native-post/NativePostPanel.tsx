import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Input, Textarea } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import type { NativePostSession } from '@gadgets/workshop-shared/native-post-integration'
import type { NativePostOwnerCandidate } from '@gadgets/workshop-shared/deployment-native-post'
import type { NativeCaptureDetail, NativeCapturePage, NativeHumanReceiptResponseV1 } from '@gadgets/workshop-shared/os-native-post.generated'
import { decodeNativeHumanDetailV1, projectNativeHumanDetailV1, projectNativeHumanListV1, projectNativeHumanReceiptV1, projectNativeHumanSelectionV1 } from '@gadgets/workshop-shared/os-native-post-schema.generated'
import { admitReview } from './nativePostAdmission'
import { literal, NativePostFields, NativePostReview } from './NativePostReview'

type Handle = Parameters<NativePostSession['reviewPrepared']>[0]
type Locator = Parameters<NativePostSession['lookupPost']>[0]
type Review = Awaited<ReturnType<typeof admitReview>> & { token: string }
export type NativePostApi = Pick<RpcStub<AuthenticatedApi>, 'openNativePost'>

/** Caller owns the stub; this component fences all in-flight paints and decisions on teardown. */
export const NativePostPanel = ({ session, api, candidate, rendererPin }: {
  session: RpcStub<NativePostSession>; api: NativePostApi; candidate: NativePostOwnerCandidate; rendererPin: string
}) => {
  const [page, setPage] = useState<NativeCapturePage | null>(null)
  const [detail, setDetail] = useState<NativeCaptureDetail | null>(null)
  const [edits, setEdits] = useState<Record<number, string>>({})
  const [handle, setHandle] = useState<Handle | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [locator, setLocator] = useState<Locator | null>(null)
  const [receipt, setReceipt] = useState<NativeHumanReceiptResponseV1 | null>(null)
  const [recoveryOperation, setRecoveryOperation] = useState('')
  const [recoveryHash, setRecoveryHash] = useState('')
  const [message, setMessage] = useState('Load captures to begin. Nothing posts automatically.')
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [now, setNow] = useState(Date.now())
  const epoch = useRef(0)
  const lock = useRef(false)
  const decision = useRef<string | null>(null)
  const status = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => { clearInterval(timer); epoch.current++; decision.current = null }
  }, [])

  const run = async (work: (current: () => boolean) => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true)
    const generation = epoch.current
    const current = () => generation === epoch.current
    try { await work(current) }
    catch { if (current()) { decision.current = null; setReview(null); setBlocked(true); setMessage('Outcome unknown or response unsupported. Do not repost. Check receipt or close this session.'); } }
    finally { if (current()) { lock.current = false; setBusy(false); status.current?.focus() } }
  }
  const refused = (reason: string) => { setMessage(`Request refused: ${literal(reason)}. No automatic retry.`) }
  const load = (cursor?: NonNullable<NativeCapturePage['next']>) => run(async current => {
    const result = await session.listCaptures(cursor)
    if (!current()) return
    if (!result.ok) return refused(result.reason)
    setPage(projectNativeHumanListV1(result.value)); setMessage('Select a capture. This page replaces the previous page; no hidden accumulation.')
  })
  const select = (id: string) => run(async current => {
    const result = await session.getCapture(id)
    if (!current()) return
    if (!result.ok) return refused(result.reason)
    const value = decodeNativeHumanDetailV1(JSON.stringify(projectNativeHumanDetailV1(result.value)))
    setDetail(value); setEdits({}); setReceipt(null); setLocator(null); setMessage('Choose unconsumed items and edit their exact journal text.')
  })
  const prepare = () => run(async current => {
    if (!detail?.draft || blocked || handle || stopped) return
    const input = projectNativeHumanSelectionV1({ capture: { id: detail.summary.id, revision: detail.summary.revision }, draftRevision: detail.draft.revision,
      selection: Object.entries(edits).map(([index, editedText]) => ({ draftIndex: Number(index), editedText })) })
    setBlocked(true); setMessage('Preparing. No Post has been requested.')
    const result = await session.prepareSelection(input)
    if (!current()) return
    if (!result.ok) { refused(result.reason); return }
    setHandle(result.value); setMessage('Prepared. Open the complete Review explicitly. Editing is locked until this review is proved closed.')
  })
  const openReview = () => run(async current => {
    if (!handle || stopped) return
    const result = await session.reviewPrepared(handle)
    if (!current()) return
    if (!result.ok) return refused(result.reason)
    const admitted = await admitReview(result.value.response, rendererPin, candidate)
    if (!current()) return
    if (typeof result.value.token !== 'string' || !result.value.token.length || result.value.token.length > 4096) throw new Error('Unsupported token')
    setLocator({ operation: admitted.response.view.binding.operation, bindingHash: admitted.response.view.binding.bindingHash })
    decision.current = result.value.token
    setReview({ ...admitted, token: result.value.token }); setMessage('Complete validated Review ready. Confirm is a separate, one-use decision. Original deadlines never renew.')
  })
  const acceptReceipt = (value: unknown) => {
    const received = projectNativeHumanReceiptV1(value)
    if (!locator || received.result.receipt.binding.operation !== locator.operation || received.result.receipt.binding.bindingHash !== locator.bindingHash) throw new Error('Receipt mismatch')
    setReceipt(received); setReview(null); setHandle(null); setDetail(null); setEdits({}); setBlocked(false)
    setMessage(`${received.result.receipt.selectedIndices.length} selected draft items posted; ${received.result.receipt.remaining} remain. Load the current capture for a fresh selection. Not a claim of full statement extraction.`)
  }
  const confirm = () => {
    if (!review || decision.current !== review.token || Date.now() >= review.response.evidence.deadline || stopped || lock.current) return
    const token = decision.current
    decision.current = null
    setReview(null)
    void run(async current => {
      setMessage('Confirm sent once. If the reply is lost, use lookup only.'); setBlocked(true)
      const result = await session.confirm(token)
      if (!current()) return
      if (!result.ok) { refused(result.reason); return }
      acceptReceipt(result.value)
    })
  }
  const close = (dismiss: boolean) => {
    if (!handle || lock.current) return
    decision.current = null; setReview(null)
    void run(async current => {
      const result = await (dismiss ? session.dismissPrepared(handle) : session.cancelReview(handle))
      if (!current()) return
      setMessage(`Review closure: ${result.status}. This does not unpost, stop the capture, or refund a reservation.`)
      if (result.status === 'closed') { setHandle(null); setLocator(null); setBlocked(false) }
    })
  }
  const stop = async () => {
    // Stop can race an owning operation. It invalidates the UI immediately, not a claimed distributed lock.
    epoch.current++; decision.current = null; setReview(null); setStopped(true); setBlocked(true); setBusy(false); lock.current = false
    const generation = epoch.current
    setMessage('Session Stop requested. A Post may already have committed; Stop cannot unpost. Cleanup acknowledgement pending.')
    try {
      const result = await session.stop()
      if (epoch.current === generation) setMessage(`Session Stop: ${result.status}. Check receipt if a Confirm was sent. No automatic repost.`)
    } catch { if (epoch.current === generation) setMessage('Session Stop outcome unknown; cleanup may still be pending. Check receipt. No automatic repost.') }
  }
  const lookup = () => run(async current => {
    if (!locator) return
    // Recovery uses a newly acquired current-authorized session, never the consumed decision.
    const fresh = await api.openNativePost(candidate)
    if (!fresh) { if (current()) refused('unavailable'); return }
    try {
      if (!current()) return
      const result = await fresh.lookupPost(locator)
      if (!current()) return
      if (!result.ok) { setMessage('Receipt unknown/unavailable. This is not proof of non-commit. Do not repost.'); return }
      acceptReceipt(result.value)
    } finally { fresh[Symbol.dispose]() }
  })
  const eligible = detail?.draft && ['complete', 'needs_review'].includes(detail.draft.outcome) &&
    ['needs_review', 'partially_posted'].includes(detail.summary.phase)
  const frozen = busy || blocked || stopped || !!handle
  return <div className="space-y-6 min-w-0 [&_button]:whitespace-normal [&_button]:h-auto [&_button]:min-h-9 [&_button]:max-w-full [&_button]:[overflow-wrap:anywhere]">
    <div ref={status} tabIndex={-1} role="status" aria-live="polite" className="border border-kumo-line rounded p-4 [overflow-wrap:anywhere]">{message}</div>
    <div className="flex flex-wrap gap-3">
      <Button disabled={frozen} onClick={() => void load()}>Load captures</Button>
      <Button disabled={stopped} onClick={() => void stop()}>Stop session / cancel in-flight work</Button>
      <Button disabled={!locator || busy} onClick={() => void lookup()}>Check receipt (current authorization)</Button>
    </div>
    {!locator && !handle && <section className="space-y-3" aria-label="Recover an earlier receipt">
      <h2 className="font-semibold">Recover an earlier receipt</h2>
      <p>After reconnecting, enter the exact earlier locator. It is not authority. Recovery never prepares or confirms. These fields are not saved in browser storage.</p>
      <label className="block">Operation<Input value={recoveryOperation} maxLength={256} onChange={event => setRecoveryOperation(event.target.value)} /></label>
      <label className="block">Binding hash<Input value={recoveryHash} maxLength={64} onChange={event => setRecoveryHash(event.target.value)} /></label>
      <Button disabled={busy || !recoveryOperation || !/^[a-f0-9]{64}$/.test(recoveryHash)} onClick={() => { setLocator({ operation: recoveryOperation, bindingHash: recoveryHash }); setBlocked(true); setMessage('Earlier locator retained for current-authorized lookup only. Click Check receipt; do not repost.'); }}>Use lookup-only locator</Button>
    </section>}
    {locator && <section><h2 className="font-semibold">Lookup-only receipt locator (not authority)</h2><NativePostFields value={locator} /></section>}
    {page && <section aria-label="Captures" className="space-y-3"><h2 className="text-xl font-semibold">Captures</h2>{page.rows.length === 0 && <p>No captures available.</p>}{page.rows.map(row => <div key={row.id} className="border border-kumo-line rounded p-3"><NativePostFields value={row} /><Button disabled={frozen} onClick={() => void select(row.id)}>Select capture {literal(row.id)}</Button></div>)}{page.next && <Button disabled={frozen} onClick={() => void load(page.next!)}>Next capture page</Button>}</section>}
    {detail && <section className="space-y-4" aria-label="Capture detail"><h2 className="text-xl font-semibold">Capture detail</h2><NativePostFields value={{ summary: detail.summary, source: detail.source, activeAttempt: detail.activeAttempt, postedIndices: detail.postedIndices, draftOutcome: detail.draft?.outcome, draftRevision: detail.draft?.revision, canonicalRevision: detail.draft?.canonicalRevision }} />
      {detail.draft?.entries.map((text, index) => <div key={index} className="border border-kumo-line rounded p-3 space-y-2"><Checkbox label={`Draft item ${index}${detail.postedIndices.includes(index) ? ' — already consumed' : ''}`} disabled={frozen || !eligible || detail.postedIndices.includes(index)} checked={Object.hasOwn(edits, index)} onCheckedChange={checked => setEdits(previous => { const next = { ...previous }; if (checked) next[index] = text; else delete next[index]; return next })} /><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">Original literal: {literal(text)}</p>{Object.hasOwn(edits, index) && <label className="block">Exact edited text for item {index}<Textarea className="block w-full min-h-40 font-mono" disabled={frozen} value={edits[index]} onChange={event => setEdits({ ...edits, [index]: event.target.value })} /><span className="block [overflow-wrap:anywhere]">Edited literal: {literal(edits[index])}</span></label>}</div>)}
      {!eligible && <p>This capture is not eligible for native selection. Processing is not offered here.</p>}
      <div className="flex flex-wrap gap-3"><Button disabled={frozen || !eligible || !Object.keys(edits).length} onClick={() => void prepare()}>Prepare selected items</Button><Button disabled={frozen} onClick={() => void run(async current => { setBlocked(true); const result = await session.stopCapture({ id: detail.summary.id, revision: detail.summary.revision }); if (current()) { setMessage(`Capture Stop: ${result.status}. Posted journal entries are not undone.`); setDetail(null); if (result.status === 'closed') setBlocked(false) } })}>Stop capture (not review Cancel)</Button></div>
    </section>}
    {handle && <div className="flex flex-wrap gap-3"><Button disabled={busy || !!review || stopped || !!locator} onClick={() => void openReview()}>Open complete Review</Button><Button disabled={busy || stopped} onClick={() => close(false)}>Cancel review</Button><Button disabled={busy || stopped} onClick={() => close(true)}>Dismiss prepared review</Button></div>}
    {review && <><NativePostReview response={review.response} effects={review.effects} /><div className="border-t border-kumo-line pt-4 space-y-3"><p>Original decision deadline (epoch ms): {review.response.evidence.deadline}. {now >= review.response.evidence.deadline ? 'Expired — Confirm disabled.' : 'No auto-confirm or deadline renewal.'}</p><Button disabled={busy || stopped || now >= review.response.evidence.deadline} onClick={confirm}>Confirm exact Post once</Button></div></>}
    {receipt && <section aria-label="Post receipt"><h2 className="text-xl font-semibold">Post receipt and remainder</h2><p>Canonical legacy counts and consequence counts are separate. Availability describes current historical receipt availability.</p><NativePostFields value={receipt} /></section>}
  </div>
}
