import { useState, useEffect, useRef } from 'react'
import { RpcStub } from 'capnweb'
import { PublicApi, AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { setReportedUserId } from './errorReporting'
import type { DraftCoordinator } from './features/managed-drafts/coordinator'

const CF_ACCESS_MODE = import.meta.env.VITE_CF_ACCESS_MODE === 'true'
const MILESVAULT_AUTH_MODE = import.meta.env.VITE_MILESVAULT_AUTH_MODE === 'true'
const EXTERNAL_AUTH_MODE = CF_ACCESS_MODE || MILESVAULT_AUTH_MODE
export { CF_ACCESS_MODE, MILESVAULT_AUTH_MODE, EXTERNAL_AUTH_MODE }

interface AuthState {
  source?: RpcStub<PublicApi>
  token: string | null
  authenticatedApi: RpcStub<AuthenticatedApi> | null
  isLoading: boolean
  error: string | null
}

export function useAuth(publicApi: RpcStub<PublicApi>, drafts?: DraftCoordinator | null) {
  const [authState, setAuthState] = useState<AuthState>({
    token: null, authenticatedApi: null, isLoading: true, error: null,
  })
  const generation = useRef(0)
  const current = useRef<RpcStub<AuthenticatedApi> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const revoke = () => {
    ++generation.current
    clearTimeout(timer.current)
    drafts?.suspend()
    const stub = current.current
    current.current = null
    try { stub?.[Symbol.dispose]() } catch { /* A broken transport must not prevent local revocation. */ }
  }

  const authenticate = (token: string | null) => {
    revoke()
    const epoch = generation.current
    setAuthState({ token, authenticatedApi: null, isLoading: true, error: null })
    const stub = token !== null ? publicApi.authenticate(token) : publicApi.authenticateFromCfAccess()
    current.current = stub
    const fail = () => {
      if (epoch !== generation.current) return
      revoke()
      setAuthState({ token: null, authenticatedApi: null, isLoading: false,
        error: 'Session could not be verified. Retry, or sign out and sign in with an authorized account. If access was removed, contact your administrator.' })
    }
    timer.current = setTimeout(fail, 20_000)
    void (async () => {
      try {
        // Never publish a pipelined authentication stub as verified authority. Display IDs may
        // be emails/usernames; recovery uses a separate opaque server-owned principal.
        const info = await stub.whoami()
        const principal = drafts ? await stub.getRecoveryPrincipal() : null
        if (epoch !== generation.current) return
        clearTimeout(timer.current)
        if (principal) drafts?.verify(principal)
        if (info.type === 'user') setReportedUserId(info.id)
        stub.onRpcBroken?.(() => fail())
        setAuthState({ source: publicApi, token, authenticatedApi: stub, isLoading: false, error: null })
      } catch { fail() }
    })()
  }

  useEffect(() => {
    if (EXTERNAL_AUTH_MODE) authenticate(null)
    else {
      try {
        const token = localStorage.getItem('authToken')
        if (token) authenticate(token)
        else setAuthState({ token: null, authenticatedApi: null, isLoading: false, error: null })
      } catch {
        setAuthState({ token: null, authenticatedApi: null, isLoading: false, error: 'Browser credential storage is unavailable. Enable storage and retry.' })
      }
    }
    return revoke
  }, [publicApi])

  const finishLogout = () => {
    revoke()
    setReportedUserId(undefined)
    setAuthState({ token: null, authenticatedApi: null, isLoading: false, error: null })
    try { localStorage.removeItem('authToken') }
    catch { window.alert('Credential cleanup failed. The browser may sign in again on reload. Clear this site’s data before using a shared device.') }
    if (MILESVAULT_AUTH_MODE) window.location.assign('/api/auth/signout')
    else if (CF_ACCESS_MODE) window.location.assign('/cdn-cgi/access/logout')
  }
  const logout = () => {
    const epoch = generation.current
    if (drafts) void drafts.logout(message => window.confirm(message)).then(ok => {
      if (ok && epoch === generation.current) finishLogout()
    })
    else finishLogout()
  }

  const authenticatedApi = authState.source === publicApi ? authState.authenticatedApi : null
  return { ...authState, authenticatedApi, sessionGeneration: generation.current,
    login: (token: string) => authenticate(token), logout,
    isAuthenticated: !!authenticatedApi }
}
