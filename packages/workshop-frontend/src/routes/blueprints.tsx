import { createFileRoute } from '@tanstack/react-router'
import { TemplatesPage, type TemplatesTab } from '../pages/templates/TemplatesPage'
import { useDocumentTitle } from '../useDocumentTitle'

const BlueprintsRoutePage = () => {
  useDocumentTitle('Templates')
  const { tab = 'browse' } = Route.useSearch()
  const navigate = Route.useNavigate()
  return <TemplatesPage tab={tab} onTabChange={(value) => void navigate({ search: { tab: value } })} />
}

export const Route = createFileRoute('/blueprints')({
  validateSearch: (search: Record<string, unknown>): { tab?: TemplatesTab } => ({
    tab: search.tab === 'saved' || search.tab === 'browse' ? search.tab : undefined,
  }),
  component: BlueprintsRoutePage,
})
