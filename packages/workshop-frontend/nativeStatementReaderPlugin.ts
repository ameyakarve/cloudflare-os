import type { Plugin } from 'vite'
import { isAbsolute } from 'node:path'

/** Deployment supplies the M-owned client module; the public Workshop has no PDF business code. */
export const nativeStatementReaderPlugin = (readerPath?: string): Plugin => {
  const id = 'virtual:native-statement-reader'
  if (readerPath && !isAbsolute(readerPath)) throw new Error('Native statement reader path must be absolute')
  return {
    name: 'deployment-native-statement-reader',
    resolveId(source) { if (source === id) return `\0${id}` },
    load(source) {
      if (source !== `\0${id}`) return
      return readerPath
        ? `export { extractNativeStatement } from ${JSON.stringify(readerPath)}; export const available = true;`
        : 'export const available = false; export async function extractNativeStatement() { throw new Error("Deployment PDF reader unavailable") }'
    },
  }
}
