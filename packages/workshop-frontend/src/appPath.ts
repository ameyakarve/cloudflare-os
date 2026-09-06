const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')

/** Prefix a Workshop-owned root-relative URL with the deployment mount path. */
export function appPath(path: string): string {
  if (!path.startsWith('/') || !basePath || path === basePath || path.startsWith(`${basePath}/`)) {
    return path
  }
  return `${basePath}${path}`
}

export function absoluteAppUrl(path: string): string {
  return `${window.location.origin}${appPath(path)}`
}
