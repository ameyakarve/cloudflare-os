import { createFileRoute } from '@tanstack/react-router'
import { NativePostPage } from '../pages/native-post/NativePostPage'

export const Route = createFileRoute('/native-post')({
  validateSearch: (search: Record<string, unknown>) => ({
    workspaceId: typeof search.workspaceId === 'string' && search.workspaceId.length <= 256 ? search.workspaceId : undefined,
    workpieceId: typeof search.workpieceId === 'string' && search.workpieceId.length <= 256 ? search.workpieceId : undefined,
  }),
  component: () => {
    const { workspaceId, workpieceId } = Route.useSearch()
    return <NativePostPage candidate={workspaceId && workpieceId ? { workspaceId, workpieceId } : null} />
  },
})
