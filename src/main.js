/**
 * mylovely-mice — two mice in a 3-D open field, each wired to its own running
 * model of its brain.
 *
 * Run from a local web server (ES modules and fetch() do not work over file://):
 *   python3 -m http.server 8000
 *
 * Spatial convention for every 2-D panel: +z ("north") is up, +x is to the left,
 * matching the overhead camera. A right-handed scene with y up cannot put both
 * +x right and +z up in an overhead view, so the panels follow the camera.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Arena } from './world/arena.js';
import { Mouse, MAX_RUN } from './world/mouse.js';
import { Brain, DAY, GESTATION } from './neuro/brain.js';
import { Litter, NEST_R } from './world/pups.js';
import { BrainView } from './view/brainview.js';
import { Raster, Trace, drawRateMap, drawPolar } from './view/plots.js';
import { SLOT } from './view/palette.js';
import { ROLES, ORDER, GROUPS } from './neuro/regions.js';

const $ = (id) => document.getElementById(id);
/** the "no optogenetic drive" object, shared so it never allocates */
const NO_DRIVE = Object.freeze({});
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// ----------------------------------------------------------------- 3-D world
const worldCanvas = $('world');
const renderer = new THREE.WebGLRenderer({ canvas: worldCanvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Shadows re-render every caster in the scene. At 20 Hz instead of 60 the lag is
// invisible on a mouse-sized animal and the saving is large.
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a0e);
scene.fog = new THREE.Fog(0x070a0e, 2.4, 6.5);

const camera = new THREE.PerspectiveCamera(46, 1, 0.01, 60);
camera.position.set(0.55, 0.5, 0.9);

const controls = new OrbitControls(camera, worldCanvas);
controls.target.set(0, 0.04, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.18;
controls.maxDistance = 3.2;
controls.maxPolarAngle = Math.PI / 2.04;
controls.enabled = false;

const arena = new Arena(scene);
arena.setLight(0.35);
const litter = new Litter(scene, arena);
litter.onWean = (pup) => {
  // the parents stop counting it as a pup, and it becomes a mouse of its own
  const parents = pup.owner ? [pup.owner, pup.owner.lastSire].filter(Boolean) : agents;
  for (const g of parents) g.brain.pupCount = Math.max(0, g.brain.pupCount - 1);
  matureInto(pup);
  if (litter.count === 0) {
    for (const g of agents) g.brain.lactating = false;
    logEvent('state', `the litter is <b>fully weaned</b> — ${litter.weaned} raised`);
    buildColonyCards();
  }
};
litter.onEyesOpen = (p) => {
  if (p.id % 97 === 0 || litter.pups.indexOf(p) === 0) {
    logEvent('sensory', `the pups' <b>eyes have opened</b> — day ${(p.age / DAY).toFixed(0)}`);
  }
};

// ----------------------------------------------------------------- the colony
const MAX_COLONY = 8;          // past this the cage is full and juveniles disperse
const ADULT_DAY = 42;          // mice reach sexual maturity at about six weeks
const WEAN_DAY = 21;
let seedSeq = 40;
const nameCount = { M: 0, F: 0 };

/** how big an animal is for its age: weanling to full size over three weeks */
function sizeForAge(days) {
  if (days >= ADULT_DAY) return 1;
  return 0.45 + 0.55 * clamp((days - WEAN_DAY) / (ADULT_DAY - WEAN_DAY), 0, 1);
}

/** one animal: a body in the arena and its own brain */
function makeAgent({ sex, name, x, z, heading, fur, belly, ageDays = 70, seed }) {
  const brain = new Brain({ arena: arena.size, sex, name, seed: seed ?? (sex === 'M' ? 7 : 23) });
  const mouse = new Mouse(scene, arena);
  mouse.x = x; mouse.z = z; mouse.heading = heading;
  // tint without touching the rig itself
  mouse.mats.fur.color.set(fur);
  mouse.mats.belly.color.set(belly);
  // the rig has its own idle autopilot; this session steers instead, so that
  // immobility (and therefore sharp-wave ripples and mating bouts) is preserved
  if (typeof mouse.setAutopilot === 'function') mouse.setAutopilot(false);
  return {
    brain, mouse, sex, name,
    auto: false,
    ageDays,
    mature: ageDays >= ADULT_DAY,
    wander: null, wanderT: 0, fleeUntil: 0, opto: NO_DRIVE,
    drinkT: 0, eatCount: 0,
    state: 'RESTING',
    home: { x, z, heading },
  };
}

/** a weaned pup grows up and joins the colony */
function matureInto(pup) {
  if (agents.length >= MAX_COLONY) {
    logEvent('state', `a weaned ${pup.sex === 'M' ? 'male' : 'female'} left the cage — <b>the colony is full</b> (${MAX_COLONY})`);
    return null;
  }
  const sex = pup.sex || (Math.random() < 0.5 ? 'M' : 'F');
  nameCount[sex]++;
  const name = `${sex === 'M' ? 'male' : 'female'} ${nameCount[sex]}`;
  // offspring colouring sits between the parents', with a little variation
  const base = sex === 'M' ? 0xa89d8e : 0xcfbfc4;
  const jitter = (c, k) => {
    const col = new THREE.Color(c);
    col.offsetHSL((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * k);
    return col.getHex();
  };
  const ag = makeAgent({
    sex, name, x: pup.x, z: pup.z, heading: Math.random() * Math.PI * 2,
    fur: jitter(base, 0.07), belly: jitter(sex === 'M' ? 0xe4ded5 : 0xf2ebe8, 0.05),
    ageDays: WEAN_DAY, seed: ++seedSeq,
  });
  ag.auto = true;
  agents.push(ag);
  buildColonyCards();
  logEvent('state', `a pup <b>grew up</b> — ${name} joins the colony (${agents.length} mice)`);
  return ag;
}

const agents = [
  makeAgent({ sex: 'M', name: 'male', x: -0.35, z: -0.35, heading: Math.PI * 0.25, fur: 0xa89d8e, belly: 0xe4ded5 }),
  makeAgent({ sex: 'F', name: 'female', x: 0.36, z: 0.3, heading: -Math.PI * 0.7, fur: 0xcfbfc4, belly: 0xf2ebe8 }),
];
let player = 0;
agents[1].auto = true;
nameCount.M = 1; nameCount.F = 1;
const A = () => agents[player];

/** the closest other animal, or null if this one is alone */
function nearestOther(i) {
  const m = agents[i].mouse;
  let best = null, bd = Infinity;
  for (let k = 0; k < agents.length; k++) {
    if (k === i) continue;
    const d = Math.hypot(agents[k].mouse.x - m.x, agents[k].mouse.z - m.z);
    if (d < bd) { bd = d; best = agents[k]; }
  }
  return best;
}
const other = (i) => nearestOther(i);

// mating bout bookkeeping
let mateTimer = 0, mateRefractory = 0, mateBout = 0;
let matePair = new Set();

// ----------------------------------------------------------------- brain view
const brainView = new BrainView($('brain'), $('brain-tip'));
let brainReady = false;
brainView.onProgress = (n, total) => { $('brain-hint').textContent = `loading atlas ${n}/${total}`; };
brainView.load('./data/mouse_brain_ccf.json')
  .then(() => {
    brainReady = true;
    brainView.select('CA1');
    $('brain-hint').textContent = 'drag to rotate · click a region';
  })
  .catch((err) => {
    $('brain-hint').textContent = '';
    $('insp').innerHTML = `<div class="nm">brain atlas not loaded</div>
      <div class="meta">${String(err.message || err)}</div>
      <div class="role">The Allen CCF mesh file is fetched over HTTP. Serve the folder
      rather than opening the file directly:<br>
      <code style="color:var(--accent)">python3 -m http.server 8000</code></div>`;
  });

// ----------------------------------------------------------------- panels
const raster = new Raster($('raster'), $('raster-legend'));
const lfpTrace = new Trace($('lfp'), [{
  label: 'CA1 LFP', color: SLOT.spatial, min: -2.1, max: 2.1,
  get: (b) => b.lfp, shadeRipple: true,
}], { window: 6 });
const daTrace = new Trace($('da'), [
  { label: 'VTA Hz', color: SLOT.reward, min: 0, max: 45, get: (b) => b.daRate, baseline: 5 },
  { label: 'V(s)', color: SLOT.state, min: 0, max: 1.05, get: (b) => b.valueNorm },
], { window: 14 });

// ----------------------------------------------------------------- population list
const SYSTEMS = ['sensory', 'spatial', 'motor', 'reward', 'state'];
let selected = 'CA1';          // declared here: renderPopList() below reads it
const popsEl = $('pops');
const rows = {};
let popFilter = 'all';

// filter chips, so 37 regions can be narrowed to one system at a time
const chipsEl = $('chips');
for (const k of ['all', ...SYSTEMS]) {
  const c = document.createElement('button');
  c.className = 'chip' + (k === 'all' ? ' on' : '');
  c.textContent = k === 'all' ? 'all' : GROUPS[k].label;
  if (k !== 'all') { c.style.borderColor = SLOT[k]; c.dataset.col = SLOT[k]; }
  c.onclick = () => {
    popFilter = k;
    for (const o of chipsEl.children) {
      o.classList.toggle('on', o === c);
      o.style.background = o === c && o.dataset.col ? o.dataset.col : 'transparent';
      if (o === c && o.dataset.col) o.style.color = '#06211d';
      else o.style.color = '';
    }
    renderPopList();
  };
  chipsEl.appendChild(c);
}

function renderPopList() {
  popsEl.textContent = '';
  for (const sys of SYSTEMS) {
    if (popFilter !== 'all' && popFilter !== sys) continue;
    const members = ORDER.filter((a) => ROLES[a].group === sys);
    if (!members.length) continue;
    const h = document.createElement('div');
    h.className = 'gname';
    h.textContent = GROUPS[sys].label;
    h.style.color = SLOT[sys];
    popsEl.appendChild(h);
    for (const acr of members) {
      const role = ROLES[acr];
      const div = document.createElement('div');
      div.className = 'prow' + (acr === selected ? ' sel' : '');
      div.title = role.short;
      div.innerHTML = `<span class="ac" style="color:${SLOT[sys]}">${acr}</span>
        <span class="lb">${role.short}</span>
        <span class="tr"><span class="fl" style="background:${SLOT[sys]}"></span></span>
        <span class="hz">0</span>`;
      div.onclick = () => selectRegion(acr);
      popsEl.appendChild(div);
      rows[acr] = { el: div, fill: div.querySelector('.fl'), hz: div.querySelector('.hz') };
    }
  }
}
renderPopList();

// the full list is folded away by default - the "busiest right now" card is the way in
$('pop-head').onclick = () => {
  const card = $('pop-card');
  card.classList.toggle('folded');
  $('pop-tw').textContent = card.classList.contains('folded') ? 'show \u25b8' : 'hide \u25be';
};

// ----------------------------------------------------------------- busiest regions
const activeEl = $('active-list');
const activeRows = [];
for (let i = 0; i < 5; i++) {
  const d = document.createElement('div');
  d.className = 'arow';
  d.innerHTML = `<span class="ac"></span><span class="lb"></span><span class="hz"></span>`;
  activeEl.appendChild(d);
  activeRows.push({ el: d, ac: d.querySelector('.ac'), lb: d.querySelector('.lb'), hz: d.querySelector('.hz') });
}
const activeSmooth = {};
function renderActive(act, brain) {
  for (const a of ORDER) {
    activeSmooth[a] = (activeSmooth[a] || 0) * 0.88 + (act[a] ?? 0) * 0.12;
  }
  const top = ORDER.slice().sort((a, b) => activeSmooth[b] - activeSmooth[a]).slice(0, 5);
  top.forEach((acr, i) => {
    const r = activeRows[i], role = ROLES[acr];
    const pops = brain.byRegion[acr] || [];
    const hz = pops.length ? pops.reduce((x, p) => x + p.smooth, 0) / pops.length : 0;
    r.ac.textContent = acr;
    r.ac.style.color = SLOT[role.group];
    r.lb.textContent = role.short;
    r.hz.textContent = `${hz < 10 ? hz.toFixed(1) : Math.round(hz)}`;
    r.el.onclick = () => selectRegion(acr);
  });
}

function selectRegion(acr) {
  selected = acr;
  for (const [k, r] of Object.entries(rows)) r.el.classList.toggle('sel', k === acr);
  if (brainReady) brainView.select(acr);
  renderInspector();
}
brainView.onSelect = (acr) => {
  selected = acr;
  for (const [k, r] of Object.entries(rows)) r.el.classList.toggle('sel', k === acr);
  renderInspector();
};
function renderInspector() {
  const role = ROLES[selected];
  const info = brainView.regions?.[selected]?.info;
  if (!role) return;
  $('insp').innerHTML = `
    <div class="nm" style="color:${SLOT[role.group]}">${selected} <span style="color:var(--ink3);font-weight:400">· ${info?.name || ''}</span></div>
    <div class="plain">${role.short}</div>
    <div class="meta">Allen CCF id ${info?.id ?? '—'} · ${GROUPS[role.group].label} · ${A().name}</div>
    <div class="role">${role.role}</div>
    <div class="ref">${role.ref}</div>
    <div class="live" id="insp-live">${A().brain.liveLine(selected)}</div>`;
}
selectRegion('CA1');

// ----------------------------------------------------------------- colony panel
const cgrid = $('cgrid');
const DRIVE_COLOR = { hunger: SLOT.reward, thirst: SLOT.sensory, mate: SLOT.state };
let cards = [];

/** the colony grows, so this is rebuilt whenever its membership changes */
function buildColonyCards() {
  cgrid.textContent = '';
  cards = agents.map((ag, i) => {
    const el = document.createElement('div');
    el.className = 'crow';
    el.innerHTML = `
      <div class="ctop">
        <span class="sx" style="color:${ag.sex === 'M' ? '#6aa6ff' : '#e58fb4'}">${ag.sex === 'M' ? '\u2642' : '\u2640'}</span>
        <span class="nm">${ag.name}</span>
        <span class="age" data-age>adult</span>
        <span class="st" data-state>resting</span>
        <span class="you" data-you>you</span>
      </div>
      <div class="bars">
        <span class="bar" title="appetite"><i data-d="hunger"></i></span>
        <span class="bar" title="thirst"><i data-d="thirst"></i></span>
        <span class="bar" title="mating drive"><i data-d="mate"></i></span>
      </div>
      <div class="rep" data-repro></div>`;
    el.onclick = () => takeControl(i);
    cgrid.appendChild(el);
    const fills = Object.fromEntries([...el.querySelectorAll('[data-d]')].map((n) => [n.dataset.d, n]));
    for (const [k, n] of Object.entries(fills)) n.style.background = DRIVE_COLOR[k];
    return {
      el,
      you: el.querySelector('[data-you]'),
      age: el.querySelector('[data-age]'),
      state: el.querySelector('[data-state]'),
      repro: el.querySelector('[data-repro]'),
      fills,
    };
  });
}
buildColonyCards();

function takeControl(i) {
  if (i === player || i < 0 || i >= agents.length) return;
  player = i;
  agents.forEach((ag, k) => { ag.auto = k !== player; });
  raster.clear();
  lfpTrace.i = 0;
  daTrace.i = 0;
  $('b-auto').classList.toggle('on', agents[player].auto);
  renderInspector();
}

// ----------------------------------------------------------------- optogenetics
let optics = { apply: () => NO_DRIVE, drivesFor: () => NO_DRIVE };
import('./optogenetics.js')
  .then((mod) => {
    optics = mod.mountOptics({
      getBrain: () => A().brain,
      getBrains: () => agents.map((g) => g.brain),
    });
    // surface it in the toolbar: a pill floating over the arena is easy to miss,
    // and the toolbar is where every other mode switch already lives
    const btn = $('b-optics');
    if (btn && typeof optics.open === 'function') {
      btn.style.display = '';
      btn.onclick = () => optics.open(!opticsOpen());
    }
    logEvent('sensory', 'optogenetics rig loaded — the <b>optogenetics</b> button, or <b>G</b>');
  })
  .catch((err) => console.warn('optogenetics module unavailable:', err.message));

/** is the optogenetics card currently showing? (it owns its own markup) */
function opticsOpen() {
  const card = document.getElementById('optics');
  return !!card && card.style.display !== 'none';
}

/** an optogenetically driven attack, and the victim fleeing it */
function stepAggression(dt) {
  for (let i = 0; i < agents.length; i++) {
    const ag = agents[i], vic = other(i);
    const agg = (ag.opto && ag.opto.aggression) || 0;
    if (!vic || agg < 0.45) { ag.attackT = 0; continue; }
    const d = Math.hypot(ag.mouse.x - vic.mouse.x, ag.mouse.z - vic.mouse.z);
    if (d < 0.08) {
      ag.attackT = (ag.attackT || 0) + dt;
      if (ag.attackT > 0.7) {
        ag.attackT = 0;
        ag.attacks = (ag.attacks || 0) + 1;
        vic.fleeUntil = sessionT + 4;
        vic.brain.bump = 1;              // the victim registers it as a threat
        logEvent('state', `<b>${ag.name}</b> lunged at <b>${vic.name}</b> — VMHvl-driven attack`);
      }
    } else ag.attackT = 0;
  }
}

// ----------------------------------------------------------------- event feed
/**
 * A plain-language running commentary. Without this the panels are just moving
 * numbers; this says what the mouse just did and what its brain did about it.
 */
const feedList = $('feed-list');
const feedRows = [];
function logEvent(group, html) {
  const el = document.createElement('div');
  el.className = 'ev';
  el.style.borderLeftColor = SLOT[group] || 'var(--line2)';
  el.innerHTML = `<time>${fmtTime(sessionT)}</time><span>${html}</span>`;
  const empty = $('feed-empty');
  if (empty) empty.remove();
  feedList.prepend(el);
  feedRows.unshift(el);
  while (feedRows.length > 5) feedRows.pop().remove();
  feedRows.forEach((r, i) => r.classList.toggle('fade', i >= 3));
}

// previous-frame values, so transitions can be spotted
const was = { ripple: false, oestrus: false };
function watchEvents(dt) {
  const ag = A(), b = ag.brain;
  if (b.ripple.active && !was.ripple) {
    const secs = (b.ripple.path.length * 0.05).toFixed(1);
    logEvent('spatial', `<b>${ag.name}</b> paused — hippocampus replayed the last <b>${secs} s</b> of path ${b.ripple.dir < 0 ? 'backwards' : 'forwards'}`);
  }
  was.ripple = b.ripple.active;

  const fem = agents.find((g) => g.sex === 'F' && g.mature) || agents.find((g) => g.sex === 'F');
  const oe = fem ? fem.brain.estrous > 0.5 : false;
  if (oe !== was.oestrus) {
    logEvent('state', oe ? 'the <b>female</b> entered oestrus — now receptive'
                         : 'the <b>female</b> left oestrus — no longer receptive');
  }
  was.oestrus = oe;

  agents.forEach((g) => {
    const hungry = g.brain.drives.eat && g.brain.hunger > 0.85;
    if (hungry && !g.wasHungry) {
      logEvent('state', `<b>${g.name}</b> is very hungry — AgRP hunger neurons at <b>${g.brain.byKey.arh.smooth.toFixed(0)} Hz</b>`);
    }
    g.wasHungry = hungry;
    const thirsty = g.brain.drives.drink && g.brain.thirst > 0.85;
    if (thirsty && !g.wasThirsty) {
      logEvent('state', `<b>${g.name}</b> is very thirsty — thirst neurons at <b>${g.brain.byKey.sfo.smooth.toFixed(0)} Hz</b>`);
    }
    g.wasThirsty = thirsty;
  });
}

// ----------------------------------------------------------------- cell pickers
const sel = { place: 0, grid: 0, hd: 0, auto: true };
for (const [id, key] of [['cap-place', 'place'], ['cap-grid', 'grid'], ['cap-hd', 'hd']]) {
  const el = $(id);
  el.style.cursor = 'pointer';
  el.title = 'click for another cell';
  el.onclick = () => { sel[key] = (sel[key] + 1) % A().brain.byKey[key].n; sel.auto = false; };
}
/**
 * Finding the best-sampled cell means building a rate map per cell, which is far
 * too expensive to do for every cell at once (that was a visible stall every few
 * seconds). Scan a few cells per call instead and commit when a sweep completes.
 */
const scan = {
  place: { i: 0, best: -1, bestI: 0 },
  grid: { i: 0, best: -1, bestI: 0 },
  hd: { i: 0, best: -1, bestI: 0 },
};
const SCAN_PER_CALL = 6;
function autoPickCells() {
  const brain = A().brain;
  for (const key of ['place', 'grid', 'hd']) {
    const p = brain.byKey[key];
    const st = scan[key];
    for (let k = 0; k < SCAN_PER_CALL; k++) {
      const i = st.i % p.n;
      const peak = key === 'hd' ? brain.hdTuning('hd', i).peak : brain.rateMap(key, i).peak;
      if (peak > st.best) { st.best = peak; st.bestI = i; }
      st.i++;
      if (st.i % p.n === 0) {           // sweep finished - commit and start over
        sel[key] = st.bestI;
        st.best = -1;
      }
    }
  }
}

// ----------------------------------------------------------------- input
const keys = Object.create(null);
const input = { throttle: 0, turn: 0, run: false, sniff: false };
let paused = false;
let camMode = 'follow';
const CAM_MODES = ['follow', 'orbit', 'top'];

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (keys[k]) return;
  keys[k] = true;
  if (k === 'c') cycleCamera();
  if (k === 'p') togglePause();
  if (k === 'r') doReset();
  if (k === 'v') toggleValue();
  if (k === 't') toggleTrail();
  if (k === 'h') toggleHelp();
  if (k === '?' || (k === '/' && e.shiftKey)) showWelcome(true);
  if (k === 'escape') showWelcome(false);
  if (k === 'm') rotateCue();
  if (k === 'x') takeControl((player + 1) % agents.length);
  if (k === 'o') toggleAuto();
  if (k === '[') setLight(arena.lightLevel - 0.12);
  if (k === ']') setLight(arena.lightLevel + 0.12);
  if (k === '-') setWater(arena.waterLevel - 0.12);
  if (k === '=') setWater(arena.waterLevel + 0.12);
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function readInput() {
  const f = (keys.w || keys.arrowup) ? 1 : 0;
  const b = (keys.s || keys.arrowdown) ? 1 : 0;
  const l = (keys.a || keys.arrowleft) ? 1 : 0;
  const r = (keys.d || keys.arrowright) ? 1 : 0;
  input.throttle = f - b * 0.55;
  input.turn = r - l;
  input.run = !!keys.shift;
  input.sniff = !!keys[' '];
}

// ----------------------------------------------------------------- environment
function setLight(v) {
  arena.setLight(clamp(v, 0, 1));
  $('sl-light').value = Math.round(arena.lightLevel * 100);
  $('lab-light').textContent = `${Math.round(arena.lightLevel * 100)}%`;
}
function setWater(v) {
  arena.setWater(clamp(v, 0, 1));
  const w = arena.waterLevel;
  $('sl-water').value = Math.round(w * 100);
  $('lab-water').textContent = w < 0.02 ? 'dry' : w < 0.35 ? 'shallow' : w < 0.7 ? 'wading' : 'deep';
}
$('sl-light').oninput = (e) => setLight(e.target.value / 100);
$('sl-water').oninput = (e) => setWater(e.target.value / 100);
$('sl-light').onchange = () => logEvent('sensory',
  `light set to <b>${Math.round(arena.lightLevel * 100)}%</b>` +
  (arena.lightLevel > 0.7 ? ' — bright and aversive, they will hug the walls' : ''));
$('sl-water').onchange = () => logEvent('sensory',
  `water <b>${$('lab-water').textContent}</b>` +
  (arena.waterLevel > 0.5 ? ' — wading is slow and raises stress' : ''));

const DRIVE_BTN = { eat: 'b-eat', drink: 'b-drink', mate: 'b-mate' };
const DRIVE_WORD = { eat: 'eating', drink: 'drinking', mate: 'mating' };
const DRIVE_OFF = {
  eat: 'the hunger circuit is silent — they cannot eat',
  drink: 'the thirst circuit is silent — they cannot drink',
  mate: 'the mating circuit is silent — mating is impossible',
};
function toggleDrive(k) {
  const on = !agents[0].brain.drives[k];
  for (const ag of agents) ag.brain.drives[k] = on;
  const el = $(DRIVE_BTN[k]);
  el.classList.toggle('on', on);
  el.querySelector('.st').textContent = on ? 'on' : 'off';
  logEvent('state', on ? `<b>${DRIVE_WORD[k]}</b> switched back on`
                       : `<b>${DRIVE_WORD[k]}</b> switched off — ${DRIVE_OFF[k]}`);
}
for (const k of Object.keys(DRIVE_BTN)) $(DRIVE_BTN[k]).onclick = () => toggleDrive(k);

// ----------------------------------------------------------------- toolbar
function cycleCamera() {
  camMode = CAM_MODES[(CAM_MODES.indexOf(camMode) + 1) % CAM_MODES.length];
  $('b-cam').textContent = `camera: ${camMode}`;
  controls.enabled = camMode === 'orbit';
  camera.up.set(0, camMode === 'top' ? 0 : 1, camMode === 'top' ? 1 : 0);
  if (camMode === 'orbit') {
    controls.target.set(0, 0.04, 0);
    camera.position.set(0.72, 0.62, 1.05);
  }
}
function togglePause() {
  paused = !paused;
  $('b-pause').classList.toggle('on', paused);
  $('b-pause').textContent = paused ? 'paused' : 'pause';
}
function toggleValue() {
  arena.valueMesh.visible = !arena.valueMesh.visible;
  $('b-value').classList.toggle('on', arena.valueMesh.visible);
  if (arena.valueMesh.visible) arena.drawValue(A().brain.valueField());
}
function toggleTrail() {
  arena.trail.visible = !arena.trail.visible;
  $('b-trail').classList.toggle('on', arena.trail.visible);
}
function toggleAuto() {
  const ag = A();
  ag.auto = !ag.auto;
  $('b-auto').classList.toggle('on', ag.auto);
}
function toggleHelp() {
  $('keys').toggleAttribute('data-collapsed');
}
function showWelcome(on) {
  $('welcome').classList.toggle('hide', !on);
}
function rotateCue() {
  arena.rotateCue(Math.PI / 2);
  for (const ag of agents) ag.brain.rotateCompass(Math.PI / 2);
  logEvent('spatial', 'cue card turned 90° — the head-direction compass turned with it');
}
function doReset() {
  for (const ag of agents) {
    ag.mouse.reset();
    ag.mouse.x = ag.home.x; ag.mouse.z = ag.home.z; ag.mouse.heading = ag.home.heading;
    ag.brain.reset();
    ag.eatCount = 0; ag.drinkT = 0;
  }
  arena.reset();
  for (const ag of agents) {
    ag.moveTarget = null; ag.pendingEat = null;
    ag.carrying = null; ag.nurseT = 0; ag.nursingNow = false; ag.halfway = false;
    ag.fleeUntil = 0; ag.attackT = 0; ag.attacks = 0; ag.opto = NO_DRIVE;
  }
  litter.reset();
  heldPup = null;
  // send the grown-up offspring away and restore the founding pair
  while (agents.length > 2) {
    const ag = agents.pop();
    scene.remove(ag.mouse.root);
  }
  nameCount.M = 1; nameCount.F = 1;
  player = Math.min(player, agents.length - 1);
  for (const ag of agents) { ag.ageDays = 70; ag.mature = true; ag.lastSire = null; }
  buildColonyCards();
  marker.visible = false;
  feedList.textContent = '';
  feedRows.length = 0;
  sessionT = 0;
  mateTimer = mateRefractory = mateBout = matePair = 0;
  sel.auto = true;
  raster.clear();
  lfpTrace.i = 0; daTrace.i = 0;
}
$('b-cam').onclick = cycleCamera;
$('b-pause').onclick = togglePause;
$('b-reset').onclick = doReset;
$('b-value').onclick = toggleValue;
$('b-trail').onclick = toggleTrail;
$('b-help').onclick = () => showWelcome(true);
$('b-cue').onclick = rotateCue;
$('b-auto').onclick = toggleAuto;

// ----------------------------------------------------------------- autopilot
/**
 * The uncontrolled mouse forages on its own: it goes for whichever drive is
 * strongest and currently satisfiable, and wanders along the walls otherwise
 * (mice hug walls — thigmotaxis — especially under bright light).
 */
/** point `ag` at a spot and fill `out` with the commands to get there */
function steerTo(ag, goal, out, urgency = 0.5) {
  const m = ag.mouse;
  const dx = goal.x - m.x, dz = goal.z - m.z;
  const dist = Math.hypot(dx, dz);
  const err = angDiff(Math.atan2(dx, dz), m.heading);
  out.turn = clamp(-err * 2.4, -1, 1);
  out.throttle = dist < 0.045 ? 0 : clamp(1 - Math.abs(err) * 0.45, 0.15, 1);
  out.run = urgency > 0.62 && dist > 0.25 && Math.abs(err) < 0.6;
  out.sniff = dist < 0.09;
  return dist;
}

function driveAuto(ag, dt, out) {
  const b = ag.brain, m = ag.mouse;
  const mate = other(agents.indexOf(ag));
  let goal = null, urgency = 0.45, sniff = false;

  const wantDrink = b.drives.drink ? b.thirst : 0;
  const wantEat = b.drives.eat ? b.hunger : 0;
  const wantMate = b.mateDrive;

  // being attacked, or attacking, overrides every other motive
  const od = ag.opto || NO_DRIVE;
  if (ag.fleeUntil > sessionT && mate) {
    const away = Math.atan2(m.x - mate.mouse.x, m.z - mate.mouse.z);
    goal = { x: clamp(m.x + Math.sin(away) * 0.5, -0.55, 0.55),
             z: clamp(m.z + Math.cos(away) * 0.5, -0.55, 0.55) };
    urgency = 1;
  } else if ((od.aggression || 0) > 0.35 && mate) {
    goal = { x: mate.mouse.x, z: mate.mouse.z };
    urgency = 1;
  }

  // A calling pup outranks almost everything: retrieval is the priority
  // behaviour of a lactating mother unless she is close to starving.
  if (!goal && b.parentalDrive > 0.2 && litter.count && wantEat < 0.92 && wantDrink < 0.92) {
    if (ag.carrying && litter.nest) {
      goal = litter.nest;
      urgency = 0.75;
    } else {
      const stray = litter.nearestStray(m.x, m.z);
      if (stray) {
        goal = { x: stray.pup.x, z: stray.pup.z };
        urgency = 0.8;
      } else if (litter.nest && b.sex === 'F' && b.lactating) {
        goal = litter.nest;                 // go back and brood
        urgency = 0.4;
      }
    }
  }

  if (goal) {
    /* a pup takes precedence */
  } else if (wantDrink > 0.5 && wantDrink >= wantEat) {
    goal = { x: arena.dish.x, z: arena.dish.z };
    urgency = wantDrink;
  } else if (wantEat > 0.3) {
    let best = null, bd = 99;
    for (const c of arena.cheeses) {
      if (c.eaten) continue;
      const d = Math.hypot(c.x - m.x, c.z - m.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) { goal = best; urgency = wantEat; }
  } else if (wantMate > 0.3 && mate && mate.brain.mateDrive > 0.15) {
    goal = { x: mate.mouse.x, z: mate.mouse.z };
    urgency = wantMate;
  }

  if (!goal) {
    ag.wanderT -= dt;
    if (!ag.wander || ag.wanderT <= 0) {
      // prefer the perimeter, more strongly when the lights are up
      const edge = 0.42 + 0.14 * (1 - arena.lightLevel);
      const a = Math.random() * TAU;
      ag.wander = { x: clamp(Math.cos(a) * edge * 1.25, -0.52, 0.52), z: clamp(Math.sin(a) * edge * 1.25, -0.52, 0.52) };
      ag.wanderT = 2.5 + Math.random() * 3;
    }
    goal = ag.wander;
    urgency = 0.35;
  }

  const dist = steerTo(ag, goal, out, urgency);
  if (dist < 0.045) ag.wander = null;
  return out;
}

// ----------------------------------------------------------------- click to move
// Keyboard-only steering is a barrier; clicking a spot is how most people expect
// to move something in a 3-D scene.
const clickRay = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hitPoint = new THREE.Vector3();
// amber, so it is never confused with the teal ring showing where the place
// cells think the mouse is
const marker = new THREE.Mesh(
  new THREE.RingGeometry(0.022, 0.032, 4),
  new THREE.MeshBasicMaterial({ color: 0xe8aa3c, transparent: true, opacity: 0.95, side: THREE.DoubleSide, toneMapped: false }),
);
marker.rotation.z = Math.PI / 4;
marker.rotation.x = -Math.PI / 2;
marker.position.y = 0.005;
marker.visible = false;
scene.add(marker);

let downAt = null;
let heldPup = null;
worldCanvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
worldCanvas.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 5) return;                       // that was a camera drag, not a click
  const r = worldCanvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  clickRay.setFromCamera(ndc, camera);

  // the pup-retrieval test: pick a pup up by hand, drop it away from the nest,
  // and watch whether the mother goes and fetches it
  if (!heldPup) {
    const pup = litter.pickAt(clickRay);
    if (pup) {
      heldPup = pup;
      pup.mesh.scale.multiplyScalar(1.35);
      logEvent('state', `you lifted <b>pup ${pup.id}</b> — click anywhere to put it down`);
      return;
    }
  }
  if (!clickRay.ray.intersectPlane(groundPlane, hitPoint)) return;
  const lim = arena.half - 0.03;
  if (heldPup) {
    const px = clamp(hitPoint.x, -lim, lim), pz = clamp(hitPoint.z, -lim, lim);
    litter.displace(heldPup, px, pz);
    heldPup.mesh.scale.setScalar(heldPup.mesh.scale.x / 1.35);
    const far = litter.nest ? Math.hypot(px - litter.nest.x, pz - litter.nest.z) : 0;
    logEvent('state', far > 0.12
      ? `you put <b>pup ${heldPup.id}</b> down ${(far * 100).toFixed(0)} cm from the nest — it will start calling`
      : `you put <b>pup ${heldPup.id}</b> back in the nest`);
    heldPup = null;
    return;
  }
  const ag = A();
  ag.moveTarget = { x: clamp(hitPoint.x, -lim, lim), z: clamp(hitPoint.z, -lim, lim) };
  ag.auto = false;
  $('b-auto').classList.remove('on');
  marker.position.set(ag.moveTarget.x, 0.005, ag.moveTarget.z);
  marker.visible = true;
});

// ----------------------------------------------------------------- resize
// Reassigning canvas.width tears down and rebuilds the WebGL drawing buffer, so
// this must happen only when the size really changes - never once per frame.
let viewW = 0, viewH = 0, viewDpr = 0;
let dprCap = Math.min(devicePixelRatio || 1, 2);

function applySize(force) {
  const w = worldCanvas.clientWidth, h = worldCanvas.clientHeight;
  const dpr = Math.min(devicePixelRatio || 1, dprCap);
  if (!w || !h) return;
  if (!force && w === viewW && h === viewH && dpr === viewDpr) return;
  viewW = w; viewH = h; viewDpr = dpr;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
function resize() { applySize(false); brainView.resize(); }

if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => resize());
  ro.observe(worldCanvas);
  ro.observe($('brain'));
} else {
  addEventListener('resize', resize);
}
addEventListener('resize', resize);

