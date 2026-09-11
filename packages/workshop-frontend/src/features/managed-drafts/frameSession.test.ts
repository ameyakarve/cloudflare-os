import { expect, it, vi } from 'vitest'
import { DraftCoordinator } from './coordinator'
import { DraftFrameSession } from './frameSession'

const settle = () => new Promise(resolve => setTimeout(resolve, 20))

it('rejects nonce/generation/sequence replays, gates Restore, flushes and revokes stale frames', async () => {
  const storage = new Map<string, string>()
  const coordinator = new DraftCoordinator(() => ({
    get length() { return storage.size }, key: n => [...storage.keys()][n] ?? null,
    getItem: k => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v) },
    removeItem: k => { storage.delete(k) }, clear: () => storage.clear(),
  }))
  const scope = { principalId: 'a', workspaceId: 'w', outputId: '1', protocol: 1 as const }
  coordinator.verify('a')
  coordinator.put(scope, '"original"')
  const received: unknown[] = []
  const session = new DraftFrameSession(coordinator, scope, () => {})
  let port!: MessagePort
  const window = { postMessage(_message: unknown, _origin: string, ports: MessagePort[]) {
    port = ports[0]; port.addEventListener('message', e => received.push(e.data)); port.start()
  } } as unknown as Window
  session.connect(window, 3)
  const snapshot = { type: 'snapshot', nonce: session.nonce, generation: 3, sequence: 1, dirty: true, payload: '"changed"' }
  port.postMessage({ type: 'ready', protocol: 1, nonce: session.nonce, generation: 3 })
  await settle()
  port.postMessage(snapshot)
  await settle()
  expect(coordinator.read(scope)).toBe('"original"')
  expect(received).toEqual([{ type: 'pendingRestore', nonce: session.nonce, generation: 3 }])
  session.choose(true)
  await settle()
  expect(received).toContainEqual({ type: 'start', nonce: session.nonce, generation: 3, payload: '"original"' })
  port.postMessage({ ...snapshot, nonce: 'stale' })
  port.postMessage({ ...snapshot, generation: 2 })
  await settle()
  expect(coordinator.read(scope)).toBe('"original"')
  port.postMessage(snapshot)
  await settle()
  expect(coordinator.read(scope)).toBe('"changed"')
  // A stale successful-Save acknowledgement cannot clear newer unsent text.
  port.postMessage({ ...snapshot, dirty: false })
  await settle()
  expect(coordinator.read(scope)).toBe('"changed"')
  const flush = session.flush()
  await settle()
  const request = received.findLast((value): value is { type: string; request: number } =>
    typeof value === 'object' && value !== null && 'type' in value && value.type === 'flush')!
  port.postMessage({ ...snapshot, sequence: 2, request: request.request })
  expect(await flush).toBe(true)
  coordinator.suspend()
  port.postMessage({ ...snapshot, sequence: 100, dirty: false })
  await settle()
  coordinator.verify('a')
  expect(coordinator.read(scope)).toBe('"changed"')
  expect(await session.flush()).toBe(false)
  session.dispose(); port.close()
})

it('client terminal fallback cancels pending Restore without losing the candidate', async () => {
  const coordinator = new DraftCoordinator(() => { throw Error('no storage') })
  const scope = { principalId: 'a', workspaceId: 'w', outputId: '1', protocol: 1 as const }
  coordinator.verify('a'); coordinator.put(scope, '"retained"')
  const received: Record<string, unknown>[] = []
  const changed = vi.fn<ConstructorParameters<typeof DraftFrameSession>[2]>()
  const session = new DraftFrameSession(coordinator, scope, changed)
  let port!: MessagePort
  session.connect({ postMessage(_m: unknown, _o: string, ports: MessagePort[]) {
    port = ports[0]; port.addEventListener('message', e => received.push(e.data)); port.start()
  } } as unknown as Window, 4)
  port.postMessage({ type: 'ready', nonce: session.nonce, generation: 4, protocol: 1 })
  await settle()
  expect(received.at(-1)?.type).toBe('pendingRestore')
  port.postMessage({ type: 'fallback', nonce: session.nonce, generation: 4 })
  await settle(); session.choose(false); await settle()
  expect(received.at(-1)?.type).toBe('fallback')
  expect(changed.mock.lastCall?.[2]).toBe(false)
  expect(coordinator.read(scope)).toBe('"retained"')
  expect(await session.flush()).toBe(false)
  session.dispose(); port.close()
})

