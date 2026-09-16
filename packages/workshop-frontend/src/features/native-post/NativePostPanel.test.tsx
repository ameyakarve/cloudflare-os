// @vitest-environment jsdom
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
// @ts-expect-error Node test runtime; the frontend program intentionally excludes Node types.
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativePostPanel } from './NativePostPanel'
import { NativePostConnection } from '../../pages/native-post/NativePostPage'
import { NativePostFields, NativePostReview, literal } from './NativePostReview'
import { admitReview, nativePostEnabled } from './nativePostAdmission'
import { candidate, makeReview, rendererPin, syntheticApi } from '../../../native-post-harness/fixture'
import { NATIVE_REVIEW_SQL_COLUMNS_V2 } from '@gadgets/workshop-shared/os-native-post-schema.generated'

const { act } = React
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
vi.stubGlobal('crypto', webcrypto)
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }) }
let root: Root
let container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllEnvs() })
const click = async (label: string) => {
  const button = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(label))
  expect(button).toBeTruthy(); expect(button!.disabled).toBe(false)
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

describe('production native Post UI with synthetic API (not native composition)', () => {
  it('requires separate Prepare, Review and one explicit Confirm; shows receipt and fresh remainder', async () => {
    const f = await mount(); expect(f.counts.confirms).toBe(0)
    await review(); expect(f.counts.confirms).toBe(0)
    expect(container.textContent).toContain('Full before inventory — all 14 tables')
    expect(container.querySelectorAll('script, iframe, img')).toHaveLength(0)
    await click('Confirm exact Post once'); expect(f.counts.confirms).toBe(1)
    expect(container.textContent).toContain('1 selected draft items posted; 1 remain')
    await click('Load captures'); await click('Select capture')
    expect((container.querySelector('input[type=checkbox]') as HTMLInputElement).disabled).toBe(true)
    expect(container.textContent).toContain('already consumed')
  })
  it.each(['malformed', 'expired'])('%s response never enables Confirm', async mode => {
    const f = await mount(mode); await review()
    expect(container.textContent).not.toContain('Confirm exact Post once')
    expect(f.counts.confirms).toBe(0)
  })
  it('lost Confirm reply reuses the current-authorized session, never reopening the latched root', async () => {
    const f = await mount('lost-reply'); await review(); await click('Confirm exact Post once')
    expect(container.textContent).toContain('Outcome unknown')
    const opener = vi.spyOn(f.api, 'openNativePost').mockResolvedValue(null)
    await click('Check receipt'); expect(f.counts.lookups).toBe(1); expect(f.counts.confirms).toBe(1)
    expect(container.textContent).toContain('Post receipt and remainder')
    expect(opener).not.toHaveBeenCalled()
    expect(f.counts.disposals).toBe(0) // Connection, not lookup, owns this stub.
  })
  it.each(['Cancel review', 'Dismiss prepared review'])('%s closes before allowing edits', async label => {
    const f = await mount(); await review(); await click(label)
    expect(container.textContent).not.toContain('Confirm exact Post once')
    expect((container.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(false)
    expect(f.counts.confirms).toBe(0)
  })
  it('Stop during delayed preparation suppresses late handle and cannot resurrect Confirm', async () => {
    const f = await mount()
    let release!: () => void
    const original = f.methods.prepareSelection
    f.methods.prepareSelection = async input => { await new Promise<void>(resolve => { release = resolve }); return original(input) }
    await click('Prepare selected'); await click('Stop session')
    await act(async () => release()); await flush()
    expect(container.textContent).not.toContain('Open complete Review')
    expect(f.counts.stops).toBe(1); expect(f.counts.confirms).toBe(0)
  })
  it('original decision expiry disables Confirm without requesting another Review', async () => {
    const f = await mount(); await review()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000)
    try {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
      const button = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Confirm exact Post once')!
      expect(button.disabled).toBe(true); expect(f.counts.confirms).toBe(0); expect(f.counts.prepares).toBe(1)
    } finally { clock.mockRestore() }
  })
  it('Stop fences a late committed response; explicit lookup resolves without reposting', async () => {
    const f = await mount(); await review()
    let release!: () => void
    const original = f.methods.confirm
    f.methods.confirm = async () => { const result = await original(); await new Promise<void>(resolve => { release = resolve }); return result }
    await click('Confirm exact Post once'); await click('Stop session')
    await act(async () => release()); await flush()
    expect(container.textContent).not.toContain('Post receipt and remainder')
    await click('Check receipt'); expect(container.textContent).toContain('Post receipt and remainder')
    expect(f.counts.confirms).toBe(1)
  })
  it('account/root replacement fences old connection and disposes late acquired stubs', async () => {
    const old = syntheticApi(), next = syntheticApi()
    let release!: () => void
    const api = { openNativePost: async () => { await new Promise<void>(resolve => { release = resolve }); return old.session } } as unknown as typeof old.api
    await act(async () => root.render(<NativePostConnection api={api} candidate={candidate} rendererPin={rendererPin} />))
    await act(async () => root.render(<NativePostConnection api={next.api} candidate={candidate} rendererPin={rendererPin} />))
    await act(async () => release()); await flush()
    expect(old.counts.stops).toBe(1); expect(old.counts.disposals).toBe(1)
    expect(container.textContent).toContain('Load captures')
  })
})

describe('renderer/admission refusal and lossless coverage', () => {
  it('gate defaults OFF and requires a deployment renderer pin', () => {
    vi.stubEnv('VITE_NATIVE_POST_HUMAN_V2', ''); expect(nativePostEnabled()).toBe(false)
    vi.stubEnv('VITE_NATIVE_POST_HUMAN_V2', 'true'); vi.stubEnv('VITE_NATIVE_POST_RENDERER_ARTIFACT_DIGEST', ''); expect(nativePostEnabled()).toBe(false)
  })
  it('verifies full binding/effect/view digests and candidate, not response-selected pins', async () => {
    const r = await makeReview(); expect((await admitReview(r, rendererPin, candidate)).response.view.binding).toEqual(r.view.binding)
    await expect(admitReview(r, 'e'.repeat(64), candidate)).rejects.toThrow('Unsupported or expired review')
    await expect(admitReview(r, rendererPin, { ...candidate, workpieceId: 'foreign' })).rejects.toThrow('Unsupported or expired review')
    r.view.selection[0].editedText += 'tamper'; await expect(admitReview(r, rendererPin, candidate)).rejects.toThrow('Native review unavailable: unsupported or over limit')
  })
  it('unknown nested semantic fields and oversized views refuse before rendering', async () => {
    const r = await makeReview(); const e = JSON.parse(r.view.effectJSON); e.selected[0].futureAuthority = true
    r.view.effectJSON = JSON.stringify(e); await expect(admitReview(r, rendererPin, candidate)).rejects.toThrow('Native review unavailable: unsupported or over limit')
    r.view.effectJSON = ' '.repeat(524289); await expect(admitReview(r, rendererPin, candidate)).rejects.toThrow('Native review unavailable: unsupported or over limit')
  })
  it('all schema table columns, business metadata and reason strings are literal, complete and uncollapsed', async () => {
    const admitted = await admitReview(await makeReview(), rendererPin, candidate)
    const node = document.createElement('div'); node.innerHTML = renderToStaticMarkup(<NativePostReview {...admitted} />)
    for (const table of Object.keys(NATIVE_REVIEW_SQL_COLUMNS_V2)) expect(node.textContent).toContain(literal(table))
    // Renderer-only field coverage adversary, not a semantically admitted canonical effect.
    const inventory = Object.fromEntries(Object.entries(NATIVE_REVIEW_SQL_COLUMNS_V2).map(([table, columns]) => [table, columns]))
    const reasons = ['selected-append', 'selected-claim', 'claim-rewrite', 'claim-open-deduplication', 'reward-overlap', 'reward-open-missing', 'reward-currency-widening', 'already-covered']
    const value = { inventory, reasons, meta: 'generated:* allocation:commit-time <script>x</script>\u202e\u0000\ud800', amount: '123456789123456789', hash: 'abcdef'.repeat(11) }
    node.innerHTML = renderToStaticMarkup(<NativePostFields value={value} />)
    const literals = (v: unknown): string[] => v && typeof v === 'object'
      ? Object.entries(v).flatMap(([k, x]) => [...(Array.isArray(v) ? [] : [literal(k)]), ...literals(x)])
      : [literal(v)]
    for (const text of literals(value)) expect(node.textContent).toContain(text)
    expect(node.querySelector('script,details,iframe')).toBeNull()
  })
})
