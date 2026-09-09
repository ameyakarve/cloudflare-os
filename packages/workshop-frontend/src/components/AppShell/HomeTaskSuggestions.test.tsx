// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import HomeTaskSuggestions from './HomeTaskSuggestions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('offers editable MilesVault tasks without sending them or promising access, writes, or award availability', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const random = vi.spyOn(Math, 'random')
  const prompts = new Map<string, string>()
  const pick = vi.fn<(prompt: string) => void>()
  try {
    for (const seed of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      random.mockReturnValue(seed)
      await act(async () => root.render(<HomeTaskSuggestions key={seed} onPick={pick} />))
      expect(pick).not.toHaveBeenCalled()
      const buttons = [...container.querySelectorAll('button')]
      expect(buttons).toHaveLength(3)
      for (const button of buttons) {
        await act(async () => button.click())
        expect(pick).toHaveBeenCalledOnce()
        prompts.set(button.querySelector('.font-medium')!.textContent!, pick.mock.calls[0][0])
        pick.mockClear()
      }
    }
    expect([...prompts.keys()].toSorted()).toEqual([
      'Build a rewards Gadget', 'Compare cards', 'Draft a journal entry', 'Explore travel awards', 'Review my holdings',
    ])
    expect(prompts.get('Compare cards')).toContain('Do not assume eligibility or approval')
    expect(prompts.get('Review my holdings')).toContain('authorized you to read')
    expect(prompts.get('Draft a journal entry')).toContain('approval before saving')
    expect(prompts.get('Explore travel awards')).toContain('Do not promise seats or make bookings')
    expect(prompts.get('Build a rewards Gadget')).toContain('do not imply live prices or availability')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    random.mockRestore()
  }
})
