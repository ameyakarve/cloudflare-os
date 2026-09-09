// The full paper/ink skin lives in styles.css. Runtime accents change action fills, not
// neutral surfaces or focus indicators. Unlike the shared iframe accent applicator, this
// shell pairs every custom fill with contrast-qualified text in both modes.

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedThemeMode = 'light' | 'dark'

const THEME_MODE_STORAGE_KEY = 'gadgets:theme-mode'

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function getSystemThemeMode(): ResolvedThemeMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function readThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_MODE_STORAGE_KEY)
    return isThemeMode(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function writeThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode)
  } catch {
    // Ignore storage failures; the selected mode still applies for this session.
  }
}

export function resolveThemeMode(mode: ThemeMode): ResolvedThemeMode {
  return mode === 'system' ? getSystemThemeMode() : mode
}

export function applyThemeMode(mode: ThemeMode): ResolvedThemeMode {
  const resolved = resolveThemeMode(mode)
  const root = document.documentElement

  root.setAttribute('data-mode', resolved)
  root.style.colorScheme = resolved

  return resolved
}

export function applyStoredThemeMode(): ResolvedThemeMode {
  return applyThemeMode(readThemeMode())
}

/** The base/default accent, shown in the admin picker when no custom color is set. */
export const DEFAULT_ACCENT_COLOR = '#f1c21b'

const accentProperties = [
  '--color-kumo-brand', '--color-kumo-brand-hover',
  '--color-accent-100', '--color-accent-200',
  '--text-color-kumo-brand', '--text-color-kumo-link', '--text-color-kumo-on-brand',
  '--color-selection-bg', '--color-selection-text',
] as const

/** Apply a hex accent with a readable foreground, or clear back to the static skin. */
export function applyAccentColor(color: string | null | undefined): void {
  const style = document.documentElement.style
  for (const name of accentProperties) style.removeProperty(name)
  if (!color || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) return

  const hex = color.length === 4 ? color.slice(1).split('').map(c => c + c).join('') : color.slice(1)
  const channels = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const linear = channels.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  const useBlack = (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
  const foreground = useBlack ? '#000000' : '#ffffff'
  // Move hover away from the foreground so custom colors never lose text contrast.
  const hover = `color-mix(in srgb, ${color}, ${useBlack ? 'white' : 'black'} 12%)`
  const values = [
    color, hover, color, hover,
    'var(--text-color-kumo-default)', 'var(--text-color-kumo-default)', foreground,
    color, foreground,
  ]
  accentProperties.forEach((name, i) => style.setProperty(name, values[i]))
}
