// Uses installed browser tooling only; no downloads/providers/deployment.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const output = process.env.SCREENSHOT_DIR ?? '/tmp/mv-native-post-ui-screenshots'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH })
try {
  for (const [name, width, height, dark] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true], ['narrow', 320, 844, false]]) {
    const page = await browser.newPage({ viewport: { width, height } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
    const visit = mode => page.goto(`http://127.0.0.1:4317/native-post-harness/index.html?mode=${mode}&dark=${dark}`)
    const prepare = async () => {
      await page.getByRole('button', { name: 'Load captures', exact: true }).click()
      await page.getByRole('button', { name: /Select capture/ }).click()
      await page.getByRole('checkbox').first().check()
      await page.getByLabel('Exact edited text for item 0').fill('2026-01-01 * "Edited synthetic"\n  Assets:Demo 1 INR\n  Equity:Demo -1 INR')
      await page.getByRole('button', { name: 'Prepare selected items' }).click()
      await page.getByRole('button', { name: 'Open complete Review' }).click()
    }
    await visit('success'); await prepare()
    const confirm = page.getByRole('button', { name: 'Confirm exact Post once' })
    await confirm.waitFor()
    assert.equal(await page.evaluate(() => window.syntheticCounts.confirms), 0)
    assert.equal(await page.locator('iframe').count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} horizontal overflow`)
    await page.getByRole('heading', { name: 'Review exact Post consequences' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${output}/${name}-review-top.png` })
    await confirm.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${output}/${name}-review-confirm.png` })
    // Keyboard-only explicit final decision.
    await confirm.focus(); await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: 'Post receipt and remainder' }).waitFor()
    assert.equal(await page.evaluate(() => window.syntheticCounts.confirms), 1)
    await page.getByRole('heading', { name: 'Post receipt and remainder' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${output}/${name}-receipt.png` })
    await visit('malformed'); await prepare()
    await page.getByRole('status').filter({ hasText: 'Outcome unknown or response unsupported' }).waitFor()
    assert.equal(await confirm.count(), 0)
    assert.equal(await page.evaluate(() => window.syntheticCounts.confirms), 0)
    await visit('lost-reply'); await prepare(); await confirm.click()
    await page.getByRole('status').filter({ hasText: 'Outcome unknown' }).waitFor()
    await page.getByRole('button', { name: /Check receipt/ }).click()
    await page.getByRole('heading', { name: 'Post receipt and remainder' }).waitFor()
    assert.deepEqual(await page.evaluate(() => [window.syntheticCounts.confirms, window.syntheticCounts.lookups]), [1, 1])
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${name}: production UI / synthetic API, explicit confirm, malformed denial, lost-reply lookup, no overflow`)
  }
} finally { await browser.close() }
