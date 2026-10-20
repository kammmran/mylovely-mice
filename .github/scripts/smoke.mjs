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
import { checkReport } from './report-smoke.mjs';
import { checkMouseBehavior } from './behavior-smoke.mjs';
import { checkThreatBehavior } from './threat-smoke.mjs';
import { checkAnatomy } from './anatomy-smoke.mjs';

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
  if (!await visible('#topbar') || !await visible('#ui-mouse')) fail.push('Explore sidebar is missing');
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
await checkMouseBehavior(page);
await checkThreatBehavior(page);
await checkAnatomy(page);
if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });

const currentMouse = await page.locator('#ui-mouse').textContent();
await page.click('#b-next-mouse');
await page.waitForFunction((name) => document.getElementById('ui-mouse').textContent !== name, currentMouse);
await page.click('#b-pause');
await page.waitForFunction(() => document.getElementById('b-pause').textContent === 'Resume');
const pausedTime = await page.locator('#ui-clock').textContent();
await page.selectOption('#b-speed', '2');
await page.selectOption('#b-speed', '1');
await page.click('#b-auto');
await page.waitForFunction(() => document.getElementById('b-auto').getAttribute('aria-pressed') === 'false');
await page.click('#b-auto');

for (const mode of ['orbit', 'top', 'all nine', 'follow']) {
  await page.selectOption('#b-cam', mode);
  if (await page.locator('#b-cam').inputValue() !== mode) fail.push(`camera did not switch to ${mode}`);
}

await page.getByRole('tab', { name: 'Brain', exact: true }).click();
if (!await visible('#brain-card')) fail.push('Brain tab did not reveal the anatomy');
if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT.replace('.png', '-brain.png') });
await page.getByRole('tab', { name: 'Tools', exact: true }).click();
await page.click('#b-reset');
if (!await visible('#reset-dialog')) fail.push('Restart did not show a confirmation');
await page.getByRole('button', { name: 'Keep exploring', exact: true }).click();
if (await page.locator('#ui-clock').textContent() !== pausedTime) fail.push('Canceling restart changed the paused session');
await page.click('#b-reset');
await page.locator('#reset-dialog').getByRole('button', { name: 'Restart session', exact: true }).click();
await page.waitForFunction(() => document.getElementById('ui-clock').textContent === '0:00');
await page.evaluate(() => { window.mouseBeforeCancel = window.sim.agents[0]; });
await page.click('#b-reset');
await page.keyboard.press('Escape');
if (!await page.evaluate(() => window.mouseBeforeCancel === window.sim.agents[0])) fail.push('Escape restarted the session after a previous confirmation');
await page.click('#b-shortcuts');
if (!await visible('#welcome')) fail.push('Help dialog did not open');
await page.keyboard.press('r');
if (!await page.evaluate(() => window.mouseBeforeCancel === window.sim.agents[0])) fail.push('A simulation shortcut ran inside the help dialog');
await page.keyboard.press('Escape');
if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT.replace('.png', '-tools.png') });
fail.push(...await checkReport(page));

// Optional panels must open on the first click, close, and stay in sync with
// both the Panels menu and the toolbar.
for (const [tab, button, card] of [['Explore', '#b-boxes', '#boxes'], ['Tools', '#b-mortality', '#mortality']]) {
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await page.click(button);
  if (!await visible(card)) fail.push(`${card} did not open on the first click`);
  if (card === '#boxes') {
    const before = await page.locator(card).boundingBox();
    if (before.x !== 12 || before.y !== 12) fail.push('Nine cages did not open in the platform corner');
    const title = await page.locator(`${card} .panel-fold`).boundingBox();
    await page.mouse.move(title.x + 40, title.y + title.height / 2);
    await page.mouse.down();
    await page.mouse.move(title.x + 200, title.y + title.height / 2 + 100, { steps: 3 });
    await page.mouse.up();
    const after = await page.locator(card).boundingBox();
    if (after.x <= before.x + 100 || after.y <= before.y + 60 || !await visible(`${card} .body`)) fail.push('Dragging a popup did not move it independently, or collapsed its body');
    await page.locator(`${card} .popup-reset`).click();
    const reset = await page.locator(card).boundingBox();
    if (reset.x !== 12 || reset.y !== 12) fail.push('Reset position did not restore the cage corner');
    await page.locator(`${card} .panel-minimize`).click();
    if (await visible(`${card} .body`) || await visible(`${card} .popup-toolbar`)) fail.push('Minimize left popup content visible');
    await page.locator(`${card} .panel-minimize`).click();
    if (!await visible(`${card} .body`)) fail.push('Expand did not restore the popup body');
  }
  await page.locator(`${card} .panel-close`).click();
  if (await visible(card)) fail.push(`${card} did not close`);
}
const sidebarHeight = await page.locator('.sidebar-content').evaluate((node) => node.scrollHeight);
await page.click('#b-panels');
if (await page.locator('.sidebar-content').evaluate((node) => node.scrollHeight) !== sidebarHeight) fail.push('Opening panel settings changed the sidebar layout');
const settings = await page.locator('#panel-menu').boundingBox();
const platform = await page.locator('#world-pane').boundingBox();
if (!settings || settings.x < platform.x || settings.x + settings.width > platform.x + platform.width) fail.push('Panel settings did not float over the platform');
if (settings.y !== platform.y + 12) fail.push('Panel settings did not open at the top edge');
await page.getByRole('button', { name: 'Brain', exact: true }).click();
if (await page.getByRole('menuitemcheckbox').count() !== 5) fail.push('Brain panel category did not filter the settings');
await page.getByRole('button', { name: 'Charts', exact: true }).click();
if (await page.getByRole('menuitemcheckbox').count() !== 3) fail.push('Charts panel category did not filter the settings');
await page.getByRole('button', { name: 'Platform', exact: true }).click();
await page.getByRole('menuitemcheckbox', { name: /Activity feed/ }).click();
if (!await visible('#feed')) fail.push('event feed did not open from the Panels menu');
await page.waitForFunction(() => document.getElementById('feed').classList.contains('is-floating'));
const feed = await page.locator('#feed').boundingBox();
if (feed.x < settings.x + settings.width && feed.x + feed.width > settings.x
  && feed.y < settings.y + settings.height && feed.y + feed.height > settings.y) fail.push('Popups overlap even though they fit side by side');