/**
 * Adaptive resolution: Retina panels cost 4x the pixels of a 1x buffer, which is
 * the difference between smooth and unusable on an integrated GPU. Drop the
 * pixel ratio when frames get expensive and restore it when they are cheap.
 */
let fpsAcc = 0, fpsFrames = 0;
function adaptResolution(dt) {
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc < 1.5) return;
  const fps = fpsFrames / fpsAcc;
  fpsAcc = 0; fpsFrames = 0;
  const maxDpr = Math.min(devicePixelRatio || 1, 2);
  if (fps < 40 && dprCap > 1) {
    dprCap = Math.max(1, dprCap - 0.5);
    applySize(true);
  } else if (fps > 57 && dprCap < maxDpr) {
    dprCap = Math.min(maxDpr, dprCap + 0.5);
    applySize(true);
  }
}

// ----------------------------------------------------------------- the loop
const fwd = new THREE.Vector3();
const camWant = new THREE.Vector3();
const camLook = new THREE.Vector3();
const autoCmd = { throttle: 0, turn: 0, run: false, sniff: false };
let last = performance.now();
let sessionT = 0;
let mapAcc = 0, valueAcc = 0, hudAcc = 0, autoAcc = 0;
let shadowAcc = 0, brainAcc = 0;
let activation = {};
let brainVisible = true;

