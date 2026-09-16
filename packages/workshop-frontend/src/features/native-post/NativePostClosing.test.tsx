// @vitest-environment jsdom
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
// @ts-expect-error Node test runtime; frontend excludes Node types.
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NATIVE_REVIEW_SQL_COLUMNS_V2 } from '@gadgets/workshop-shared/os-native-post-schema.generated'
import { NativePostPanel } from './NativePostPanel'
import { NativePostReview, literal } from './NativePostReview'
import { admitReview } from './nativePostAdmission'
import { closingText, makeClosingReview } from './nativePostClosingFixture'
import { candidate, rendererPin, syntheticApi } from '../../../native-post-harness/fixture'

const { act } = React
vi.stubGlobal('crypto', webcrypto)
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root, container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })
const click = async (label: string) => {
  const button = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(label))!
  expect(button).toBeTruthy(); expect(button.disabled).toBe(false)
  await act(async () => { button.click() })
}

describe('closing-capable current review (synthetic wire/UI proof only)', () => {
  it.each([false, true])('losslessly renders closing and every physical inventory; mixed=%s', async mixed => {
    const admitted = await admitReview(await makeClosingReview(mixed), rendererPin, candidate)
    const node = document.createElement('div'); node.innerHTML = renderToStaticMarkup(<NativePostReview {...admitted} />)
    expect(node.textContent).toContain('Closing pad + balance assertion (not a transaction)')
    for (const value of ['2026-01-30', '2026-01-31', 'Assets:Closing', 'Equity:Closing', '12.34', 'INR', 'selected-closing', 'padDate', 'plug_account', 'amount_scaled']) expect(node.textContent).toContain(literal(value))
    for (const table of Object.keys(NATIVE_REVIEW_SQL_COLUMNS_V2)) expect(node.textContent).toContain(literal(table))
    // Entire admitted tree, not a summary/truncated or synthesized transaction.
    const literals = (value: unknown): string[] => {
      if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, child]) => [...(Array.isArray(value) ? [] : [literal(key)]), ...literals(child)])
      return [literal(value)]
    }
    expect(node.textContent).toContain('Full before inventory — all 14 tables')
    expect(node.textContent).toContain('Full after inventory — all 14 tables')
    for (const value of Object.values(admitted.effects).flatMap(literals)) expect(node.textContent).toContain(value)
    expect(node.querySelector('details,iframe,script')).toBeNull()
    expect(admitted.effects.after.transactions).toHaveLength(mixed ? 1 : 0)
    expect(node.textContent?.includes('insertTransaction')).toBe(mixed)
  })
  it.each(['review', 'effect', 'renderer', 'selected-field', 'missing-closing', 'duplicate-closing', 'pad-date', 'physical-balance'])('%s refuses before Confirm', async change => {
    const r = await makeClosingReview(true)
    const effects = JSON.parse(r.view.effectJSON)
    if (change === 'review') Object.assign(r.view.binding, { reviewVersion: 99 })
    if (change === 'effect') effects.effectVersion = 99
    if (change === 'renderer') Object.assign(r.evidence, { rendererVersion: 99 })
    if (change === 'selected-field') effects.selected[1].future = true
    if (change === 'missing-closing') effects.selected.pop()
    if (change === 'duplicate-closing') effects.selected.push(effects.selected[1])
    if (change === 'pad-date') effects.selected[1].effective.padDate = '2026-01-29'
    if (change === 'physical-balance') effects.after.directives_balance[0].amount = '999.00'
    r.view.effectJSON = JSON.stringify(effects)
    await expect(admitReview(r, rendererPin, candidate)).rejects.toThrow('Native review unavailable: unsupported or over limit')
  })
  it('requires explicit Prepare, complete Review, Confirm once and renders receipt V3 without counting closing as a transaction', async () => {
    const f = syntheticApi(), response = await makeClosingReview()
    const original = f.methods.getCapture
    f.methods.getCapture = async () => { const value = await original(); value.value.draft!.entries[1] = closingText; return value }
    const prepare = vi.spyOn(f.methods, 'prepareSelection').mockImplementation(async () => ({ ok: true, value: { reviewId: response.view.binding.reviewId, generation: '1' } }))
    vi.spyOn(f.methods, 'reviewPrepared').mockResolvedValue({ ok: true, value: { token: 'closing-token', response } })
    const confirm = vi.spyOn(f.methods, 'confirm').mockResolvedValue({ ok: true, value: { humanVersion: 1, result: { availability: 'present', receipt: { version: 3, binding: response.view.binding, canonical: { deleted: 0, inserted: 1, unchanged: 0, textHash: response.view.binding.textHash }, captureRevision: 2, effects: { assertions: 1, carried: 0, commands: 3, orphans: 0, plugs: 1, rewards: 0 }, phase: 'partially_posted', remaining: 1, selectedIndices: [1] } } } })
    await act(async () => root.render(<NativePostPanel {...f} candidate={candidate} rendererPin={rendererPin} />))
    await click('Load captures'); await click('Select capture')
    await act(async () => (container.querySelectorAll('input[type=checkbox]')[1] as HTMLInputElement).click())
    expect(prepare).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled()
    await click('Prepare selected'); expect(confirm).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Confirm exact Post once')
    await click('Open complete Review'); expect(confirm).not.toHaveBeenCalled()
    // Review admission awaits real WebCrypto digests; act does not await that detached work.
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.textContent).toContain('Closing pad + balance assertion (not a transaction)')
    })
    await click('Confirm exact Post once'); expect(confirm).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('1 selected draft items posted; 1 remain')
    expect(container.textContent).toContain('Selected item counts include closing assertions when present; transaction counts do not.')
    expect(container.textContent).toContain('Post receipt and remainder')
    expect(container.textContent).not.toContain('Confirm exact Post once')
  })
})
