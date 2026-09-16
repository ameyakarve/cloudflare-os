// Synthetic UI fixture only: strict wire admission, not a canonical writer proof.
import type { CanonicalEffectsV2, CanonicalEffectsV3, NativeHumanReviewResponseV1, NativeReviewViewV3 } from '@gadgets/workshop-shared/os-native-post.generated'
import { makeReview } from '../../../native-post-harness/fixture'

export const closingText = '2026-01-30 pad Assets:Closing Equity:Closing\n2026-01-31 balance Assets:Closing 12.34 INR'
const digest = async (domain: string, value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['native-post-v2', domain, value])))), b => b.toString(16).padStart(2, '0')).join('')
const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => a.localeCompare(b, 'en')).map(([k, x]) => [k, sorted(x)])) : v

export const makeClosingReview = async (mixed = false): Promise<NativeHumanReviewResponseV1 & { view: NativeReviewViewV3 }> => {
  const historical = await makeReview()
  const physical: CanonicalEffectsV2 = JSON.parse(historical.view.effectJSON)
  if (!mixed) {
    physical.after.transactions = []; physical.selected = []; physical.commands.shift()
    physical.allocation.transactionRefs = []; physical.allocation.freshRows = []
  }
  const ordinal = mixed ? 1 : 0, ref = `generated:balance:${ordinal}`
  const directive = { kind: 'command' as const, ordinal }
  const closing = { kind: 'closing' as const, padDate: '2026-01-30', input: { kind: 'balance' as const, date: '2026-01-31', account: 'Assets:Closing', amount: '12.34', currency: 'INR', plug_account: 'Equity:Closing' } }
  const selection = [...(mixed ? historical.view.selection : []), { draftIndex: 1, originalText: closingText, editedText: closingText }]
  physical.after.directives_balance.push({ id: ref, date: 20260131, account: 'Assets:Closing', amount: '12.34', amount_scaled: 1234, scale: 2, currency: 'INR', plug_account: 'Equity:Closing', meta_json: '{}', created_at: 'allocation:commit-time', updated_at: 'allocation:commit-time' })
  physical.commands.splice(ordinal, 0, { op: 'writeDirective', kind: 'balance', ref })
  physical.allocation.directiveWrites.push({ ordinal, ref, table: 'directives_balance', operation: 'insert' })
  physical.allocation.freshRows.push({ ref: `generated:row:${physical.allocation.freshRows.length}`, table: 'directives_balance', key: { id: ref } })
  physical.assertions.push({ directive, scale: 12, posted: '0', priorPlugs: '0', computed: '0', asserted: '12340000000000', gap: '12340000000000' })
  const next = ['Assets:Closing', 'Equity:Closing'].map((account, i) => ({ directive, account, amount_scaled: i ? -1234 : 1234, scale: 2, currency: 'INR', date: 20260131 }))
  physical.plugChanges.push({ directive, current: [], next })
  physical.after.plug_postings = next.map(({ directive: _directive, ...row }) => ({ directive_id: ref, ...row }))
  physical.allocation.actionAttemptUpperBound = physical.commands.length
  const effects: CanonicalEffectsV3 = { ...physical, effectVersion: 3, kind: 'selected_items_append_existing_derived', source: selection.map(s => s.editedText).join('\n\n'), selected: [...physical.selected.map(s => ({ ...s, kind: 'transaction' as const, draftIndex: 0 })), { kind: 'closing', draftIndex: 1, original: closing, effective: closing, ref, reason: 'selected-closing', operation: 'insert' }], unsupported: ['other selected directives', 'explicit deletions'] }
  const { bindingHash: _bindingHash, ...oldBinding } = historical.view.binding
  const binding = { ...oldBinding, reviewVersion: 3 as const, effectVersion: 3 as const, rendererVersion: 2 as const }
  const remainder = mixed ? [] : historical.view.selection.map(({ draftIndex, originalText }) => ({ draftIndex, originalText }))
  const effectJSON = JSON.stringify(effects)
  binding.textHash = await digest('text', effects.source)
  binding.selectionHash = await digest('selection', JSON.stringify([selection, remainder]))
  binding.planHash = await digest('effect', effectJSON)
  const view: NativeReviewViewV3 = { binding: { ...binding, bindingHash: await digest('binding', JSON.stringify(binding)) }, selection, remainder, effectJSON }
  return { humanVersion: 1, view, evidence: { ...historical.evidence, binding: view.binding, rendererVersion: 2, viewDigest: await digest('human-complete-view-v1', JSON.stringify(sorted(view))) } }
}
