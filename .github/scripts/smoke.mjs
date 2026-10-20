/**
 * Load the page in a real browser and fail on anything it throws.
 *
 * This exists because of a specific failure mode: main.js is one long module
 * that wires up a dozen singletons in declaration order, and a `const` that
 * references another `const` declared further down throws a temporal-dead-zone
 * error at import time. Everything after that line silently never runs — the
 * page looks nearly fine, and nothing in a syntax check or an import check
 * sees it. Twice now that has only shown up in a browser.
 *
 * Needs: playwright chromium, and a server on $URL.
 */
import { chromium } from 'playwright';

const URL_BASE = process.env.URL || 'http://localhost:8777';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// Returning visitors must also get the new defaults instead of the old busy
// layout. New choices in mlm-panels-v2 are checked across a reload below.
await page.addInitScript(() => {
  localStorage.setItem('mlm-panels', JSON.stringify({ feed: true, boxes: true, spikes: true }));
});
// Every runtime dependency must be available from the Pages origin itself.
await page.route('**/*', (route) => new URL(route.request().url()).origin === new URL(URL_BASE).origin
  ? route.continue() : route.abort());

const errors = [];
page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));

await page.goto(`${URL_BASE}/index.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(8000);          // the atlas and the connectivity matrix load

// the pieces that only exist if the module ran all the way through
const state = await page.evaluate(() => ({
  cages: document.querySelectorAll('.bx').length,
  panels: ['boxes', 'mortality', 'report', 'threats', 'colony', 'feed']
    .filter((id) => !document.getElementById(id)),
  stimuli: document.querySelectorAll('#tgrid .tbtn').length,
  colony: document.querySelectorAll('.crow').length,
  regions: document.querySelectorAll('#pops .prow, #active-list .arow').length,
  session: document.getElementById('st-time')?.textContent,
}));

// It has to actually be running, not merely mounted. A CI runner has no GPU,
// so the simulation crawls and the clock — which only resolves to whole
// seconds — may not tick in the time available. Any of these moving is proof
// the loop is turning.
const pulse = () => page.evaluate(() => [
  document.getElementById('st-time')?.textContent,
  document.getElementById('pos-badge')?.textContent,
  document.getElementById('st-spk')?.textContent,
].join('|'));
const before = await pulse();
await page.waitForTimeout(6000);
const later = await pulse();

const fail = [];
if (state.panels.length) fail.push(`panels missing: ${state.panels.join(', ')}`);
if (state.cages !== 9) fail.push(`expected 9 cages, found ${state.cages}`);
if (state.stimuli !== 6) fail.push(`expected 6 threat buttons, found ${state.stimuli}`);
if (!state.colony) fail.push('the colony panel has no rows');
if (!state.regions) fail.push('no region rows rendered');
if (before === later) fail.push(`nothing moved in six seconds (${before})`);

const visible = (selector) => page.locator(selector).isVisible();
const clean = async () => {
  const overlays = await page.locator('.float:visible').count();
  if (overlays) fail.push(`clean view has ${overlays} floating panels`);
  for (const selector of ['#welcome', '#footer', '#hud', '#scalebar']) {
    if (await visible(selector)) fail.push(`clean view shows ${selector}`);
  }
  if (!await visible('#topbar') || !await visible('#brain-card')) fail.push('right sidebar is missing');
  const world = await page.locator('#world').boundingBox();
  const menu = await page.locator('#topbar').boundingBox();
  if (!world || !menu || world.y !== 0 || world.height < 790 || menu.x < world.x + world.width - 1) {
    fail.push('platform does not fill the space beside the right menu');
  }
};
await clean();
if (fail.length || errors.length) {
  console.error(JSON.stringify({ state, failures: [...fail, ...errors] }, null, 2));
  await browser.close();
  process.exit(1);
}
console.log('The simulation runs with a clean platform and right sidebar');

for (const mode of ['orbit', 'top', 'all nine', 'follow']) {
  await page.click('#b-cam');
  if (await page.locator('#b-cam').textContent() !== `camera: ${mode}`) fail.push(`camera did not switch to ${mode}`);
}

// Optional panels must open on the first click, close, and stay in sync with
// both the Panels menu and the toolbar.
for (const [button, card] of [['#b-boxes', '#boxes'], ['#b-mortality', '#mortality']]) {
  await page.click(button);
  if (!await visible(card)) fail.push(`${card} did not open on the first click`);
  await page.click(button);
  if (await visible(card)) fail.push(`${card} did not close`);
}
await page.click('#b-panels');
await page.getByRole('menuitemcheckbox', { name: /what just happened/ }).click();
if (!await visible('#feed')) fail.push('event feed did not open from the Panels menu');
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => !!window.sim);
if (!await visible('#feed')) fail.push('panel choice was not remembered after reload');
await page.click('#b-panels');
await page.getByRole('button', { name: 'show all', exact: true }).click();
if (!await visible('#footer')) fail.push('show all did not restore the bottom charts');
await page.getByRole('button', { name: 'clean view', exact: true }).click();
await page.keyboard.press('Escape');
await clean();

if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });
await page.setViewportSize({ width: 390, height: 844 });
const mobileWorld = await page.locator('#world').boundingBox();
const mobileMenu = await page.locator('#topbar').boundingBox();
if (!mobileWorld || mobileWorld.width < 200 || !mobileMenu || mobileMenu.x + mobileMenu.width > 391) {
  fail.push('narrow screen clips the platform or right menu');
}
await page.click('#b-panels');
const panelMenu = await page.locator('#panel-menu').boundingBox();
if (!panelMenu || panelMenu.x < mobileMenu.x || panelMenu.x + panelMenu.width > 391) {
  fail.push('narrow screen clips the Panels dropdown');
}
for (const e of errors) fail.push(e);

console.log(JSON.stringify({ ...state, pulse: `${before}  ->  ${later}` }, null, 1));
await browser.close();

if (fail.length) {
  console.error('\nFAILED:');
  for (const f of fail) console.error(` - ${f}`);
  process.exit(1);
}
console.log('\nthe page loads, mounts and runs clean');
