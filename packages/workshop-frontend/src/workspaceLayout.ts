export function isWorkspaceLayoutReady({
  chatListReady,
  codeStateReady,
  hasCodeRelatedState,
  isManagedSystemOutput,
}: {
  chatListReady: boolean
  codeStateReady: boolean
  hasCodeRelatedState: boolean
  isManagedSystemOutput: boolean
}): boolean {
  return chatListReady && (
    isManagedSystemOutput || codeStateReady || hasCodeRelatedState
  )
}
