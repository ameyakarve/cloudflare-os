// UI-layer synthetic API only. No native RPC, canonical writer, accounting or human-auth proof.
import type { RpcStub } from 'capnweb'
import type { NativePostSession } from '@gadgets/workshop-shared/native-post-integration'
import type { CanonicalEffectsV2, NativeHumanReviewResponseV1, NativeHumanReceiptResponseV1, NativeCaptureDetail } from '@gadgets/workshop-shared/os-native-post.generated'
import { NATIVE_POST_CONTRACT_DIGEST, NATIVE_REVIEW_SQL_COLUMNS_V2 } from '../../workshop-shared/src/os-native-post-schema.generated'
import type { NativePostApi } from '../src/features/native-post/NativePostPanel'

export const rendererPin = 'd'.repeat(64)
export const candidate = { workspaceId: 'synthetic-workspace', workpieceId: '3' }
export const text = '2026-01-01 * "Synthetic <script>not executable</script> \\u202e"\n  Assets:Demo 1 INR\n  Equity:Demo -1 INR'
const digest = async (domain: string, value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['native-post-v2', domain, value])))), b => b.toString(16).padStart(2, '0')).join('')
export const makeReview = async (editedText = text): Promise<NativeHumanReviewResponseV1> => {
  const state = () => Object.fromEntries(Object.keys(NATIVE_REVIEW_SQL_COLUMNS_V2).map(k => [k, [] as Array<Record<string, string | number | null>>])) as CanonicalEffectsV2['before']
  const after = state()
  after.transactions.push({ id: 'generated:transaction:0', date: 20260101, flag: '*', payee: '', narration: 'Synthetic <script>not executable</script>\u202e', meta_json: '{"business":"allocation:commit-time"}', hash: 'a'.repeat(64), created_at: 'allocation:commit-time', updated_at: 'allocation:commit-time' })
  const effects: CanonicalEffectsV2 = { effectVersion: 2, kind: 'transaction_append_existing_derived', complete: true, source: editedText,
    before: state(), after, commands: [{ op: 'insertTransaction', ref: 'generated:transaction:0' }, { op: 'rematerializePlugs' }, { op: 'sweepOrphans' }],
    selected: [{ ref: 'generated:transaction:0', reason: 'selected-append', original: { date: '2026-01-01', postings: [] }, effective: { date: '2026-01-01', postings: [] } }],
    carried: [], rewards: { provenance: 'private-trusted-fixture-not-Graph', candidates: [], changes: [], coverage: [] }, assertions: [], plugChanges: [], orphanRemovals: [],
    allocation: { transactionRefs: ['generated:transaction:0'], openRefs: [], commitTimestamp: 'allocation:commit-time', directiveWrites: [], freshRows: [{ ref: 'generated:row:0', table: 'transactions', key: { id: 'generated:transaction:0' } }], actionAttemptUpperBound: 3, physicalOnly: ['implicit rowid (postings, tags, links, plugs, totals)', 'sqlite_sequence allocation history'], plugReplacement: 'delete-current-pair-then-insert-next-pair' }, unsupported: ['selected directives', 'explicit deletions'] }
  const now = Date.now()
  const binding = { owner: 'synthetic-owner', epoch: 1, operation: 'synthetic-operation', reviewId: 'synthetic-review', generation: '1', captureId: 'synthetic-capture', captureRevision: 1, sourceRevision: 1 as const, draftRevision: 1, sourceHash: '0'.repeat(64), draftHash: '0'.repeat(64), selectionHash: '', textHash: '', canonicalRevision: '0'.repeat(16), planHash: '', expiresAt: now + 900000, reviewVersion: 2 as const, effectVersion: 2 as const, rendererVersion: 1 as const }
  const selection = [{ draftIndex: 0, originalText: text, editedText }]
  const remainder = [{ draftIndex: 1, originalText: text }]
  const effectJSON = JSON.stringify(effects)
  binding.textHash = await digest('text', editedText)
  binding.selectionHash = await digest('selection', JSON.stringify([selection, remainder]))
  binding.planHash = await digest('effect', effectJSON)
  const view = { binding: { ...binding, bindingHash: await digest('binding', JSON.stringify(binding)) }, selection, remainder, effectJSON }
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, x]) => [k, sorted(x)])) : v
  return { humanVersion: 1, view, evidence: { humanVersion: 1, principal: 'synthetic-owner', userId: 'synthetic-user', userIncarnation: '1', ...candidate, resourceId: 'synthetic-resource', resourceGeneration: '1', rootSessionId: 'synthetic-root', rootGeneration: '1', uiSessionGeneration: '1', receiverId: 'synthetic-receiver', receiverSessionId: 'synthetic-session', binding: { ...view.binding }, viewDigest: await digest('human-complete-view-v1', JSON.stringify(sorted(view))), contractDigest: NATIVE_POST_CONTRACT_DIGEST, rendererArtifactDigest: rendererPin, rendererVersion: 1, decisionId: 'synthetic-decision', issuedAt: now, deadline: now + 60000 } }
}

