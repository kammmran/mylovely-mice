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
import { ProxyBody, ProxyHerd, transferBody } from './world/proxybody.js';
import { Brain, DAY, GESTATION } from './neuro/brain.js';
import { Litter, NEST_R } from './world/pups.js';
import { Threats, STIMULI, STIMULUS_ORDER, ODOUR_R } from './world/threats.js';
import { mountMortality, CAUSES } from './world/mortality.js';
import { ColonyGrid, PITCH } from './world/colonygrid.js';
import { mountReport } from './report.js';
import { MouseBehavior, steerMouse, separateMice } from './world/behavior.js';
import { COATS } from './world/mouseappearance.js';
import { canvasFigure } from './reportvisuals.js';
import { BrainView } from './view/brainview.js';
import { Raster, Trace, drawRateMap, drawPolar } from './view/plots.js';
import { mountSignals } from './view/signalspanel.js';
import { SLOT } from './view/palette.js';
import { mountInterface } from './view/interface.js';
import { mountFloatingPanels } from './view/floatingpanels.js';
import { mountAnatomy } from './view/anatomypanel.js';
import { ROLES, ORDER, GROUPS } from './neuro/regions.js';

const $ = (id) => document.getElementById(id);
/** the "no optogenetic drive" object, shared so it never allocates */
const NO_DRIVE = Object.freeze({});

const MAX_COLONY = 100;        // past this the cage is full and juveniles disperse
/**
 * Nearby animals use the articulated body. The rest share instanced coat and
 * facial-detail meshes in each cage.
 */
const RIG_BUDGET = 6;
const BRAIN_STRIDE = 3;        // animals you are not inspecting think at 20 Hz

// Module state that makeAgent() reads. It MUST be declared above the agent
// construction below: a `let` further down the file is in the temporal dead
// zone when makeAgent runs, which throws and takes the whole page with it.
let connData = null;
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

/**
 * Nine cages rather than one. Each is a THREE.Group with an x/z offset, and
 * everything inside it — bodies, litter, odours — keeps using cage-local
 * coordinates, so only the camera, the mouse picking and the cage-to-cage
 * transfers have to know the difference between local and world.
 */
const grid = new ColonyGrid(scene, { onEvent: (g, h) => logEvent(g, h) });
const rigPool = [];
const proxyScratch = [];

// Each cage gets its own litter, its own instanced bodies and its own
// aversive stimuli, because the conditions are what differ between them.
for (const box of grid.boxes) {
  box.herd = new ProxyHerd(box.group, MAX_COLONY);
  box.litter = new Litter(box.group, box.arena);
  box.threats = new Threats(box.group, box.arena);
  box.litter.onWean = (pup) => {
    const parents = pup.owner ? [pup.owner, pup.owner.lastSire].filter(Boolean) : box.agents;
    for (const g of parents) g.brain.pupCount = Math.max(0, g.brain.pupCount - 1);
    matureInto(pup, box);
    if (box.litter.count === 0) {
      for (const g of box.agents) g.brain.lactating = false;
      logEvent('state', `a litter in <b>${box.cond.name}</b> is fully weaned — ${box.litter.weaned} raised`);
      buildColonyCards();
    }
  };
  box.litter.onEyesOpen = (pp) => {
    if (box === playerBox() && (pp.id % 97 === 0 || box.litter.pups.indexOf(pp) === 0)) {
      logEvent('sensory', `the pups' <b>eyes have opened</b> — day ${(pp.age / DAY).toFixed(0)}`);
    }
  };
}

/** the cage the mouse you are driving is in — what every UI control acts on */
const playerBox = () => (agents[player] && agents[player].box) || grid.boxes[4];
// `arena`, `litter` and `threats` always mean "the cage you are looking at",
// so every panel, slider and hotkey keeps working exactly as it did with one.
let arena = grid.boxes[4].arena;
let litter = grid.boxes[4].litter;
let threats = grid.boxes[4].threats;
/** point the UI at whichever cage the driven animal is now in */
function followBox() {
  const box = playerBox();
  if (box.arena === arena) return false;
  arena = box.arena;
  litter = box.litter;
  threats = box.threats;
  grid.here = box;
  grid.describe(box);
  syncEnvUI();
  return true;
}

/** world position of a point in a cage */
const worldX = (ag, x) => x + ag.box.origin.x;
const worldZ = (ag, z) => z + ag.box.origin.z;

// ----------------------------------------------------------------- the colony
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
function makeAgent({ sex, name, x, z, heading, fur, belly, ageDays = 70, seed, box }) {
  const home = box || grid.boxes[4];
  const brain = new Brain({ arena: home.arena.size, sex, name, seed: seed ?? (sex === 'M' ? 7 : 23) });
  if (connData) brain.setConnectivity(connData.matrix);
  brain.envId = home.id;              // its hippocampal map is this cage's map
  // every animal starts on a proxy body; the level-of-detail pass hands real
  // rigs to whichever ones are nearest the camera
  const mouse = new ProxyBody(home.arena, { x, z, heading });
  mouse.furColor = new THREE.Color(fur);
  return {
    brain, mouse, sex, name, fur, belly, box: home,
    behavior: new MouseBehavior(),
    bornAt: 0, visited: new Set([home.cond.name]), crossings: 0,
    hasRig: false, phase: 0, accDt: 0, pend: {},
    auto: false,
    ageDays,
    mature: ageDays >= ADULT_DAY,
    wander: null, wanderT: 0, fleeUntil: 0, opto: NO_DRIVE,
    drinkT: 0, eatCount: 0,
    state: 'RESTING',
    home: { x, z, heading },
  };
}

/** give this animal the articulated rig */
function acquireRig(ag) {
  let rig = rigPool.pop();
  if (!rig) {
    rig = new Mouse(ag.box.group, ag.box.arena);
    // the rig ships an idle autopilot; this session steers, so that immobility
    // (and with it sharp-wave ripples and mating bouts) is preserved
    if (typeof rig.setAutopilot === 'function') rig.setAutopilot(false);
  }
  rig.setCoat(ag.fur, ag.belly);
  transferBody(ag.mouse, rig);
  // a pooled rig may have come from another cage: reparent, so that its
  // local coordinates land inside the cage this animal is actually in
  ag.box.group.add(rig.root);
  rig.arena = ag.box.arena;
  rig.root.visible = true;
  ag.mouse = rig;
  ag.hasRig = true;
}

/** hand the rig back and fall to the instanced body */
function releaseRig(ag) {
  const rig = ag.mouse;
  const proxy = new ProxyBody(ag.box.arena);
  transferBody(rig, proxy);
  proxy.furColor = new THREE.Color(ag.fur);
  rig.root.visible = false;
  rigPool.push(rig);
  ag.mouse = proxy;
  ag.hasRig = false;
}

/**
 * Decide who gets a rig and how much of each brain to compute. Re-run a few
 * times a second rather than every frame, so bodies are not swapped constantly.
 */
function updateLOD() {
  const cam = camera.position;
  const ranked = agents.map((ag) => ({
    ag,
    // a corpse never takes a rig back off a live animal: it has no gait to
    // show, and the instanced body is the one that knows how to lie on its side
    d: ag.dead ? Infinity : (ag === A() ? -1 : Math.hypot(worldX(ag, ag.mouse.x) - cam.x, worldZ(ag, ag.mouse.z) - cam.z)),
  })).sort((a, b) => a.d - b.d);
  const want = new Set(ranked.slice(0, RIG_BUDGET).map((r) => r.ag));
  for (const ag of agents) {
    const needRig = want.has(ag) && !ag.dead;
    if (needRig && !ag.hasRig) acquireRig(ag);
    else if (!needRig && ag.hasRig) releaseRig(ag);
    ag.brain.setDetail(ag === A() ? 2 : (needRig ? 1 : 0));
  }
}

