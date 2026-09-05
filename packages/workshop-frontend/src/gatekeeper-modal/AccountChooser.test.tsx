/* eslint-disable react/react-in-jsx-scope */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AccountOption } from './AccountChooser'
import { AccountChooser } from './AccountChooser'

const account: AccountOption = {
  id: 1,
  description: {
    uniqueName: 'purchase-data',
    avatar: { url: 'data:image/svg+xml,purchase-data' },
  },
  vendorId: 'purchase-data',
  vendorDescription: {
    displayName: 'Purchase data',
    url: 'https://purchase-data.local',
    autoProvisionsAccount: true,
  },
  supportedResources: [],
  credentialsValid: true,
}

function renderChooser(accounts: AccountOption[], autoProvisionsAccount: boolean): string {
  return renderToStaticMarkup(
    <AccountChooser
      accounts={accounts}
      selectedAccountId={accounts[0]?.id ?? null}
      vendorId="purchase-data"
      vendorName="Purchase data"
      autoProvisionsAccount={autoProvisionsAccount}
      connecting={false}
      reconnectingAccountId={null}
      onSelect={() => {}}
      onConnect={() => {}}
      onReconnect={() => {}}
    />,
  )
}

describe('AccountChooser', () => {
  it('does not offer another account for an existing ambient account', () => {
    const html = renderChooser([account], true)

    expect(html).toContain('one shared account for this user')
    expect(html).not.toContain('Use another Purchase data account')
    expect(html).not.toContain('Add Purchase data')
  })

  it('offers in-place provisioning when the ambient account is absent', () => {
    const html = renderChooser([], true)

    expect(html).toContain('Add Purchase data')
    expect(html).not.toContain('Connect Purchase data')
  })

  it('continues to offer additional accounts for regular vendors', () => {
    expect(renderChooser([account], false)).toContain('Use another Purchase data account')
  })
})
