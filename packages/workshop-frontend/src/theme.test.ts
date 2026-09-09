// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAccentColor, applyStoredThemeMode, DEFAULT_ACCENT_COLOR } from './theme'

const value = (name: string) => document.documentElement.style.getPropertyValue(name)

afterEach(() => {
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-mode')
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('MilesVault theme', () => {
  it.each([['#f1c21b', '#000000'], ['#fff', '#000000'], ['#123', '#ffffff'], ['#000000', '#ffffff']])(
    'pairs %s with readable action and selection text', (seed, foreground) => {
      applyAccentColor(seed)
      expect(value('--color-kumo-brand')).toBe(seed)
      expect(value('--text-color-kumo-on-brand')).toBe(foreground)
      expect(value('--color-selection-text')).toBe(foreground)
      expect(value('--text-color-kumo-link')).toBe('var(--text-color-kumo-default)')
    },
  )

  it.each([undefined, null, '', 'red', '#12345', '#fff; background: red'])('clears invalid accent %s back to the static skin', seed => {
    applyAccentColor(DEFAULT_ACCENT_COLOR)
    applyAccentColor(seed)
    expect(value('--color-kumo-brand')).toBe('')
    expect(value('--text-color-kumo-on-brand')).toBe('')
    expect(value('--color-selection-text')).toBe('')
  })

  it('preserves stored mode over the system preference', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    localStorage.setItem('gadgets:theme-mode', 'dark')
    expect(applyStoredThemeMode()).toBe('dark')
    expect(document.documentElement.dataset.mode).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })
})
