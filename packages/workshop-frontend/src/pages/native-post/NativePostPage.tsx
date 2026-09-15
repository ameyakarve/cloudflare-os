import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { NativePostSession } from '@gadgets/workshop-shared/native-post-integration'
import type { NativePostOwnerCandidate } from '@gadgets/workshop-shared/deployment-native-post'
import { useAuthenticatedApi } from '../../AuthContext'
import { NativePostPanel, type NativePostApi } from '../../features/native-post/NativePostPanel'
import { nativePostEnabled } from '../../features/native-post/nativePostAdmission'

/** An object envelope is essential: native RPC stubs are callable, including in React setters. */
export const NativePostConnection = ({ api, candidate, rendererPin }: {
  api: NativePostApi; candidate: NativePostOwnerCandidate; rendererPin: string
}) => {
  const [connection, setConnection] = useState<{ api: NativePostApi; workspaceId: string; workpieceId: string; session: RpcStub<NativePostSession> } | null>(null)
  const [failure, setFailure] = useState(false)
  const { workspaceId, workpieceId } = candidate
  useEffect(() => {
    let alive = true
    let owned: RpcStub<NativePostSession> | null = null
    const release = (session: RpcStub<NativePostSession>) => {
      // Await cleanup without racing away server ownership; disposal is not a Stop acknowledgement.
      void Promise.resolve().then(() => session.stop()).catch(() => {}).finally(() => session[Symbol.dispose]())
    }
    void (async () => {
      try {
        const session = await api.openNativePost({ workspaceId, workpieceId })
        if (!alive) { if (session) release(session); return }
        if (!session) { setFailure(true); return }
        owned = session
        setConnection({ api, workspaceId, workpieceId, session })
      } catch { if (alive) setFailure(true) }
    })()
    return () => { alive = false; if (owned) release(owned) }
  }, [api, workspaceId, workpieceId])
  // Hide old account/context data during render, before effect cleanup runs.
  if (!connection || connection.api !== api || connection.workspaceId !== workspaceId || connection.workpieceId !== workpieceId) {
    return <p role="status">{failure ? 'Native Post unavailable for this current owner context. No fallback or installation was attempted.' : 'Opening current-authorized native Post session…'}</p>
  }
  return <NativePostPanel session={connection.session} api={api} candidate={candidate} rendererPin={rendererPin} />
}

export const NativePostPage = ({ candidate }: { candidate: NativePostOwnerCandidate | null }) => {
  const { authenticatedApi } = useAuthenticatedApi()
  return <main className="mx-auto w-full max-w-5xl p-4 sm:p-8 space-y-6 text-kumo-default bg-kumo-base min-w-0">
    <h1 className="text-2xl font-semibold">Native Post</h1>
    <p>Trusted Workshop host · select → Prepare → Review → explicit Confirm → receipt. No iframe approval.</p>
    {!nativePostEnabled() ? <p>Native Post is disabled by deployment configuration.</p> : !candidate ? <p>Open Native Post from a selected workspace workpiece. A workspace/workpiece ID is only a lookup candidate, never authority.</p> :
      <NativePostConnection api={authenticatedApi} candidate={candidate} rendererPin={import.meta.env.VITE_NATIVE_POST_RENDERER_ARTIFACT_DIGEST!} />}
  </main>
}
