import { useState, type ReactNode } from 'react'
import { useServerConfig } from '../ServerConfigContext'
import logo from '../assets/logo.svg?raw'

// Bundled rather than fetched: available on first render, offline, and under any Vite base path.
const defaultLogo = `data:image/svg+xml,${encodeURIComponent(logo)}`

const LogoImage = ({ src, size, className }: {
  src?: string
  size: number
  className?: string
}) => {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading')
  return (
    <span
      className={`relative inline-block shrink-0 align-middle ${className ?? ''}`}
      style={{ width: size, height: size }}
    >
      <img
        src={defaultLogo}
        alt=""
        width={size}
        height={size}
        className="h-full w-full object-contain"
        style={{ backgroundColor: '#ffffff', visibility: status === 'loaded' ? 'hidden' : undefined }}
      />
      {src && status !== 'failed' && (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className="absolute inset-0 h-full w-full object-contain"
          style={{ visibility: status === 'loaded' ? undefined : 'hidden' }}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('failed')}
        />
      )}
    </span>
  )
}

const SiteLogo = ({ size, className, srcOverride }: {
  size: number
  className?: string
  srcOverride?: string | null
  /** Retained for existing callers; the bundled mark replaces legacy icon fallbacks. */
  children?: ReactNode
}) => {
  const serverConfig = useServerConfig()
  const src = (srcOverride === undefined ? serverConfig?.siteLogo?.url : srcOverride) ?? undefined
  // A new URL resets loading/error state, but unrelated config refreshes do not retry broken URLs.
  return <LogoImage key={src ?? ''} src={src} size={size} className={className} />
}

export default SiteLogo
