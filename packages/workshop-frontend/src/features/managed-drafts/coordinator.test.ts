// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { DraftCoordinator } from './coordinator'

const a = { principalId: 'opaque-a', workspaceId: 'workspace-a', outputId: '3', protocol: 1 as const }
const b = { ...a, principalId: 'opaque-b' }
const payload = JSON.stringify({ buffer: '  exact\n\n', baseline: 'old\n', refs: [{ id: 1, expected_updated_at: 7 }] })
const store = () => {
  const values = new Map<string, string>()
  return { get length() { return values.size }, key: (n: number) => [...values.keys()][n] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) }, clear: () => values.clear() }
}

describe('auth-root managed draft coordinator', () => {
  it('quarantines memory, invalidates old authority, and releases only a freshly verified exact scope', () => {
    const storage = store(), c = new DraftCoordinator(() => storage)
    c.verify(a.principalId)
    const lease = c.lease(a)
    expect(c.put(a, payload)).toBe(true)
    c.suspend()
    expect(lease()).toBe(false)
    expect(c.read(a)).toBeNull()
    expect(c.put(a, '"stale"')).toBe(false)
    c.verify(b.principalId)
    expect(c.read(a)).toBeNull()
    expect(c.read(b)).toBeNull()
    c.verify(a.principalId)
    expect(lease()).toBe(false)
    expect(c.read({ ...a, workspaceId: 'workspace-b' })).toBeNull()
    expect(c.read(a)).toBe(payload)
    const remount = new DraftCoordinator(() => storage)
    expect(remount.read(a)).toBeNull()
    remount.verify(a.principalId)
    expect(remount.read(a)).toBe(payload)
  })

  it('keeps denied-storage memory over reauthentication and requires an explicit cleanup failure choice', async () => {
    const c = new DraftCoordinator(() => { throw Error('denied') })
    c.verify(a.principalId)
    expect(c.put(a, payload)).toBe(false)
    c.suspend(); c.verify(a.principalId)
    expect(c.read(a)).toBe(payload)
    const cancel = vi.fn<(message: string) => boolean>(() => false).mockReturnValueOnce(true)
    expect(await c.logout(cancel)).toBe(false)
    expect(cancel.mock.calls[1][0]).toContain('cleanup failed')
    expect(c.read(a)).toBe(payload)
    expect(await c.logout(() => true)).toBe(true)
    c.verify(a.principalId)
    expect(c.read(a)).toBeNull()
  })

  it('bounds size/count/total without silently replacing retained drafts, expires and validates records', () => {
    let now = 1000
    const storage = store(), c = new DraftCoordinator(() => storage, () => now)
    c.verify(a.principalId)
    for (let i = 0; i < 8; ++i) expect(c.put({ ...a, outputId: String(i) }, payload)).toBe(true)
    expect(c.put({ ...a, outputId: '9' }, payload)).toBe(false)
    expect(c.put(a, JSON.stringify('x'.repeat(512 * 1024)))).toBe(false)
    expect(c.read(a)).toBe(payload)
    expect(c.put(a, 'invalid JSON')).toBe(false)
    now += 24 * 60 * 60 * 1000 + 1
    expect(c.read(a)).toBeNull()
    expect(storage.length).toBe(0)
    expect(c.put(a, payload)).toBe(true)
    storage.setItem(storage.key(0)!, '{"expires":99999999999999,"payload":"invalid"}')
    const fresh = new DraftCoordinator(() => storage, () => now)
    fresh.verify(a.principalId)
    expect(fresh.read(a)).toBeNull()
    const large = JSON.stringify('x'.repeat(240 * 1024))
    for (let i = 0; i < 4; ++i) expect(fresh.put({ ...a, outputId: String(i) }, large)).toBe(true)
    expect(fresh.put({ ...a, outputId: '5' }, large)).toBe(false)
    expect(fresh.read({ ...a, outputId: '0' })).toBe(large)
  })

  it('waits for flush before confirmation and synchronously revokes registered frames on auth loss', async () => {
    const c = new DraftCoordinator(() => store())
    c.verify(a.principalId)
    let release!: (ok: boolean) => void
    const revoke = vi.fn<() => void>(), confirm = vi.fn<(message: string) => boolean>(() => true)
    c.register({ flush: () => new Promise(resolve => { release = resolve }), revoke })
    const guard = c.guard(confirm)
    expect(confirm).not.toHaveBeenCalled()
    release(false)
    expect(await guard).toBe(true)
    expect(confirm.mock.calls[0][0]).toContain('Copy any unsaved text')
    c.suspend()
    expect(revoke).toHaveBeenCalledOnce()
  })
})