// the brain panel can be scrolled out of view - do not pay for it when it is
if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver((es) => { brainVisible = es[0].isIntersecting; },
    { threshold: 0.01 }).observe($('brain'));
}
let lastSwr = -9;

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function stepAgent(ag, i, dt) {
  const b = ag.brain, m = ag.mouse;
  let cmd;
  if (ag.auto) {
    cmd = driveAuto(ag, dt, autoCmd);
  } else {
    readInput();
    if (input.throttle || input.turn) ag.moveTarget = null;   // the keys take over
    if (ag.moveTarget) {
      const left = steerTo(ag, ag.moveTarget, autoCmd, 0.5);
      if (left < 0.05) ag.moveTarget = null;
      cmd = autoCmd;
    } else {
      cmd = input;
    }
  }

  // a mating bout holds both animals still
  const inBout = mateBout > 0 && matePair.has(ag);
  const eff = inBout
    ? { throttle: 0, turn: 0, run: false, sniff: true }
    : { throttle: cmd.throttle, turn: cmd.turn, run: cmd.run, sniff: cmd.sniff };
  // wading through water is hard work
  eff.throttle *= 1 - 0.6 * arena.waterLevel;
  // optogenetically induced freezing stops the animal dead
  const od = ag.opto || NO_DRIVE;
  if ((od.freeze || 0) > 0.5) { eff.throttle = 0; eff.turn = 0; }
  if (od.locomotor) eff.throttle = clamp(eff.throttle + od.locomotor * 0.6, -1, 1);
  if (od.turnBias) eff.turn = clamp(eff.turn + od.turnBias, -1, 1);

  m.update(dt, eff, b);

  const nx = m.x + Math.sin(m.heading) * 0.032;
  const nz = m.z + Math.cos(m.heading) * 0.032;

  // ---- eating ----
  let ate = null;
  if (b.drives.eat) {
    ate = arena.tryEat(nx, nz, 0.05);
    if (ate) {
      m.onEat();
      ag.eatCount++;
      ag.pendingEat = { t: sessionT, peak: 0 };   // report the burst once it has risen
    }
  }
  if (ag.pendingEat) {
    ag.pendingEat.peak = Math.max(ag.pendingEat.peak, b.daRate);
    if (sessionT - ag.pendingEat.t > 0.6) {
      const pk = ag.pendingEat.peak;
      logEvent('reward', `<b>${ag.name}</b> ate cheese — dopamine ` +
        (pk > 14 ? `burst to <b>${pk.toFixed(0)} Hz</b>` : `barely moved (<b>${pk.toFixed(0)} Hz</b>) — it saw this coming`));
      ag.pendingEat = null;
    }
  }

  // ---- drinking ----
  const atWater = arena.atWater(nx, nz);
  let drank = false;
  if (b.drives.drink && atWater && b.thirst > 0.06 && m.speed < 0.08) {
    ag.drinkT += dt;
    if (ag.drinkT > 0.9) {
      ag.drinkT = 0; drank = true;
      logEvent('state', `<b>${ag.name}</b> drank — thirst neurons dropped to <b>${b.byKey.sfo.smooth.toFixed(0)} Hz</b>`);
    }
  } else if (!atWater) {
    ag.drinkT = 0;
  }

  // ---- parental care: fetching strays and nursing ----
  let retrieved = false, nursed = false;
  const nest = litter.nest;
  const atNest = nest && Math.hypot(m.x - nest.x, m.z - nest.z) < NEST_R;
  if (b.parentalDrive > 0.2 && litter.count) {
    if (ag.carrying) {
      if (atNest) {
        litter.putDown(ag.carrying);
        logEvent('state', `<b>${ag.name}</b> carried pup ${ag.carrying.id} back to the nest`);
        ag.carrying = null;
        retrieved = true;
      }
    } else {
      const stray = litter.nearestStray(nx, nz);
      if (stray && stray.dist < 0.055) {
        litter.pickUp(stray.pup, m);
        ag.carrying = stray.pup;
        logEvent('state', `<b>${ag.name}</b> picked up pup ${stray.pup.id} — it was calling`);
      }
    }
    // crouching over the litter
    if (!ag.carrying && atNest && m.speed < 0.05 && b.sex === 'F' && b.lactating) {
      ag.nurseT = (ag.nurseT || 0) + dt;
      if (ag.nurseT > 2.4) {
        ag.nurseT = 0;
        nursed = true;
        logEvent('state', `<b>${ag.name}</b> is nursing — oxytocin neurons in <b>PVH</b> at ${b.byKey.pvh.smooth.toFixed(0)} Hz`);
      }
    } else { ag.nurseT = 0; }
  }
  ag.nursingNow = !ag.carrying && atNest && litter.count > 0 && m.speed < 0.05 && b.lactating;

  const mate = other(i);
  const pdx = mate ? mate.mouse.x - m.x : 99, pdz = mate ? mate.mouse.z - m.z : 99;
  const pdist = Math.hypot(pdx, pdz);

  const st = m.sensorState(arena.cheeses.filter((c) => !c.eaten), !!ate);
  st.light = arena.lightLevel;
  st.waterLevel = arena.waterLevel;
  st.atWater = atWater;
  st.drank = drank;
  st.mated = !!(mateBout > 0 && mateBout <= dt * 1.001 && matePair.has(ag));
  st.pupCall = litter.callLevel(m.x, m.z);
  st.pupsNear = litter.nearLevel(m.x, m.z);
  st.nursing = ag.nursingNow;
  st.retrieving = !!ag.carrying;
  st.nursed = nursed;
  st.retrieved = retrieved;
  st.partner = mate ? {
    dist: pdist,
    bearing: angDiff(Math.atan2(pdx, pdz), m.heading),
    sex: mate.sex,
    receptive: mate.brain.estrous,
  } : null;
  b.update(st, dt);

  // optogenetic modulation sits on top of the physiology, per animal
  ag.opto = optics.apply(b, dt) || NO_DRIVE;
  if (typeof m.setBehaviourDrive === 'function') m.setBehaviourDrive(ag.opto);

  // ---- behavioural state label ----
  const vcm = m.speed * 100;
  const odd = ag.opto || NO_DRIVE;
  let state = 'RESTING';
  if ((odd.freeze || 0) > 0.5) state = 'FREEZING';
  else if ((odd.aggression || 0) > 0.45) state = 'ATTACKING';
  else if (ag.fleeUntil > sessionT) state = 'FLEEING';
  else if (inBout) state = 'MATING';
  else if (ag.carrying) state = 'CARRYING PUP';
  else if (ag.nursingNow) state = 'NURSING';
  else if (b.eating > 0.35) state = 'EATING';
  else if (b.drinking > 0.3) state = 'DRINKING';
  else if (pdist < 0.1 && b.pheromone > 0.15) state = 'INVESTIGATING';
  else if (m.rear > 0.4) state = 'REARING';
  else if (vcm > 16) state = arena.waterLevel > 0.55 ? 'SWIMMING' : 'RUNNING';
  else if (vcm > 2) state = arena.waterLevel > 0.55 ? 'WADING' : 'WALKING';
  else if (b.odor > 0.4) state = 'SNIFFING';
  ag.state = state;
  return ate;
}

