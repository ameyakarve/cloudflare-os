import { useBlocker } from '@tanstack/react-router'
import { useDraftCoordinator } from './DraftContext'

/** Shared router/back/forward guard; forced auth loss uses quarantine, not navigation. */
export const useDraftNavigationGuard = () => {
  const drafts = useDraftCoordinator()
  useBlocker({
    shouldBlockFn: async () => drafts ? !await drafts.guard(message => window.confirm(message)) : false,
    // The auth-root provider also covers quarantined memory and native document unload.
    enableBeforeUnload: false,
  })
}
