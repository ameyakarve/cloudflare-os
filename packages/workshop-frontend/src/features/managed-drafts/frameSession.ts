import type { ManagedDraftDescriptor } from '@gadgets/workshop-shared/api'
import type { DraftCoordinator } from './coordinator'

/** One native frame document; scope and nonce are exclusively host-owned. */
export class DraftFrameSession {
  readonly nonce = crypto.randomUUID()
  private port: MessagePort | null = null
  private sequence = 0
  private generation = 0
  private request = 0
  private pending = new Map<number, (ok: boolean) => void>()
  private live = true
  private supported = false
  private negotiationExpired = false
  private negotiationTimer: ReturnType<typeof setTimeout> | undefined
  private ready = false
  private unregister: () => void
  private authorized: () => boolean
  private candidate: string | null

  constructor(private coordinator: DraftCoordinator, private descriptor: ManagedDraftDescriptor,
    private changed: (candidate: string | null, warning: string, supported: boolean) => void) {
    this.authorized = coordinator.lease(descriptor)
    this.candidate = coordinator.read(descriptor)
    this.unregister = coordinator.register({ flush: () => this.flush(), revoke: () => this.revoke() })
  }

  connect(frame: Window, generation: number) {
    this.generation = generation
    this.port?.close()
    const channel = new MessageChannel()
    this.port = channel.port1
    const fallback = () => {
      if (this.supported || !this.live || !this.authorized()) return
      clearTimeout(this.negotiationTimer)
      this.negotiationExpired = true
      this.port?.postMessage({ type: 'fallback', nonce: this.nonce, generation, blocked: !!this.candidate })
      this.changed(null, this.candidate
        ? 'Draft negotiation failed. Your retained draft is unchanged. Reload this view to retry recovery.'
        : 'This saved client did not negotiate draft recovery. Copy unsaved text before leaving; dirty state is not tracked.', false)
    }
    this.negotiationTimer = setTimeout(fallback, 1500)
    this.port.addEventListener('message', event => {
      if (!this.live || !this.authorized()) return
      const data = event.data
      if (!data || data.nonce !== this.nonce || data.generation !== generation) return
      if (data.type === 'fallback') {
        this.supported = false
        this.ready = false
        fallback()
      } else if (data.type === 'ready' && this.negotiationExpired) {
        fallback()
      } else if (data.type === 'ready' && data.protocol === 1 && !this.supported && !this.negotiationExpired) {
        clearTimeout(this.negotiationTimer)
        this.supported = true
        this.changed(this.candidate, this.coordinator.warning, true)
        if (!this.candidate) this.choose(false)
        else this.port?.postMessage({ type: 'pendingRestore', nonce: this.nonce, generation })
      } else if (data.type === 'snapshot' && this.ready && Number.isSafeInteger(data.sequence) && data.sequence > this.sequence &&
          typeof data.payload === 'string' && typeof data.dirty === 'boolean') {
        const oversized = data.payload.length * 2 > 500 * 1024
        if (!oversized) { try { JSON.parse(data.payload) } catch { return } }
        this.sequence = data.sequence
        const ok = !oversized && (data.dirty ? this.coordinator.put(this.descriptor, data.payload) : this.coordinator.discard(this.descriptor))
        this.changed(null, oversized
          ? 'Draft recovery limit reached. Latest changes are not protected; copy your text before leaving. Any previous draft is unchanged.'
          : this.coordinator.warning, true)
        this.port?.postMessage({ type: 'ack', nonce: this.nonce, generation, sequence: data.sequence, ok })
        if (Number.isSafeInteger(data.request)) {
          this.pending.get(data.request)?.(ok)
          this.pending.delete(data.request)
        }
      }
    })
    this.port.start()
    frame.postMessage({ type: 'managed-draft', nonce: this.nonce, generation, protocol: 1 }, '*', [channel.port2])
  }

  choose(restore: boolean) {
    if (!this.live || !this.authorized() || !this.supported || this.ready) return
    if (restore && this.candidate) {
      this.candidate = this.coordinator.read(this.descriptor)
      if (this.candidate === null) this.coordinator.warning = 'Draft expired. Loading the saved journal; no changes were saved.'
    }
    if (!restore && this.candidate && !this.coordinator.discard(this.descriptor)) {
      this.changed(this.candidate, this.coordinator.warning, true)
      return
    }
    this.ready = true
    this.port?.postMessage({ type: 'start', nonce: this.nonce, generation: this.generation, payload: restore ? this.candidate : null })
    this.candidate = null
    this.changed(null, this.coordinator.warning, true)
  }

  async flush(): Promise<boolean> {
    if (!this.live || !this.authorized() || !this.supported || !this.ready || this.pending.size) return false
    const request = ++this.request
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.pending.delete(request); resolve(false) }, 750)
      this.pending.set(request, ok => { clearTimeout(timer); resolve(ok) })
      this.port?.postMessage({ type: 'flush', nonce: this.nonce, generation: this.generation, request })
    })
  }

  revoke() {
    clearTimeout(this.negotiationTimer)
    this.live = false
    this.port?.postMessage({ type: 'revoke', nonce: this.nonce, generation: this.generation })
    this.port?.close()
    this.port = null
    for (const resolve of this.pending.values()) resolve(false)
    this.pending.clear()
  }

  dispose() { this.revoke(); this.unregister() }
}
