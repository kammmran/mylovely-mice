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
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

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
for (const e of errors) fail.push(e);

console.log(JSON.stringify({ ...state, pulse: `${before}  ->  ${later}` }, null, 1));
await browser.close();

if (fail.length) {
  console.error('\nFAILED:');
  for (const f of fail) console.error(` - ${f}`);
  process.exit(1);
}
console.log('\nthe page loads, mounts and runs clean');
