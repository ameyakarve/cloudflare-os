import type { ManagedDraftDescriptor } from '@gadgets/workshop-shared/api'

const PREFIX = 'workshop.managed-draft.v1:'
const TTL = 24 * 60 * 60 * 1000
const MAX_RECORD = 512 * 1024
const MAX_TOTAL = 2 * 1024 * 1024
const MAX_COUNT = 8

type RecordValue = { expires: number; payload: string }
type Frame = { flush: () => Promise<boolean>; revoke: () => void }

/** Auth-root owner. Payloads are untrusted data, never capabilities or identity claims. */
export class DraftCoordinator {
  private records = new Map<string, RecordValue>()
  private frames = new Set<Frame>()
  private principal: string | null = null
  private epoch = 0
  warning = ''
  constructor(private storage: () => Storage = () => sessionStorage, private now = Date.now) { this.sweep() }

  needsLeaveWarning() { return this.frames.size > 0 || this.records.size > 0 }

  suspend() {
    this.principal = null
    ++this.epoch
    for (const frame of this.frames) frame.revoke()
  }

  verify(principal: string) {
    if (this.principal !== principal) this.suspend()
    this.principal = principal
  }

  lease(descriptor: ManagedDraftDescriptor) {
    const epoch = this.epoch
    return () => this.principal === descriptor.principalId && this.epoch === epoch
  }

  private key(d: ManagedDraftDescriptor) {
    return PREFIX + JSON.stringify([d.principalId, d.workspaceId, d.outputId])
  }

  private sweep() {
    const now = this.now()
    for (const [key, value] of this.records) if (value.expires <= now) this.records.delete(key)
    try {
      const storage = this.storage()
      for (let i = storage.length - 1; i >= 0; --i) {
        const key = storage.key(i)
        if (!key?.startsWith(PREFIX)) continue
        let scope: unknown
        try { scope = JSON.parse(key.slice(PREFIX.length)) } catch { scope = null }
        if (!Array.isArray(scope) || scope.length !== 3 || !scope.every(id => typeof id === 'string' && id.length > 0 && id.length <= 256)) {
          storage.removeItem(key); continue
        }
        const raw = storage.getItem(key)!
        let value: RecordValue | undefined
        try { value = JSON.parse(raw); JSON.parse(value!.payload) } catch { value = undefined }
        if (!value || !Number.isFinite(value.expires) || value.expires <= now || value.expires > now + TTL ||
            typeof value.payload !== 'string' || raw.length * 2 > MAX_RECORD) {
          storage.removeItem(key)
        } else if (!this.records.has(key) && this.records.size < MAX_COUNT &&
            [...this.records.values()].reduce((n, v) => n + JSON.stringify(v).length * 2, raw.length * 2) <= MAX_TOTAL) {
          this.records.set(key, value)
        }
      }
    } catch { this.warning = 'Private draft storage is unavailable. Keep this tab open and copy your text before leaving; reload or a crash can lose it.' }
  }

  read(d: ManagedDraftDescriptor): string | null {
    if (!this.lease(d)()) return null
    this.sweep()
    return this.records.get(this.key(d))?.payload ?? null
  }

  put(d: ManagedDraftDescriptor, payload: string): boolean {
    if (!this.lease(d)()) return false
    try { JSON.parse(payload) } catch { return false }
    this.sweep()
    const key = this.key(d)
    const value = { expires: this.now() + TTL, payload }
    const raw = JSON.stringify(value)
    const others = [...this.records].filter(([k]) => k !== key)
    if (raw.length * 2 > MAX_RECORD || others.length >= MAX_COUNT ||
        others.reduce((n, [, v]) => n + JSON.stringify(v).length * 2, raw.length * 2) > MAX_TOTAL) {
      this.warning = 'Draft recovery limit reached. Copy your text before leaving; this draft was not retained.'
      return false
    }
    this.records.set(key, value)
    try { this.storage().setItem(key, raw); return true }
    catch { this.warning = 'Draft retained in memory only. Keep this tab open; copy your text before reload or closing.'; return false }
  }

  discard(d: ManagedDraftDescriptor): boolean {
    if (!this.lease(d)()) return false
    const key = this.key(d)
    try { this.storage().removeItem(key) }
    catch { this.warning = 'Draft cleanup failed. A stored copy may remain in this tab.'; return false }
    this.records.delete(key)
    return true
  }

  register(frame: Frame) {
    this.frames.add(frame)
    return () => { this.frames.delete(frame) }
  }

  async guard(confirm: (message: string) => boolean): Promise<boolean> {
    if (!this.frames.size) return true
    const results = await Promise.all([...this.frames].map(f => f.flush().catch(() => false)))
    return confirm(results.every(Boolean)
      ? 'Leave this editor? Retained drafts require explicit Restore; nothing is saved automatically.'
      : 'Draft tracking or storage is unavailable. Copy any unsaved text before leaving. Leave anyway?')
  }

  async logout(confirm: (message: string) => boolean): Promise<boolean> {
    const epoch = this.epoch
    if (!this.frames.size && this.records.size && !confirm('Sign out and discard private drafts retained in this tab?')) return false
    if (!await this.guard(confirm) || epoch !== this.epoch) return false
    this.sweep()
    let failed = false
    try {
      const storage = this.storage()
      for (let i = storage.length - 1; i >= 0; --i) {
        const key = storage.key(i)
        if (key?.startsWith(PREFIX)) storage.removeItem(key)
      }
    } catch { failed = true }
    if (failed && !confirm('Draft cleanup failed. Private drafts may remain in this tab storage. Sign out anyway and close this tab on a shared device?')) return false
    this.records.clear()
    this.suspend()
    this.frames.clear()
    return true
  }
}
