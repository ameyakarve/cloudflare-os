import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { DraftCoordinator } from './coordinator'

const DraftContext = createContext<DraftCoordinator | null>(null)

export const DraftProvider = ({ children }: { children: ReactNode }) => {
  const [coordinator] = useState(() => new DraftCoordinator())
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (coordinator.needsLeaveWarning()) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [coordinator])
  return <DraftContext.Provider value={coordinator}>{children}</DraftContext.Provider>
}

export const useDraftCoordinator = () => useContext(DraftContext)
