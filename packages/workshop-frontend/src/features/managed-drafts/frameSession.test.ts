import { expect, it } from 'vitest'
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
  expect(received).toEqual([])
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