/** courtship -> mating, with a refractory period afterwards as in real pairs */
function stepMating(dt) {
  mateBout = Math.max(0, mateBout - dt);
  mateRefractory = Math.max(0, mateRefractory - dt);
  if (mateBout > 0) return;

  // any sexually mature opposite-sex pair in contact, with her receptive
  let pair = null;
  for (let i = 0; i < agents.length && !pair; i++) {
    for (let j = i + 1; j < agents.length && !pair; j++) {
      const a = agents[i], b = agents[j];
      if (a.sex === b.sex || !a.mature || !b.mature) continue;
      if (!a.brain.drives.mate || !b.brain.drives.mate) continue;
      if (Math.hypot(a.mouse.x - b.mouse.x, a.mouse.z - b.mouse.z) >= 0.085) continue;
      const f = a.sex === 'F' ? a : b, m = a.sex === 'F' ? b : a;
      if (f.brain.estrous <= 0.25 || f.brain.pregnant) continue;
      if (m.brain.mateDrive <= 0.22 || f.brain.mateDrive <= 0.1) continue;
      pair = { f, m };
    }
  }
  if (pair && mateRefractory <= 0) {
    mateTimer += dt;
    if (mateTimer > 1.6) {
      mateTimer = 0;
      mateBout = 2.2;              // the bout itself
      mateRefractory = 9;          // post-copulatory refractory period
      matePair = new Set([pair.f, pair.m]);
      logEvent('state', 'the pair mated — male <b>MPN</b> and female <b>VMHvl</b> peaked together');
      // conception: not every mating takes
      const fem = pair.f, male = pair.m;
      male.brain.sired = true;
      fem.lastSire = male;
      if (!fem.brain.pregnant && Math.random() < 0.75) {
        const n = 5 + Math.floor(Math.random() * 4);         // litters of 5-8
        fem.brain.conceive(n);
        logEvent('state', `the <b>female conceived</b> — ${n} embryos, ${(GESTATION / DAY).toFixed(0)} days of gestation ahead`);
      }
    }
  } else {
    mateTimer = Math.max(0, mateTimer - dt * 0.8);
  }
}

