import { Button, Dialog } from '@cloudflare/kumo'
import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import type { DeploymentInstallPreparation, DeploymentInstallRelease, DeploymentInstallResult } from '@gadgets/workshop-shared/deployment-install'
import { useAuthenticatedApi } from '../../AuthContext'

/** Trusted Outputs chrome only. No installer capability is sent to authored content. */
export const DeploymentInstallCard = () => {
  const { authenticatedApi } = useAuthenticatedApi()
  const [root, setRoot] = useState({ api: authenticatedApi, incarnation: 0 })
  if (root.api !== authenticatedApi) {
    setRoot({ api: authenticatedApi, incarnation: root.incarnation + 1 })
    return null
  }
  if (import.meta.env.VITE_DEPLOYMENT_INSTALL_OFFERING !== 'true') return null
  return <RootInstallCard key={root.incarnation} api={authenticatedApi} />
}

const RootInstallCard = ({ api }: { api: RpcStub<AuthenticatedApi> }) => {
  const [offering, setOffering] = useState<DeploymentInstallRelease | null>(null)
  const [prepared, setPrepared] = useState<DeploymentInstallPreparation | null>(null)
  const [result, setResult] = useState<DeploymentInstallResult | null>(null)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'review' | 'installing' | 'cancelling' | 'unknown' | 'cancelUnknown' | 'cancelled' | 'committed'>('idle')
  const [message, setMessage] = useState('')
  const attempt = useRef<DeploymentInstallPreparation | null>(null)
  const busy = useRef(false)
  const cancellationRequested = useRef(false)
  const sequence = useRef(0)
  const lifetime = useRef({ live: false })

  useEffect(() => {
    const life = { live: true }
    lifetime.current = life
    api.getDeploymentInstallOffering().then(release => {
      if (life.live) setOffering(release)
    }).catch(() => {})
    return () => {
      life.live = false
      // Best effort only: leaving/reloading is never presented as proof of cancellation.
      if (attempt.current) void api.cancelDeploymentInstall(attempt.current.attempt).catch(() => {})
    }
  }, [api])

  const review = async () => {
    if (!offering || busy.current || attempt.current) return
    busy.current = true
    const life = lifetime.current
    setPhase('preparing')
    try {
      const p = await api.prepareDeploymentInstall(offering.releaseId)
      if (!life.live) {
        void api.cancelDeploymentInstall(p.attempt).catch(() => {})
        return
      }
      // Render the actual prepared descriptor, not the earlier offering or catalog text.
      attempt.current = p
      setPrepared(p)
      setPhase('review')
      setOpen(true)
    } catch {
      if (life.live) {
        setPhase('idle')
        setMessage('Installation review unavailable. No installation was requested.')
      }
    } finally { busy.current = false }
  }

  const confirm = async () => {
    const p = attempt.current
    if (!p || cancellationRequested.current || busy.current || (phase !== 'review' && phase !== 'unknown')) return
    busy.current = true
    const serial = ++sequence.current
    const life = lifetime.current
    setPhase('installing')
    setMessage('Installing a separate private app…')
    try {
      const installed = await api.confirmDeploymentInstall(p.attempt)
      if (life.live && serial === sequence.current) {
        setResult(installed)
        setPhase('committed')
        setMessage('New app created. No scan or dismissal performed.')
      }
    } catch {
      if (life.live && serial === sequence.current) {
        setPhase('unknown')
        setMessage('Outcome unknown. Retry this same attempt on this connection, or cancel to resolve it. Do not start another installation to recover a lost reply.')
      }
    } finally { if (serial === sequence.current) busy.current = false }
  }

  const cancel = async () => {
    const p = attempt.current
    if (!p || phase === 'cancelling') return
    if (phase === 'committed' || phase === 'cancelled') { setOpen(false); return }
    cancellationRequested.current = true
    const serial = ++sequence.current
    const life = lifetime.current
    busy.current = true
    setPhase('cancelling')
    setMessage('Resolving cancellation…')
    try {
      const installed = await api.cancelDeploymentInstall(p.attempt)
      if (!life.live || serial !== sequence.current) return
      setResult(installed)
      setPhase(installed ? 'committed' : 'cancelled')
      setMessage(installed ? 'Already committed. New app retained; no scan or dismissal performed.' : 'Cancelled before commit. No app was created by this attempt.')
    } catch {
      if (life.live && serial === sequence.current) {
        setPhase('cancelUnknown')
        setMessage('Cancellation outcome unknown. Retry cancellation on this connection. Reloading cannot recover this attempt; inspect Outputs before considering another installation.')
      }
    } finally { if (serial === sequence.current) busy.current = false }
  }

  if (!offering) return null
  return <section className="mx-3 mb-4 rounded-lg border border-kumo-line bg-kumo-base p-4 text-kumo-default" aria-label="Deployment installation">
    <h2 className="font-semibold">{offering.title}</h2>
    <p className="my-2 text-sm text-kumo-subtle">{offering.explanation}</p>
    <p className="my-2 text-sm text-kumo-subtle">After reload or connection loss, no installation is retried automatically. Check Outputs before starting another; an earlier request may have committed.</p>
    <Button disabled={phase === 'preparing'} onClick={() => { if (prepared) setOpen(true); else void review() }}>
      {prepared ? 'Show installation attempt' : 'Review installation'}
    </Button>
    {!open && message && <p role="status">{message}</p>}
    <Dialog.Root open={open} onOpenChange={next => { if (!next) void cancel() }}>
      <Dialog className="max-h-[90vh] overflow-y-auto bg-kumo-base p-6" size="sm">
        <Dialog.Title>{prepared?.release.title}</Dialog.Title>
        <Dialog.Description>{prepared?.release.explanation}</Dialog.Description>
        <dl className="my-4 space-y-2 text-sm">
          <dt>Signed-in account</dt><dd className="break-all">{prepared?.principal}</dd>
          <dt>Release / version</dt><dd className="break-all">{prepared?.release.releaseId}</dd>
          <dt>Full client SHA-256</dt><dd className="select-text break-all font-mono">{prepared?.release.uiSha256}</dd>
        </dl>
        <p role="status">{message}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {/* Kumo focuses the first focusable control: keep Cancel before Install. */}
          <Button disabled={phase === 'cancelling'} onClick={() => void cancel()}>
            {phase === 'committed' || phase === 'cancelled' ? 'Close' : phase === 'cancelUnknown' ? 'Retry cancellation' : 'Cancel'}
          </Button>
          {(phase === 'review' || phase === 'unknown' || phase === 'installing') && <Button disabled={phase === 'installing'} onClick={() => void confirm()}>
            {phase === 'unknown' ? 'Retry same installation attempt' : prepared?.release.confirmLabel}
          </Button>}
          {result && <Link to="/workspace/$id" params={{ id: result.workspaceId }} search={{ w: result.workpieceId }}>Open new app</Link>}
        </div>
      </Dialog>
    </Dialog.Root>
  </section>
}
