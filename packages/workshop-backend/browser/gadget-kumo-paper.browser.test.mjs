// Offline: node build-browser-runtime.mjs && PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node browser/gadget-kumo-paper.browser.test.mjs
// Exercises the real getter prelude, production CSS/font bundle, and real Kumo controls. No RPC/data.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const wrapper = await build({
  entryPoints: [fileURLToPath(new URL('../src/gadget-kumo.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false, loader: { '.txt': 'text' },
});
const { withGadgetKumo, KUMO_STYLES } = await import(`data:text/javascript;base64,${Buffer.from(wrapper.outputFiles[0].text).toString('base64')}`);
assert.match(KUMO_STYLES, /data:font\/woff2;base64,/);
assert.ok(!KUMO_STYLES.includes('@import'));
const modern = `
GadgetUI.mount(React.createElement('main', {},
  React.createElement(Kumo.Button, { id: 'primary', variant: 'primary' }, 'Save'),
  React.createElement(Kumo.Button, { id: 'danger', variant: 'destructive' }, 'Delete'),
  React.createElement(Kumo.Button, { id: 'secondary' }, 'Cancel'),
  React.createElement('article', { id: 'card', className: 'bg-kumo-elevated text-kumo-default' }, 'Ledger fixture'),
  React.createElement('div', { id: 'custom', className: 'authored' }, 'Authored'),
  React.createElement('div', { id: 'inline', style: { color: 'rgb(12, 34, 56)', backgroundColor: 'rgb(210, 220, 230)' } }, 'Inline')
));`;
const legacy = `
const { page, card } = Kumo;
Kumo.mount(page({}, card({}, 'Ledger fixture'), Kumo.button('Save', { id: 'primary', variant: 'primary' }),
  Kumo.notice('Danger', 'danger'), Kumo.input({ id: 'input' }),
  Kumo.h('div', { id: 'custom', class: 'authored' }, 'Authored'),
  Kumo.h('div', { id: 'inline', style: 'color:rgb(12,34,56);background:rgb(210,220,230)' }, 'Inline')));`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
try {
  for (const [kind, client] of [['modern', modern], ['legacy', legacy]]) {
    const page = await browser.newPage();
    const requests = [];
    await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    // Authored stylesheet deliberately precedes SDK defaults: layer precedence, not injection order.
    await page.setContent('<!doctype html><html data-skin="my-custom-skin" data-mode="light"><head><style>.authored { color: rgb(1,2,3); background: rgb(4,5,6); border-radius: 13px; }</style></head><body></body></html>');
    await page.addScriptTag({ content: withGadgetKumo(client) });
    await page.waitForSelector('#primary');
    for (const mode of ['light', 'dark', 'media-light', 'media-dark']) {
      await page.emulateMedia({ colorScheme: mode.endsWith('dark') ? 'dark' : 'light' });
      await page.evaluate(mode => {
        if (mode.startsWith('media')) {
          document.documentElement.removeAttribute('data-mode');
          document.documentElement.style.removeProperty('color-scheme');
        } else {
          // GadgetUI.tsx's actual host theme protocol sets both, including live theme changes.
          document.documentElement.dataset.mode = mode;
          document.documentElement.style.colorScheme = mode;
        }
      }, mode);
      const dark = mode.endsWith('dark');
      const styles = await page.evaluate(kind => {
        const get = selector => {
          const s = getComputedStyle(document.querySelector(selector));
          return { color: s.color, bg: s.backgroundColor, radius: s.borderRadius, font: s.fontFamily };
        };
        return { body: get('body'), card: get(kind === 'legacy' ? '.k-card' : '#card'), primary: get('#primary'),
          custom: get('#custom'), inline: get('#inline'), danger: get(kind === 'legacy' ? '.k-notice--danger' : '#danger'),
          skin: document.documentElement.dataset.skin };
      }, kind);
      assert.equal(styles.body.bg, dark ? 'rgb(11, 11, 11)' : 'rgb(255, 255, 255)', `${kind}/${mode}: body`);
      assert.equal(styles.card.bg, dark ? 'rgb(22, 22, 22)' : 'rgb(255, 255, 255)');
      assert.equal(styles.card.color, dark ? 'rgb(244, 244, 244)' : 'rgb(17, 17, 17)');
      assert.match(styles.body.font, /Inter/);
      assert.equal(styles.primary.bg, 'rgb(241, 194, 27)');
      assert.equal(styles.primary.color, 'rgb(17, 17, 17)');
      assert.equal(styles.custom.color, 'rgb(1, 2, 3)');
      assert.equal(styles.custom.bg, 'rgb(4, 5, 6)');
      assert.equal(styles.custom.radius, '13px');
      assert.equal(styles.inline.color, 'rgb(12, 34, 56)');
      assert.equal(styles.inline.bg, 'rgb(210, 220, 230)');
      assert.equal(styles.skin, 'my-custom-skin');
      assert.notEqual(styles.danger.bg, styles.primary.bg);
      if (kind === 'modern') assert.equal(styles.danger.color, 'rgb(255, 255, 255)');
      else assert.equal(styles.danger.color, dark ? 'rgb(255, 131, 137)' : 'rgb(180, 35, 24)');
    }
    await page.evaluate(async () => { await document.fonts.load('14px Inter'); await document.fonts.ready; });
    assert.equal(await page.evaluate(() => [...document.fonts].some(f => f.family === 'Inter' && f.status === 'loaded')), true);
    // Saved Ledger-like partial token override remains authoritative; absent tokens still use paper.
    await page.addStyleTag({ content: ':root { --color-kumo-base: #faf9f6; --color-kumo-brand: #eebb11; }' });
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(250, 249, 246)');
    assert.equal(await page.locator('#primary').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(238, 187, 17)');
    assert.deepEqual(requests, [], 'font and runtime are self-contained');
    await page.close();
  }
  console.log('Gadget Kumo paper: real controls, legacy ABI, both modes/media, authored overrides and offline font passed');
} finally {
  await browser.close();
}
