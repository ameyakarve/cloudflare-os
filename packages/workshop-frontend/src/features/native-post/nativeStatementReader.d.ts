declare module 'virtual:native-statement-reader' {
  /** Build-time deployment integration; never supplied by a PDF or RPC response. */
  export const available: boolean
  export function extractNativeStatement(file: File, options: { password?: string; signal: AbortSignal }): Promise<{
    pageCount: number
    pages: Array<{ page: number; text: string; image: string }>
    textLayer: 'present' | 'image_only' | 'partial'
  }>
}
