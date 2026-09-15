import { createFileRoute, Link } from '@tanstack/react-router'
import { nativePostEnabled } from '../features/native-post/nativePostAdmission'
import GadgetEditor from '../GadgetEditor'

type GadgetSearch = {
  chat?: number
  // Selected workpiece (gadget) ID. Workpiece IDs start at 0, so parsing must not treat 0 as
  // absent.
  w?: number
}

function parseIntParam(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value)
    if (Number.isInteger(parsed)) return parsed
  }
  return undefined
}

export const Route = createFileRoute('/workspace/$id')({
  component: () => {
    const { id } = Route.useParams()
    const { w } = Route.useSearch()
    return <>{nativePostEnabled() && w !== undefined && <div className="px-4 py-2 border-b border-kumo-line"><Link to="/native-post" search={{ workspaceId: id, workpieceId: String(w) }}>Open trusted Native Post</Link></div>}<GadgetEditor /></>
  },
  validateSearch: (search: Record<string, unknown>): GadgetSearch => ({
    chat: typeof search.chat === 'number' ? search.chat
      : typeof search.chat === 'string' ? Number(search.chat) || undefined
      : undefined,
    w: parseIntParam(search.w),
  }),
})
