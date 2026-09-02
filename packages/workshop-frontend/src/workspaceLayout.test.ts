import { describe, expect, it } from 'vitest'
import { isWorkspaceLayoutReady } from './workspaceLayout'

describe('isWorkspaceLayoutReady', () => {
  it('does not wait for the unmounted code editor in a managed system output', () => {
    expect(isWorkspaceLayoutReady({
      chatListReady: true,
      codeStateReady: false,
      hasCodeRelatedState: false,
      isManagedSystemOutput: true,
    })).toBe(true)
  })

  it('still waits for code state in an ordinary workspace', () => {
    expect(isWorkspaceLayoutReady({
      chatListReady: true,
      codeStateReady: false,
      hasCodeRelatedState: false,
      isManagedSystemOutput: false,
    })).toBe(false)
  })
})
