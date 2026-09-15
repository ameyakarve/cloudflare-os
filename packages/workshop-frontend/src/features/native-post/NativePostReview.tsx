import type { ReactNode } from 'react'
import type { CanonicalEffectsV2, CanonicalEffectsV3, NativeHumanReviewResponseV1 } from '@gadgets/workshop-shared/os-native-post.generated'

/** Literal presentation: quotes distinguish business strings from structural labels.
 * Escape controls, bidi formatting and non-ASCII code units (including lone surrogates). */
export const literal = (value: unknown): string => {
  const text = JSON.stringify(value)
  return (text ?? 'undefined').replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

/** Schema admission occurs before this renderer. Every own field and array element is visible;
 * no disclosure, virtualization, linkification, markdown, or generated-ref substitution. */
export const NativePostFields = ({ value }: { value: unknown }): ReactNode => {
  if (value === null || typeof value !== 'object') return <code className="whitespace-pre-wrap [overflow-wrap:anywhere]">{literal(value)}</code>
  if (Array.isArray(value)) return value.length ? <ol className="space-y-3 pl-4">{value.map((item, index) => <li key={index} className="border-l border-kumo-line pl-3"><span className="text-kumo-subtle">[{index}] </span><NativePostFields value={item} /></li>)}</ol> : <span>None (0)</span>
  return <dl className="space-y-2">{Object.entries(value).map(([key, item]) => <div key={key} className="min-w-0"><dt className="font-semibold [overflow-wrap:anywhere]">{literal(key)}</dt><dd className="ml-3 min-w-0"><NativePostFields value={item} /></dd></div>)}</dl>
}

type Effects = CanonicalEffectsV2 | CanonicalEffectsV3

const SelectedItems = ({ effects }: { effects: Effects }) => <section className="border-t border-kumo-line pt-4">
  <h3 className="text-lg font-semibold">Effective selected entries</h3>
  <p>Original and normalized effective entries follow in full. Edited text is not necessarily the final journal.</p>
  {effects.effectVersion === 2 ? <NativePostFields value={effects.selected} /> : <ol className="space-y-3 pl-4">{effects.selected.map(item => <li key={item.draftIndex} className="border-l border-kumo-line pl-3 space-y-2">
    <h4 className="font-semibold">Draft item {item.draftIndex} — {item.kind === 'closing' ? 'Closing pad + balance assertion (not a transaction)' : 'Transaction'}</h4>
    {item.kind === 'closing' && <p>The original and effective pad date, balance date, account, exact amount, currency and plug account are shown below. The directive reference links to the complete physical inventories and plug consequences; no transaction is invented for this closing item.</p>}
    <NativePostFields value={item} />
  </li>)}</ol>}
</section>

const sections: { key: Exclude<keyof Effects, 'selected'>; title: string; note: string }[] = [
  { key: 'commands', title: 'Ordered actions', note: 'Execution order is preserved, including unmatched deletes and adjacent delete/reinsert actions.' },
  { key: 'carried', title: 'Carried changes and reasons', note: 'Replacement identity (replaces / nextRef) is distinct from an in-place update. Complete before and after children follow.' },
  { key: 'rewards', title: 'Reward consequences', note: 'private-trusted-fixture-not-Graph: not Graph-complete. Includes unchanged coverage and duplicate multiplicity.' },
  { key: 'before', title: 'Full before inventory — all 14 tables', note: 'All rows and columns, unchanged included. Exact amounts and scales; no rounding.' },
  { key: 'after', title: 'Full after inventory — all 14 tables', note: 'Includes balance_totals by account/currency/scale, backed zeroes and all retained rows.' },
  { key: 'assertions', title: 'Successful assertions', note: 'Unchanged checks included. Integer strings use scale 12. Directive references resolve to the full balance inventory above, including account, currency, date and plug dependencies.' },
  { key: 'plugChanges', title: 'Plug / pad consequences', note: 'Delete current pair then insert next pair. Balance directives represent pads; there is no fifteenth table.' },
  { key: 'orphanRemovals', title: 'Orphan removals', note: 'Complete prior values, not recomputed balances.' },
  { key: 'allocation', title: 'Commit allocation', note: 'Review references are not permanent target IDs. Only declared allocations resolve at commit; business metadata remains literal.' },
  { key: 'source', title: 'Exact combined edited source', note: 'Literal escaped text.' },
  { key: 'effectVersion', title: 'Effect version', note: '' },
  { key: 'kind', title: 'Effect kind', note: '' },
  { key: 'complete', title: 'Completeness', note: 'Complete only for this admitted snapshot and selection. Not a claim that a statement was fully extracted.' },
  { key: 'unsupported', title: 'Unsupported effects', note: '' },
]

export const NativePostReview = ({ response, effects }: { response: NativeHumanReviewResponseV1; effects: Effects }) => <article aria-label="Complete Post review" className="space-y-6 min-w-0">
  <h2 className="text-xl font-semibold">Review exact Post consequences</h2>
  <p>All strings below are lossless JSON-escaped literals (Unicode shown as \\uXXXX). No business text is an instruction or approval control. Read the complete document before Confirm.</p>
  <section><h3 className="text-lg font-semibold">Identity, scope, versions and original deadlines</h3><NativePostFields value={{ humanVersion: response.humanVersion, evidence: response.evidence, binding: response.view.binding }} /></section>
  <section><h3 className="text-lg font-semibold">Selected draft items ({response.view.selection.length})</h3><NativePostFields value={response.view.selection} /></section>
  <section><h3 className="text-lg font-semibold">Unconsumed remainder ({response.view.remainder.length})</h3><NativePostFields value={response.view.remainder} /></section>
  <SelectedItems effects={effects} />
  {sections.map(({ key, title, note }) => <section key={key} className="border-t border-kumo-line pt-4"><h3 className="text-lg font-semibold">{title}</h3>{note && <p className="text-kumo-subtle mb-3">{note}</p>}<NativePostFields value={effects[key]} /></section>)}
</article>
