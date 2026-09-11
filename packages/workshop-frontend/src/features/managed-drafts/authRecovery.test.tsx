// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { PublicApi } from '@gadgets/workshop-shared/api'
import { useAuth } from '../../useAuth'
import { DraftCoordinator } from './coordinator'

vi.mock('../../errorReporting', () => ({ setReportedUserId: vi.fn<() => void>() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('withholds authority until both fresh identity reads finish; times out with actionable errors and rejects late verification', async () => {
  vi.useFakeTimers()
  const container = document.createElement('div'), root = createRoot(container)
  const coordinator = new DraftCoordinator(() => sessionStorage)
  let release!: (id: string) => void
  let breakConnection: (() => void) | undefined
  const stub = {
    whoami: async () => ({ type: 'user', id: 'display-not-authority', name: 'Test' }),
    getRecoveryPrincipal: () => new Promise<string>(resolve => { release = resolve }),
    onRpcBroken: (callback: () => void) => { breakConnection = callback },
    [Symbol.dispose]() {},
  }
  const api = { authenticate: () => stub } as unknown as RpcStub<PublicApi>
  let state!: ReturnType<typeof useAuth>
  const App = () => { state = useAuth(api, coordinator); return null }
  try {
    localStorage.setItem('authToken', 'synthetic')
    await act(async () => root.render(<App />))
    expect(state.authenticatedApi).toBeNull()
    expect(state.isLoading).toBe(true)
    await act(async () => vi.advanceTimersByTime(20_001))
    expect(state.error).toContain('authorized account')
    await act(async () => release('opaque-a'))
    expect(state.authenticatedApi).toBeNull()
    await act(async () => state.login('fresh'))
    await act(async () => release('opaque-a'))
    expect(state.isAuthenticated).toBe(true)
    const scope = { principalId: 'opaque-a', workspaceId: 'w', outputId: '3', protocol: 1 as const }
    expect(coordinator.put(scope, '"private"')).toBe(true)
    const lease = coordinator.lease(scope)
    act(() => breakConnection!())
    expect(lease()).toBe(false)
    expect(state.authenticatedApi).toBeNull()
    expect(coordinator.read(scope)).toBeNull()
    await act(async () => state.login('fresh-again'))
    await act(async () => release('opaque-a'))
    expect(coordinator.read(scope)).toBe('"private"')
  } finally {
    act(() => root.unmount()); localStorage.clear(); sessionStorage.clear(); vi.useRealTimers()
  }
})
