import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeStatementReaderPlugin } from '../nativeStatementReaderPlugin'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export default defineConfig({
  root, plugins: [react(), tailwindcss(), nativeStatementReaderPlugin()],
  resolve: { alias: { '@gadgets/workshop-shared': path.resolve(root, '../workshop-shared/src') } },
  server: { host: '127.0.0.1', port: 4317, strictPort: true },
})
