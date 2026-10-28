import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.join(here, '..', 'extension');
const typer = await readFile(path.join(extDir, 'typer.js'), 'utf8');
const pageHtml = await readFile(path.join(here, 'page.html'), 'utf8');

let server;
let url;
let browser;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(pageHtml);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function openPage() {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('rin'));
  await page.addScriptTag({ content: typer });
  return page;
}

// Focus `selector`, start typing and wait until it finishes.
async function typeInto(page, selector, text, opts = {}) {
  await page.focus(selector);
  const res = await page.evaluate(([t, o]) => startTyping(t, o), [text, { delay: 0, ...opts }]);
  assert.equal(res.ok, true, `startTyping refused: ${JSON.stringify(res)}`);
  await page.waitForFunction(() => !window.__tipeador, null, { timeout: 60_000 });
}

const value = (page, selector) => page.$eval(selector, (el) => el.value);

test('types into a plain input, accents and emoji included', async () => {
  const page = await openPage();
  const text = 'Hola, mundo! ñandú ¿qué tal? 😀';
  await typeInto(page, '#in', text);
  assert.equal(await value(page, '#in'), text);
  await page.close();
});

test('keeps new lines in a textarea and turns them into spaces in an input', async () => {
  const page = await openPage();
  await typeInto(page, '#ta', 'línea 1\nlínea 2\r\nlínea 3');
  assert.equal(await value(page, '#ta'), 'línea 1\nlínea 2\nlínea 3');
  await typeInto(page, '#in', 'a\nb');
  assert.equal(await value(page, '#in'), 'a b');
  await page.close();
});

test('new lines in a chat box do not send the message', async () => {
  const page = await openPage();
  await typeInto(page, '#chat', 'hola\nchau');
  assert.equal(await value(page, '#chat'), 'hola\nchau');
  assert.equal(await page.evaluate(() => window.sent), 0);
  await page.close();
});

test('respects keys the page cancels', async () => {
  const page = await openPage();
  await typeInto(page, '#digits', '12ab34');
  assert.equal(await value(page, '#digits'), '1234');
  await page.close();
});

test('types into a contenteditable editor', async () => {
  const page = await openPage();
  await typeInto(page, '#ce', 'uno dos\ntres');
  assert.equal(await page.$eval('#ce', (el) => el.innerText.trim()), 'uno dos\ntres');
  await page.close();
});

test('updates React state', async () => {
  const page = await openPage();
  await typeInto(page, '#rin', 'react ok');
  assert.equal(await page.$eval('#rout', (el) => el.textContent), 'react ok');
  await page.close();
});

test('types into an editor inside a same-origin iframe', async () => {
  const page = await openPage();
  const frame = page.frames().find((f) => f.url() === 'about:srcdoc');
  await frame.focus('body');
  const res = await page.evaluate(() => startTyping('dentro del iframe', { delay: 0 }));
  assert.equal(res.ok, true);
  await page.waitForFunction(() => !window.__tipeador);
  assert.equal(await frame.$eval('body', (b) => b.innerText.trim()), 'dentro del iframe');
  await page.close();
});

test('refuses when no text field has focus', async () => {
  const page = await openPage();
  await page.focus('#btn');
  const res = await page.evaluate(() => startTyping('x', {}));
  assert.deepEqual(res, { ok: false, reason: 'no-field' });
  await page.close();
});

test('human rhythm has uneven gaps between keys', async () => {
  const page = await openPage();
  await page.evaluate(() => {
    window.times = [];
    document.getElementById('in').addEventListener('keydown', () => window.times.push(performance.now()));
  });
  await typeInto(page, '#in', 'abcdefghijklmnopqrst', { delay: 40, human: true });
  const gaps = await page.evaluate(() => window.times.slice(1).map((t, i) => t - window.times[i]));
  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  assert.ok(min >= 15 && max <= 80, `gaps out of range: ${min}..${max}`);
  assert.ok(max - min > 10, `gaps too even: ${min}..${max}`);
  await page.close();
});

test('Esc stops the typing', async () => {
  const page = await openPage();
  await page.focus('#in');
  await page.evaluate(() => startTyping('x'.repeat(200), { delay: 20 }));
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__tipeador);
  const typed = (await value(page, '#in')).length;
  assert.ok(typed > 0 && typed < 200, `typed ${typed}`);
  await page.waitForTimeout(200);
  assert.equal((await value(page, '#in')).length, typed);
  await page.close();
});

test('pauses while the field has no focus and resumes after', async () => {
  const page = await openPage();
  const text = 'abcdefghijklmnopqrstuvwxyz';
  await page.focus('#in');
  await page.evaluate((t) => startTyping(t, { delay: 30 }), text);
  await page.waitForTimeout(200);
  await page.focus('#other');
  await page.waitForTimeout(200);
  const paused = (await value(page, '#in')).length;
  await page.waitForTimeout(300);
  assert.equal((await value(page, '#in')).length, paused);
  assert.ok(paused < text.length);
  assert.equal(await value(page, '#other'), '');
  await page.focus('#in');
  await page.waitForFunction(() => !window.__tipeador);
  assert.equal(await value(page, '#in'), text);
  await page.close();
});

test('the extension popup types into the active tab', async () => {
  // A copy of the extension with host access to the test server: in real use
  // clicking the toolbar icon grants that access (activeTab), which a test
  // can't do.
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'tipeador-'));
  const ext = path.join(tmp, 'extension');
  await cp(extDir, ext, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(ext, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(path.join(ext, 'manifest.json'), JSON.stringify(manifest));

  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    const admin = await ctx.newPage();
    await admin.goto('chrome://extensions');
    const info = await admin.evaluate(() => chrome.developerPrivate.getExtensionsInfo());
    const tipeador = info.find((e) => e.name === 'Tipeador');
    assert.ok(tipeador, 'extension did not load');
    assert.deepEqual(tipeador.manifestErrors ?? [], []);

    const target = await ctx.newPage();
    await target.goto(url);
    await target.focus('#ta');

    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${tipeador.id}/popup.html`);
    await popup.selectOption('#speed', '5');
    // The popup acts on the window's active tab: make that the test page.
    await target.bringToFront();
    // Pasting starts the typing on its own.
    await popup.evaluate((t) => {
      const box = document.getElementById('text');
      box.value = t;
      box.dispatchEvent(new ClipboardEvent('paste', { bubbles: true }));
    }, 'desde la extensión\nsegunda línea');

    await target.waitForFunction(
      (t) => document.getElementById('ta').value === t,
      'desde la extensión\nsegunda línea',
      { timeout: 15_000 },
    );
  } finally {
    await ctx.close();
    await rm(tmp, { recursive: true, force: true });
  }
});
