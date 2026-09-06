import { createFileRoute } from '@tanstack/react-router'
import { useRpcStub } from '../RpcContext'
import { EXTERNAL_AUTH_MODE } from '../useAuth'
import { Navigate } from '@tanstack/react-router'
import SignupPage from '../SignupPage'

export const Route = createFileRoute('/signup')({
  component: SignupRoute,
})

function SignupRoute() {
  const rpcStub = useRpcStub()
  // Signup is not available in CF Access mode — identity is managed by Access.
  if (EXTERNAL_AUTH_MODE) {
    return <Navigate to="/" replace />
  }
  return <SignupPage rpcStub={rpcStub} />
}