/** age everybody, grow the juveniles, and let them reach maturity */
function stepAging(dt) {
  for (const ag of agents) {
    ag.ageDays += dt / DAY;
    const sz = sizeForAge(ag.ageDays);
    ag.mouse.root.scale.setScalar(sz);
    if (!ag.mature) {
      ag.brain.libido = 0;                 // not yet sexually mature
      if (ag.ageDays >= ADULT_DAY) {
        ag.mature = true;
        logEvent('state', `<b>${ag.name}</b> reached sexual maturity at six weeks`);
      }
    }
  }
}

/** gestation runs in the female's brain; this is where the litter arrives */
function stepBirth() {
  for (const fem of agents) {
    if (!fem.brain.pregnant) continue;
    stepGestation(fem);
  }
}

function stepGestation(fem) {
  {
    const b = fem.brain;
    const pct = Math.floor(b.gestation * 100);
    if (pct >= 50 && !fem.halfway) {
      fem.halfway = true;
      logEvent('state', `the female is <b>halfway through gestation</b> — ${b.litterSize} pups, and she is eating for them`);
    }
    if (b.gestation >= 1) {
      const n = b.giveBirth();
      fem.halfway = false;
      litter.birth(n, fem.mouse, fem);
      logEvent('state', `<b>${n} pups born</b> to ${fem.name} — blind, deaf and hairless, in a nest against the wall`);
      logEvent('state', 'she is fertile again within a day — mice have a <b>postpartum oestrus</b>');
      fem.brain.pupCount = n;
      if (fem.lastSire) fem.lastSire.brain.pupCount = n;   // the father helps too
      buildColonyCards();
    }
  }
}

