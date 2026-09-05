// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type {
  AuthenticatedApi, ConnectedAccountsSubscriber, GatekeeperVendorInfo,
} from '@gadgets/workshop-shared/api'
import type {
  AccountDescription, SupportedResource, VendorDescription,
} from '@gadgets/workshop-shared/gatekeeper'
import ResourcePicker from './ResourcePicker'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@cloudflare/kumo', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  useKumoToastManager: () => ({ add: vi.fn<(toast: unknown) => void>() }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const dispose = vi.fn<() => void>()
  const promise = Object.assign(new Promise<T>(next => { resolve = next }), {
    [Symbol.dispose]: dispose,
  })
  return { promise, resolve, dispose }
}

const purchaseResource: SupportedResource = {
  urlPattern: 'https://purchase-data.local/sessions/*/register',
  title: 'Purchase register',
  description: 'Purchase register rows.',
}

const purchaseVendor: VendorDescription = {
  displayName: 'Purchase data',
  url: 'https://purchase-data.local',
  autoProvisionsAccount: true,
}

const purchaseAccount: AccountDescription = {
  displayName: 'Purchase data',
  uniqueName: 'purchase-data',
  avatar: { url: 'data:image/svg+xml,purchase-data' },
}

function settledSubscription() {
  const dispose = vi.fn<() => void>()
  const result = Object.assign(Promise.resolve({}), { [Symbol.dispose]: dispose })
  return { result, dispose }
}

function findElementByText(container: HTMLElement, text: string): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>('*')]
    .find(element => element.children.length === 0 && element.textContent === text)
}

describe('ResourcePicker', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    vi.restoreAllMocks()
  })

  it('disposes a pending connected-account subscription on unmount', async () => {
    const pendingSubscription = deferred<{ [Symbol.dispose](): void }>()
    const authenticatedApi = {
      subscribeConnectedAccounts: () => pendingSubscription.promise,
      listGatekeeperVendors: async () => [],
    } as unknown as RpcStub<AuthenticatedApi>

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(
      <ResourcePicker
        authenticatedApi={authenticatedApi}
        searchText="https://example.com"
        onSelectAccount={() => {}}
      />,
    ))

    act(() => root!.unmount())
    root = undefined

    expect(pendingSubscription.dispose).toHaveBeenCalledOnce()
  })

  it('provisions an absent ambient account without starting a connection flow', async () => {
    const subscription = settledSubscription()
    let subscriber: ConnectedAccountsSubscriber | undefined
    const subscribeConnectedAccounts = vi.fn<
      (next: ConnectedAccountsSubscriber) => typeof subscription.result
    >((next) => {
      subscriber = next
      return subscription.result
    })
    const provisionAmbientAccount = vi.fn<(vendorId: string) => Promise<void>>(async () => {})
    const connectAccount = vi.fn<
      (vendorId: string) => Promise<{ url: string }>
    >(async () => ({ url: 'https://example.com/connect' }))
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const vendors: GatekeeperVendorInfo[] = [{
      id: 'purchase-data',
      description: purchaseVendor,
      supportedResources: [purchaseResource],
    }]
    const authenticatedApi = {
      subscribeConnectedAccounts,
      listGatekeeperVendors: async () => vendors,
      provisionAmbientAccount,
      connectAccount,
    } as unknown as RpcStub<AuthenticatedApi>

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(
      <ResourcePicker
        authenticatedApi={authenticatedApi}
        searchText="https://purchase-data.local/sessions/september/register"
        onSelectAccount={() => {}}
      />,
    ))
    await act(async () => subscriber!.ready())

    expect(subscribeConnectedAccounts).toHaveBeenCalledWith(expect.anything(), {
      includeForcedAutoProvisionedAccounts: true,
    })
    expect(container.textContent).toContain('Add Purchase data')
    expect(container.textContent).not.toContain('Connect new account')

    await act(async () => {
      findElementByText(container!, 'Add Purchase data')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })

    expect(provisionAmbientAccount).toHaveBeenCalledWith('purchase-data')
    expect(connectAccount).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('only offers the existing account for an ambient resource', async () => {
    const subscription = settledSubscription()
    let subscriber: ConnectedAccountsSubscriber | undefined
    const subscribeConnectedAccounts = vi.fn<
      (next: ConnectedAccountsSubscriber) => typeof subscription.result
    >((next) => {
      subscriber = next
      return subscription.result
    })
    const vendors: GatekeeperVendorInfo[] = [{
      id: 'purchase-data',
      description: purchaseVendor,
      supportedResources: [purchaseResource],
    }]
    const authenticatedApi = {
      subscribeConnectedAccounts,
      listGatekeeperVendors: async () => vendors,
    } as unknown as RpcStub<AuthenticatedApi>

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(
      <ResourcePicker
        authenticatedApi={authenticatedApi}
        searchText="https://purchase-data.local/sessions/september/register"
        onSelectAccount={() => {}}
      />,
    ))
    await act(async () => {
      subscriber!.add(
        7, purchaseAccount, purchaseVendor, [purchaseResource], true, 'purchase-data',
      )
      subscriber!.ready()
    })

    expect(container.textContent).toContain('purchase-data')
    expect(container.textContent).not.toContain('Add Purchase data')
    expect(container.textContent).not.toContain('Connect new account')
  })
})
