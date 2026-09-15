import type { extractNativeStatement } from 'virtual:native-statement-reader'
import type { NativePostSession } from '@gadgets/workshop-shared/native-post-integration'

export type NativeStatementInput = Parameters<NativePostSession['addStatement']>[0]

/** Explicitly projects only the opted-in text layer, never claiming image equivalence. */
export const nativeStatementSource = (filename: string, evidence: Awaited<ReturnType<typeof extractNativeStatement>>): NativeStatementInput => {
  if (!filename.trim() || filename.length > 256 || evidence.textLayer !== 'present' ||
      !Number.isInteger(evidence.pageCount) || evidence.pageCount < 1 || evidence.pageCount > 15 ||
      evidence.pages.length !== evidence.pageCount) throw new Error('Unsupported statement coverage')
  let bytes = 0
  const pages = evidence.pages.map((page, index) => {
    if (page.page !== index + 1 || !page.text.trim()) throw new Error('Incomplete page text')
    bytes += new TextEncoder().encode(page.text).byteLength
    return { page: page.page, text: page.text }
  })
  if (bytes > 131072) throw new Error('Statement text exceeds 131072 UTF-8 bytes')
  return { mode: 'text_layer_only', source: { filename, pageCount: evidence.pageCount, complete: true, pages } }
}
