// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { ServerConfig } from '@gadgets/workshop-shared/api'
import { ServerConfigContext } from '../ServerConfigContext'
import SiteLogo from './SiteLogo'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('SiteLogo', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = undefined
    container = undefined
  })

  const render = (logoUrl?: string, srcOverride?: string | null) => {
    if (!container) {
      container = document.createElement('div')
      document.body.append(container)
      root = createRoot(container)
    }
    const config = { siteLogo: logoUrl ? { url: logoUrl } : undefined } as ServerConfig
    act(() => root!.render(
      <ServerConfigContext.Provider value={config}>
        <SiteLogo size={20} srcOverride={srcOverride}><span data-legacy>legacy</span></SiteLogo>
      </ServerConfigContext.Provider>,
    ))
  }
  const fallback = () => container!.querySelector<HTMLImageElement>('img[src^="data:"]')!
  const custom = () => container!.querySelector<HTMLImageElement>('img:not([src^="data:"])')

  it('bundles the actual mark, without an asset fetch or base-path dependency', () => {
    render()
    expect(decodeURIComponent(fallback().src)).toContain('M 1287.84 491.799')
    expect(fallback().alt).toBe('')
    expect(fallback().width).toBe(20)
    expect(fallback().height).toBe(20)
    expect(container!.querySelector('[data-legacy]')).toBeNull()
  })

  it('keeps the mark visible until a configured logo loads', () => {
    render('/os/api/site-logo?v=1')
    expect(custom()!.getAttribute('src')).toBe('/os/api/site-logo?v=1')
    expect(custom()!.style.visibility).toBe('hidden')
    expect(fallback().style.visibility).not.toBe('hidden')
    act(() => custom()!.dispatchEvent(new Event('load')))
    expect(custom()!.style.visibility).not.toBe('hidden')
    expect(fallback().style.visibility).toBe('hidden')
  })

  it('falls back on error, does not retry on config refresh, and retries a new URL', () => {
    render('/os/api/site-logo?v=1')
    act(() => custom()!.dispatchEvent(new Event('error')))
    expect(custom()).toBeNull()
    expect(fallback().style.visibility).not.toBe('hidden')
    render('/os/api/site-logo?v=1')
    expect(custom()).toBeNull()
    render('/os/api/site-logo?v=2')
    expect(custom()!.getAttribute('src')).toBe('/os/api/site-logo?v=2')
    expect(fallback().style.visibility).not.toBe('hidden')
  })

  it('uses the bundled mark for the Admin reset preview', () => {
    render('/os/api/site-logo?v=1', null)
    expect(custom()).toBeNull()
    expect(fallback()).not.toBeNull()
  })
})
