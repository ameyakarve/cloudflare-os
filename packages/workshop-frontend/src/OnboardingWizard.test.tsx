// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { AuthenticatedApi, ServerConfig } from '@gadgets/workshop-shared/api'
import { ServerConfigContext } from './ServerConfigContext'
import OnboardingWizard from './OnboardingWizard'
import { ComposerModelSelector } from './features/chat/composer/ComposerModelSelector'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const { api } = vi.hoisted(() => {
  const vendors = async () => [{ id: 'google', description: { url: 'https://google.fixture', displayName: 'Google' } }]
  const subscribe = () => Object.assign(Promise.resolve(), { [Symbol.dispose]: vi.fn<() => void>() })
  return { api: {
    listModels: vi.fn<AuthenticatedApi['listModels']>(), getAiConfig: vi.fn<AuthenticatedApi['getAiConfig']>(),
    setPreferredModel: vi.fn<AuthenticatedApi['setPreferredModel']>(), setOwnDisplayName: vi.fn<AuthenticatedApi['setOwnDisplayName']>(),
    setAvatar: vi.fn<AuthenticatedApi['setAvatar']>(), completeOnboarding: vi.fn<AuthenticatedApi['completeOnboarding']>(async () => {}),
    listGatekeeperVendors: vi.fn<typeof vendors>(vendors), subscribeConnectedAccounts: vi.fn<typeof subscribe>(subscribe),
  } }
})
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api, currentUser: { id: 'member', name: 'Google Member' } }) }))
vi.mock('./ThemeContext', () => ({ useTheme: () => ({ resolvedThemeMode: 'light' }) }))
vi.mock('./AddModelModal', () => ({ default: () => { throw new Error('Model setup must not mount') } }))
vi.mock('@cloudflare/kumo', async original => ({
  ...await original<typeof import('@cloudflare/kumo')>(), useKumoToastManager: () => ({ add: vi.fn<() => void>() }),
}))
const config: ServerConfig = {
  authVendors: [], passwordAuthEnabled: false, cloudflareLimitsEnabled: false, signupsEnabled: true,
  siteName: 'MilesVault', announcement: '', banner: '', bannerColor: 'neutral', accentColor: '',
  managedAgentModel: '@cf/deepseek-ai/deepseek-v4-flash-0731',
}
let root: Root | undefined
let container: HTMLDivElement
const mount = async (node: ReactNode) => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<ServerConfigContext.Provider value={config}>{node}</ServerConfigContext.Provider>))
}
afterEach(async () => { await act(async () => root?.unmount()); container?.remove() })

it('onboards with connections and welcome only, without overwriting the login profile or model', async () => {
  const done = vi.fn<() => void>()
  await mount(<OnboardingWizard onComplete={done} />)
  expect(container.textContent).toContain('Connect your services')
  expect(container.querySelector('#onboarding-display-name')).toBeNull()
  expect(container.textContent).not.toContain('Choose your model')
  expect(container.textContent).not.toContain('Bring your own models')
  const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.includes(label))!
  await act(async () => button('Next').click())
  await act(async () => button("Let's build").click())
  expect(done).toHaveBeenCalledOnce()
  expect(api.completeOnboarding).toHaveBeenCalledOnce()
  expect(api.listModels).not.toHaveBeenCalled()
  expect(api.setPreferredModel).not.toHaveBeenCalled()
  expect(api.setOwnDisplayName).not.toHaveBeenCalled()
})

it('does not render a chat model picker, even with stale client model choices', async () => {
  const change = vi.fn<(id: string | null) => void>()
  await mount(<ComposerModelSelector models={[{ type: 'agent', id: 'old-model', name: 'Old model' }]} selectedModel="old-model" onModelChange={change} />)
  expect(container.childElementCount).toBe(0)
  expect(change).not.toHaveBeenCalled()
})
