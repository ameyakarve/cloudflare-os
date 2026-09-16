import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const backend = new URL('../packages/workshop-backend/', import.meta.url)
const requireBackend = createRequire(new URL('package.json', backend))
const { build } = requireBackend('esbuild') as typeof import('../packages/workshop-backend/node_modules/esbuild/lib/main.js')

test('native schema bundles and executes through its package export after validator relocation', async (t) => {
  const source = readFileSync(new URL('src/server.ts', backend), 'utf8')
  const specifier = source.match(/from ['"]([^'"]*os-native-post-schema\.generated[^'"]*)['"]/)?.[1]
  assert.equal(specifier, '@gadgets/workshop-shared/os-native-post-schema.generated')
  const manifest = JSON.parse(readFileSync(new URL('../workshop-shared/package.json', backend), 'utf8'))
  assert.equal(manifest.exports['./os-native-post-schema.generated'].types, './src/os-native-post-schema.generated.ts')
  // Use real workspace dependencies with a disposable relocated tree, even on a clean checkout.
  const fixture = await mkdtemp(join(tmpdir(), 'native-schema-resolution-'))
  t.after(() => rm(fixture, { recursive: true, force: true }))
  const relocated = join(fixture, '.wrangler/validate/src')
  await mkdir(relocated, { recursive: true })
  await symlink(fileURLToPath(new URL('node_modules/', backend)), join(fixture, 'node_modules'), 'dir')
  const result = await build({
    stdin: {
      contents: `export * from ${JSON.stringify(specifier)}`,
      resolveDir: relocated,
    },
    // No TS paths, resolver plugins or externals: exercise the runtime package export.
    tsconfigRaw: {}, bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
  })
  assert.ok(Object.keys(result.metafile!.inputs).some(path => path.endsWith('/os-native-post-schema.generated.ts')))
  assert.deepEqual(Object.values(result.metafile!.outputs).flatMap(output => output.imports), [])
  const schema = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles![0].text).toString('base64')}`)
  assert.equal(schema.NATIVE_POST_CONTRACT_DIGEST.length, 64)
  assert.deepEqual(schema.NATIVE_HUMAN_VERSIONS_CURRENT, { human: 1, review: 3, effect: 3, renderer: 2 })
  for (const version of [2, 3, 4]) {
    assert.throws(() => schema.admitNativeHumanViewCurrent({ selection: { reviewVersion: version } }))
  }
  assert.throws(() => schema.decodeNativeHumanReviewV1('{}'))
})