function frame(now) {
  const dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
  last = now;
  adaptResolution(dt);

  if (!paused) {
    sessionT += dt;
    stepMating(dt);
    stepAging(dt);
    stepAggression(dt);
    stepBirth(dt);
    for (let i = 0; i < agents.length; i++) stepAgent(agents[i], i, dt);
    arena.update(dt, sessionT, A().mouse, A().brain);
    litter.update(dt, sessionT, agents);
  }

  // ---- camera follows whichever mouse you are driving ----
  const pm = A().mouse;
  fwd.set(Math.sin(pm.heading), 0, Math.cos(pm.heading));
  if (camMode === 'follow') {
    const k = Math.min(1, pm.speed / MAX_RUN);
    camWant.set(pm.x, 0, pm.z).addScaledVector(fwd, -(0.44 + 0.2 * k));
    camWant.y = 0.23 + 0.05 * k;
    camera.position.lerp(camWant, 1 - Math.exp(-dt * 4.5));
    camLook.set(pm.x, 0.028, pm.z).addScaledVector(fwd, 0.14);
    camera.lookAt(camLook);
  } else if (camMode === 'top') {
    camera.position.set(0, 1.42, 0);
    camera.lookAt(0, 0, 0);
  } else {
    controls.update();
  }

  shadowAcc += dt;
  if (shadowAcc > 0.05) { shadowAcc = 0; renderer.shadowMap.needsUpdate = true; }
  renderer.render(scene, camera);

  // ---- panels (always show the mouse you are driving) ----
  const brain = A().brain;
  activation = brain.regionActivation();
  if (!paused) {
    raster.draw(brain, dt);
    lfpTrace.push(brain, dt);
    daTrace.push(brain, dt);
  }
  lfpTrace.draw();
  daTrace.draw();
  // the second WebGL context does not need 60 Hz
  brainAcc += dt;
  if (brainReady && brainVisible && brainAcc > 1 / 30) {
    brainView.update(brainAcc, activation, brain);
    brainAcc = 0;
  }

  mapAcc += dt;
  if (mapAcc > 0.22) {
    mapAcc = 0;
    const pmap = brain.rateMap('place', sel.place);
    drawRateMap($('map-place'), pmap);
    $('cap-place').textContent = `#${sel.place}`;
    $('sub-place').textContent = `${pmap.peak.toFixed(1)} Hz peak`;

    const gmap = brain.rateMap('grid', sel.grid);
    drawRateMap($('map-grid'), gmap);
    $('cap-grid').textContent = `#${sel.grid}`;
    $('sub-grid').textContent = `${(brain.byKey.grid.cells[sel.grid].lambda * 100).toFixed(0)} cm · ${gmap.peak.toFixed(1)} Hz`;

    const tun = brain.hdTuning('hd', sel.hd);
    drawPolar($('polar-hd'), tun, brain.byKey.hd.cells, sel.hd, A().mouse.heading, brain.popVector());
    $('cap-hd').textContent = `#${sel.hd}`;
    $('sub-hd').textContent = `${tun.peak.toFixed(1)} Hz peak`;
  }

  autoAcc += dt;
  if (sel.auto && autoAcc > 0.5) { autoAcc = 0; autoPickCells(); }

  valueAcc += dt;
  if (arena.valueMesh.visible && valueAcc > 1.2) {
    valueAcc = 0;
    arena.drawValue(brain.valueField());
  }

  if (!paused) watchEvents(dt);

  const tgt = A().moveTarget;
  marker.visible = !!tgt;
  if (tgt) {
    marker.position.set(tgt.x, 0.005, tgt.z);
    marker.scale.setScalar(1 + 0.16 * Math.sin(sessionT * 7));
  }

  hudAcc += dt;
  if (hudAcc > 0.1) { hudAcc = 0; updateHud(); }

  requestAnimationFrame(frame);
}