export const syntheticApi = (mode = 'success') => {
  const counts = { confirms: 0, prepares: 0, lookups: 0, stops: 0, disposals: 0 }
  let response: NativeHumanReviewResponseV1 | null = null
  let receipt: NativeHumanReceiptResponseV1 | null = null
  const detail: NativeCaptureDetail = { activeAttempt: null, draft: { canonicalRevision: '0'.repeat(16), entries: [text, text], outcome: 'complete', revision: 1 }, postedIndices: [], source: { complete: true, filename: 'Synthetic only.txt', pageCount: 1, pages: [{ page: 1, text }] }, summary: { draftRevision: 1, epoch: 1, evidence: 'complete_text_pages', id: 'synthetic-capture', pages: 1, phase: 'needs_review', post: 'blocked_atomic_post_and_human_gate', processing: 'blocked_processor_and_human_gate', revision: 1, sequence: 1, sourceRevision: 1, updatedAt: 0 } }
  const methods = {
    listCaptures: async () => ({ ok: true as const, value: { next: null, rows: [detail.summary] } }),
    getCapture: async () => ({ ok: true as const, value: structuredClone(detail) }),
    prepareSelection: async (input: Parameters<NativePostSession['prepareSelection']>[0]) => { counts.prepares++; response = await makeReview(input.selection[0].editedText); return { ok: true as const, value: { reviewId: response.view.binding.reviewId, generation: '1' } } },
    reviewPrepared: async () => {
      if (!response) throw Error('No preparation')
      const value = structuredClone(response)
      if (mode === 'malformed') value.view.effectJSON = '{}'
      if (mode === 'expired') value.evidence.deadline = value.evidence.issuedAt
      return { ok: true as const, value: { token: 'synthetic-token', response: value } }
    },
    confirm: async () => {
      counts.confirms++
      if (!response) throw Error('No preparation')
      receipt = { humanVersion: 1, result: { availability: 'present', receipt: { version: 2, binding: response.view.binding, canonical: { deleted: 0, inserted: 1, unchanged: 0, textHash: response.view.binding.textHash }, captureRevision: 2, effects: { assertions: 0, carried: 0, commands: 3, orphans: 0, plugs: 0, rewards: 0 }, phase: 'partially_posted', remaining: 1, selectedIndices: [0] } } }
      detail.postedIndices = [0]; detail.summary.revision = 2; detail.summary.phase = 'partially_posted'
      if (mode === 'lost-reply') throw Error('Synthetic lost reply')
      return { ok: true as const, value: receipt }
    },
    lookupPost: async () => { counts.lookups++; return receipt ? { ok: true as const, value: receipt } : { ok: false as const, reason: 'unknown' as const } },
    cancelReview: async () => ({ status: 'closed' as const }), dismissPrepared: async () => ({ status: 'closed' as const }), stopCapture: async () => ({ status: 'closed' as const }),
    stop: async () => { counts.stops++; return { status: 'closed' as const } },
    [Symbol.dispose]: () => { counts.disposals++ },
  }
  // Test-only structural transport substitute. Production has no synthetic adapter import.
  const session = methods as unknown as RpcStub<NativePostSession>
  const api = { openNativePost: async () => session } as unknown as NativePostApi
  return { api, session, counts, methods }
}
