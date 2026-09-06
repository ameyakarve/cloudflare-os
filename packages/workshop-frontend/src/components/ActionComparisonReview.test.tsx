// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionComparisonReview } from './ActionComparisonReview'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@gadgets/workshop-shared/beancount-editor', () => ({
  createReadonlyBeancountEditor: () => { throw new Error('Editor unavailable') },
}))

describe('shared action comparison', () => {
  let root: Root | undefined
  let host: HTMLDivElement

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
  })

  async function mount(presentation: Parameters<typeof ActionComparisonReview>[0]['presentation']) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(<ActionComparisonReview presentation={presentation} />))
  }

  it('keeps every line reviewable and treats source markup as text', async () => {
    const after = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n') + '\n<img src=x onerror=alert(1)>'
    await mount({ type: 'comparison', before: 'original', after, beforeLabel: 'Replaces', afterLabel: 'With', summary: '1 transaction updated' })
    expect(host.querySelector('[aria-label="Replaces"]')?.textContent).toBe('original')
    expect(host.querySelector('[aria-label="With"]')?.textContent).toBe(after)
    expect(host.querySelector('img')).toBeNull()
  })

  it('preserves both Beancount texts when the editor cannot initialize', async () => {
    await mount({ type: 'comparison', language: 'beancount', before: 'original journal', after: 'proposed journal' })
    await vi.waitFor(() => {
      expect(host.querySelector('[aria-label="Before Beancount"]')?.textContent).toBe('original journal')
      expect(host.querySelector('[aria-label="After Beancount"]')?.textContent).toBe('proposed journal')
    })
  })

  it('distinguishes an omitted before section from an explicitly empty after section', async () => {
    await mount({ type: 'comparison', after: '' })
    expect(host.querySelector('[aria-label="Before"]')).toBeNull()
    expect(host.querySelector('[aria-label="After"]')?.textContent).toBe('(empty)')
  })
})
