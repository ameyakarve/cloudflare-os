// Offline integration: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node browser/beancount-editor.browser.test.mjs
// Uses the production SDK entry and bundler aliases, no server, accounts, or journal data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
// Build exactly the bytes shipped by the SDK, including production CSS and dependency deduplication.
execFileSync(process.execPath, [fileURLToPath(new URL('../build-browser-runtime.mjs', import.meta.url))]);
const generated = name => readFileSync(new URL(`../src/generated/${name}.txt`, import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
try {
  const page = await browser.newPage();
  let browserErrors = 0;
  page.on('pageerror', () => browserErrors++);
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html data-mode="light"><body style="height:500px"></body></html>');
  await page.addStyleTag({ content: generated('gadget-kumo-styles') });
  await page.addScriptTag({ content: generated('gadget-kumo-runtime') });
  await page.evaluate(() => {
    window.fixture = { changes: 0, saves: 0, value: '2025-01-01 open Assets:Bank USD\n2025-01-02 * "Shop" "Lunch ; not a comment" #fixture ^receipt\n  verified: TRUE\n  Expenses:Food  -12.50 USD\n  Assets:Bank\n; fixture comment\n' };
    window.renderFixture = (readOnly = false) => {
      const props = { value: window.fixture.value, readOnly, onValueChange: value => { window.fixture.value = value; window.fixture.changes++; }, onSave: () => window.fixture.saves++, completionData: { ledgerAccounts: ['Assets:Bank'], catalogueAccounts: [] } };
      window.fixtureRoot ||= GadgetUI.mount(React.createElement(GadgetUI.BeancountEditor, props));
      window.fixtureRoot.render(React.createElement(GadgetUI.BeancountEditor, props));
    };
    window.renderFixture();
  });
  await page.waitForSelector('.cm-line span');
  for (const mode of ['light', 'dark', 'light']) {
    await page.evaluate(nextMode => { document.documentElement.dataset.mode = nextMode; }, mode);
    await page.waitForTimeout(100);
    const styles = await page.evaluate(() => {
      const tokens = ['2025-01-01', 'Expenses:Food', 'USD', '"Shop"', '; fixture comment'];
      return tokens.map(token => {
        const span = [...document.querySelectorAll('.cm-line span')].find(el => el.textContent === token);
        return { token, color: span && getComputedStyle(span).color, fontStyle: span && getComputedStyle(span).fontStyle };
      });
    });
    assert.ok(styles.every(style => style.color), `${mode}: all token categories render as spans`);
    assert.equal(new Set(styles.map(style => style.color)).size, 5, `${mode}: token categories have distinct colors`);
    assert.equal(styles[4].fontStyle, 'italic');
    const extra = await page.evaluate(() => ['open', '*', '-12.50', '#fixture', '^receipt', 'verified', 'TRUE', '"Lunch ; not a comment"'].map(token => {
      const span = [...document.querySelectorAll('.cm-line span')].find(el => el.textContent === token);
      return span ? getComputedStyle(span).color : null;
    }));
    assert.ok(extra.every(Boolean), 'Directives, flags, signed amounts, tags, links, metadata and booleans render highlighted');
    assert.equal(extra[7], styles[3].color, 'Semicolons inside strings are not comments');
    const chrome = await page.evaluate(() => {
      const editor = getComputedStyle(document.querySelector('.cm-editor'));
      return {
        background: editor.backgroundColor,
        scheme: editor.colorScheme,
        hostScheme: getComputedStyle(document.documentElement).colorScheme,
        font: getComputedStyle(document.querySelector('.cm-scroller')).fontFamily,
        gutter: getComputedStyle(document.querySelector('.cm-gutters')).color,
        cursor: getComputedStyle(document.querySelector('.cm-cursor')).borderLeftColor,
      };
    });
    assert.equal(chrome.scheme, mode);
    assert.equal(chrome.hostScheme, mode);
    assert.match(chrome.font, /monospace/);
    for (const color of [...styles.map(style => style.color), ...extra, chrome.gutter, chrome.cursor]) {
      assert.ok(contrast(color, chrome.background) >= 4.5, `${mode}: text, gutter and cursor contrast`);
    }
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForSelector('.cm-selectionBackground');
    const selection = await page.locator('.cm-selectionBackground').first().evaluate(el => getComputedStyle(el).backgroundColor);
    assert.notEqual(selection, chrome.background);
    for (const { color } of styles) assert.ok(contrast(color, selection) >= 4.5, `${mode}: selected syntax stays legible (${color} on ${selection})`);
    const activeLine = await page.locator('.cm-activeLine').evaluate(el => getComputedStyle(el).backgroundColor);
    assert.match(activeLine, /^rgba\(.+, 0\./, 'Active line must not obscure drawn selection');
    assert.equal(await page.locator('.cm-editor').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
  }
  const editor = page.locator('.cm-content');
  const original = await page.evaluate(() => window.fixture.value);
  assert.equal(await page.evaluate(() => window.fixture.changes), 0, 'Theme/selection transactions do not emit edits');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('; typed');
  assert.equal(await page.evaluate(() => window.fixture.value), original + '; typed');
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(() => window.fixture.value), original, 'Undo retained');
  await page.keyboard.press('Control+s');
  assert.equal(await page.evaluate(() => window.fixture.saves), 1, 'Save shortcut retained');

  // Controlled replacements must not echo onValueChange; completion applies a real transaction.
  const changes = await page.evaluate(() => window.fixture.changes);
  await page.evaluate(() => { window.fixture.value = '2025-01-01 open Assets:Ba'; window.renderFixture(); });
  await page.waitForFunction(() => document.querySelector('.cm-content').textContent.includes('open Assets:Ba'));
  assert.equal(await page.evaluate(() => window.fixture.changes), changes, 'Controlled replacement does not echo');
  await editor.focus();
  await page.keyboard.press('Control+End');
  // Let the controlled replacement's pending view/completion updates settle first.
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+Space');
  await page.waitForSelector('.cm-tooltip-autocomplete');
  await page.waitForTimeout(150);
  // The parser also harvests the current partial account, ranked ahead of ledger entries.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.fixture.value.endsWith('Assets:Bank'));
  assert.equal(await page.evaluate(() => window.fixture.value), '2025-01-01 open Assets:Bank');
  assert.equal(await page.evaluate(() => window.fixture.changes), changes + 1);
  await page.evaluate(() => window.renderFixture(true));
  await page.waitForFunction(() => document.querySelector('.cm-content').getAttribute('aria-readonly') === 'true');
  assert.equal(await editor.getAttribute('contenteditable'), 'false');
  assert.equal(await editor.getAttribute('tabindex'), '0');
  assert.equal(await editor.getAttribute('aria-label'), 'Beancount journal');
  await editor.focus();
  await page.keyboard.type('NO');
  await page.keyboard.press('Backspace');
  assert.equal(await page.evaluate(() => window.fixture.changes), changes + 1, 'Readonly cannot mutate');
  await page.evaluate(() => window.fixtureRoot.unmount());
  assert.equal(await page.locator('.cm-editor').count(), 0);
  assert.equal(browserErrors, 0, 'No uncaught browser errors');
  console.log('PASS: offline SDK rendered syntax, both themes/contrast, selection, editing, undo, save, completion, readonly and cleanup');
} finally {
  await browser.close();
}

function luminance(color) {
  const [r, g, blue] = color.match(/\d+/g).slice(0, 3).map(Number).map(value => {
    value /= 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + blue * 0.0722;
}

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
