// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AuthenticatedApi, ServerConfig } from '@gadgets/workshop-shared/api'
import { ServerConfigContext, ServerConfigErrorContext } from './ServerConfigContext'
import { Route as ProvidersRoute } from './routes/providers'
import UsageSettings from './components/billing/UsageSettings'
import AccountSelectionModal from './components/billing/AccountSelectionModal'
import OutOfCreditsModal from './components/billing/OutOfCreditsModal'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const { mode, api, auth } = vi.hoisted(() => {
  const api = {
    getCloudflareUsage: vi.fn<AuthenticatedApi['getCloudflareUsage']>(() => new Promise<never>(() => {})),
    listCloudflareAccounts: vi.fn<AuthenticatedApi['listCloudflareAccounts']>(),
    connectAccount: vi.fn<AuthenticatedApi['connectAccount']>(),
    selectCloudflareAccount: vi.fn<AuthenticatedApi['selectCloudflareAccount']>(),
    listModels: vi.fn<AuthenticatedApi['listModels']>(async () => []),
    getQuickModel: vi.fn<AuthenticatedApi['getQuickModel']>(async () => null),
    getAiConfig: vi.fn<AuthenticatedApi['getAiConfig']>(async () => ({ enabled: false })),
  }
  return { mode: { milesvault: false }, api, auth: { authenticatedApi: api } }
})
vi.mock('./useAuth', () => ({ get MILESVAULT_AUTH_MODE() { return mode.milesvault } }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => auth, useOptionalAuthenticatedApi: () => auth }))
vi.mock('./AddModelModal', () => ({ default: () => <div>Provider credential controls</div> }))
vi.mock('@cloudflare/kumo', async original => {
  const Shell = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    ...await original<typeof import('@cloudflare/kumo')>(),
    Dialog: Object.assign(Shell, {
      Root: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <dialog open>{children}</dialog> : null,
      Title: Shell,
    }),
    Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
    useKumoToastManager: () => ({ add: vi.fn<() => void>() }),
  }
})
const ProvidersPage = ProvidersRoute.options.component!
const config: ServerConfig = {
  authVendors: [], passwordAuthEnabled: false, cloudflareLimitsEnabled: true, signupsEnabled: true,
  siteName: 'MilesVault', announcement: '', banner: '', bannerColor: 'neutral', accentColor: '',
}
let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  await act(async () => { await ProvidersPage.preload?.() })
  mode.milesvault = false
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
const render = async (value: ServerConfig | null, node: ReactNode, error = false) => {
  await act(async () => root.render(
    <ServerConfigErrorContext.Provider value={error}>
      <ServerConfigContext.Provider value={value}>{node}</ServerConfigContext.Provider>
    </ServerConfigErrorContext.Provider>,
  ))
}

it.each([false, true])('does not mount direct provider credential controls while config is unavailable (error=%s)', async error => {
  await render(null, <ProvidersPage />, error)
  expect(container.textContent).toContain(error ? 'Unable to load model settings' : 'Loading model settings')
  expect(container.textContent).not.toContain('credential')
  expect(api.listModels).not.toHaveBeenCalled()
})

it.each([null, config, { ...config, managedAgentModel: 'managed-model' }])('blocks direct provider setup in MilesVault mode regardless of server flags: %j', async value => {
  mode.milesvault = true
  await render(value, <ProvidersPage />)
  expect(container.textContent).toContain('Agent models are managed by MilesVault')
  expect(api.listModels).not.toHaveBeenCalled()
})

it('blocks managed model configuration outside MilesVault too, but retains genuine provider setup otherwise', async () => {
  await render({ ...config, managedAgentModel: 'managed-model' }, <ProvidersPage />)
  expect(api.listModels).not.toHaveBeenCalled()
  await render(config, <ProvidersPage />)
  expect(api.listModels).toHaveBeenCalledOnce()
  expect(container.textContent).toContain('Provider credential controls')
})

it.each(['milesvault', 'managed', 'loading', 'disabled'] as const)('blocks all billing entry points and still explains exhaustion: %s', async policy => {
  mode.milesvault = policy === 'milesvault'
  const value = policy === 'loading' ? null : {
    ...config,
    ...(policy === 'managed' ? { managedAgentModel: 'managed-model' } : {}),
    ...(policy === 'disabled' ? { cloudflareLimitsEnabled: false } : {}),
  }
  const close = vi.fn<() => void>()
  await render(value, <><UsageSettings /><AccountSelectionModal /><OutOfCreditsModal open onClose={close} /></>)
  expect(container.textContent).toContain('Usage limit reached')
  expect(container.textContent).toContain('could not continue')
  expect(container.textContent).not.toMatch(/Cloudflare|credits|600|\$/)
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(api.getCloudflareUsage).not.toHaveBeenCalled()
  expect(api.listCloudflareAccounts).not.toHaveBeenCalled()
  expect(api.connectAccount).not.toHaveBeenCalled()
  expect(api.selectCloudflareAccount).not.toHaveBeenCalled()
  await act(async () => container.querySelector('button')!.click())
  expect(close).toHaveBeenCalledOnce()
})

it('retains the genuine Cloudflare billing flow only when explicitly enabled outside managed/MilesVault mode', async () => {
  await render(config, <OutOfCreditsModal open onClose={() => {}} />)
  expect(api.getCloudflareUsage).toHaveBeenCalledOnce()
  expect(container.textContent).toContain("You've reached your free usage limit")
})