function updateHud() {
  try {
    updateHudInner();
  } catch (err) {
    // a panel must never be able to stop the simulation
    console.error('HUD update failed:', err);
  }
}

function updateHudInner() {
  const ag = A(), brain = ag.brain, m = ag.mouse;
  const vcm = m.speed * 100;
  $('st-cheese').textContent = brain.cheeseCount;
  $('st-speed').innerHTML = `${vcm.toFixed(0)}<span>cm/s</span>`;
  $('st-head').innerHTML = `${(((m.heading * 180 / Math.PI) % 360 + 360) % 360).toFixed(0)}<span>°</span>`;
  $('st-theta').innerHTML = `${brain.thetaFreq.toFixed(1)}<span>Hz</span>`;
  $('st-da').innerHTML = `${brain.daRate.toFixed(1)}<span>Hz</span>`;
  $('st-hunger').innerHTML = `${(brain.hunger * 100).toFixed(0)}<span>%</span>`;
  $('st-spk').innerHTML = `${(brain.spikeRateTotal / 1000).toFixed(1)}k<span>/s</span>`;
  $('st-time').textContent = fmtTime(sessionT);
  $('state-badge').textContent = `${ag.name.toUpperCase()} · ${ag.state}${ag.auto ? ' · AUTO' : ''}`;

  if (brain.ripple.active) lastSwr = sessionT;
  const swr = $('swr-badge');
  const showSwr = sessionT - lastSwr < 0.45;
  swr.style.display = showSwr ? 'block' : 'none';
  if (showSwr) swr.textContent = `SHARP-WAVE RIPPLE · ${brain.ripple.dir < 0 ? 'REVERSE' : 'FORWARD'} REPLAY · ${brain.swrCount}`;

  $('pos-badge').innerHTML = `x <b>${(m.x * 100).toFixed(0)}</b> cm &nbsp; z <b>${(m.z * 100).toFixed(0)}</b> cm`;

  // region bars for the controlled brain (computed once per frame)
  const act = activation;
  for (const acr of ORDER) {
    const r = rows[acr];
    if (!r || !r.el.isConnected) continue;      // only the rows currently shown
    const pops = brain.byRegion[acr] || [];
    const hz = pops.length ? pops.reduce((s, p) => s + p.smooth, 0) / pops.length : 0;
    r.fill.style.width = `${((act[acr] ?? 0) * 100).toFixed(1)}%`;
    r.hz.textContent = hz < 10 ? hz.toFixed(1) : hz.toFixed(0);
  }
  renderActive(act, brain);
  const live = $('insp-live');
  if (live) live.textContent = brain.liveLine(selected);

  // ---- colony analysis ----
  const mins = Math.max(sessionT, 1) / 60;
  agents.forEach((g, i) => {
    const c = cards[i];
    if (!c) return;
    const b = g.brain;
    c.el.classList.toggle('me', i === player);
    c.you.style.visibility = i === player ? 'visible' : 'hidden';
    c.state.textContent = g.state.toLowerCase();
    c.age.textContent = g.mature ? 'adult' : `${Math.floor(g.ageDays)}d`;
    c.age.classList.toggle('juv', !g.mature);
    const set = (k, v) => {
      if (c.fills[k]) c.fills[k].style.width = `${(clamp(v, 0, 1) * 100).toFixed(0)}%`;
    };
    set('hunger', b.drives.eat ? b.hunger : 0);
    set('thirst', b.drives.drink ? b.thirst : 0);
    set('mate', b.mateDrive);

    let rep = '';
    if (b.pregnant) {
      const day = (b.gestation * GESTATION / DAY).toFixed(0);
      rep = `<span class="pg">pregnant</span> day ${day}/${(GESTATION / DAY).toFixed(0)} · ${b.litterSize} pups
             <span class="pbar"><span style="width:${(b.gestation * 100).toFixed(0)}%"></span></span>`;
    } else if (b.pupCount > 0 && litter.count) {
      rep = `<span class="pg">${g.sex === 'F' ? 'nursing' : 'with'} ${litter.count}</span> · day ${litter.days.toFixed(0)}` +
            (litter.strays ? ` · <span class="stray">${litter.strays} astray</span>` : '');
    } else {
      rep = `ate ${b.cheeseCount} · drank ${b.drinkCount} · mated ${b.mateCount}` +
            (b.litters ? ` · ${b.litters} litter${b.litters > 1 ? 's' : ''}` : '');
    }
    c.repro.innerHTML = rep;
  });

  const ob = $('b-optics');
  if (ob && ob.style.display !== 'none') ob.classList.toggle('on', opticsOpen());

  const sub = $('col-sub');
  if (sub) sub.textContent = `${agents.length} mice${litter.count ? ` · ${litter.count} pups` : ''}` + (mateBout > 0 ? ' · mating' : '');
}

// Fold any floating card by its header. Delegated, so cards mounted later
// (by other modules) fold the same way without re-registering.
document.addEventListener('click', (e) => {
  const h = e.target.closest && e.target.closest('.float h5[data-fold]');
  if (h) h.parentElement.toggleAttribute('data-collapsed');
});

// first visit gets the explainer; after that it is behind the "?" button
let seen = false;
try { seen = localStorage.getItem('mlm-seen') === '1'; } catch { seen = false; }
if (!seen) showWelcome(true);
$('welcome-start').onclick = () => {
  showWelcome(false);
  try { localStorage.setItem('mlm-seen', '1'); } catch { /* private mode */ }
};
$('welcome').onclick = (e) => { if (e.target === $('welcome')) showWelcome(false); };

setLight(0.35);
setWater(0);
resize();
applySize(true);
requestAnimationFrame(frame);

window.sim = {
  agents, arena, litter, brainView, THREE, camera, scene, renderer, controls,
  get optics() { return optics; },
  get brain() { return A().brain; },
  get mouse() { return A().mouse; },
  setCam: (m) => { while (camMode !== m) cycleCamera(); },
  takeControl, setLight, setWater, toggleDrive,
};