/** a weaned pup grows up and joins the colony */
function matureInto(pup, box) {
  if (agents.length >= MAX_COLONY) {
    logEvent('state', `a weaned ${pup.sex === 'M' ? 'male' : 'female'} left the cage — <b>the colony is full</b> (${MAX_COLONY})`);
    return null;
  }
  const sex = pup.sex || (Math.random() < 0.5 ? 'M' : 'F');
  nameCount[sex]++;
  const name = `${sex === 'M' ? 'male' : 'female'} ${nameCount[sex]}`;
  // Natural coat colors with a little variation between individuals.
  const coat = COATS[(seedSeq + pup.id) % COATS.length];
  const base = coat.fur;
  const jitter = (c, k) => {
    const col = new THREE.Color(c);
    col.offsetHSL((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * k);
    return col.getHex();
  };
  const home = box || grid.boxes[4];
  const ag = makeAgent({
    sex, name, box: home, x: pup.x, z: pup.z, heading: Math.random() * Math.PI * 2,
    fur: jitter(base, 0.07), belly: jitter(coat.belly, 0.05),
    ageDays: WEAN_DAY, seed: ++seedSeq,
  });
  ag.auto = true;
  ag.bornAt = sessionT;
  ag.phase = agents.length % BRAIN_STRIDE;
  agents.push(ag);
  home.agents.push(ag);
  buildColonyCards();
  logEvent('state', `a pup <b>grew up</b> — ${name} joins the colony (${agents.length} mice)`);
  return ag;
}

/**
 * The founding population: every cage stocked according to its condition, so
 * the differences between them are there from the first second.
 */
const agents = [];
function stockCages() {
  for (const box of grid.boxes) {
    const want = box.cond.mice || ['M', 'F'];
    want.forEach((sex, i) => {
      nameCount[sex]++;
      const a = (i / want.length) * Math.PI * 2;
      const r = want.length > 2 ? 0.34 : 0.3;
      const ag = makeAgent({
        sex, box,
        name: `${sex === 'M' ? 'male' : 'female'} ${nameCount[sex]}`,
        x: Math.cos(a) * r, z: Math.sin(a) * r, heading: -a,
        fur: COATS[(box.id * 3 + i) % COATS.length].fur,
        belly: COATS[(box.id * 3 + i) % COATS.length].belly,
        ageDays: 70, seed: ++seedSeq,
      });
      ag.auto = true;
      ag.phase = agents.length % BRAIN_STRIDE;
      agents.push(ag);
      box.agents.push(ag);
    });
  }
}
stockCages();
// start in the control cage: the others are the experiment, this is the baseline
let player = Math.max(0, agents.findIndex((g) => g.box === grid.boxes[4]));
const A = () => agents[player];

/**
 * An animal goes through a tunnel into the next cage.
 *
 * The hippocampus treats the two cages as different places, which they are:
 * the map it was using goes away and another one comes out, and the rate map
 * in the panel starts rebuilding from nothing. Come back and the first map
 * comes back with it.
 */
function transferAgent(ag, cross) {
  const from = cross.from, to = cross.to;
  const i = from.agents.indexOf(ag);
  if (i >= 0) from.agents.splice(i, 1);
  to.agents.push(ag);
  ag.box = to;
  ag.mouse.x = cross.at.x;
  ag.mouse.z = cross.at.z;
  ag.moveTarget = null;
  ag.behavior.interrupt('explore');
  ag.wander = null;
  ag.roam = null;
  ag.roamT = 4 + Math.random() * 6;  // settle in before looking for the next one
  ag.crossT = sessionT + 1.5;        // no ping-ponging back through the mouth
  if (ag.hasRig) { to.group.add(ag.mouse.root); ag.mouse.arena = to.arena; }
  else ag.mouse.arena = to.arena;
  from.left++;
  to.arrived++;
  ag.crossings = (ag.crossings || 0) + 1;
  if (ag.visited) ag.visited.add(to.cond.name);
  cross.tunnel.uses++;
  grid.crossings++;
  const remapped = ag.brain.enterEnvironment(to.id);
  if (ag === A()) { followBox(); raster.clear(); }
  if (ag === A() || grid.crossings < 8 || to === grid.centre) {
    logEvent('spatial', `<b>${ag.name}</b> went through to <b>${to.cond.name}</b>`
      + (ag.leaving ? ` — it could not find ${ag.leaving}` : '')
      + (remapped ? ` · the hippocampus <b>remapped</b>, map ${Object.keys(ag.brain.envs).length} of nine` : ''));
  }
  ag.leaving = null;
  grid.render();
}

/** what each cage does to the animals in it, over and above its furniture */
function stepCondition(box, dt) {
  const c = box.cond;
  if (c.noise) {
    box.noiseT -= dt;
    if (box.noiseT <= 0) {
      box.noiseT = c.noise * (0.7 + Math.random() * 0.6);
      // you hear the cage you are in; the animals in the others still startle
      box.threats.setMuted(box !== playerBox());
      box.threats.trigger('burst', sessionT);
    }
  }
  if (c.threat && !box.threats.odour) {
    // the odour evaporates; in this cage it is a standing condition
    box.threats.trigger(c.threat, sessionT);
  }
}

/** the closest other animal, or null if this one is alone */
function nearestOther(i) {
  const self = agents[i];
  const m = self.mouse;
  let best = null, bd = Infinity;
  for (let k = 0; k < agents.length; k++) {
    const o = agents[k];
    // only cagemates: an animal two cages away is not a social partner, a
    // rival or a mate, whatever the distance between the plates happens to be
    if (k === i || o.dead || o.box !== self.box) continue;
    const d = Math.hypot(o.mouse.x - m.x, o.mouse.z - m.z);
    if (d < bd) { bd = d; best = o; }
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
    ${connectionLines(selected)}
    <div class="live" id="insp-live">${A().brain.liveLine(selected)}</div>`;
}
selectRegion('CA1');

// ----------------------------------------------------------------- colony panel
const cgrid = $('cgrid');
const DRIVE_COLOR = { hunger: SLOT.reward, thirst: SLOT.sensory, mate: SLOT.state, health: SLOT.motor };
let cards = [];

const COLONY_ROWS = 24;        // a hundred live DOM rows is not worth the cost

/** the colony grows, so this is rebuilt whenever its membership changes */
function buildColonyCards() {
  cgrid.textContent = '';
  const shown = agents.slice(0, COLONY_ROWS);
  cards = shown.map((ag, i) => {
    const el = document.createElement('div');
    el.className = 'crow';
    el.innerHTML = `
      <div class="ctop">
        <span class="sx" style="color:${ag.sex === 'M' ? '#6aa6ff' : '#e58fb4'}">${ag.sex === 'M' ? '\u2642' : '\u2640'}</span>
        <span class="nm">${ag.name}</span>
        <span class="age" data-age>adult</span>
        <span class="age" data-cage></span>
        <span class="st" data-state>resting</span>
        <span class="you" data-you>you</span>
      </div>
      <div class="bars">
        <span class="bar" title="appetite"><i data-d="hunger"></i></span>
        <span class="bar" title="thirst"><i data-d="thirst"></i></span>
        <span class="bar" title="mating drive"><i data-d="mate"></i></span>
        <span class="bar" title="body condition — bite wounds and weight loss take it down"><i data-d="health"></i></span>
      </div>
      <div class="rep" data-repro></div>`;
    el.onclick = () => takeControl(i);
    cgrid.appendChild(el);
    const fills = Object.fromEntries([...el.querySelectorAll('[data-d]')].map((n) => [n.dataset.d, n]));
    for (const [k, n] of Object.entries(fills)) n.style.background = DRIVE_COLOR[k];
    return {
      agent: ag,
      el,
      you: el.querySelector('[data-you]'),
      age: el.querySelector('[data-age]'),
      cage: el.querySelector('[data-cage]'),
      state: el.querySelector('[data-state]'),
      repro: el.querySelector('[data-repro]'),
      fills,
    };
  });
  if (agents.length > COLONY_ROWS) {
    cgrid.appendChild(el('div', 'cmore', `\u2026 and ${agents.length - COLONY_ROWS} more`));
  }
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
buildColonyCards();

function takeControl(i) {
  if (i === player || i < 0 || i >= agents.length) return;
  player = i;
  // every animal forages for itself, including the one you have just picked:
  // selecting a mouse means watching it, not taking the keys off it
  agents.forEach((ag) => { ag.auto = true; ag.moveTarget = null; });
  raster.clear();
  lfpTrace.i = 0;
  daTrace.i = 0;
  $('b-auto').classList.toggle('on', agents[player].auto);
  followBox();
  renderInspector();
}

// ----------------------------------------------------------------- connectivity
// Real anterograde tracer strengths, so the populations are wired to each other
// the way a mouse brain actually is rather than each sitting on its own.
fetch('./data/mouse_connectivity.json')
  .then((r) => r.json())
  .then((d) => {
    connData = d;
    let wired = 0;
    for (const ag of agents) wired = ag.brain.setConnectivity(d.matrix);
    renderInspector();
    logEvent('spatial', `wired <b>${wired} regions</b> to each other using measured tracer projections`);
  })
  .catch((err) => console.warn('connectivity data unavailable:', err.message));

/** the strongest measured inputs and outputs for a region */
function connectionLines(acr) {
  if (!connData) return '';
  const m = connData.matrix;
  const fmt = (list, label) => {
    if (!list.length) return '';
    const items = list.map(([r, v]) =>
      `<b style="color:${SLOT[ROLES[r].group]}">${r}</b> ${v < 1 ? v.toFixed(2) : v.toFixed(1)}`).join(' · ');
    return `<div class="conn"><span>${label}</span> ${items}</div>`;
  };
  const outs = Object.entries(m[acr] || {})
    .filter(([t, v]) => t !== acr && ROLES[t] && v > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 3);
  const ins = Object.entries(m)
    .map(([src, row]) => [src, row[acr] || 0])
    .filter(([src, v]) => src !== acr && ROLES[src] && v > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!outs.length && !ins.length) return '';
  return fmt(ins, 'input from') + fmt(outs, 'projects to');
}

// ----------------------------------------------------------------- signals panel
// Real recorded firing statistics, so the model can be shown against them.
let signals = null;
fetch('./data/mouse_unit_metrics.json')
  .then((r) => r.json())
  .catch(() => null)
  .then((metrics) => {
    signals = mountSignals({
      getBrain: () => A().brain,
      getRegion: () => selected,
      metrics,
    });
    $('b-signals').onclick = () => { signals.open(!signals.isOpen()); syncSignalsBtn(); };
    if (metrics) {
      logEvent('sensory', `firing rates from <b>${metrics.units_analysed.toLocaleString()} recorded neurons</b> loaded for comparison`);
    }
  });
function syncSignalsBtn() {
  const b = $('b-signals');
  if (b && signals) b.classList.toggle('on', signals.isOpen());
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

grid.mount($('world-pane'), {
  onPick: (box) => {
    // clicking a cage in the panel drives something in it
    const i = agents.findIndex((g) => g.box === box && !g.dead);
    if (i >= 0) takeControl(i);
  },
});
if (grid.viewBtn) {
  grid.viewBtn.onclick = () => cycleCamera(camMode === 'all nine' ? 'follow' : 'all nine');
}

/** the nine-cages card */
function toggleBoxes(force) {
  const on = force === undefined ? !shown('boxes') : !!force;
  panelOn.boxes = on;
  if (on) toggleMortality(false);          // they share the same slot
  applyPanels();
}

function toggleReport(force) {
  const on = force === undefined ? !report.isOpen() : !!force;
  report.open(on);
  const btn = $('b-report');
  if (btn) btn.classList.toggle('on', on);
}

/** the fighting & mortality card: its own markup, like the optogenetics rig */
function toggleMortality(force) {
  const on = force === undefined ? !shown('mortality') : !!force;
  panelOn.mortality = on;
  if (on) panelOn.boxes = false;
  applyPanels();
}

/** is the optogenetics card currently showing? (it owns its own markup) */
function opticsOpen() {
  const card = document.getElementById('optics');
  return !!card && card.style.display !== 'none';
}

// ----------------------------------------------------------------- mortality
/**
 * Fighting, infanticide and death. The rules live in world/mortality.js; this
 * gives it the colony operations it cannot do for itself — taking a body out
 * of the cage, and putting a strange male into it.
 */
const mortality = mountMortality({
  getAgents: () => agents,
  getLitter: () => litter,
  getLitters: () => grid.boxes.map((b) => b.litter),
  litterFor: (ag) => (ag.box ? ag.box.litter : litter),
  getArena: () => arena,
  now: () => sessionT,
  onEvent: (group, html) => logEvent(group, html),
  nearestOther: (ag) => other(agents.indexOf(ag)),
  releaseRig: (ag) => releaseRig(ag),
  onDeath: (ag) => {
    if (ag.box) ag.box.deaths++;
    // you cannot drive a corpse: control passes to whoever is still alive
    if (agents[player] === ag) {
      const next = agents.findIndex((g) => !g.dead);
      if (next >= 0) {
        takeControl(next);
        logEvent('state', `you are now driving <b>${agents[next].name}</b>`);
      }
    }
    buildColonyCards();
  },
  removeAgent: (ag) => removeAgent(ag),
  addIntruder: () => addIntruder(),
  mount: $('world-pane'),
});

/**
 * The session report: a row per animal, a row per cage, the timeline, and a
 * set of rules that each look for one pattern worth pointing out. Downloads
 * as a visual PDF, Markdown or CSV, with user-selected sections and mice.
 */
const report = mountReport({
  mount: $('world-pane'),
  agents,
  grid,
  mortality,
  journal: () => journal,
  sessionT: () => sessionT,
  observedMouse: () => A().name,
  signalTracks: () => [lfpTrace, daTrace].flatMap((trace) => {
    const count = Math.min(trace.i, trace.N), start = trace.i - count;
    return trace.tracks.map((track, index) => ({
      label: track.label === 'VTA Hz' ? 'VTA dopamine' : track.label, min: track.min, max: track.max,
      unit: track.label === 'CA1 LFP' ? 'model units' : track.label === 'VTA Hz' ? 'Hz' : 'normalized',
      period: trace.window / trace.N,
      values: Array.from({ length: count }, (_, j) => trace.buf[index][(start + j) % trace.N]),
    }));
  }),
  captureImages: () => {
    renderer.render(scene, camera);
    const images = [canvasFigure(worldCanvas, 'Platform snapshot', `The current platform camera view, observing ${A().name}.`)];
    if (brainView.ready) {
      const size = brainView.renderer.getSize(new THREE.Vector2());
      try {
        brainView.renderer.setSize(900, 640, false);
        brainView.update(0, A().brain.regionActivation(), A().brain);
        const captureCamera = brainView.camera.clone();
        captureCamera.aspect = 900 / 640;
        captureCamera.position.sub(brainView.controls.target).multiplyScalar(1.18).add(brainView.controls.target);
        captureCamera.updateProjectionMatrix();
        brainView.renderer.render(brainView.scene, captureCamera);
        images.push(canvasFigure(brainView.canvas, 'Brain atlas snapshot', `Allen CCFv3 anatomy with model activity for ${A().name} at the snapshot.`));
      } finally {
        brainView.renderer.setSize(size.x, size.y, false);
      }
    }
    return images.filter(Boolean);
  },
  causeLabel: (k) => (CAUSES[k] ? CAUSES[k].label : (k || 'unknown')),
});

/** take a body out of the cage */
function removeAgent(ag) {
  const i = agents.indexOf(ag);
  if (i < 0 || agents.length <= 1) return;
  if (ag.hasRig) releaseRig(ag);
  if (ag.mouse && ag.mouse.root) scene.remove(ag.mouse.root);
  if (ag.mouse && typeof ag.mouse.dispose === 'function') ag.mouse.dispose();
  const bi = ag.box ? ag.box.agents.indexOf(ag) : -1;
  if (bi >= 0) ag.box.agents.splice(bi, 1);
  agents.splice(i, 1);
  if (player >= agents.length) player = agents.length - 1;
  else if (player > i) player--;
  buildColonyCards();
}

/**
 * The resident-intruder test: put an unfamiliar adult male into an established
 * cage and the resident attacks him. It is the standard way aggression is
 * measured, and the only variable that matters is that he is a stranger.
 */
function addIntruder() {
  if (agents.length >= MAX_COLONY) {
    logEvent('state', 'the cage is full — no room for an intruder');
    return null;
  }
  nameCount.M++;
  const name = `intruder ${nameCount.M}`;
  const a = Math.random() * TAU;
  const ag = makeAgent({
    sex: 'M', name, box: playerBox(),
    x: clamp(Math.cos(a) * 0.5, -0.5, 0.5), z: clamp(Math.sin(a) * 0.5, -0.5, 0.5),
    heading: a, fur: 0x8e8578, belly: 0xd8d2c6, ageDays: 70, seed: ++seedSeq,
  });
  ag.auto = true;
  ag.phase = agents.length % BRAIN_STRIDE;
  agents.push(ag);
  ag.box.agents.push(ag);
  buildColonyCards();
  logEvent('state', `an <b>unfamiliar male</b> was put in the cage — the resident has about a minute to decide what he is`);
  return ag;
}

// ----------------------------------------------------------------- threats
/**
 * The aversive-stimulus panel. Each button presents one stimulus to both mice;
 * what they do about it is decided by their own defensive circuits.
 */
const tgrid = $('tgrid');
if (tgrid) {
  for (const key of STIMULUS_ORDER) {
    const st = STIMULI[key];
    const b = document.createElement('button');
    b.className = 'tbtn';
    b.dataset.stimulus = key; b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<span class="ic">${st.icon}</span><span class="tl">${st.label}</span><kbd>${st.key}</kbd>`;
    b.title = `${st.blurb}\n\n${st.detail}\n\n${st.ref}`;
    b.onclick = () => presentThreat(key);
    tgrid.appendChild(b);
  }
}

/** present one stimulus, and say so in the feed */
function presentThreat(key) {
  const st = STIMULI[key];
  const r = threats.trigger(key, sessionT);
  if (!r) return;
  const habituated = r.repeat > 1 && r.responsiveness < 0.95
    ? ` — presentation ${r.repeat}, and they are down to <b>${(r.responsiveness * 100) | 0}%</b> of the first response (habituation)`
    : '';
  logEvent('sensory', st.kind === 'odour'
    ? `<b>${st.label}</b> placed in the far corner${habituated}`
    : `<b>${st.label}</b>${habituated}`);
}

function clearThreatSource() {
  threats.clear();
  logEvent('sensory', 'stimuli removed — the mice recover at their own pace');
}

function toggleThreatSound() {
  threats.setMuted(!threats.muted);
  const b = $('b-thr-mute');
  if (b) b.textContent = `sound: ${threats.muted ? 'off' : 'on'}`;
}

if ($('b-thr-clear')) $('b-thr-clear').onclick = clearThreatSource;
if ($('b-thr-mute')) $('b-thr-mute').onclick = toggleThreatSound;
if ($('b-thr-view')) $('b-thr-view').onclick = () => {
  cycleCamera('orbit');
  const box = playerBox();
  controls.target.set(box.origin.x + .12, .12, box.origin.z + .04);
  const distance = Math.max(2.4, 1.8 / (2 * Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
  controls.maxDistance = Math.max(3.2, distance * 1.1);
  camera.position.copy(controls.target).add(new THREE.Vector3(.6, .8, 1).normalize().multiplyScalar(distance));
  controls.update();
};

/**
 * How strongly a point is contaminated for this animal, 0..1. Used to steer
 * the autopilot away: a mouse will not walk into a corner that smells of fox
 * to reach a piece of cheese, and that conflict is the measurable behaviour.
 */
function threatAt(b, x, z) {
  const src = b.threatSource;
  if (!src || b.aversion < 0.06) return 0;
  return clamp(1 - Math.hypot(x - src.x, z - src.z) / (ODOUR_R * 1.6), 0, 1) * b.aversion;
}

// ----------------------------------------------------------------- event feed
/**
 * A plain-language running commentary. Without this the panels are just moving
 * numbers; this says what the mouse just did and what its brain did about it.
 */
const feedList = $('feed-list');
const feedRows = [];
/**
 * Everything that has happened, in order, for the session report. The feed on
 * screen only keeps the last few; this keeps the lot, minus the markup.
 */
const journal = [];
function logEvent(group, html) {
  journal.push({ t: sessionT, group, text: String(html).replace(/<[^>]+>/g, '') });
  if (journal.length > 900) journal.shift();
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

  // ---- defensive reactions ----
  agents.forEach((g) => {
    const bb = g.brain;
    const d = bb.defenseState;
    if (d !== g.wasDefense && sessionT - (g.defLogT || -9) > 2.5) {
      g.defLogT = sessionT;
      if (d === 'FREEZING') {
        logEvent('state', `<b>${g.name}</b> froze — ventrolateral <b>PAG</b> at `
          + `<b>${bb.byKey.pag.smooth.toFixed(0)} Hz</b>, and the hippocampus dropped from theta to the `
          + `<b>${bb.thetaFreq.toFixed(1)} Hz</b> breathing rhythm of a frightened mouse`);
      } else if (d === 'FLEEING') {
        logEvent('state', `<b>${g.name}</b> bolted${bb.escapeTarget ? ' toward its remembered refuge' : ' away from danger'}`);
      } else if (d === 'HIDING') {
        logEvent('state', `<b>${g.name}</b> reached cover and is waiting for the threat to pass`);
      } else if (d === 'WARY') {
        logEvent('state', `<b>${g.name}</b> is wary — keeping to the walls, and not interested in food`);
      } else if (d === 'RISK ASSESSMENT') {
        const what = STIMULI[bb.threatKind] ? STIMULI[bb.threatKind].label : 'it';
        logEvent('state', `<b>${g.name}</b> is assessing the <b>${what}</b> from a distance — stretched out, sniffing, going no closer`);
      } else if (!d && g.wasDefense) {
        logEvent('state', `<b>${g.name}</b> settled — fear down to <b>${(bb.fear * 100) | 0}%</b>, `
          + `but corticosterone is still <b>${(bb.cort * 100) | 0}%</b> and takes minutes to clear`);
      }
    }
    if (d !== g.wasDefense) g.wasDefense = d;

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
/** how many steps of the world go into one frame: 1x, 2x, 4x, 8x */
const SPEEDS = [1, 2, 4, 8];
const SUB_STEP = 1 / 60;       // one step of the world, in simulated seconds
let simSpeed = 1;
let simAcc = 0;
let simStepsLast = 0;
function cycleSpeed(to) {
  simSpeed = to || SPEEDS[(SPEEDS.indexOf(simSpeed) + 1) % SPEEDS.length];
  const b = $('b-speed');
  if (b) {
    b.value = String(simSpeed);
    b.classList.toggle('on', simSpeed > 1);
  }
  logEvent('state', simSpeed === 1
    ? 'back to <b>real time</b>'
    : `running at <b>${simSpeed}\u00d7</b> — ${(5 / simSpeed).toFixed(1)} s per simulated day`);
}
let camMode = 'follow';
const CAM_MODES = ['follow', 'orbit', 'top', 'all nine'];

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.defaultPrevented || e.target.closest('input,select,textarea,[contenteditable="true"]') || document.querySelector('dialog[open]')) return;
  if (e.target.closest('button,summary,[role="button"]') && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'enter', 'home', 'end'].includes(k)) return;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (keys[k]) return;
  keys[k] = true;
  if (k === 'c') cycleCamera();
  if (k === 'p') togglePause();
  if (k === 'r') requestReset();
  if (k === 'v') toggleValue();
  if (k === 't') toggleTrail();
  if (k === 'h') toggleHelp();
  if (k === '?' || (k === '/' && e.shiftKey)) showWelcome(true);
  if (k === 'escape') showWelcome(false);
  if (k === 'm') rotateCue();
  if (k === 'x') takeControl((player + 1) % agents.length);
  if (k === 'o') toggleAuto();
  if (k === 'b' && signals) { signals.open(!signals.isOpen()); syncSignalsBtn(); }
  for (const sk of STIMULUS_ORDER) {
    if (k === STIMULI[sk].key) presentThreat(sk);
  }
  if (k === '0') clearThreatSource();
  if (k === 'n') toggleMortality();
  if (k === 'j') toggleBoxes();
  if (k === 'y') toggleReport();
  if (k === '.' || k === '>') cycleSpeed();
  if (k === ',' || k === '<') cycleSpeed(1);
  if (k === 'k') { grid.setOpen(!grid.open); grid.render(); }
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
/** point the light and water controls at whichever cage is being driven */
function syncEnvUI() {
  const l = Math.round(arena.lightLevel * 100);
  $('sl-light').value = l;
  $('lab-light').textContent = `${l}%`;
  const w = arena.waterLevel;
  $('sl-water').value = Math.round(w * 100);
  $('lab-water').textContent = w < 0.02 ? 'dry' : w < 0.35 ? 'shallow' : w < 0.7 ? 'wading' : 'deep';
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

const DRIVE_BTN = { eat: 'b-eat', drink: 'b-drink', mate: 'b-mate', fear: 'b-fear' };
const DRIVE_WORD = { eat: 'eating', drink: 'drinking', mate: 'mating', fear: 'defence' };
const DRIVE_OFF = {
  eat: 'the hunger circuit is silent — they cannot eat',
  drink: 'the thirst circuit is silent — they cannot drink',
  mate: 'the mating circuit is silent — mating is impossible',
  fear: 'the defensive circuit is silent — predator cues mean nothing to them now',
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

const anatomy = mountAnatomy({ getAgent: A, getPaused: () => paused,
  ensureRig: (ag) => { if (!ag.dead && !ag.hasRig) acquireRig(ag); } });
$('b-anatomy').onclick = () => anatomy.open(!anatomy.isOpen());

// ----------------------------------------------------------------- panels
/** Every panel can be shown or hidden, and the layout closes up around it. */
const PANELS = [
  { key: 'brain', label: 'Live brain', group: 'side panel' },
  { key: 'busiest', label: 'Most active regions', group: 'side panel' },
  { key: 'region', label: 'Region details', group: 'side panel' },
  { key: 'maps', label: 'Learned maps', group: 'side panel' },
  { key: 'regions', label: 'All regions', group: 'side panel' },
  { key: 'spikes', label: 'Spike raster', group: 'along the bottom' },
  { key: 'waves', label: 'Brain waves', group: 'along the bottom' },
  { key: 'reward', label: 'Reward traces', group: 'along the bottom' },
  { key: 'boxes', label: 'Nine cages', group: 'over the arena' },
  { key: 'colony', label: 'Mouse colony', group: 'over the arena' },
  { key: 'feed', label: 'Activity feed', group: 'over the arena' },
  { key: 'threats', label: 'Threat stimuli', group: 'over the arena' },
  { key: 'mortality', label: 'Health & survival', group: 'over the arena' },
  { key: 'keys', label: 'Keyboard shortcuts', group: 'over the arena' },
  { key: 'hud', label: 'Mouse status', group: 'over the arena' },
  { key: 'scale', label: 'Scale bar', group: 'over the arena' },
];
// A new layout preference leaves old all-panels settings behind. Subsequent
// visits remember choices made in this layout; "clean view" restores it.
const PANEL_STORAGE = 'mlm-panels-v2';
const defaultPanelOn = Object.fromEntries(PANELS.map((p) =>
  [p.key, p.group === 'layout' || p.group === 'side panel']));
const panelOn = { ...defaultPanelOn };
try {
  const saved = JSON.parse(localStorage.getItem(PANEL_STORAGE) || '{}');
  for (const p of PANELS) {
    if (typeof saved?.[p.key] === 'boolean') panelOn[p.key] = saved[p.key];
  }
} catch { /* private mode */ }
const shown = (k) => panelOn[k] !== false;

function applyPanels() {
  for (const p of PANELS) {
    for (const e of document.querySelectorAll(`[data-panel="${p.key}"]`)) {
      e.classList.toggle('panel-off', !shown(p.key));
    }
  }
  grid.openPanel(shown('boxes'));
  mortality.open(shown('mortality'));
  $('b-boxes').classList.toggle('on', shown('boxes'));
  $('b-mortality').classList.toggle('on', shown('mortality'));
  $('b-colony').classList.toggle('on', shown('colony'));
  // the bottom strip closes up as its cells go away
  const anyTrace = shown('waves') || shown('reward');
  const tr = $('trace-right');
  if (tr) tr.classList.toggle('panel-off', !anyTrace);
  const ft = $('footer');
  if (ft) {
    ft.classList.toggle('panel-off', !shown('spikes') && !anyTrace);
    ft.classList.toggle('wide-traces', !shown('spikes') && anyTrace);
  }
  document.body.classList.remove('starting');
  resize();
  try { localStorage.setItem(PANEL_STORAGE, JSON.stringify(panelOn)); } catch { /* private mode */ }
}

let panelCategory = 'over the arena';
const PANEL_DESCRIPTIONS = {
  boxes: 'Cage conditions & tunnel controls', colony: 'Select mice & adjust their habitat',
  feed: 'Recent events in the colony', threats: 'Stimuli & behavioral responses',
  mortality: 'Fighting, stress & causes of death', keys: 'Navigation & simulation shortcuts',
  hud: 'Position & behavior on the platform', scale: 'Distance reference for the arena',
  brain: 'Interactive 3D brain anatomy', busiest: 'Regions with the most activity',
  region: 'Details for a selected brain region', maps: 'Spatial memories for each habitat',
  regions: 'Browse every simulated region', spikes: 'Neural firing over time',
  waves: 'Rhythms of neural activity', reward: 'Reward signals & predictions',
};
function buildPanelMenu() {
  const m = $('panel-options');
  const focused = m.contains(document.activeElement) ? document.activeElement.dataset.panelKey : null;
  m.textContent = '';
  for (const button of document.querySelectorAll('[data-panel-category]')) {
    button.setAttribute('aria-pressed', String(button.dataset.panelCategory === panelCategory));
  }
  for (const p of PANELS.filter((panel) => panel.group === panelCategory)) {
    const row = document.createElement('button');
    row.type = 'button';
    row.dataset.panelKey = p.key;
    row.setAttribute('role', 'menuitemcheckbox');
    row.setAttribute('aria-checked', String(shown(p.key)));
    row.className = 'mrow' + (shown(p.key) ? ' on' : '');
    row.innerHTML = `<span class="panel-option-copy"><strong>${p.label}</strong><small>${PANEL_DESCRIPTIONS[p.key]}</small></span><span class="panel-switch" aria-hidden="true"></span>`;
    row.onclick = (e) => { e.stopPropagation(); panelOn[p.key] = !shown(p.key); applyPanels(); buildPanelMenu(); };
    m.appendChild(row);
  }
  const foot = document.createElement('div');
  foot.className = 'mfoot';
  const btn = (text, fn) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.onclick = (e) => { e.stopPropagation(); fn(); applyPanels(); buildPanelMenu(); };
    return b;
  };
  foot.appendChild(btn('Show all', () => { for (const p of PANELS) panelOn[p.key] = true; }));
  foot.appendChild(btn('Clean view', restoreCleanView));
  $('panel-menu-footer').replaceChildren(foot);
  if (focused) m.querySelector(`[data-panel-key="${focused}"]`)?.focus({ preventScroll: true });
}

function togglePanelMenu(force) {
  const m = $('panel-menu');
  const wasOpen = !m.hidden;
  const open = force !== undefined ? force : m.hidden;
  m.hidden = !open;
  $('b-panels').classList.toggle('on', open);
  $('b-panels').setAttribute('aria-expanded', String(open));
  if (open) {
    m.removeAttribute('data-collapsed');
    m.querySelector('.panel-fold')?.setAttribute('aria-expanded', 'true');
    buildPanelMenu();
    floating.open(m);
    requestAnimationFrame(() => m.querySelector('[role="menuitemcheckbox"]')?.focus({ preventScroll: true }));
  } else if (wasOpen && m.contains(document.activeElement)) {
    ($('brain-pane').inert ? $('b-mobile-menu') : $('b-panels')).focus({ preventScroll: true });
  }
}
function restoreCleanView() {
  togglePanelMenu(false);
  floating.reset();
  Object.assign(panelOn, defaultPanelOn);
  signals?.open(false);
  optics.open?.(false);
  toggleReport(false);
  anatomy.open(false);
  syncSignalsBtn();
  $('stats-card').open = false;
  applyPanels();
}
$('b-panels').onclick = () => togglePanelMenu();
$('panel-menu-close').onclick = () => togglePanelMenu(false);
for (const button of document.querySelectorAll('[data-panel-category]')) {
  button.onclick = () => { panelCategory = button.dataset.panelCategory; buildPanelMenu(); };
}
$('panel-options').addEventListener('keydown', (event) => {
  const rows = [...$('panel-options').querySelectorAll('[role="menuitemcheckbox"]')];
  let index = rows.indexOf(document.activeElement);
  if (event.key === 'ArrowDown') index = (index + 1) % rows.length;
  else if (event.key === 'ArrowUp') index = (index - 1 + rows.length) % rows.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = rows.length - 1;
  else return;
  event.preventDefault();
  rows[index]?.focus();
});
document.addEventListener('click', (e) => {
  if (!$('panel-menu').contains(e.target) && !$('b-panels').contains(e.target)) togglePanelMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('panel-menu').hidden && !document.querySelector('dialog[open]')
    && !document.body.classList.contains('sidebar-open')) {
    e.preventDefault();
    togglePanelMenu(false);
  }
});

// clicking a card's title rolls it up without removing it
for (const h of document.querySelectorAll('.pcard > h4')) {
  if (h.id === 'pop-head') continue;          // that one has its own behaviour
  h.onclick = () => { h.parentElement.classList.toggle('shut'); resize(); };
}

// ----------------------------------------------------------------- toolbar
function cycleCamera(to) {
  camMode = to || CAM_MODES[(CAM_MODES.indexOf(camMode) + 1) % CAM_MODES.length];
  $('b-cam').value = camMode;
  controls.enabled = camMode === 'orbit';
  const overhead = camMode === 'top' || camMode === 'all nine';
  camera.up.set(0, overhead ? 0 : 1, overhead ? 1 : 0);
  // the fog is set for one cage; seeing all nine means seeing 4.9 m of floor
  if (scene.fog) {
    scene.fog.near = camMode === 'all nine' ? 4 : 2.4;
    scene.fog.far = camMode === 'all nine' ? 16 : 6.5;
  }
  if (camMode === 'orbit') {
    controls.target.set(0, 0.04, 0);
    camera.position.set(0.72, 0.62, 1.05);
  }
}
function togglePause() {
  paused = !paused;
  $('b-pause').classList.toggle('on', paused);
  $('b-pause').textContent = paused ? 'Resume' : 'Pause';
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
/** set the autopilot on one animal and keep the button honest about it */
function setAuto(ag, on) {
  ag.behavior?.interrupt(on ? 'explore' : 'manual');
  ag.auto = !!on;
  if (ag === agents[player]) {
    const b = $('b-auto');
    if (b) b.classList.toggle('on', ag.auto);
  }
}
function toggleAuto() {
  const ag = A();
  setAuto(ag, !ag.auto);
  if (!ag.auto) ag.moveTarget = null;
  logEvent('state', ag.auto
    ? `<b>${ag.name}</b> is foraging on its own again`
    : `you have the keys — <b>${ag.name}</b> is yours to drive`);
}
function toggleHelp() {
  if (!shown('keys')) {
    panelOn.keys = true;
    $('keys').removeAttribute('data-collapsed');
    applyPanels();
    return;
  }
  $('keys').toggleAttribute('data-collapsed');
}
function showWelcome(on) {
  const dialog = $('welcome');
  if (on && !dialog.open) dialog.showModal();
  if (!on && dialog.open) dialog.close();
}
function requestReset() {
  const dialog = $('reset-dialog');
  if (!dialog.open) {
    dialog.returnValue = '';
    dialog.showModal();
  }
}
function rotateCue() {
  arena.rotateCue(Math.PI / 2);
  // only the animals that can see this cue card
  for (const ag of playerBox().agents) ag.brain.rotateCompass(Math.PI / 2);
  logEvent('spatial', 'cue card turned 90° — the head-direction compass turned with it');
}
function doReset() {
  for (const ag of agents) {
    ag.mouse.reset();
    ag.mouse.x = ag.home.x; ag.mouse.z = ag.home.z; ag.mouse.heading = ag.home.heading;
    ag.brain.reset();
    ag.eatCount = 0; ag.drinkT = 0;
  }
  for (const bx of grid.boxes) {
    bx.arena.reset();
    bx.arena.setLight(bx.cond.light);
    bx.threats.reset();
    bx.litter.reset();
    bx.agents.length = 0;
    bx.deaths = 0; bx.arrived = 0; bx.left = 0;
  }
  grid.setOpen(false);
  grid.crossings = 0;
  mortality.reset();
  const mute = $('b-thr-mute');
  if (mute) mute.textContent = `sound: ${threats.muted ? 'off' : 'on'}`;
  for (const ag of agents) {
    ag.moveTarget = null; ag.pendingEat = null;
    ag.carrying = null; ag.nurseT = 0; ag.nursingNow = false; ag.halfway = false;
    ag.fleeUntil = 0; ag.attackT = 0; ag.attacks = 0; ag.opto = NO_DRIVE;
  }
  heldPup = null;
  // every animal goes, and the nine cages are stocked again from scratch
  while (agents.length) {
    const ag = agents.pop();
    if (ag.hasRig) { ag.mouse.root.visible = false; rigPool.push(ag.mouse); }
  }
  for (const bx of grid.boxes) bx.herd.sync([]);
  nameCount.M = 0; nameCount.F = 0;
  stockCages();
  player = Math.max(0, agents.findIndex((g) => g.box === grid.boxes[4]));
  followBox();
  setAuto(agents[player], true);
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
if ($('b-mortality')) $('b-mortality').onclick = () => toggleMortality();
if ($('b-boxes')) $('b-boxes').onclick = () => toggleBoxes();
if ($('b-speed')) $('b-speed').onchange = (e) => cycleSpeed(Number(e.target.value));
if ($('b-report')) $('b-report').onclick = () => toggleReport();
$('b-cam').onchange = (e) => cycleCamera(e.target.value);
$('b-pause').onclick = togglePause;
$('b-reset').onclick = requestReset;
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
  return steerMouse(ag, goal, out, urgency);
}

function driveAuto(ag, dt, out) {
  Object.assign(out, { throttle: 0, turn: 0, run: false, sniff: false, rear: false, groom: false, rest: false });
  const b = ag.brain, m = ag.mouse;
  // this animal's own cage, shadowing the module-level "cage you are looking
  // at" aliases, so everything below reads the conditions it is actually in
  const arena = ag.box.arena, litter = ag.box.litter;
  const mate = other(agents.indexOf(ag));
  let goal = null, urgency = 0.45;

  // ---- defence outranks every other motive ----
  if (b.mode === 'hide' || b.freeze > .45 && b.mode !== 'flight') {
    ag.behavior.interrupt(b.mode === 'hide' ? 'hide' : 'freeze');
    return out;
  }
  if (b.flight > .3) {
    ag.behavior.interrupt('flee');
    const src = b.threatSource;
    const away = src ? Math.atan2(m.x - src.x, m.z - src.z) : Math.atan2(m.x, m.z);
    const run = b.escapeTarget || {
      x: clamp(m.x + Math.sin(away) * .8, -arena.half + .055, arena.half - .055),
      z: clamp(m.z + Math.cos(away) * .8, -arena.half + .055, arena.half - .055),
    };
    steerTo(ag, run, out, 1);
    out.run = true; out.sniff = false;
    return out;
  }
  if (b.risk > .3 && b.threatSource) {
    const src = b.threatSource, d = Math.max(.02, Math.hypot(m.x - src.x, m.z - src.z));
    const standoff = .28 + .2 * b.fear;
    if (d < standoff || sessionT < (ag.assessUntil || 0) || sessionT > (ag.nextAssessT || 0)) {
      if (sessionT > (ag.nextAssessT || 0)) {
        ag.assessUntil = sessionT + .7 + ag.behavior.boldness * .7;
        ag.nextAssessT = sessionT + 2.5 + ag.behavior.boldness * 2;
      }
      ag.behavior.interrupt('risk assessment');
      if (d < standoff - .025) {
        const post = { x: clamp(src.x + (m.x - src.x) / d * standoff, -.54, .54),
          z: clamp(src.z + (m.z - src.z) / d * standoff, -.54, .54) };
        steerTo(ag, post, out, .35); out.throttle *= .65;
      } else {
        out.turn = clamp(-angDiff(Math.atan2(src.x - m.x, src.z - m.z), m.heading) * 1.8, -1, 1);
      }
      out.sniff = true; out.rear = false;
      return out;
    }
  }

  const wantDrink = b.drives.drink ? b.thirst : 0;
  const wantEat = b.drives.eat ? b.hunger : 0;

  // being attacked, or attacking, overrides every other motive
  const od = ag.opto || NO_DRIVE;
  if (ag.fleeUntil > sessionT && mate) {
    const away = Math.atan2(m.x - mate.mouse.x, m.z - mate.mouse.z);
    goal = { x: clamp(m.x + Math.sin(away) * 0.5, -0.55, 0.55),
             z: clamp(m.z + Math.cos(away) * 0.5, -0.55, 0.55) };
    urgency = 1;
  } else if (Math.max(od.aggression || 0, b.aggression || 0) > 0.35 && mate) {
    // a dominant male pursues the loser, and in a cage there is nowhere to go
    goal = { x: mate.mouse.x, z: mate.mouse.z };
    urgency = 1;
  }

  // a body in the cage is collected like a stray, and eaten
  if (!goal && b.parentalDrive > 0.15 && typeof litter.nearestCarcass === 'function') {
    const dead = litter.nearestCarcass(m.x, m.z);
    if (dead && dead.dist < 0.5) { goal = { x: dead.pup.x, z: dead.pup.z }; urgency = 0.45; }
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

  // ---- is what it needs even in this cage? ----
  // A thirsty mouse in the cage with no dish has to leave it, and with the
  // tunnels open it can. This is what redistributes the colony.
  if (!goal && grid.open) {
    const noWater = !arena.dish && arena.waterLevel < 0.05;
    const noFood = !arena.cheeses.some((c) => !c.eaten);
    const needWater = wantDrink > 0.45 && noWater;
    const needFood = wantEat > 0.45 && noFood;
    const flee = b.fear > 0.5 || b.aversion > 0.5;
    if (needWater || needFood || flee) {
      const mouth = grid.nearestMouth(ag.box, m.x, m.z, (far) => (
        needWater ? !!far.arena.dish
          : needFood ? far.arena.cheeses.some((c) => !c.eaten)
            : true));
      if (mouth) {
        goal = mouth.mouth;
        urgency = flee ? 1 : 0.8;
        ag.leaving = needWater ? 'water' : needFood ? 'food' : 'the conditions';
      }
    }
  }

  if (goal) {
    ag.behavior.interrupt('alert');
    steerTo(ag, goal, out, urgency);
    return out;
  }

  const plan = ag.behavior.choose(ag, { grid, mate,
    threatAt: (x, z) => threatAt(b, x, z) });
  if (plan.stationary) {
    out.sniff = ['sniff', 'rear', 'investigate'].includes(plan.action);
    out.rear = plan.action === 'rear';
    out.groom = plan.action === 'groom';
    out.rest = plan.action === 'rest';
    if (plan.action === 'investigate' && plan.goal) {
      out.turn = clamp(-angDiff(Math.atan2(plan.goal.x - m.x, plan.goal.z - m.z), m.heading), -1, 1);
    }
    return out;
  }
  steerTo(ag, plan.goal, out, plan.urgency);
  const stoppingDistance = plan.action === 'drink' ? (plan.goal.r || .075) + .035 : .065;
  if (['eat', 'drink'].includes(plan.action) && Math.hypot(m.x - plan.goal.x, m.z - plan.goal.z) < stoppingDistance) {
    out.throttle = 0; out.run = false; out.sniff = true;
    out.turn = clamp(-angDiff(Math.atan2(plan.goal.x - m.x, plan.goal.z - m.z), m.heading) * 2, -1, 1);
  }
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
let heldBox = null;
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
    // picking uses real meshes, so the parent transform is already applied
    let pup = null;
    for (const bx of grid.boxes) { pup = bx.litter.pickAt(clickRay); if (pup) { heldBox = bx; break; } }
    if (pup) {
      heldPup = pup;
      pup.mesh.scale.multiplyScalar(1.35);
      logEvent('state', `you lifted <b>pup ${pup.id}</b> — click anywhere to put it down`);
      return;
    }
  }
  if (!heldPup) {
    // Detailed bodies and instanced mice are both selectable. Anatomy opens
    // before floor navigation, so clicking a mouse never sends it elsewhere.
    const targets = [];
    for (const box of grid.boxes) {
      for (const ag of box.agents) if (ag.hasRig && !ag.dead) targets.push(ag.mouse.root);
      if (box.herd.mesh.count) targets.push(box.herd.mesh, box.herd.details);
    }
    let selectedMouse = null;
    for (const hit of clickRay.intersectObjects(targets, true)) {
      if (hit.instanceId !== undefined) {
        const box = grid.boxes.find((bx) => hit.object === bx.herd.mesh || hit.object === bx.herd.details);
        selectedMouse = box?.agents.filter((ag) => !ag.hasRig)[hit.instanceId];
      } else selectedMouse = agents.find((ag) => ag.hasRig && ag.mouse.root.getObjectById(hit.object.id));
      if (selectedMouse && !selectedMouse.dead) break;
      selectedMouse = null;
    }
    if (!selectedMouse) {
      // Keep small mice usable at overview zoom, especially on touch screens.
      const point = new THREE.Vector3(), radius = e.pointerType === 'touch' ? 16 : 9;
      let nearest = radius;
      for (const ag of agents) {
        if (ag.dead) continue;
        point.set(worldX(ag, ag.mouse.x), .02, worldZ(ag, ag.mouse.z)).project(camera);
        if (point.z > 1 || point.z < -1) continue;
        const gap = Math.hypot((point.x * .5 + .5) * r.width + r.left - e.clientX,
          (-point.y * .5 + .5) * r.height + r.top - e.clientY);
        if (gap < nearest) { nearest = gap; selectedMouse = ag; }
      }
    }
    if (selectedMouse) {
      takeControl(agents.indexOf(selectedMouse)); marker.visible = false; anatomy.open(true); return;
    }
  }
  if (!clickRay.ray.intersectPlane(groundPlane, hitPoint)) return;
  // the plane hit is in world coordinates; everything below it is cage-local
  const hitBox = grid.boxAt(hitPoint.x, hitPoint.z);
  if (!hitBox) return;
  const local = hitBox.toLocal(hitPoint.x, hitPoint.z);
  hitPoint.x = local.x; hitPoint.z = local.z;
  const lim = hitBox.arena.half - 0.03;
  if (heldPup) {
    const px = clamp(hitPoint.x, -lim, lim), pz = clamp(hitPoint.z, -lim, lim);
    if (hitBox !== heldBox) { heldPup.mesh.scale.setScalar(heldPup.mesh.scale.x / 1.35); heldPup = null; return; }
    const litter = heldBox.litter;
    heldBox.litter.displace(heldPup, px, pz);
    heldPup.mesh.scale.setScalar(heldPup.mesh.scale.x / 1.35);
    const far = litter.nest ? Math.hypot(px - litter.nest.x, pz - litter.nest.z) : 0;
    logEvent('state', far > 0.12
      ? `you put <b>pup ${heldPup.id}</b> down ${(far * 100).toFixed(0)} cm from the nest — it will start calling`
      : `you put <b>pup ${heldPup.id}</b> back in the nest`);
    heldPup = null;
    return;
  }
  // clicking in another cage takes control of an animal in that cage, which
  // is the quickest way to go and look at what is happening over there
  let ag = A();
  if (hitBox !== ag.box) {
    const there = agents.findIndex((g) => g.box === hitBox && !g.dead);
    if (there >= 0) { takeControl(there); ag = A(); }
    else return;
  }
  ag.moveTarget = { x: clamp(hitPoint.x, -lim, lim), z: clamp(hitPoint.z, -lim, lim) };
  const w = ag.box.toWorld(ag.moveTarget.x, ag.moveTarget.z);
  marker.position.set(w.x, 0.005, w.z);
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
/** an animal with no autopilot and nobody driving it does nothing */
const NO_CMD = Object.freeze({ throttle: 0, turn: 0, run: false, sniff: false });
let last = performance.now();
let sessionT = 0;
let mapAcc = 0, valueAcc = 0, hudAcc = 0, autoAcc = 0;
let shadowAcc = 0, brainAcc = 0, lodAcc = 0, colonyAcc = 0;
let frameNo = 0;
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
  const arena = ag.box.arena, litter = ag.box.litter;
  const driving = ag === agents[player];
  // a dead animal is a body in the cage: no commands, no brain, no state
  if (ag.dead) {
    ag.state = 'DEAD';
    if (typeof m.update === 'function') m.update(dt, { throttle: 0, turn: 0, run: false, sniff: false }, b);
    return null;
  }
  ag.behavior.update(ag, dt);
  // Every animal is on autopilot unless you have taken the keys off it. The
  // one you are driving reads the keyboard, and touching a key is itself the
  // instruction to stop driving itself.
  let cmd;
  if (driving) {
    readInput();
    if (input.throttle || input.turn) {
      ag.moveTarget = null;
      if (ag.auto) setAuto(ag, false);
    }
  }
  if (ag.auto && (b.flight > .3 || b.freeze > .45 || b.mode === 'hide')) {
    ag.moveTarget = null;
    cmd = driveAuto(ag, dt, autoCmd);
  } else if (ag.moveTarget) {
    // a click sends it there whether or not the autopilot is on, and it picks
    // its own business back up when it arrives
    const left = steerTo(ag, ag.moveTarget, autoCmd, 0.5);
    if (left < 0.05) ag.moveTarget = null;
    cmd = autoCmd;
  } else if (ag.auto) {
    cmd = driveAuto(ag, dt, autoCmd);
  } else {
    cmd = driving ? input : NO_CMD;
  }

  // a mating bout holds both animals still
  const inBout = mateBout > 0 && matePair.has(ag);
  const eff = inBout
    ? { throttle: 0, turn: 0, run: false, sniff: true, rear: false, groom: false, rest: false }
    : { throttle: cmd.throttle, turn: cmd.turn, run: cmd.run, sniff: cmd.sniff,
      rear: cmd.rear ?? cmd.sniff, groom: !!cmd.groom, rest: !!cmd.rest };
  // wading through water is hard work
  eff.throttle *= 1 - 0.6 * arena.waterLevel;
  // optogenetically induced freezing stops the animal dead
  const od = ag.opto || NO_DRIVE;
  if ((od.freeze || 0) > 0.5) { eff.throttle = 0; eff.turn = 0; eff.groom = eff.rear = eff.rest = false; }
  // Defence, from the brain's last update. A freezing mouse cannot be driven
  // with the keyboard either — that is what freezing is.
  if (b.flight > .3 && b.mode === 'flight') { eff.run = true; eff.sniff = eff.rear = eff.groom = eff.rest = false; }
  else if (b.freeze > .45 || b.mode === 'hide') { eff.throttle = 0; eff.turn = 0; eff.sniff = false; eff.groom = eff.rear = eff.rest = false; }
  else if (b.risk > 0.3) { eff.throttle *= 0.5; eff.sniff = true; }
  if (od.locomotor) eff.throttle = clamp(eff.throttle + od.locomotor * 0.6, -1, 1);
  if (od.turnBias) eff.turn = clamp(eff.turn + od.turnBias, -1, 1);

  m.update(dt, eff, b);

  // ---- through a tunnel into the next cage ----
  if (grid.open && sessionT > (ag.crossT || 0)) {
    const cross = grid.crossingFor(ag);
    if (cross) transferAgent(ag, cross);
  }

  const noseReach = .050 * (m.root.scale.x || 1);
  const nx = m.x + Math.sin(m.heading) * noseReach;
  const nz = m.z + Math.cos(m.heading) * noseReach;

  const safeToConsume = !b.drives.fear || (b.flight < .25 && b.freeze < .4 && b.fear < .35);
  // ---- eating ----
  let ate = null;
  if (safeToConsume && b.drives.eat && (b.hunger > .18 || (od.feeding || 0) > .4)) {
    ate = arena.tryEat(nx, nz, 0.05);
    if (ate) {
      m.onEat();
      ag.behavior.consume('eat', m);
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
  if (safeToConsume && b.drives.drink && atWater && b.thirst > 0.06 && m.speed < 0.08) {
    ag.drinkT += dt;
    if (ag.drinkT > 0.9) {
      ag.drinkT = 0; drank = true;
      ag.behavior.consume('drink', m);
      logEvent('state', `<b>${ag.name}</b> drank — thirst neurons dropped to <b>${b.byKey.sfo.smooth.toFixed(0)} Hz</b>`);
    }
  } else if (!atWater || !safeToConsume) {
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

  // ---- a carcass in the nest is eaten, not mourned ----
  // This is the behaviour that gets reported as maternal infanticide: the pup
  // was already dead, usually of cold, and the dam consumes the body.
  if (b.parentalDrive > 0.15 && typeof litter.nearestCarcass === 'function') {
    const dead = litter.nearestCarcass(m.x, m.z);
    if (dead && dead.dist < 0.045) litter.consume(dead.pup, ag);
  }

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
  // Animals you are not inspecting think at a lower rate. Events that happen on
  // a frame where the brain does not run are held and delivered on the next one.
  ag.accDt += dt;
  if (ate) ag.pend.ate = true;
  if (drank) ag.pend.drank = true;
  if (nursed) ag.pend.nursed = true;
  if (retrieved) ag.pend.retrieved = true;

  st.partner = mate ? {
    dist: pdist,
    bearing: angDiff(Math.atan2(pdx, pdz), m.heading),
    sex: mate.sex,
    receptive: mate.brain.estrous,
  } : null;
  if (st.mated) ag.pend.mated = true;

  st.mature = ag.mature;
  // crowding escalates male aggression, in a cage as in a colony room
  st.crowding = clamp(ag.box.population / 6, 0, 1);
  // how close the nearest live pup is: what a male's BSTrh is answering to
  st.pupNear = litter.pups && litter.pups.length
    ? Math.max(0, ...litter.pups.filter((q) => !q.dead && !q.carried)
        .map((q) => clamp(1 - Math.hypot(q.x - m.x, q.z - m.z) / 0.12, 0, 1)))
    : 0;
  if (st.partner && mate) st.partner.familiar = mortality.familiarity(ag, mate);

  // Predator cues: sounds reach the whole cage, odours are a gradient the
  // animal has to move through. The onset of a stimulus and the startle
  // impulse are both shorter than one brain step for an animal thinking at
  // the reduced rate, so they are held the same way the other events are.
  const refuge = arena.shelter;
  const underCover = !!refuge && Math.abs(m.x - refuge.x) < .05 && Math.abs(m.z - refuge.z) < .065;
  st.threat = ag.box.threats.sense(m.x, m.z, m.heading, underCover);
  st.threat.shelterTarget = ag.behavior.memory(ag.box).shelter;
  // a mouse that can see its cagemate freeze catches the fear from it
  st.threat.socialFreeze = mate && pdist < 0.35 ? mate.brain.freeze : 0;
  if (st.threat.onset) ag.pend.threatOnset = st.threat.onset;
  ag.pend.startle = Math.max(ag.pend.startle || 0, st.threat.startle);
  ag.pend.imminence = Math.max(ag.pend.imminence || 0, st.threat.imminence);
  const doBrain = b.detail >= 2 || (frameNo % BRAIN_STRIDE) === ag.phase;
  if (doBrain) {
    const bdt = Math.min(0.12, ag.accDt);
    st.ate = !!ag.pend.ate;
    st.drank = !!ag.pend.drank;
    st.nursed = !!ag.pend.nursed;
    st.retrieved = !!ag.pend.retrieved;
    st.mated = !!ag.pend.mated;
    st.threat.onset = ag.pend.threatOnset || null;
    st.threat.startle = Math.max(st.threat.startle, ag.pend.startle || 0);
    st.threat.imminence = Math.max(st.threat.imminence, ag.pend.imminence || 0);
    b.update(st, bdt);

    // optogenetic modulation sits on top of the physiology, per animal
    ag.opto = optics.apply(b, bdt) || NO_DRIVE;
    // the body shows whichever is stronger: the light, or real fear
    const drive = { ...ag.opto };
    drive.fear = clamp(Math.max(b.fear, drive.fear || 0), 0, 1);
    drive.freeze = clamp(Math.max(b.freeze, drive.freeze || 0), 0, 1);
    if (typeof m.setBehaviourDrive === 'function') m.setBehaviourDrive(drive);
    ag.accDt = 0;
    ag.pend = {};
  }

  // ---- behavioural state label ----
  const vcm = Math.abs(m.speed) * 100;
  const odd = ag.opto || NO_DRIVE;
  let state = 'RESTING';
  const agg = Math.max(b.aggression || 0, odd.aggression || 0);
  if ((odd.freeze || 0) > 0.5) state = 'FREEZING';
  else if (agg > 0.45) state = b.maternalAgg > 0.4 ? 'DEFENDING NEST' : 'ATTACKING';
  else if (b.infanticide > 0.4) state = 'STALKING A PUP';
  else if (b.defenseState) state = b.defenseState;
  else if (b.health < 0.6) state = 'WOUNDED';
  else if (ag.fleeUntil > sessionT) state = 'FLEEING';
  else if (inBout) state = 'MATING';
  else if (ag.carrying) state = 'CARRYING PUP';
  else if (ag.nursingNow) state = 'NURSING';
  else if ((b.eating > .35 || m.chew > .2) && Math.abs(m.speed) < .02) state = 'EATING';
  else if (atWater && b.drinking > .3 && Math.abs(m.speed) < .06) state = 'DRINKING';
  else if (pdist < 0.1 && b.pheromone > 0.15) state = 'INVESTIGATING';
  else if (m.groom > .3) state = 'GROOMING';
  else if (m.rest > .3) state = 'RESTING';
  else if (m.rear > 0.4) state = 'REARING';
  else if (ag.auto && ag.behavior.bout > 0 && ag.behavior.action === 'sniff') state = 'SNIFFING';
  else if (ag.auto && vcm > 2 && ag.behavior.action === 'drink') state = 'SEEKING WATER';
  else if (ag.auto && vcm > 2 && ag.behavior.action === 'eat') state = 'FORAGING';
  else if (ag.auto && vcm > 2 && ag.behavior.action === 'return home') state = 'RETURNING TO SHELTER';
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
      if (a.sex === b.sex || !a.mature || !b.mature || a.dead || b.dead) continue;
      if (a.box !== b.box) continue;
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
    if (ag.dead) continue;
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
  const litter = fem.box.litter;
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

/** one step of the world, of length dt. Called more than once per frame when
 *  the simulation is running faster than real time. */
function stepWorld(dt) {
  sessionT += dt;
  for (const bx of grid.boxes) {
    bx.threats.update(dt, sessionT);
    stepCondition(bx, dt);
  }
  stepMating(dt);
  stepAging(dt);
  mortality.step(dt);
  stepBirth(dt);
  for (let i = 0; i < agents.length; i++) stepAgent(agents[i], i, dt);
  for (const box of grid.boxes) separateMice(box);
  const pbox = playerBox();
  for (const bx of grid.boxes) {
    // each cage animates around whichever animal is in it
    const focus = bx === pbox ? A() : (bx.agents.find((g) => !g.dead) || A());
    bx.arena.update(dt, sessionT, focus.mouse, focus.brain);
    bx.litter.update(dt, sessionT, bx.agents);
  }
}

function frame(now) {
  const dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
  last = now;
  adaptResolution(dt);

  frameNo++;
  lodAcc += dt;
  if (lodAcc > 0.4) { lodAcc = 0; updateLOD(); }

  // Faster than real time means more steps of the same length, not longer
  // steps: every integrator here — Poisson spiking, the 1 kHz field
  // potential, the theta phase — is only valid at a sane dt, and stretching
  // it would quietly distort all of them.
  //
  // The steps are a fixed length and the leftover is carried, so the
  // multiplier means what it says whatever the frame rate is doing. The cap
  // is what stops a slow frame asking for more steps than the next frame can
  // afford, which is how a simulation loop spirals.
  if (!paused) {
    simAcc += dt * simSpeed;
    const cap = 8 * simSpeed;
    let n = 0;
    while (simAcc >= SUB_STEP && n < cap) { stepWorld(SUB_STEP); simAcc -= SUB_STEP; n++; }
    if (n >= cap) simAcc = 0;              // gave up on the backlog
    simStepsLast = n;
  }

  // Selection and camera changes can swap rigs even while paused. Keep the
  // rendered instances and their picking order synchronized in either state.
  for (const bx of grid.boxes) {
    proxyScratch.length = 0;
    for (const ag of bx.agents) {
      if (ag.hasRig) continue;
      // let the instanced bodies show the defensive state the rig would
      ag.mouse.freeze = ag.brain.freeze || 0;
      ag.mouse.fear = ag.brain.fear || 0;
      ag.mouse.risk = ag.brain.risk || 0; ag.mouse.startle = ag.brain.startle || 0;
      ag.mouse.dead = !ag.brain.alive;
      proxyScratch.push(ag.mouse);
    }
    bx.herd.sync(proxyScratch);
  }

  // ---- camera follows whichever mouse you are driving ----
  // Bodies are positioned in cage-local coordinates inside an offset group, so
  // anything the camera or a raycast touches has to be converted to world.
  const pa = A();
  const pm = pa.mouse;
  const px = worldX(pa, pm.x), pz = worldZ(pa, pm.z);
  fwd.set(Math.sin(pm.heading), 0, Math.cos(pm.heading));
  if (camMode === 'follow') {
    const k = Math.min(1, pm.speed / MAX_RUN);
    camWant.set(px, 0, pz).addScaledVector(fwd, -(0.44 + 0.2 * k));
    camWant.y = 0.23 + 0.05 * k;
    camera.position.lerp(camWant, 1 - Math.exp(-dt * 4.5));
    camLook.set(px, 0.028, pz).addScaledVector(fwd, 0.14);
    camera.lookAt(camLook);
  } else if (camMode === 'top') {
    camera.position.set(pa.box.origin.x, 1.42, pa.box.origin.z);
    camera.lookAt(pa.box.origin.x, 0, pa.box.origin.z);
  } else if (camMode === 'all nine') {
    // high enough that 4.9 m of floor fits the vertical field of view
    camera.position.set(0, PITCH * 4.3, 0.001);
    camera.lookAt(0, 0, 0);
  } else {
    controls.update();
  }

  shadowAcc += dt;
  if (shadowAcc > 0.05) { shadowAcc = 0; renderer.shadowMap.needsUpdate = true; }
  renderer.render(scene, camera);
  anatomy.update(dt);

  // ---- panels (always show the mouse you are driving) ----
  const brain = A().brain;
  activation = brain.regionActivation();
  if (!paused) {
    // the traces are a record of simulated time, so they scroll at the rate
    // the simulation is actually running at
    const simDt = simStepsLast * SUB_STEP;
    if (shown('spikes')) raster.draw(brain, simDt);
    lfpTrace.push(brain, simDt);
    daTrace.push(brain, simDt);
  }
  if (shown('waves')) lfpTrace.draw();
  if (shown('reward')) daTrace.draw();
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
  if (signals) { signals.update(dt); syncSignalsBtn(); }

  const tgt = A().moveTarget;
  marker.visible = !!tgt;
  if (tgt) {
    const wt = A().box.toWorld(tgt.x, tgt.z);
    marker.position.set(wt.x, 0.005, wt.z);
    marker.scale.setScalar(1 + 0.16 * Math.sin(sessionT * 7));
  }

  hudAcc += dt;
  if (hudAcc > 0.1) { hudAcc = 0; updateHud(); }
  colonyAcc += dt;
  if (colonyAcc > 0.5) { colonyAcc = 0; updateColony(); }

  requestAnimationFrame(frame);
}

function updateColony() {
  const mins = Math.max(sessionT, 1) / 60;
  cards.forEach((c, i) => {
    const g = c.agent;
    if (!g) return;
    const b = g.brain;
    const isMe = g === A();
    c.el.classList.toggle('me', isMe);
    c.you.style.visibility = isMe ? 'visible' : 'hidden';
    c.state.textContent = g.state.toLowerCase();
    c.age.textContent = g.mature ? 'adult' : `${Math.floor(g.ageDays)}d`;
    c.age.classList.toggle('juv', !g.mature);
    if (c.cage) {
      c.cage.textContent = g.box ? g.box.cond.name : '';
      c.cage.style.opacity = g.box === playerBox() ? '1' : '0.55';
    }
    const set = (k, v) => {
      if (c.fills[k]) c.fills[k].style.width = `${(clamp(v, 0, 1) * 100).toFixed(0)}%`;
    };
    set('hunger', b.drives.eat ? b.hunger : 0);
    set('thirst', b.drives.drink ? b.thirst : 0);
    set('mate', b.mateDrive);
    const cond = clamp(b.health - (g.surv ? g.surv.weightLoss * 3 : 0), 0, 1);
    set('health', cond);
    if (c.fills.health) {
      c.fills.health.style.background = cond > 0.65 ? SLOT.motor : cond > 0.3 ? SLOT.reward : SLOT.state;
    }
    c.el.classList.toggle('dead', !!g.dead);

    let rep = '';
    if (b.pregnant) {
      const day = (b.gestation * GESTATION / DAY).toFixed(0);
      rep = `<span class="pg">pregnant</span> day ${day}/${(GESTATION / DAY).toFixed(0)} · ${b.litterSize} pups
             <span class="pbar"><span style="width:${(b.gestation * 100).toFixed(0)}%"></span></span>`;
    } else if (g.dead) {
      const cz = CAUSES[g.cause];
      rep = `<span class="stray">dead</span> — ${cz ? cz.label : g.cause} · ${Math.round(g.ageDays)} days old`;
    } else if (b.pupCount > 0 && g.box.litter.count) {
      const lt = g.box.litter;
      rep = `<span class="pg">${g.sex === 'F' ? 'nursing' : 'with'} ${lt.count}</span> · day ${lt.days.toFixed(0)}` +
            (lt.strays ? ` · <span class="stray">${lt.strays} astray</span>` : '') +
            (lt.lost ? ` · <span class="stray">${lt.lost} lost</span>` : '');
    } else {
      rep = `ate ${b.cheeseCount} · drank ${b.drinkCount} · mated ${b.mateCount}` +
            (b.litters ? ` · ${b.litters} litter${b.litters > 1 ? 's' : ''}` : '');
    }
    c.repro.innerHTML = rep;
  });
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
  ui.update();
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

  // ---- threats: what is being presented, and what it is doing ----
  const tstat = threats.status();
  const tsub = $('thr-sub');
  if (tsub) {
    tsub.textContent = tstat.predator?.label || (tstat.odour
      ? `${tstat.odour.label} · ${(tstat.odour.level * 100) | 0}%`
      : (tstat.sound || ''));
    for (const button of tgrid.querySelectorAll('[data-stimulus]')) {
      const active = button.dataset.stimulus === tstat.predator?.key || button.dataset.stimulus === tstat.odour?.key
        || STIMULI[button.dataset.stimulus]?.label === tstat.sound;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    }
    $('b-thr-clear').disabled = !tstat.predator && !tstat.odour && !tstat.sound;
    $('b-thr-view').disabled = !tstat.predator;
    $('thr-context').textContent = brain.sheltered ? 'Under cover · waiting for danger to pass'
      : brain.escapeTarget ? 'Refuge remembered · directed escape available'
      : 'No refuge remembered · freezing or retreat may occur';
  }
  const tstate = $('thr-state');
  if (tstate) {
    const d = brain.defenseState;
    tstate.textContent = d
      ? d.toLowerCase()
      : brain.aversion > 0.12 ? 'avoiding the corner' : 'nothing to worry about';
    tstate.className = `tstate${d ? ' on' : ''}`;
    const setBar = (id, v, col) => {
      const el = $(id);
      if (!el) return;
      el.style.width = `${(clamp(v, 0, 1) * 100).toFixed(0)}%`;
      el.style.background = col;
    };
    setBar('thr-fear', brain.fear, SLOT.state);
    setBar('thr-cort', brain.cort, SLOT.reward);
    $('thr-fear-v').textContent = `${(brain.fear * 100) | 0}%`;
    $('thr-cort-v').textContent = `${(brain.cort * 100) | 0}%`;
    $('thr-frz').textContent = `${(brain.freezePct * 100) | 0}%`;
    const q = brain.quadrantOccupancy;
    $('thr-quad').textContent = q === null ? '—' : `${(q * 100) | 0}%`;
  }

  const mb = $('b-mortality');
  if (mb) mb.classList.toggle('on', mortality.isOpen());
  const bb = $('b-boxes');
  if (bb) bb.classList.toggle('on', grid.isOpen());
  const rb = $('b-report');
  if (rb) rb.classList.toggle('on', report.isOpen());
  followBox();
  grid.render();

  const ob = $('b-optics');
  if (ob && ob.style.display !== 'none') ob.classList.toggle('on', opticsOpen());

  const sub = $('col-sub');
  const pups = grid.boxes.reduce((n, bx) => n + (bx.litter ? bx.litter.count : 0), 0);
  if (sub) sub.textContent = `${agents.filter((g) => !g.dead).length} mice${pups ? ` · ${pups} pups` : ''}`
    + (grid.open ? ' · connected' : '');
}

// Fold any floating card by its header. Delegated, so cards mounted later
// (by other modules) fold the same way without re-registering.
document.addEventListener('click', (e) => {
  const h = e.target.closest && e.target.closest('.float h5[data-fold]');
  if (h) h.parentElement.toggleAttribute('data-collapsed');
});

// Start directly in the platform. The explainer remains behind the "?" button.
$('welcome-start').onclick = () => showWelcome(false);
$('welcome').onclick = (e) => { if (e.target === $('welcome')) showWelcome(false); };

applyPanels();
buildPanelMenu();

const ui = mountInterface({
  getState: () => ({ agent: A(), population: agents.filter((ag) => !ag.dead).length,
    time: fmtTime(sessionT), paused, speed: simSpeed }),
  nextMouse: () => {
    for (let offset = 1; offset <= agents.length; offset++) {
      const index = (player + offset) % agents.length;
      if (!agents[index].dead) { takeControl(index); break; }
    }
  },
  togglePanel: (key, force) => {
    panelOn[key] = force ?? !shown(key);
    applyPanels();
  },
  restart: doReset,
  cleanView: restoreCleanView,
  resize,
});
const floating = mountFloatingPanels($('world-pane'));

setLight(0.35);
setWater(0);
resize();
applySize(true);
requestAnimationFrame(frame);

window.sim = {
  agents, arena, litter, brainView, THREE, camera, scene, renderer, controls,
  anatomy,
  get optics() { return optics; },
  get brain() { return A().brain; },
  get mouse() { return A().mouse; },
  setCam: (m) => { while (camMode !== m) cycleCamera(); },
  takeControl, setLight, setWater, toggleDrive,
};
