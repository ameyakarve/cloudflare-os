// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeStatementUpload } from './NativeStatementUpload'
import { NativePostPanel } from './NativePostPanel'
import { nativeStatementSource } from './nativeStatementSource'
import { candidate, rendererPin, syntheticApi } from '../../../native-post-harness/fixture'
import type { NativeCaptureDetail } from '@gadgets/workshop-shared/os-native-post.generated'

const reader = vi.hoisted(() => vi.fn())
vi.mock('virtual:native-statement-reader', () => ({ available: true, extractNativeStatement: reader }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const evidence = () => ({ pageCount: 2, textLayer: 'present' as const, pages: [1, 2].map(page => ({ page, text: `Public page ${page}`, image: 'data:image/jpeg;base64,public-fixture' })) })
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers(); reader.mockReset(); reader.mockResolvedValue(evidence())
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers() })
const click = async (label: string) => {
  const button = [...container.querySelectorAll('button')].find(node => node.textContent?.includes(label))!
  expect(button, label).toBeTruthy(); expect(button.disabled, label).toBe(false)
  await act(async () => button.click())
}
const choose = async () => {
  const file = container.querySelector('input[type=file]')!
  Object.defineProperty(file, 'files', { configurable: true, value: [new File(['public'], 'Public.pdf', { type: 'application/pdf' })] })
  await act(async () => file.dispatchEvent(new Event('change', { bubbles: true })))
}
const optIn = async () => { await act(async () => (container.querySelector('input[type=checkbox]') as HTMLInputElement).click()) }
const tick = async (ms = 1000) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

const panel = async () => {
  const f = syntheticApi()
  const original = (await f.methods.getCapture()).value
  const stored: NativeCaptureDetail = { ...original, draft: null, summary: { ...original.summary, draftRevision: 0, phase: 'stored' } }
  const processing: NativeCaptureDetail = { ...stored, activeAttempt: { id: stored.summary.id, revision: 2, sourceRevision: 1, epoch: 1, attempt: 'public-attempt', deadline: Date.now() + 180000 }, summary: { ...stored.summary, revision: 2, phase: 'processing' } }
  const add = vi.fn(async () => ({ ok: true as const, value: stored }))
  const process = vi.fn(async () => ({ ok: true as const, value: processing }))
  const stop = vi.spyOn(f.methods, 'stopCapture')
  Object.assign(f.methods, { addStatement: add, processStatement: process })
  const get = vi.spyOn(f.methods, 'getCapture').mockResolvedValue({ ok: true, value: processing })
  await act(async () => root.render(<NativePostPanel {...f} candidate={candidate} rendererPin={rendererPin} />))
  await optIn(); await choose(); await click('Read PDF locally'); await click('Admit text source')
  return { ...f, add, process, get, stop, processing, original }
}

