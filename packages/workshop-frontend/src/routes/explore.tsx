import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/explore')({
  beforeLoad: () => {
    throw redirect({ to: '/blueprints', search: { tab: 'browse' }, replace: true })
  },
})
