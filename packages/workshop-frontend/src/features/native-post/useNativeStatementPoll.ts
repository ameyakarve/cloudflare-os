import { useEffect, useRef, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { NativePostSession } from '@gadgets/workshop-shared/native-post-integration'
import type { NativeCaptureDetail } from '@gadgets/workshop-shared/os-native-post.generated'
import { decodeNativeHumanDetailV1, projectNativeHumanDetailV1 } from '@gadgets/workshop-shared/os-native-post-schema.generated'

export const readNativeDetail = (value: unknown) => decodeNativeHumanDetailV1(JSON.stringify(projectNativeHumanDetailV1(value)))

/** One outstanding read, a fixed deadline, and cleanup fences even an unresolved RPC. */
export const useNativeStatementPoll = (session: RpcStub<NativePostSession> | null, detail: NativeCaptureDetail | null, paused: boolean, generation: Readonly<{ current: number }>, onDetail: (value: NativeCaptureDetail) => void) => {
  const receiver = useRef(onDetail)
  receiver.current = onDetail
  const [message, setMessage] = useState('')
  const id = detail?.summary.phase === 'processing' ? detail.summary.id : null
  const attemptId = detail?.activeAttempt?.attempt
  const serverDeadline = detail?.activeAttempt?.deadline
  const incarnation = generation.current
  const bound = useRef<{ id: string; attemptId: string | undefined; deadline: number } | null>(null)
  useEffect(() => {
    if (!session || !id || paused) { setMessage(''); return }
    if (bound.current?.id !== id || bound.current.attemptId !== attemptId) {
      bound.current = { id, attemptId, deadline: Math.min(serverDeadline ?? Infinity, Date.now() + 120000) }
    }
    const deadline = bound.current.deadline
    let alive = true
    let next: ReturnType<typeof setTimeout> | undefined
    const current = () => alive && generation.current === incarnation
    const timeout = setTimeout(() => {
      if (!current()) return
      alive = false; clearTimeout(next)
      setMessage('Processing poll deadline reached. Processing may still be active; Stop capture or explicitly refresh. No automatic processing retry or Post.')
    }, Math.max(0, deadline - Date.now()))
    const poll = async () => {
      if (!current() || Date.now() >= deadline) return
      try {
        const result = await session.getCapture(id)
        if (!current() || Date.now() >= deadline) return
        if (!result.ok) throw new Error('Poll unavailable')
        const value = readNativeDetail(result.value)
        if (value.summary.id !== id) throw new Error('Poll capture mismatch')
        receiver.current(value)
        if (value.summary.phase !== 'processing') {
          alive = false; clearTimeout(timeout)
          setMessage('Background processing finished. Inspect the current draft; Post still requires Prepare, Review and explicit Confirm.')
          return
        }
        next = setTimeout(() => void poll(), 1000)
      } catch {
        if (!current()) return
        alive = false; clearTimeout(timeout)
        setMessage('Processing status unavailable. No automatic retry. Stop capture or explicitly refresh; nothing posts automatically.')
      }
    }
    setMessage('Background processing active. Polling current capture for at most two minutes. Stop capture remains available.')
    next = setTimeout(() => void poll(), 1000)
    return () => { alive = false; clearTimeout(next); clearTimeout(timeout) }
  }, [session, id, attemptId, serverDeadline, paused, generation, incarnation])
  return message
}