describe('native text-only statement upload', () => {
  it('requires opt-in and separate read/admit clicks; keeps password and images out of admission', async () => {
    const admit = vi.fn()
    await act(async () => root.render(<NativeStatementUpload disabled={false} onAdmit={admit} />))
    await choose()
    expect([...container.querySelectorAll('button')].find(b => b.textContent === 'Read PDF locally')!.disabled).toBe(true)
    await optIn()
    const password = container.querySelector('input[type=password]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(password, 'public-password')
      password.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('Read PDF locally')
    expect(reader.mock.calls[0][1].password).toBe('public-password')
    expect(password.value).toBe(''); expect(admit).not.toHaveBeenCalled()
    expect(container.textContent).toContain('not full source equivalence')
    await click('Admit text source')
    expect(admit).toHaveBeenCalledExactlyOnceWith(nativeStatementSource('Public.pdf', evidence()))
    expect(JSON.stringify(admit.mock.calls)).not.toMatch(/image|password/)
  })
  it.each(['Cancel local reading', 'replacement', 'unmount'])('aborts reader on %s and fences a late read', async action => {
    let finish!: (value: ReturnType<typeof evidence>) => void
    reader.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const admit = vi.fn()
    await act(async () => root.render(<NativeStatementUpload disabled={false} onAdmit={admit} />))
    await optIn(); await choose(); await click('Read PDF locally')
    const signal = reader.mock.calls[0][1].signal as AbortSignal
    if (action === 'replacement') await choose()
    else if (action === 'unmount') await act(async () => root.render(null))
    else await click(action)
    expect(signal.aborted).toBe(true)
    await act(async () => finish(evidence()))
    expect(admit).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('2 pages read')
  })
  it('refuses image-only, partial, missing, misnumbered and over-limit evidence without truncation', () => {
    for (const textLayer of ['image_only', 'partial'] as const) expect(() => nativeStatementSource('Public.pdf', { ...evidence(), textLayer })).toThrow()
    expect(() => nativeStatementSource('Public.pdf', { ...evidence(), pageCount: 16 })).toThrow()
    expect(() => nativeStatementSource('Public.pdf', { ...evidence(), pages: evidence().pages.slice(1) })).toThrow()
    expect(() => nativeStatementSource('Public.pdf', { ...evidence(), pages: [{ page: 1, text: ' ', image: '' }, evidence().pages[1]] })).toThrow()
    expect(() => nativeStatementSource('Public.pdf', { ...evidence(), pages: evidence().pages.reverse() })).toThrow()
    const single = { pageCount: 1, textLayer: 'present' as const, pages: [{ page: 1, text: 'é'.repeat(65536), image: '' }] }
    expect(nativeStatementSource('Public.pdf', single).source.pages[0].text).toHaveLength(65536)
    single.pages[0].text += 'a'
    expect(() => nativeStatementSource('Public.pdf', single)).toThrow()
  })
  it('reports password failures without leaking parser messages and waits for explicit retry', async () => {
    reader.mockRejectedValue({ detail: { kind: 'wrong_password' }, message: 'DO NOT DISPLAY' })
    await act(async () => root.render(<NativeStatementUpload disabled={false} onAdmit={vi.fn()} />))
    await optIn(); await choose(); await click('Read PDF locally'); await tick(20000)
    expect(container.textContent).toContain('PDF password required or incorrect')
    expect(container.textContent).not.toContain('DO NOT DISPLAY'); expect(reader).toHaveBeenCalledTimes(1)
  })
})

describe('connected native processing and existing Post controls', () => {
  it('admission does not auto-process/Post; explicit processing polls and feeds the existing selection', async () => {
    const f = await panel()
    expect(f.add).toHaveBeenCalledTimes(1); expect(f.process).not.toHaveBeenCalled(); expect(f.counts.prepares).toBe(0)
    await click('Process statement'); expect(f.process).toHaveBeenCalledTimes(1)
    await tick(); expect(f.get).toHaveBeenCalledTimes(1)
    f.get.mockResolvedValue({ ok: true, value: f.original })
    await tick(); expect(container.textContent).toContain('Draft item 0')
    expect(f.counts.prepares).toBe(0); expect(f.counts.confirms).toBe(0)
    const draft = container.querySelector('section[aria-label="Capture detail"] input[type=checkbox]') as HTMLInputElement
    expect(draft.disabled).toBe(false)
    await tick(10000); expect(f.get).toHaveBeenCalledTimes(2)
  })
  it('Stop capture races processing start and fences the late response', async () => {
    const f = await panel()
    let finish!: (value: { ok: true; value: NativeCaptureDetail }) => void
    f.process.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await click('Process statement'); await click('Stop capture')
    expect(f.stop).toHaveBeenCalledTimes(1)
    await act(async () => finish({ ok: true, value: f.processing })); await tick(5000)
    expect(f.get).not.toHaveBeenCalled(); expect(container.querySelector('section[aria-label="Capture detail"]')).toBeNull()
  })
  it('bounded deadline fences an unresolved poll and never retries processing', async () => {
    const f = await panel()
    let finish!: (value: { ok: true; value: NativeCaptureDetail }) => void
    f.get.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await click('Process statement'); await tick(121000)
    expect(container.textContent).toContain('Processing poll deadline reached')
    await act(async () => finish({ ok: true, value: f.original }))
    expect(container.textContent).not.toContain('Draft item 0'); expect(f.get).toHaveBeenCalledTimes(1); expect(f.process).toHaveBeenCalledTimes(1)
    await click('Stop capture'); expect(f.stop).toHaveBeenCalledTimes(1)
  })
  it.each(['Stop session', 'replacement', 'unmount'])('%s fences a late processing poll', async action => {
    const f = await panel()
    let finish!: (value: { ok: true; value: NativeCaptureDetail }) => void
    f.get.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await click('Process statement'); await tick()
    if (action === 'replacement') {
      const next = syntheticApi()
      await act(async () => root.render(<NativePostPanel {...next} candidate={candidate} rendererPin={rendererPin} />))
    } else if (action === 'unmount') await act(async () => root.render(null))
    else await click(action)
    await act(async () => finish({ ok: true, value: f.original })); await tick(10000)
    expect(container.textContent).not.toContain('Draft item 0'); expect(f.get).toHaveBeenCalledTimes(1)
  })
  it('a failed poll stops read retries and leaves explicit Stop available', async () => {
    const f = await panel(); f.get.mockRejectedValue(Error('unavailable'))
    await click('Process statement'); await tick(10000)
    expect(f.get).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('Processing status unavailable')
    await click('Stop capture'); expect(f.stop).toHaveBeenCalledTimes(1)
  })
  it('lost admission reply freezes new mutations and never retries the admission', async () => {
    const f = syntheticApi(); const add = vi.fn(async () => { throw Error('lost') })
    Object.assign(f.methods, { addStatement: add })
    await act(async () => root.render(<NativePostPanel {...f} candidate={candidate} rendererPin={rendererPin} />))
    await optIn(); await choose(); await click('Read PDF locally'); await click('Admit text source'); await tick(130000)
    expect(add).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('Outcome unknown')
    expect([...container.querySelectorAll('button')].find(b => b.textContent === 'Read PDF locally')!.disabled).toBe(true)
    expect(f.counts.confirms).toBe(0)
  })
})