await page.keyboard.press('Escape');
if (await visible('#panel-menu') || !await visible('#feed')) fail.push('Escape did not close just the active popup');
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => !!window.sim);
if (!await visible('#feed')) fail.push('panel choice was not remembered after reload');
await page.getByRole('tab', { name: 'Tools', exact: true }).click();
await page.click('#b-panels');
await page.getByRole('button', { name: 'Show all', exact: true }).click();
if (!await visible('#footer')) fail.push('show all did not restore the bottom charts');
await page.click('#b-clean');
await page.keyboard.press('Escape');
await clean();

await page.setViewportSize({ width: 390, height: 844 });
const mobileWorld = await page.locator('#world').boundingBox();
if (!mobileWorld || mobileWorld.width < 300 || await page.locator('#b-mobile-menu').getAttribute('aria-expanded') !== 'false') {
  fail.push('narrow screen does not start with a clear platform and collapsed controls');
}
await page.click('#b-mobile-menu');
await page.getByRole('tab', { name: 'Tools', exact: true }).click();
await page.click('#b-panels');
const panelMenu = await page.locator('#panel-menu').boundingBox();
if (!panelMenu || panelMenu.x < 12 || panelMenu.x + panelMenu.width > mobileWorld.width - 11 || await page.locator('#b-mobile-menu').getAttribute('aria-expanded') !== 'false') {
  fail.push('Mobile panel settings did not float inside the platform with the drawer closed');
}
await page.click('#panel-menu-close');
await page.click('#b-mobile-menu');
await page.click('#b-clean');
const mobileMouse = await page.locator('#ui-mouse').boundingBox();
const mobileHeader = await page.locator('#topbar').boundingBox();
if (!mobileMouse || mobileMouse.y < mobileHeader.y + mobileHeader.height) fail.push('Switching tabs left the selected mouse scrolled behind the header');
if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT.replace('.png', '-mobile.png') });
await page.keyboard.press('Escape');
if (await page.locator('#b-mobile-menu').getAttribute('aria-expanded') !== 'false') fail.push('Escape did not close the mobile menu');
await page.click('#b-mobile-menu');
await page.click('#b-boxes');
if (await page.locator('#b-mobile-menu').getAttribute('aria-expanded') !== 'false') fail.push('Opening a mobile panel did not dismiss the controls');
const cages = await page.locator('#boxes').boundingBox();
if (!cages || cages.x !== 12 || cages.y !== 12 || cages.x + cages.width > mobileWorld.width) fail.push('Mobile cage panel is outside the platform corner');
await page.locator('#boxes .panel-close').click();
await page.click('#b-mobile-menu');
await page.getByRole('tab', { name: 'Explore', exact: true }).click();
await page.click('#b-anatomy');
await page.waitForFunction(() => !!window.sim.anatomy.model);
const mobileAnatomy = await page.locator('#anatomy').boundingBox();
if (!mobileAnatomy || mobileAnatomy.x < 12 || mobileAnatomy.x + mobileAnatomy.width > mobileWorld.width - 11
  || await page.locator('#b-mobile-menu').getAttribute('aria-expanded') !== 'false') {
  fail.push('Mobile anatomy popup did not stay inside the platform with the drawer closed');
}
await page.locator('#anatomy .panel-close').click();
for (const e of errors) fail.push(e);

console.log(JSON.stringify({ ...state, pulse: `${before}  ->  ${later}` }, null, 1));
await browser.close();

if (fail.length) {
  console.error('\nFAILED:');
  for (const f of fail) console.error(` - ${f}`);
  process.exit(1);
}
console.log('\nthe page loads, mounts and runs clean');
