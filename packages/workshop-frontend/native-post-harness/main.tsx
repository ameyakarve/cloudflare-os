import { createRoot } from 'react-dom/client'
import { NativePostConnection } from '../src/pages/native-post/NativePostPage'
import { candidate, rendererPin, syntheticApi } from './fixture'
import '../src/styles.css'

const params = new URLSearchParams(location.search)
const fixture = syntheticApi(params.get('mode') ?? 'success')
Object.assign(window, { syntheticCounts: fixture.counts })
if (params.get('dark') === 'true') document.documentElement.dataset.mode = 'dark'
createRoot(document.getElementById('root')!).render(<main className="max-w-5xl mx-auto p-4 space-y-6 min-w-0 text-kumo-default bg-kumo-base">
  <h1 className="text-2xl font-semibold">Native Post — synthetic API UI harness</h1>
  <p>Production connection, panel, admission and renderer. NOT native K→W→M composition, live human authentication, real journal mutation, or accounting evidence.</p>
  <NativePostConnection api={fixture.api} candidate={candidate} rendererPin={rendererPin} />
</main>)
