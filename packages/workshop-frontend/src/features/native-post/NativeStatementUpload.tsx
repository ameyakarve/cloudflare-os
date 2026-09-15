import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Input } from '@cloudflare/kumo'
import { available, extractNativeStatement } from 'virtual:native-statement-reader'
import { nativeStatementSource, type NativeStatementInput } from './nativeStatementSource'
import { literal } from './NativePostReview'

export const NativeStatementUpload = ({ disabled, onAdmit }: {
  disabled: boolean; onAdmit: (input: NativeStatementInput) => void
}) => {
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [optedIn, setOptedIn] = useState(false)
  const [source, setSource] = useState<NativeStatementInput | null>(null)
  const [reading, setReading] = useState(false)
  const [message, setMessage] = useState('Read locally first, then explicitly admit the text source. Nothing posts automatically.')
  const attempt = useRef<AbortController | null>(null)
  const cancel = () => {
    attempt.current?.abort(); attempt.current = null
    setReading(false); setSource(null); setPassword('')
  }
  useEffect(() => () => { attempt.current?.abort(); attempt.current = null }, [])
  useEffect(() => { if (disabled) cancel() }, [disabled])
  const read = async () => {
    if (!file || !optedIn || disabled || !available) return
    attempt.current?.abort()
    const controller = new AbortController()
    attempt.current = controller; setSource(null); setReading(true)
    const localPassword = password
    setPassword(''); setMessage('Reading every PDF page locally…')
    try {
      const evidence = await extractNativeStatement(file, { password: localPassword || undefined, signal: controller.signal })
      if (attempt.current !== controller || controller.signal.aborted) return
      setSource(nativeStatementSource(file.name, evidence))
      setMessage(`${evidence.pageCount} pages read. Text exists on every page. Images are NOT processed; this is not full source equivalence. Click Admit text source to upload only the text.`)
    } catch (error) {
      if (attempt.current !== controller || controller.signal.aborted) return
      // Never render parser messages, which may contain document contents or passwords.
      const kind = error && typeof error === 'object' && 'detail' in error && error.detail && typeof error.detail === 'object' && 'kind' in error.detail ? error.detail.kind : null
      setMessage(kind === 'need_password' || kind === 'wrong_password'
        ? 'PDF password required or incorrect. Enter it locally and explicitly read again. The password is never uploaded.'
        : 'PDF refused. Require valid PDF, at most 15 MB / 15 pages, text on EVERY page and at most 131072 UTF-8 text bytes. Scans, image-only pages, partial text coverage and truncated sources are unsupported. OCR is unsupported.')
    } finally {
      if (attempt.current === controller) { attempt.current = null; setReading(false) }
    }
  }
  if (!available) return <section aria-label="Upload native statement"><h2 className="text-xl font-semibold">Upload PDF statement</h2><p>Deployment PDF reader unavailable. No upload is offered.</p></section>
  return <section aria-label="Upload native statement" className="min-w-0 border border-kumo-line rounded p-4 space-y-3">
    <h2 className="text-xl font-semibold">Upload PDF statement</h2>
    <p>Text-layer-only mode: images are NOT processed and OCR is unsupported. Text must exist on EVERY page. Image content may contain transactions missing from the text layer; this mode is not equivalent to processing the full PDF. Maximum 15 MB, 15 pages and 131072 UTF-8 text bytes; no page truncation.</p>
    <Checkbox label="I explicitly choose text-layer-only processing; images are NOT processed and OCR is unsupported" checked={optedIn} disabled={disabled || !available} onCheckedChange={value => { cancel(); setOptedIn(value === true) }} />
    <label className="block min-w-0">PDF file<Input className="block w-full min-w-0 max-w-full" type="file" accept="application/pdf,.pdf" disabled={disabled || !available} onChange={event => { cancel(); setFile(event.target.files?.[0] ?? null); setMessage('File selected locally. Click Read PDF locally; no source has been uploaded.') }} /></label>
    {file && <p className="[overflow-wrap:anywhere]">Selected PDF filename: {literal(file.name)}</p>}
    <label className="block min-w-0">PDF password (local only)<Input className="block w-full min-w-0 max-w-full" type="password" autoComplete="off" value={password} disabled={disabled || reading || !available} onChange={event => setPassword(event.target.value)} /></label>
    <div className="flex flex-wrap gap-3">
      <Button disabled={disabled || !available || !file || !optedIn || reading} onClick={() => void read()}>Read PDF locally</Button>
      <Button disabled={!reading && !source && !password} onClick={() => { cancel(); setMessage('Local reading cancelled. No source was admitted by this action.') }}>Cancel local reading</Button>
      <Button disabled={disabled || !source || !optedIn || reading} onClick={() => { if (source) { const input = source; setSource(null); setPassword(''); onAdmit(input) } }}>Admit text source</Button>
    </div>
    <p role="status">{message}</p>
  </section>
}
