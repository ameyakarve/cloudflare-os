// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act, type ReactNode } from 'react'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { createRoot, type Root } from 'react-dom/client'
import {
  createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route as TemplatesRoute } from '../../routes/blueprints'
import { Route as ExploreRoute } from '../../routes/explore'
import Sidebar from '../../components/AppShell/Sidebar'
import CommandPalette from '../../components/AppShell/CommandPalette'

const { api, toast } = vi.hoisted(() => ({
  api: {
    listFeaturedBlueprints: vi.fn<AuthenticatedApi['listFeaturedBlueprints']>(async () => []),
    listGatekeeperVendors: vi.fn<AuthenticatedApi['listGatekeeperVendors']>(async () => []),
    listOwnBlueprints: vi.fn<AuthenticatedApi['listOwnBlueprints']>(async () => []),
    listLibraryBlueprints: vi.fn<AuthenticatedApi['listLibraryBlueprints']>(async () => []),
    listGadgets: vi.fn<AuthenticatedApi['listGadgets']>(async () => []),
    listOutputFormats: vi.fn<AuthenticatedApi['listOutputFormats']>(async () => []),
  },
  toast: { add: vi.fn<() => void>() },
}))
vi.mock('../../AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
vi.mock('@cloudflare/kumo', async (importOriginal) => ({
  ...await importOriginal<typeof import('@cloudflare/kumo')>(),
  useKumoToastManager: () => toast,
}))
vi.mock('../../ServerConfigContext', () => ({ useSiteName: () => 'Workshop' }))
vi.mock('../../useGatekeeperApps', () => ({ useGatekeeperApps: () => [] }))
vi.mock('../../components/SiteLogo', () => ({ default: () => null }))
vi.mock('../../components/AppShell/SidebarUtilityStrip', () => ({ default: () => null }))
vi.mock('../../components/AppShell/SidebarWorkspaces', () => ({
  SidebarWorkspacesProvider: ({ children }: { children: ReactNode }) => children,
  SidebarWorkspacesTools: () => null,
  SidebarWorkspacesLists: () => null,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
window.scrollTo = () => {}
Element.prototype.scrollIntoView = () => {}

const makeRouter = (entry: string, chrome = false) => {
  const rootRoute = createRootRoute({ component: () => <>
    {chrome && <><Sidebar collapsed={false} onToggleCollapsed={() => {}} /><CommandPalette open onClose={() => {}} /></>}
    <Outlet />
  </> })
  const templates = TemplatesRoute.update({
    id: '/blueprints', path: '/blueprints', getParentRoute: () => rootRoute,
  } as never)
  const explore = ExploreRoute.update({
    id: '/explore', path: '/explore', getParentRoute: () => rootRoute,
  } as never)
  const detail = createRoute({ getParentRoute: () => rootRoute, path: '/blueprint/$id', component: () => <p>Template detail</p> })
  return createRouter({
    history: createMemoryHistory({ initialEntries: [entry] }),
    routeTree: rootRoute.addChildren([templates, explore, detail]),
  })
}

describe('unified Templates navigation', () => {
  let container: HTMLDivElement
  let root: Root | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
  })
  afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    container?.remove()
    vi.unstubAllGlobals()
  })

  const renderAt = async (entry: string, chrome = false) => {
    const router = makeRouter(entry, chrome)
    await router.load()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => { root!.render(<RouterProvider router={router} />) })
    return router
  }
  const tab = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((element) => element.textContent === name)!
  const expectSelected = (name: string) => {
    expect(tab(name).getAttribute('aria-selected')).toBe('true')
    const panel = container.querySelector('[role="tabpanel"]:not([hidden])')!
    expect(panel.getAttribute('aria-labelledby')).toBe(tab(name).id)
    expect(tab(name).getAttribute('aria-controls')).toBe(panel.id)
    expect([...container.querySelectorAll('h1')].map((heading) => heading.textContent)).toEqual(['Templates'])
  }

  it('defaults to featured Browse and switches to the own/library view through URL state', async () => {
    const router = await renderAt('/blueprints')
    expectSelected('Browse')
    expect(api.listFeaturedBlueprints).toHaveBeenCalledOnce()
    expect(api.listOwnBlueprints).not.toHaveBeenCalled()
    await act(async () => tab('Saved & created').click())
    expectSelected('Saved & created')
    expect(router.state.location.search).toEqual({ tab: 'saved' })
    expect(api.listOwnBlueprints).toHaveBeenCalledOnce()
    expect(api.listLibraryBlueprints).toHaveBeenCalledOnce()
    expect(container.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('.gadget')
    expect(container.textContent).toContain('Upload .gadget')
    const browse = [...container.querySelectorAll('a')].find((link) => link.textContent?.includes('Browse templates'))!
    expect(browse.getAttribute('href')).toBe('/blueprints?tab=browse')
    await act(async () => browse.click())
    expectSelected('Browse')
    await act(async () => router.history.back())
    expectSelected('Saved & created')
    await act(async () => router.history.forward())
    expectSelected('Browse')
  })

  it('restores Saved & created on a fresh load and after returning from a template', async () => {
    const router = await renderAt('/blueprints?tab=saved')
    expectSelected('Saved & created')
    expect(api.listFeaturedBlueprints).not.toHaveBeenCalled()
    await act(async () => router.navigate({ to: '/blueprint/$id', params: { id: 'example' } }))
    await act(async () => router.history.back())
    expectSelected('Saved & created')
    const href = router.state.location.href
    await act(async () => root!.unmount())
    container.remove()
    await renderAt(href)
    expectSelected('Saved & created')
  })

  it.each(['unknown', 'null', '42', 'true', '%5B%22saved%22%5D', '%7B%22tab%22%3A%22saved%22%7D'])(
    'safely defaults malformed tab=%s to Browse', async (value) => {
      await renderAt(`/blueprints?tab=${value}`)
      expectSelected('Browse')
      expect(api.listOwnBlueprints).not.toHaveBeenCalled()
    },
  )

  it('replaces legacy Explore URLs with Browse, even with a saved tab in the old URL', async () => {
    const router = await renderAt('/explore?tab=saved')
    expect(router.state.location.pathname).toBe('/blueprints')
    expect(router.state.location.search).toEqual({ tab: 'browse' })
    expect(router.history.length).toBe(1)
    expectSelected('Browse')
  })

  it('has one Templates rail destination and one palette command, both opening Browse', async () => {
    const router = await renderAt('/blueprints?tab=saved', true)
    const rail = container.querySelector('aside')!
    const links = [...rail.querySelectorAll('a')]
    const templates = links.filter((link) => link.textContent === 'Templates')
    expect(templates).toHaveLength(1)
    expect(links.some((link) => link.getAttribute('href')?.startsWith('/explore'))).toBe(false)
    await act(async () => templates[0].click())
    expectSelected('Browse')
    await act(async () => router.navigate({ to: '/blueprints', search: { tab: 'saved' } }))
    const commands = [...container.querySelectorAll('button')].filter((button) => button.textContent === 'Templates')
    expect(commands).toHaveLength(1)
    expect(container.textContent).not.toContain('Explore')
    await act(async () => commands[0].click())
    expect(router.state.location.search).toEqual({ tab: 'browse' })
    expectSelected('Browse')
  })
})