it('negotiation expires explicitly, including late Ready, without discarding a retained candidate', async () => {
  const coordinator = new DraftCoordinator(() => { throw Error('no storage') })
  const scope = { principalId: 'a', workspaceId: 'w', outputId: '1', protocol: 1 as const }
  coordinator.verify('a'); coordinator.put(scope, '"retained"')
  const received: unknown[] = []
  const changed = vi.fn<ConstructorParameters<typeof DraftFrameSession>[2]>()
  const session = new DraftFrameSession(coordinator, scope, changed)
  let port!: MessagePort
  session.connect({ postMessage(_m: unknown, _o: string, ports: MessagePort[]) {
    port = ports[0]; port.addEventListener('message', e => received.push(e.data)); port.start()
  } } as unknown as Window, 4)
  await new Promise(resolve => setTimeout(resolve, 1550))
  port.postMessage({ type: 'ready', nonce: session.nonce, generation: 4, protocol: 1 })
  await settle()
  expect(received).toEqual(Array.from({ length: 2 }, () => ({ type: 'fallback', nonce: session.nonce, generation: 4, blocked: true })))
  expect(changed.mock.lastCall?.[1]).toMatch(/Reload this view/)
  expect(coordinator.read(scope)).toBe('"retained"')
  expect(await session.flush()).toBe(false)
  session.dispose(); port.close()
})

it('rejects ordered oversize transport data before parsing, negatively acknowledges flush, and retains the old record', async () => {
  const coordinator = new DraftCoordinator(() => { throw Error('no storage') })
  const scope = { principalId: 'a', workspaceId: 'w', outputId: '1', protocol: 1 as const }
  coordinator.verify('a'); coordinator.put(scope, '"retained"')
  const received: Record<string, unknown>[] = []
  const changed = vi.fn<ConstructorParameters<typeof DraftFrameSession>[2]>()
  const session = new DraftFrameSession(coordinator, scope, changed)
  let port!: MessagePort
  session.connect({ postMessage(_m: unknown, _o: string, ports: MessagePort[]) {
    port = ports[0]; port.addEventListener('message', e => received.push(e.data)); port.start()
  } } as unknown as Window, 4)
  port.postMessage({ type: 'ready', nonce: session.nonce, generation: 4, protocol: 1 })
  await settle(); session.choose(true); await settle()
  const huge = { type: 'snapshot', nonce: session.nonce, generation: 4, sequence: 8, dirty: false, payload: 'invalid JSON'.repeat(30000) }
  const parse = vi.spyOn(JSON, 'parse')
  const put = vi.spyOn(coordinator, 'put')
  const discard = vi.spyOn(coordinator, 'discard')
  try {
    const count = changed.mock.calls.length
    port.postMessage({ ...huge, nonce: 'stale' }); port.postMessage({ ...huge, generation: 3 })
    await settle()
    expect(changed.mock.calls).toHaveLength(count)
    const flush = session.flush(); await settle()
    const request = received.findLast(data => data.type === 'flush')!.request
    port.postMessage({ ...huge, request })
    expect(await flush).toBe(false); await settle()
    expect(parse).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(discard).not.toHaveBeenCalled()
    expect(received).toContainEqual({ type: 'ack', nonce: session.nonce, generation: 4, sequence: 8, ok: false })
    expect(changed.mock.lastCall?.[1]).toMatch(/Latest changes are not protected/)
    const acks = received.length
    port.postMessage({ ...huge, payload: 'null', sequence: 7 })
    port.postMessage({ ...huge, payload: 'null' })
    await settle()
    expect(received).toHaveLength(acks)
    // An old request cannot resolve a newer flush even with a fresh sequence.
    const next = session.flush(); await settle()
    port.postMessage({ ...huge, sequence: 9, request })
    await settle()
    await expect(session.flush()).resolves.toBe(false)
    const nextRequest = received.findLast(data => data.type === 'flush')!.request
    port.postMessage({ ...huge, sequence: 10, request: nextRequest })
    expect(await next).toBe(false)
  } finally { parse.mockRestore(); put.mockRestore(); discard.mockRestore(); session.dispose(); port.close() }
  expect(coordinator.read(scope)).toBe('"retained"')
})
