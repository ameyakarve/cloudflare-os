import { Tabs } from '@cloudflare/kumo'
import BlueprintsPage from '../../BlueprintsPage'
import BlueprintList from '../../components/BlueprintList'

export type TemplatesTab = 'browse' | 'saved'

export const TemplatesPage = ({
  tab,
  onTabChange,
}: {
  tab: TemplatesTab
  onTabChange: (tab: TemplatesTab) => void
}) => (
  <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-3 sm:px-10">
    <header className="min-w-0 px-3 pb-3 pt-6 sm:pt-10">
      <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">Templates</h1>
      <p className="mt-1 text-[13px] leading-[18px] text-kumo-subtle">
        Discover reusable starting points, or use templates you've saved and created.
      </p>
    </header>
    <Tabs
      variant="underline"
      className="mx-3 mb-3 shrink-0"
      value={tab}
      onValueChange={(value) => {
        if (value === 'browse' || value === 'saved') onTabChange(value)
      }}
      tabs={[
        { value: 'browse', label: 'Browse' },
        { value: 'saved', label: 'Saved & created' },
      ].map((item) => ({
        ...item,
        render: (props) => (
          <button {...props} id={`templates-tab-${item.value}`} aria-controls={`templates-panel-${item.value}`} />
        ),
      }))}
    />
    {(['browse', 'saved'] as const).map((value) => (
      <div
        key={value}
        role="tabpanel"
        id={`templates-panel-${value}`}
        aria-labelledby={`templates-tab-${value}`}
        hidden={tab !== value}
        tabIndex={0}
        className="min-h-0 flex-1"
      >
        {tab === value && (value === 'browse' ? <BlueprintsPage /> : <BlueprintList />)}
      </div>
    ))}
  </div>
)
