// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
// @ts-expect-error Node test runtime; the frontend program intentionally excludes Node types.
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativePostPanel } from './NativePostPanel'
import { NativePostConnection, NativePostPage } from '../../pages/native-post/NativePostPage'
import { admitReview } from './nativePostAdmission'
import { candidate, makeReview, rendererPin, syntheticApi } from '../../../native-post-harness/fixture'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
vi.stubGlobal('crypto', webcrypto)
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }) }
let root: Root
let container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllEnvs() })
const click = async (label: string) => {
  const button = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(label))
  expect(button, label).toBeTruthy(); expect(button!.disabled, label).toBe(false)
  await act(async () => button!.click()); await flush()
}
const mount = async (mode = 'success') => {
  const fixture = syntheticApi(mode)
  await act(async () => root.render(<NativePostPanel {...fixture} candidate={candidate} rendererPin={rendererPin} />))
  await click('Load captures'); await click('Select capture')
  await act(async () => (container.querySelector('input[type=checkbox]') as HTMLInputElement).click())
  return fixture
}
const review = async () => { await click('Prepare selected'); await click('Open complete Review') }


const auth = vi.hoisted(() => ({ api: {} }))
vi.mock('../../AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: auth.api }) }))

describe('independent UI adversaries', () => {
  it('deployment OFF preserves lookup UI without acquiring new Post authority', async () => {
    vi.stubEnv('VITE_NATIVE_POST_HUMAN_V2', 'false')
    const f = syntheticApi(); auth.api = f.api
    const opener = vi.spyOn(f.api, 'openNativePost')
    await act(async () => root.render(<NativePostPage candidate={candidate} />))
    expect(container.textContent).toContain('disabled by deployment configuration')
    expect(container.textContent).toContain('Recover an earlier receipt')
    expect(container.textContent).toContain('Check receipt')
    expect(opener).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Load captures')
  })
  it.each(['candidate', 'root'])('ABA %s retires old controls and suppresses its pending read in replacement', async axis => {
    const old = syntheticApi(), next = syntheticApi()
    let calls = 0, acquire!: () => void, late!: () => void
    const api = { openNativePost: async () => { calls++; if (calls === 1) return old.session; await new Promise<void>(r => { acquire = r }); return next.session } } as unknown as typeof old.api
    const otherApi = { openNativePost: async () => new Promise(() => {}) } as unknown as typeof old.api
    const render = async (workpieceId: string) => { await act(async () => root.render(<NativePostConnection api={axis === 'root' && workpieceId === 'other' ? otherApi : api} candidate={axis === 'root' ? candidate : {...candidate, workpieceId}} rendererPin={rendererPin} />)); await flush() }
    await render(candidate.workpieceId)
    const original = old.methods.listCaptures
    old.methods.listCaptures = async () => { await new Promise<void>(r => { late = r }); const result = await original(); result.value.rows[0].id = 'RETIRED-SESSION-DATA'; return result }
    await click('Load captures')
    await render('other')
    expect(old.counts.stops).toBe(1); expect(old.counts.disposals).toBe(1)
    await render(candidate.workpieceId)
    expect(container.textContent).not.toContain('Load captures')
    await act(async () => acquire()); await flush()
    await act(async () => late()); await flush()
    expect(container.textContent).not.toContain('RETIRED-SESSION-DATA')
    expect(container.textContent).toContain('Load captures')
  })
  it('known Prepare refusal preserves edits and permits explicit correction and refresh', async () => {
    const f = await mount()
    f.methods.prepareSelection = async () => ({ ok: false, reason: 'conflict' }) as never
    await click('Prepare selected')
    expect(container.textContent).toContain('Request refused')
    expect(container.textContent).not.toContain('Cancel review')
    expect((container.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(false)
    expect([...container.querySelectorAll('button')].find(b => b.textContent === 'Load captures')!.disabled).toBe(false)
    expect(f.counts.prepares).toBe(0)
    await click('Refresh current capture detail')
    expect(container.querySelector('textarea')).toBeNull()
  })
  it('local oversize edit permits correction with zero Prepare dispatch', async () => {
    const f = await mount()
    const textarea = container.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'x'.repeat(131073))
      textarea.dispatchEvent(new Event('input', {bubbles:true}))
    })
    await click('Prepare selected')
    expect(f.counts.prepares).toBe(0)
    expect(container.textContent).toContain('before Prepare was sent')
    expect(container.textContent).not.toContain('Outcome unknown')
    expect(textarea.disabled).toBe(false)
  })
  it.each(['unknown', 'thrown', 'future'])('uncertain Prepare %s never unlocks correction or refresh', async reason => {
    const f = await mount()
    f.methods.prepareSelection = async () => { if (reason === 'thrown') throw Error('lost'); return { ok: false, reason } as never }
    await click('Prepare selected')
    expect(container.querySelector('textarea')!.disabled).toBe(true)
    expect([...container.querySelectorAll('button')].find(b => b.textContent?.includes('Refresh current'))!.disabled).toBe(true)
    expect(container.textContent).not.toContain('Open complete Review')
  })
  it('session replacement fences a pending read even when root and candidate are unchanged', async () => {
    const old = syntheticApi(), next = syntheticApi()
    let release!: () => void
    const original = old.methods.listCaptures
    old.methods.listCaptures = async () => { await new Promise<void>(r => { release = r }); const result = await original(); result.value.rows[0].id = 'RETIRED-SESSION-DATA'; return result }
    await act(async () => root.render(<NativePostPanel {...old} candidate={candidate} rendererPin={rendererPin} />))
    await click('Load captures')
    await act(async () => root.render(<NativePostPanel session={next.session} api={old.api} candidate={candidate} rendererPin={rendererPin} />))
    await act(async () => release()); await flush()
    expect(container.textContent).not.toContain('RETIRED-SESSION-DATA')
    await click('Load captures')
    expect(container.textContent).toContain('synthetic-capture')
  })
  it('OFF lookup renders a historical receipt but never upgrades the recovery session', async () => {
    const f = syntheticApi()
    // Seed synthetic history outside the UI, then measure only recovery dispatches.
    await f.methods.prepareSelection({ capture: { id: 'synthetic-capture', revision: 1 }, draftRevision: 1, selection: [{ draftIndex: 0, editedText: 'historical' }] })
    const history = await f.methods.confirm()
    const binding = history.value.result.receipt.binding
    auth.api = f.api; vi.stubEnv('VITE_NATIVE_POST_HUMAN_V2', 'false')
    const opener = vi.spyOn(f.api, 'openNativePost')
    await act(async () => root.render(<NativePostPage candidate={candidate} />))
    const inputs = container.querySelectorAll('input')
    await act(async () => {
      for (const [input, value] of [[inputs[0], binding.operation], [inputs[1], binding.bindingHash]] as const) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await click('Use lookup-only locator'); expect(opener).not.toHaveBeenCalled()
    await click('Check receipt')
    expect(opener).toHaveBeenCalledExactlyOnceWith(candidate)
    expect(container.textContent).toContain('Post receipt and remainder')
    expect(f.counts.lookups).toBe(1); expect(f.counts.disposals).toBe(1)
    expect(f.counts.prepares).toBe(1); expect(f.counts.confirms).toBe(1)
    for (const label of ['Load captures', 'Prepare selected', 'Open complete Review', 'Confirm exact Post']) expect(container.textContent).not.toContain(label)
  })
  it('double click cannot dispatch a second Confirm', async () => {
    const f = await mount(); await review()
    const b = [...container.querySelectorAll('button')].find(b => b.textContent === 'Confirm exact Post once')!
    await act(async () => { b.click(); b.click() }); await flush()
    expect(f.counts.confirms).toBe(1)
  })
  it('unknown closure keeps edits locked and removes Confirm', async () => {
    const f = await mount(); await review()
    f.methods.cancelReview = async () => ({status:'unknown'}) as never
    await click('Cancel review')
    expect(container.textContent).not.toContain('Confirm exact Post once')
    expect((container.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true)
  })
  it.each(['humanVersion','rendererVersion','contractDigest'])('unknown %s is denied', async key => {
    const r = await makeReview()
    if (key === 'humanVersion') r.humanVersion = 99 as never
    else if (key === 'rendererVersion') r.evidence.rendererVersion = 99 as never
    else r.evidence.contractDigest = 'f'.repeat(64)
    await expect(admitReview(r, rendererPin, candidate)).rejects.toThrow()
  })
  it('oversized effect refuses before any JSON.parse call', async () => {
    const r = await makeReview(); r.view.effectJSON = ' '.repeat(524289)
    const spy = vi.spyOn(JSON, 'parse')
    try { await expect(admitReview(r, rendererPin, candidate)).rejects.toThrow(); expect(spy).not.toHaveBeenCalled() } finally { spy.mockRestore() }
  })
  it('late lookup acquisition is disposed after unmount and cannot lookup', async () => {
    const f = await mount('lost-reply'); await review(); await click('Confirm exact Post once')
    const fresh = syntheticApi(); let release!: () => void
    f.api.openNativePost = (async () => { await new Promise<void>(r => { release = r }); return fresh.session }) as never
    await click('Check receipt')
    await act(async () => root.render(<div>replacement</div>))
    await act(async () => release()); await flush()
    expect(fresh.counts.lookups).toBe(0); expect(fresh.counts.disposals).toBe(1)
    expect(container.textContent).toBe('replacement')
  })
})
