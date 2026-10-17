/**
 * A running model of the mouse's brain while it forages.
 *
 * ~480 model neurons in 26 Allen-CCF regions. Every cell has a tuning curve
 * taken from the published response properties of that cell type, is driven by
 * the simulated animal's own position / heading / speed / sensory input, and
 * emits Poisson spikes. Nothing here is a recording; everything here is a
 * reproduction of a measured phenomenon. Key parameters are cited inline.
 *
 * Coordinates: arena-centred metres. x = right, z = forward/"north".
 * heading 0 = +z, increasing clockwise when seen from above.
 */

import { ROLES } from './regions.js';

// ---------------------------------------------------------------- utilities
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;
/** shortest signed angular difference, in (-PI, PI] */
function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

const BINS = 32;            // rate-map resolution
const HD_BINS = 36;         // 10 deg per bin
const TRAJ_DT = 0.05;       // trajectory sample period (s)
const TRAJ_MAX = 160;       // 8 s of history for replay

// One simulated "day" is five seconds, so a pregnancy you can actually sit
// through. Everything downstream of this is in real mouse units.
export const DAY = 5;
export const GESTATION = 19.5 * DAY;   // 19-20 days in C57BL/6
export const WEANING = 21 * DAY;       // pups weaned at ~3 weeks
export const EYES_OPEN = 13 * DAY;

/**
 * How much of a region's activity comes from the regions that anatomically
 * project to it. Kept modest: the tuning curves are what make each population
 * mean something, and this is the synaptic context around them.
 */
const NET_GAIN = 0.18;

/**
 * Tracer data records that an axon arrives, not what it does on arrival. Most
 * long-range projections in the mouse brain are glutamatergic, but the striatal
 * and extended-amygdala outputs are GABAergic projection neurons, and the
 * midbrain dopamine cells are neuromodulatory rather than driving.
 */
const PROJECTION_SIGN = {
  CP: -1, ACB: -1, CEA: -1, BST: -1,        // GABAergic projection neurons
  VTA: 0.35, SNc: 0.35,                     // dopaminergic, modulatory
};

// ---------------------------------------------------------------- population
/**
 * Nothing fires arbitrarily fast. Cortical and hypothalamic cells saturate
 * around 100-150 Hz; cerebellar Purkinje cells genuinely do run far faster
 * (simple spikes 50-150 Hz, peaks well above); dopamine cells burst to ~60.
 */
const MAX_RATE = { CB: 260, VTA: 70, SNc: 70, 'SSp-bfd': 180, MOB: 160 };
const MAX_RATE_DEFAULT = 130;

/**
 * The field potential is generated at 1 kHz rather than once per frame. A
 * frame-rate signal cannot represent anything above ~30 Hz, so gamma and
 * ripples would be invisible to any spectrum taken from it.
 */
export const LFP_FS = 1000;
const LFP_N = 2048;            // ~2 s of history
const ISI_BINS = 100, ISI_BIN_MS = 10;   // intervals out to 1 s

class Population {
  constructor(key, region, label, n, refMax, opts = {}) {
    this.maxRate = opts.maxRate ?? MAX_RATE[region] ?? MAX_RATE_DEFAULT;
    this.key = key;
    this.region = region;
    this.label = label;
    this.n = n;
    this.refMax = refMax;              // Hz that counts as "fully active"
    this.rate = new Float32Array(n);
    this.spikes = new Uint8Array(n);
    this.mean = 0;
    this.max = 0;
    this.smooth = 0;                   // display-smoothed mean rate
    this.smoothMax = 0;                // display-smoothed peak rate
    this.norm = 0;                     // 0..1 activation
    this.cells = [];
    this.mapped = !!opts.mapped;       // accumulate 2-D rate maps?
    this.peakNorm = !!opts.peakNorm;   // sparse code: normalise by the best cell
    this.weight = opts.weight ?? 1;    // contribution to its region's activation
    if (this.mapped) this.spikeMap = new Float32Array(n * BINS * BINS);
    if (opts.hd) {
      this.hdMap = new Float32Array(n * HD_BINS);
      this.hd = true;
    }
    // inter-spike intervals, accumulated the way a spike sorter reports them
    this.isiHist = new Uint32Array(ISI_BINS);
    this.lastSpike = new Float32Array(n).fill(-1);
  }
  /** Poisson draw for every cell, given rates already written into this.rate */
  /**
   * @param spikes draw Poisson spikes (needed for rasters, maps and ISI)
   * @param timing track inter-spike intervals
   */
  fire(dt, rnd, now, spikes = true, timing = true) {
    const s = this.spikes;
    let sum = 0, count = 0, max = 0;
    const cap = this.maxRate;
    for (let i = 0; i < this.n; i++) {
      let r = this.rate[i];
      if (r > cap) { r = cap; this.rate[i] = cap; }
      sum += r;
      if (r > max) max = r;
      if (!spikes) continue;
      const p = 1 - Math.exp(-Math.max(0, r) * dt);
      const k = rnd() < p ? 1 : 0;
      s[i] = k;
      count += k;
      if (k && timing) {
        const last = this.lastSpike[i];
        if (last >= 0) {
          const bin = ((now - last) * 1000 / ISI_BIN_MS) | 0;
          if (bin >= 0 && bin < ISI_BINS) this.isiHist[bin]++;
        }
        this.lastSpike[i] = now;
      }
    }
    if (!spikes) s.fill(0);
    this.mean = sum / this.n;
    this.max = max;
    this.smooth += (this.mean - this.smooth) * Math.min(1, dt * 9);
    this.smoothMax += (max - this.smoothMax) * Math.min(1, dt * 9);
    this.norm = clamp((this.peakNorm ? this.smoothMax : this.smooth) / this.refMax, 0, 1);
    return count;
  }
}

// ---------------------------------------------------------------- the brain
export class Brain {
  constructor({ arena = 1.2, seed = 7, sex = 'M', name = 'mouse' } = {}) {
    this.arena = arena;
    this.half = arena / 2;
    this.rnd = mulberry32(seed);
    const rnd = this.rnd;

    // ------------------------------------------------ oscillators & state
    this.t = 0;
    this.thetaPhase = 0;
    this.thetaFreq = 6.7;
    this.sniffPhase = 0;
    this.whiskPhase = 0;
    this.stridePhase = 0;
    this.lfp = 0;
    this.lfpTheta = 0;
    this.lfpRipple = 0;
    this.lfpBuf = new Float32Array(LFP_N);
    this.lfpWrite = 0;
    this.lfpPhase = { theta: 0, slow: 0, fast: 0, ripple: 0, delta: 0 };

    this.sex = sex;            // 'M' or 'F' — several nuclei below are dimorphic
    this.name = name;

    // ------------------------------------------------ homeostatic drives
    // Each can be switched off from the panel; off means the circuit is silent
    // and the behaviour it motivates is unavailable.
    this.drives = { eat: true, drink: true, mate: true, fear: true, fight: true };
    this.hunger = 0.72;        // 0..1 drive
    this.odor = 0;             // odour concentration at the nose
    this.odorPrev = 0;
    this.odorRate = 0;         // d[odour]/dt
    this.detect = 0;           // 0..1 "there is food here" signal
    this.eating = 0;           // decaying eat transient
    this.bump = 0;             // decaying wall-collision transient
    this.orient = 0;           // decaying orienting transient
    this.bearingPrev = 0;
    this.centre = 0;           // exposure in the open middle, 0..1
    this.thirst = 0.45;        // 0..1 drive
    this.libido = 0.3;         // 0..1 drive
    this.light = 0.35;         // arena illuminance, 0..1
    this.waterLevel = 0;       // 0 dry .. 1 deep
    this.social = 0;           // how close the other mouse is
    this.pheromone = 0;        // vomeronasal sampling, needs near contact
    this.drinking = 0;         // decaying transients
    this.mating = 0;
    this.waterNear = 0;
    this.cyclePhase = sex === 'F' ? 0.42 : 0;
    this.estrous = sex === 'F' ? 0 : 1;
    this.drinkCount = 0;
    this.mateCount = 0;

    // ------------------------------------------------ defensive state
    // Everything a predator cue sets up. The stimulus itself lives in
    // src/world/threats.js; this is what the animal makes of it.
    this.threatSound = 0;      // a predator heard, 0..1
    this.threatSoundKind = null;
    this.predatorOdour = 0;    // predator smell at the nose, 0..1
    this.foulOdour = 0;        // merely unpleasant smell, 0..1
    this.vnoThreat = 0;        // the part of it the vomeronasal organ reads
    this.looming = 0;          // something expanding overhead, 0..1
    this.startle = 0;          // decaying whole-body startle transient
    this.fear = 0;             // defensive state; outlasts the stimulus
    this.freeze = 0;           // immobile except for breathing
    this.flight = 0;           // escape burst
    this.risk = 0;             // risk assessment: stretched out, sniffing
    this.cort = 0;             // corticosterone, the slow arm of the response
    this.aversion = 0;         // how much it wants to be somewhere else, 0..1

    // ------------------------------------------------ fighting and survival
    this.alive = true;
    this.causeOfDeath = null;
    this.health = 1;           // 1 = unmarked; bite wounds take it down
    this.pain = 0;             // decaying nociceptive transient
    this.aggression = 0;       // natural aggression, 0..1 (not the opsin kind)
    this.maternalAgg = 0;      // a lactating female defending the nest
    this.rivalry = 0;          // another male, close
    this.infanticide = 0;      // BSTrh drive to kill a pup
    this.paternal = 0;         // cMPOA inhibition of it, 0..1
    this.mature = true;
    this.mode = null;          // which defence is running
    this.defenseGain = 1;      // 0 when the defence switch is off
    this.defenseT = 0;         // how much longer it has to run
    this.threatSource = null;  // where the smell is coming from
    this.threatDist = Infinity;
    this.threatBearing = 0;
    this.threatKind = null;
    this.freezePct = 0;        // running fraction of time spent frozen
    this.avoidT = 0;           // time since the source was put down
    this.avoidIn = 0;          // of which, time spent in its quadrant

    // ------------------------------------------------ reproduction
    this.pregnant = false;
    this.gestation = 0;        // 0..1 through the pregnancy
    this.litterSize = 0;
    this.lactating = false;
    this.litters = 0;
    this.pupCount = 0;         // live pups this animal is caring for
    this.pupCall = 0;          // 0..1 loudness of a stray pup's ultrasonic calls
    this.pupsNear = 0;         // 0..1 how close its own pups are
    this.nursing = 0;          // decaying transients
    this.retrieving = 0;
    this.parentalDrive = 0;
    this.sired = false;        // males only: has it mated and settled with a female
    this.postpartum = 0;       // brief receptive window right after giving birth
    this.ateTimes = [];        // for the appetite / intake analysis
    this.drankTimes = [];
    this.matedTimes = [];

    // ------------------------------------------------ reward learning (TD)
    this.value = 0;
    this.valueNorm = 0;        // value scaled by the running peak, for display/drive
    this.valueMax = 0.25;
    this.valuePrev = 0;
    this.rpe = 0;
    this.rpeSmooth = 0;
    this.rpeSlow = 0;          // slow baseline; dopamine reports the deviation from it
    this.rpePhasic = 0;
    this.rewardKernel = 0;     // decaying reward impulse
    this.daRate = 5;
    this.cheeseCount = 0;
    this.gammaTau = 1.6;       // discount time constant (s)
    this.lr = 1.15;            // TD learning rate
    this.traceTau = 0.45;      // eligibility trace (s)

    // ------------------------------------------------ replay machinery
    this.traj = [];
    this.trajT = 0;
    this.immobile = 0;
    this.sinceReward = 99;
    this.ripple = { active: false, t: 0, dur: 0, dir: 1, idx: 0, path: [], virt: null, env: 0 };
    this.swrCount = 0;

    // ------------------------------------------------ occupancy
    this.occ = new Float32Array(BINS * BINS);
    this.hdOcc = new Float32Array(HD_BINS);
    this.spikeRateTotal = 0;

    // ============================================================ POPULATIONS
    const P = [];
    const A = arena;

    // ---- CA1 place cells (O'Keefe & Dostrovsky 1971) -------------------
    // Field width ~20-30 cm in a 1-1.5 m arena -> sigma ~ 7-11 cm.
    const ca1 = new Population('place', 'CA1', 'place cells', 72, 22, { mapped: true, peakNorm: true });
    for (let i = 0; i < ca1.n; i++) {
      ca1.cells.push({
        cx: (rnd() - 0.5) * A * 1.06,
        cz: (rnd() - 0.5) * A * 1.06,
        sg: 0.068 + rnd() * 0.045,
        peak: 11 + rnd() * 17,
        ph: rnd() * TAU,
      });
    }
    P.push(ca1);

    // ---- CA3 (broader fields, drives replay) ---------------------------
    const ca3 = new Population('ca3', 'CA3', 'place cells', 28, 14, { mapped: true, peakNorm: true });
    for (let i = 0; i < ca3.n; i++) {
      ca3.cells.push({
        cx: (rnd() - 0.5) * A * 1.05, cz: (rnd() - 0.5) * A * 1.05,
        sg: 0.1 + rnd() * 0.06, peak: 7 + rnd() * 10, ph: rnd() * TAU,
      });
    }
    P.push(ca3);

    // ---- dentate gyrus: very sparse, very sharp (Leutgeb 2007) ---------
    const dg = new Population('dg', 'DG', 'granule cells', 24, 6, { mapped: true, peakNorm: true });
    for (let i = 0; i < dg.n; i++) {
      const silent = rnd() < 0.3;            // most granule cells have no field here
      dg.cells.push({
        cx: (rnd() - 0.5) * A * (silent ? 3.2 : 1.0),
        cz: (rnd() - 0.5) * A * (silent ? 3.2 : 1.0),
        sg: 0.045 + rnd() * 0.03, peak: 6 + rnd() * 8, ph: rnd() * TAU,
      });
    }
    P.push(dg);

    // ---- MEC grid cells: 3 modules, spacing ratio 1.42 -----------------
    // Hafting 2005 (hexagonal fields); Stensola 2012 (discrete modules, ~1.42x).
    const grid = new Population('grid', 'ENTm', 'grid cells', 48, 17, { mapped: true, peakNorm: true });
    this.gridModules = [
      { lambda: 0.30, orient: 8 * Math.PI / 180 },
      { lambda: 0.30 * 1.42, orient: 28 * Math.PI / 180 },
      { lambda: 0.30 * 1.42 * 1.42, orient: 48 * Math.PI / 180 },
    ];
    for (let i = 0; i < grid.n; i++) {
      const m = this.gridModules[i % 3];
      const k = (4 * Math.PI) / (Math.sqrt(3) * m.lambda);
      const dirs = [0, 1, 2].map((j) => m.orient + (j * Math.PI) / 3);
      grid.cells.push({
        mod: i % 3,
        lambda: m.lambda,
        kx: dirs.map((d) => k * Math.cos(d)),
        kz: dirs.map((d) => k * Math.sin(d)),
        ox: (rnd() - 0.5) * m.lambda,
        oz: (rnd() - 0.5) * m.lambda,
        peak: 10 + rnd() * 14,
        beta: 5.0 + rnd() * 1.6,
      });
    }
    P.push(grid);

    // ---- MEC speed cells: rate linear in running speed (Kropff 2015) ---
    const speed = new Population('speed', 'ENTm', 'speed cells', 10, 14, { weight: 0.55 });
    for (let i = 0; i < speed.n; i++) {
      speed.cells.push({ base: 2 + rnd() * 5, slope: 0.26 + rnd() * 0.3, sat: 24 + rnd() * 16 });
    }
    P.push(speed);

    // ---- subiculum border / boundary-vector cells (Solstad 2008) -------
    const border = new Population('border', 'SUB', 'border cells', 16, 14, { mapped: true, peakNorm: true });
    for (let i = 0; i < border.n; i++) {
      border.cells.push({
        wall: i % 4,                      // 0:+x 1:-x 2:+z 3:-z
        d0: rnd() * 0.1,                  // preferred distance from that wall
        sw: 0.035 + rnd() * 0.045,
        peak: 9 + rnd() * 13,
      });
    }
    P.push(border);

    // ---- head direction: postsubiculum (Taube 1990) --------------------
    const hd = new Population('hd', 'POST', 'HD cells', 20, 9, { hd: true });
    for (let i = 0; i < hd.n; i++) {
      hd.cells.push({ pref: (i / hd.n) * TAU + rnd() * 0.08, kappa: 2.6 + rnd() * 1.1, peak: 22 + rnd() * 24 });
    }
    P.push(hd);

    // ---- anterodorsal thalamus: anticipatory HD (Blair & Sharp 1995) ---
    const adn = new Population('adn', 'AD', 'HD cells', 16, 11, { hd: true });
    for (let i = 0; i < adn.n; i++) {
      adn.cells.push({
        pref: (i / adn.n) * TAU + rnd() * 0.08, kappa: 2.9 + rnd() * 1.2,
        peak: 28 + rnd() * 26, lead: 0.04 + rnd() * 0.035,   // ~40-75 ms anticipation
      });
    }
    P.push(adn);

    // ---- retrosplenial: position x heading conjunctions ----------------
    const rsp = new Population('rsp', 'RSP', 'conjunctive cells', 18, 11, { peakNorm: true });
    for (let i = 0; i < rsp.n; i++) {
      rsp.cells.push({
        pref: rnd() * TAU, kappa: 1.5 + rnd(),
        cx: (rnd() - 0.5) * A, cz: (rnd() - 0.5) * A, sg: 0.16 + rnd() * 0.12,
        peak: 9 + rnd() * 11,
      });
    }
    P.push(rsp);

    // ---- olfactory bulb: sniff-locked concentration coding -------------
    const mob = new Population('mob', 'MOB', 'mitral cells', 20, 16);
    for (let i = 0; i < mob.n; i++) {
      mob.cells.push({ gain: 0.45 + rnd() * 1.25, ph: rnd() * TAU, base: 1.5 + rnd() * 4 });
    }
    P.push(mob);

    // ---- piriform: identity + gradient (change) ------------------------
    const pir = new Population('pir', 'PIR', 'pyramidal cells', 16, 9);
    for (let i = 0; i < pir.n; i++) {
      pir.cells.push({ gain: 0.3 + rnd() * 0.9, dgain: 1.4 + rnd() * 3.4, base: 0.8 + rnd() * 2 });
    }
    P.push(pir);

    // ---- barrel cortex: whisker contact at 8-12 Hz ---------------------
    const bfd = new Population('whisk', 'SSp-bfd', 'barrel columns', 14, 10);
    for (let i = 0; i < bfd.n; i++) {
      const a = ((i / (bfd.n - 1)) - 0.5) * 2.4;   // +-69 deg whisker field
      bfd.cells.push({ ang: a, ph: rnd() * TAU, peak: 32 + rnd() * 30, base: 0.8 + rnd() * 2 });
    }
    P.push(bfd);

    // ---- V1 and visual thalamus: optic flow + the cheese in view -------
    const v1 = new Population('v1', 'VISp', 'V1 neurons', 18, 9);
    for (let i = 0; i < v1.n; i++) {
      v1.cells.push({
        pref: ((i / (v1.n - 1)) - 0.5) * 4.0,       // retinotopic bearing, +-115 deg
        flow: 0.3 + rnd() * 1.3, base: 1.2 + rnd() * 3, peak: 14 + rnd() * 18,
      });
    }
    P.push(v1);
    const lgd = new Population('lgd', 'LGd', 'relay cells', 12, 11);
    for (let i = 0; i < lgd.n; i++) {
      lgd.cells.push({
        pref: ((i / (lgd.n - 1)) - 0.5) * 4.0,
        flow: 0.5 + rnd() * 1.5, base: 2 + rnd() * 4, peak: 16 + rnd() * 16,
      });
    }
    P.push(lgd);

    // ---- motor cortex: speed + turn, modulated by the step cycle -------
    const mop = new Population('mop', 'MOp', 'pyramidal cells', 20, 14);
    for (let i = 0; i < mop.n; i++) {
      mop.cells.push({ ph: rnd() * TAU, depth: 0.25 + rnd() * 0.45, gain: 0.5 + rnd() * 1.2, base: 1 + rnd() * 3 });
    }
    P.push(mop);

    // ---- premotor: carries the *intended* action -----------------------
    const mos = new Population('mos', 'MOs', 'premotor cells', 16, 15);
    for (let i = 0; i < mos.n; i++) {
      mos.cells.push({ turn: rnd() < 0.5 ? -1 : 1, gain: 0.6 + rnd() * 1.3, base: 1.5 + rnd() * 3 });
    }
    P.push(mos);

    // ---- caudoputamen: vigour, gated by dopamine -----------------------
    const cp = new Population('cp', 'CP', 'spiny projection neurons', 22, 7);
    for (let i = 0; i < cp.n; i++) {
      cp.cells.push({ gain: 0.4 + rnd() * 1.3, d1: rnd() < 0.5, base: 0.4 + rnd() * 1.6 });
    }
    P.push(cp);

    // ---- cerebellum: angular velocity + acceleration -------------------
    const cb = new Population('cb', 'CB', 'Purkinje cells', 22, 46);
    for (let i = 0; i < cb.n; i++) {
      cb.cells.push({ base: 30 + rnd() * 26, gw: 0.5 + rnd() * 1.4, ga: 0.4 + rnd() * 1.3 });
    }
    P.push(cb);

    // ---- superior colliculus: orienting bursts -------------------------
    const scm = new Population('scm', 'SCm', 'output neurons', 16, 9);
    for (let i = 0; i < scm.n; i++) {
      scm.cells.push({ side: i % 2 ? 1 : -1, gain: 0.6 + rnd() * 1.5, base: 1 + rnd() * 2.5 });
    }
    P.push(scm);

    // ---- periaqueductal grey: arousal / exposure -----------------------
    // The PAG is not one thing: its ventrolateral column drives freezing and
    // its dorsolateral column drives flight, and they inhibit each other, which
    // is why a mouse does one or the other and never both (Tovote et al. 2016).
    const pag = new Population('pag', 'PAG', 'PAG neurons', 16, 10);
    for (let i = 0; i < pag.n; i++) {
      pag.cells.push({
        col: i % 2 ? 'dl' : 'vl',
        gs: 0.4 + rnd() * 1.2, gc: 0.4 + rnd() * 1.5, gd: 0.6 + rnd() * 1.3,
        base: 2 + rnd() * 3.5,
      });
    }
    P.push(pag);

    // ---- VTA / SNc dopamine: reward prediction error (Schultz 1997) ----
    const vta = new Population('vta', 'VTA', 'dopamine neurons', 16, 14);
    for (let i = 0; i < vta.n; i++) {
      vta.cells.push({ base: 3.5 + rnd() * 3.5, gain: 16 + rnd() * 22 });
    }
    P.push(vta);
    const snc = new Population('snc', 'SNc', 'dopamine neurons', 12, 12);
    for (let i = 0; i < snc.n; i++) {
      snc.cells.push({ base: 3 + rnd() * 3, gain: 10 + rnd() * 16 });
    }
    P.push(snc);

    // ---- accumbens: learned value of where the mouse is ----------------
    const acb = new Population('acb', 'ACB', 'accumbens neurons', 18, 7);
    for (let i = 0; i < acb.n; i++) {
      acb.cells.push({ gv: 0.6 + rnd() * 1.8, gd: 0.3 + rnd() * 1.2, base: 0.6 + rnd() * 2 });
    }
    P.push(acb);

    // ---- amygdala: valence (BLA) and threat (CEA) ----------------------
    const bla = new Population('bla', 'BLA', 'BLA neurons', 14, 8);
    for (let i = 0; i < bla.n; i++) {
      bla.cells.push({ gdet: 0.5 + rnd() * 1.6, geat: 0.8 + rnd() * 2.2, base: 1 + rnd() * 2.5 });
    }
    P.push(bla);
    const cea = new Population('cea', 'CEA', 'CEA neurons', 12, 8);
    for (let i = 0; i < cea.n; i++) {
      cea.cells.push({ gb: 0.8 + rnd() * 2.4, gc: 0.4 + rnd() * 1.4, gt: 0.6 + rnd() * 1.6, base: 1 + rnd() * 2.5 });
    }
    P.push(cea);

    // ---- hypothalamus: feeding drive and hunger ------------------------
    const lha = new Population('lha', 'LHA', 'feeding neurons', 16, 10);
    for (let i = 0; i < lha.n; i++) {
      lha.cells.push({ gh: 0.6 + rnd() * 1.8, ge: 0.6 + rnd() * 2.2, base: 1.2 + rnd() * 3 });
    }
    P.push(lha);
    const arh = new Population('arh', 'ARH', 'AgRP neurons', 14, 13);
    for (let i = 0; i < arh.n; i++) {
      arh.cells.push({ gh: 12 + rnd() * 18, base: 1 + rnd() * 2.5, drop: 0.7 + rnd() * 0.28 });
    }
    P.push(arh);

    // ---- thirst: the lamina terminalis (Oka 2015; Zimmerman 2016) ------
    const sfo = new Population('sfo', 'SFO', 'thirst neurons', 12, 14);
    for (let i = 0; i < sfo.n; i++) {
      sfo.cells.push({ base: 0.8 + rnd() * 2, gain: 14 + rnd() * 16, drop: 0.75 + rnd() * 0.22 });
    }
    P.push(sfo);
    const mepo = new Population('mepo', 'MEPO', 'integrator neurons', 10, 12);
    for (let i = 0; i < mepo.n; i++) mepo.cells.push({ base: 1 + rnd() * 2, gain: 10 + rnd() * 12 });
    P.push(mepo);
    const ov = new Population('ov', 'OV', 'osmosensors', 8, 12);
    for (let i = 0; i < ov.n; i++) ov.cells.push({ base: 1 + rnd() * 2, gain: 9 + rnd() * 11 });
    P.push(ov);

    // ---- pheromones and mating ----------------------------------------
    const aob = new Population('aob', 'AOB', 'mitral cells', 14, 12);
    for (let i = 0; i < aob.n; i++) aob.cells.push({ base: 0.6 + rnd() * 1.8, gain: 0.5 + rnd() * 1.4, ph: rnd() * TAU });
    P.push(aob);
    const mea = new Population('mea', 'MEA', 'MeA neurons', 14, 12);
    for (let i = 0; i < mea.n; i++) mea.cells.push({ base: 0.8 + rnd() * 2, gp: 0.6 + rnd() * 1.5, gs: 0.4 + rnd() * 1.2, gt: 0.5 + rnd() * 1.5 });
    P.push(mea);
    // BNST principal nucleus is markedly larger in males (Bayless et al. 2019)
    const bst = new Population('bst', 'BST', 'BNST neurons', 14, 12);
    for (let i = 0; i < bst.n; i++) bst.cells.push({ base: 0.8 + rnd() * 2, gp: 0.5 + rnd() * 1.3, gd: 0.6 + rnd() * 1.5, gt: 0.5 + rnd() * 1.4 });
    P.push(bst);
    // The rhomboid nucleus of the BST, a millimetre from the preoptic cells
    // above and doing the opposite job. c-Fos in cMPOA and BSTrh tells a
    // paternal male from an infanticidal one with better than 95% accuracy;
    // lesion the cMPOA and a father starts killing pups, lesion the BSTrh and
    // a virgin male stops (Tsuneoka et al. 2015). The cMPOA holds it down
    // through a GABAergic projection, which is why only one of them is ever up.
    const brh = new Population('bstrh', 'BST', 'BSTrh neurons', 10, 11, { weight: 0.8 });
    for (let i = 0; i < brh.n; i++) brh.cells.push({ base: 0.5 + rnd() * 1.4, gain: 0.6 + rnd() * 1.5 });
    P.push(brh);

    const mpn = new Population('mpn', 'MPN', 'Esr1 neurons', 14, 14);
    for (let i = 0; i < mpn.n; i++) mpn.cells.push({ base: 0.5 + rnd() * 1.6, gain: 0.6 + rnd() * 1.6 });
    P.push(mpn);
    const vmh = new Population('vmh', 'VMH', 'VMHvl neurons', 14, 14);
    for (let i = 0; i < vmh.n; i++) vmh.cells.push({ base: 0.5 + rnd() * 1.6, gain: 0.6 + rnd() * 1.6 });
    P.push(vmh);
    // The other half of VMH. VMHvl above carries mating and aggression; the
    // dorsomedial part is the predator-defence node, and driving it makes a
    // mouse freeze at low power and bolt at high power with nothing there.
    const vmd = new Population('vmhdm', 'VMH', 'VMHdm SF1 neurons', 12, 13, { weight: 0.9 });
    for (let i = 0; i < vmd.n; i++) vmd.cells.push({ base: 0.6 + rnd() * 1.6, gain: 0.6 + rnd() * 1.5 });
    P.push(vmd);

    const pmv = new Population('pmv', 'PMv', 'PMv neurons', 10, 10);
    for (let i = 0; i < pmv.n; i++) pmv.cells.push({ base: 0.8 + rnd() * 1.8, gain: 0.5 + rnd() * 1.4 });
    P.push(pmv);

    // ---- hearing, tuned to the pup-call band (Ehret 2005) --------------
    const audp = new Population('audp', 'AUDp', 'A1 neurons', 16, 14);
    for (let i = 0; i < audp.n; i++) {
      audp.cells.push({ base: 1.5 + rnd() * 3.5, gain: 0.5 + rnd() * 1.5, pup: 0.4 + rnd() * 1.6, thr: 0.5 + rnd() * 1.7 });
    }
    P.push(audp);

    // ---- light and stress ---------------------------------------------
    const sch = new Population('sch', 'SCH', 'SCN neurons', 10, 12);
    for (let i = 0; i < sch.n; i++) sch.cells.push({ base: 1.2 + rnd() * 2.5, gain: 8 + rnd() * 12 });
    P.push(sch);
    const pvh = new Population('pvh', 'PVH', 'CRH neurons', 12, 12);
    for (let i = 0; i < pvh.n; i++) pvh.cells.push({ base: 0.8 + rnd() * 2, gl: 0.5 + rnd() * 1.4, gw: 0.6 + rnd() * 1.6, gb: 0.5 + rnd() * 1.5 });
    P.push(pvh);

    // filled in by setConnectivity()
    this.afferents = null;
    this.netDrive = {};

    /**
     * Detail level. A colony can hold a hundred animals, and only the one being
     * inspected needs its spike trains, rate maps and kilohertz field potential.
     *   2 = full   (everything; the animal you are driving)
     *   1 = lite   (rates and spikes, no maps, no ISI, no 1 kHz LFP)
     *   0 = drives (rates only, no spike draws — enough to behave correctly)
     */
    this.detail = 2;

    this.pops = P;
    this.byKey = {};
    for (const p of P) this.byKey[p.key] = p;

    // region -> populations
    this.byRegion = {};
    for (const p of P) (this.byRegion[p.region] ||= []).push(p);

    // A stable index per region, so the per-frame network and activation loops
    // can run over typed arrays instead of allocating from Object.entries().
    this.regionKeys = Object.keys(this.byRegion);
    this.regionIndex = {};
    this.regionKeys.forEach((k, i) => { this.regionIndex[k] = i; });
    const R = this.regionKeys.length;
    this.actArr = new Float32Array(R);      // activation, this frame
    this.prevArr = new Float32Array(R);     // activation, last frame
    this.netArr = new Float32Array(R);      // synaptic drive in
    this.regionPops = this.regionKeys.map((k) => this.byRegion[k]);
    this.regionWeight = new Float32Array(R);
    this.regionKeys.forEach((k, i) => {
      this.regionWeight[i] = this.byRegion[k].reduce((a, p) => a + p.weight, 0) || 1;
    });
    for (const p of P) p.regionIdx = this.regionIndex[p.region];
    // flat afferent lists, filled by setConnectivity
    this.affStart = new Int32Array(R + 1);
    this.affIdx = new Int32Array(0);
    this.affW = new Float32Array(0);

    // place-cell basis for the value function (envelope only, no theta)
    this.placeEnv = new Float32Array(ca1.n);
    this.w = new Float32Array(ca1.n);
    this.trace = new Float32Array(ca1.n);
  }

  // ------------------------------------------------------------ geometry help
  /** distance from (x,z) to the arena boundary along heading+angle */
  rayToWall(x, z, dir) {
    const dx = Math.sin(dir), dz = Math.cos(dir);
    const h = this.half;
    let t = Infinity;
    if (dx > 1e-6) t = Math.min(t, (h - x) / dx); else if (dx < -1e-6) t = Math.min(t, (-h - x) / dx);
    if (dz > 1e-6) t = Math.min(t, (h - z) / dz); else if (dz < -1e-6) t = Math.min(t, (-h - z) / dz);
    return Math.max(0, t);
  }

  wallDistances(x, z) {
    const h = this.half;
    return [h - x, x + h, h - z, z + h];   // +x, -x, +z, -z
  }

  // ------------------------------------------------------------------- update
  /**
   * @param {object} s world state
   *   x,z        position (m)
   *   heading    rad
   *   speed      m/s
   *   angVel     rad/s
   *   accel      m/s^2
   *   cheeses    [{x,z}]
   *   cmd        {throttle,turn,sniff}  current motor command
   *   ate        true on the frame a cheese was eaten
   *   bumped     true on the frame a wall was hit
   * @param {number} dt seconds
   */
  update(s, dt) {
    const rnd = this.rnd;
    if (!this.alive) return this.silence(dt);
    this.t += dt;
    this.lastSpeed = s.speed;
    const vcm = s.speed * 100;                  // cm/s
    const moving = clamp(vcm / 5, 0, 1);        // 0 at rest, 1 above 5 cm/s

    // ---------------- predator cues, and what to do about them --------
    // Run before the oscillators: a frightened mouse breathes differently and
    // its hippocampus runs at a different frequency, and both follow from here.
    this.updateDefense(s, dt);
    const frozen = this.freeze;

    // ---------------- oscillators -------------------------------------
    // theta frequency rises linearly with running speed (Rivas 1996; Wells 2013)
    // — except in a frozen mouse, which has a rhythm of its own: a steady ~4 Hz
    // respiration that entrains a 4 Hz oscillation right across the olfactory
    // and limbic network (Moberly et al. 2018; Bagur et al. 2021).
    this.thetaFreq = frozen > 0.4
      ? 4.0 + 0.5 * (1 - frozen) + 0.02 * vcm
      : clamp(6.7 + 0.055 * vcm, 6.2, 12);
    this.thetaPhase = (this.thetaPhase + TAU * this.thetaFreq * dt) % TAU;
    // sniffing: ~5 Hz at rest, 8-10 Hz while investigating (Wachowiak 2011)
    // quiet breathing 2-4 Hz, investigative sniffing up to ~12 Hz (Wachowiak 2011)
    const sniffF = frozen > 0.4
      ? 4 + 0.6 * (1 - frozen)                              // the freezing rhythm
      : 2.6 + 7.2 * Math.max(moving, s.cmd.sniff ? 1 : 0, this.risk);
    this.sniffFreq = sniffF;                 // Hz, read by the body rig
    this.sniffPhase = (this.sniffPhase + TAU * sniffF * dt) % TAU;
    // whisking 8-12 Hz
    const whiskF = 8 + 4 * moving;
    this.whiskFreq = whiskF;                 // Hz, read by the body rig
    this.whiskPhase = (this.whiskPhase + TAU * whiskF * dt) % TAU;
    // step cycle ~2-6 Hz with speed
    this.stridePhase = (this.stridePhase + TAU * (1.8 + 4.6 * clamp(s.speed / 0.45, 0, 1)) * dt) % TAU;

    // ---------------- sensory scalars ---------------------------------
    // odour plume: each cheese is a source, concentration ~ 1/(1+(d/d0)^2)
    let odor = 0, nearest = null, nd = Infinity;
    for (const c of s.cheeses) {
      const dx = c.x - s.x, dz = c.z - s.z;
      const d = Math.hypot(dx, dz);
      odor += 1 / (1 + (d / 0.26) ** 2);
      if (d < nd) { nd = d; nearest = { d, bearing: angDiff(Math.atan2(dx, dz), s.heading) }; }
    }
    odor = clamp(odor, 0, 1.6);
    this.odorRate = dt > 0 ? clamp((odor - this.odor) / dt, -8, 8) : 0;
    this.odorPrev = this.odor;
    this.odor = odor;
    this.detect = clamp(odor * 1.5, 0, 1);
    this.nearest = nearest;

    // decaying transients
    const dec = (v, tau) => v * Math.exp(-dt / tau);
    this.eating = dec(this.eating, 0.45);
    this.pain = dec(this.pain, 0.7);
    this.bump = dec(this.bump, 0.3);
    this.orient = dec(this.orient, 0.25);
    if (s.bumped) this.bump = 1;
    // orienting burst when the bearing to food swings quickly
    if (nearest) {
      const db = Math.abs(angDiff(nearest.bearing, this.bearingPrev)) / Math.max(dt, 1e-3);
      if (db > 1.6 && this.detect > 0.15) this.orient = Math.min(1, this.orient + 0.6);
      this.bearingPrev = nearest.bearing;
    }

    // exposure: how far from any wall (thigmotaxis / open-field anxiety)
    const wd = this.wallDistances(s.x, s.z);
    const minWall = Math.min(...wd);
    this.centre = clamp((minWall - 0.08) / (this.half - 0.08), 0, 1);

    // ---------------- light, water, and the other mouse ---------------
    if (s.light !== undefined) this.light = clamp(s.light, 0, 1);
    if (s.waterLevel !== undefined) this.waterLevel = clamp(s.waterLevel, 0, 1);
    this.waterNear = s.atWater ? 1 : 0;
    const pr = s.partner || null;
    this.partner = pr;
    this.social = pr ? clamp(1 - pr.dist / 0.45, 0, 1) : 0;
    // the vomeronasal organ only samples on near contact
    this.pheromone = pr ? clamp(1 - pr.dist / 0.12, 0, 1) * (pr.sex !== this.sex ? 1 : 0.4) : 0;

    // ---------------- hunger ------------------------------------------
    if (this.drives.eat) this.hunger = clamp(this.hunger + 0.012 * dt, 0, 1);
    this.sinceReward += dt;
    if (s.ate) {
      this.eating = 1;
      this.cheeseCount++;
      this.ateTimes.push(this.t);
      this.sinceReward = 0;
      this.rewardKernel += 2.5 * this.hunger;   // hungrier mouse -> bigger reward
      this.hunger = clamp(this.hunger - 0.3, 0, 1);
    }

    // ---------------- thirst ------------------------------------------
    // thirst builds faster than hunger: mice drink in many short bouts
    if (this.drives.drink) this.thirst = clamp(this.thirst + 0.009 * dt, 0, 1);
    else this.thirst = 0;
    this.drinking = dec(this.drinking, 0.4);
    if (s.drank && this.drives.drink) {
      this.drinking = 1;
      this.drinkCount++;
      this.drankTimes.push(this.t);
      this.rewardKernel += 1.6 * this.thirst;
      this.thirst = clamp(this.thirst - 0.32, 0, 1);
      this.sinceReward = 0;
    }

    // ---------------- pregnancy, birth and parental care --------------
    this.pupCall = clamp(s.pupCall ?? 0, 0, 1);
    this.pupsNear = clamp(s.pupsNear ?? 0, 0, 1);
    this.nursing = s.nursing ? 1 : dec(this.nursing, 0.5);
    this.retrieving = s.retrieving ? 1 : dec(this.retrieving, 0.5);
    this.postpartum = Math.max(0, this.postpartum - dt);

    if (this.pregnant) {
      this.gestation = clamp(this.gestation + dt / GESTATION, 0, 1);
      // carrying a litter costs energy: hunger and thirst build faster
      this.hunger = clamp(this.hunger + 0.006 * dt * this.gestation, 0, 1);
    }
    // caring for pups is itself a drive, and a stray pup calling sharpens it
    this.parentalDrive = this.pupCount > 0
      ? clamp((0.55 + 0.45 * this.pupCall) * (this.sex === 'F' ? 1 : (this.sired ? 0.7 : 0.15)), 0, 1)
      : 0;
    if (s.nursed) { this.rewardKernel += 0.5; this.sinceReward = 0; }
    if (s.retrieved) { this.rewardKernel += 0.8; this.sinceReward = 0; }

    // ---------------- oestrous cycle and mating drive -----------------
    // The real cycle is 4-5 days; compressed here to 75 s so it is visible.
    if (this.sex === 'F') {
      if (this.pregnant) {
        this.estrous = 0;                      // cycling stops during pregnancy
      } else if (this.postpartum > 0) {
        this.estrous = 1;                      // mice are fertile again within a day of birth
      } else {
        this.cyclePhase = (this.cyclePhase + dt / 75) % 1;
        const c = this.cyclePhase - 0.5;
        this.estrous = clamp(1.25 * Math.exp(-(c * c) / (2 * 0.13 * 0.13)), 0, 1);
      }
    } else {
      this.estrous = 1;
    }
    // PMv gates reproduction on body condition: a starving mouse will not mate
    this.bodyCondition = clamp(1 - 0.75 * this.hunger - 0.35 * this.thirst, 0, 1);
    if (this.drives.mate) {
      this.libido = clamp(this.libido + 0.02 * dt * (0.35 + 0.65 * this.bodyCondition), 0, 1);
    } else {
      this.libido = 0;
    }
    this.mating = dec(this.mating, 0.6);
    if (s.mated && this.drives.mate) {
      this.mating = 1;
      this.mateCount++;
      this.matedTimes.push(this.t);
      this.rewardKernel += 1.9 * this.libido;
      this.libido = clamp(this.libido - 0.6, 0, 1);
      this.sinceReward = 0;
    }
    /** how strongly this animal is currently motivated to mate, 0..1 */
    // A frightened mouse does not court: predator odour suppresses sexual
    // behaviour for as long as it lasts (Kavaliers & Choleris 2001).
    this.mateDrive = (this.drives.mate && !this.pregnant)
      ? clamp(this.libido * this.estrous * (0.35 + 0.65 * this.bodyCondition)
              * (1 - 0.85 * this.fear), 0, 1) : 0;

    // ---------------- aggression --------------------------------------
    // Male mice fight over territory and over females, and in a cage the loser
    // has nowhere to go. That is why aggression between group-housed males is
    // a recognised welfare problem rather than a curiosity: somewhere between
    // 1.5% and 14% of group-housed mice are wounded by a cagemate, nearly all
    // of them male, and the wounds are concentrated on the rump and the base
    // of the tail (NC3Rs mouse aggression guidance; Mertens et al. 2019).
    this.mature = s.mature !== false;
    const rivalMale = pr && pr.sex === 'M' && this.sex === 'M' && this.mature
      ? clamp(1 - pr.dist / 0.28, 0, 1) : 0;
    this.rivalry = rivalMale;
    // A stranger is attacked where a cagemate is tolerated: this is the whole
    // basis of the resident-intruder test.
    const stranger = pr ? 1 - clamp(pr.familiar ?? 1, 0, 1) : 0;
    let agg = rivalMale * (0.45 + 0.55 * stranger)
            * (0.8 + 0.2 * clamp(s.crowding ?? 0, 0, 1))   // crowding escalates it
            * (0.8 + 0.2 * this.libido)                    // competition for mates
            * (1 - 0.85 * this.fear)                       // a frightened mouse does not attack
            * (0.6 + 0.4 * this.bodyCondition);            // and nor does a starving one
    // A lactating female defending the nest is the most aggressive animal in
    // the cage, and she attacks anything that comes near it.
    this.maternalAgg = (this.sex === 'F' && this.lactating && pr && pr.dist < 0.3)
      ? clamp(1.15 * (1 - pr.dist / 0.3) * (0.45 + 0.55 * this.pupsNear), 0, 1) : 0;
    agg = Math.max(agg, this.maternalAgg);
    this.aggression = this.drives.fight ? clamp(agg, 0, 1) : 0;

    // ---------------- infanticide, and the switch out of it -------------
    // A virgin male kills pups; a male that has mated does not. The inhibition
    // is delayed for days after he mates but is in place before his own
    // offspring would be born at 18-20 days, and it lifts again 50-60 days
    // later — a clock that runs without any hormonal or social cue at all
    // (vom Saal & Howard 1982; Perrigo et al. 1992).
    const sinceMating = this.matedTimes.length
      ? (this.t - this.matedTimes[this.matedTimes.length - 1]) / DAY : Infinity;
    this.paternal = this.sex === 'F' ? 1
      : (Number.isFinite(sinceMating)
          ? clamp((sinceMating - 2) / 8, 0, 1) * clamp((60 - sinceMating) / 10, 0, 1)
          : 0);
    const pupHere = clamp(s.pupNear ?? 0, 0, 1);
    this.infanticide = (this.sex === 'M' && this.mature && this.drives.fight)
      ? clamp((1 - this.paternal) * pupHere * (1 - 0.6 * this.fear), 0, 1) : 0;

    // ---------------- trajectory buffer (for replay) -------------------
    this.trajT += dt;
    if (this.trajT >= TRAJ_DT) {
      this.trajT = 0;
      this.traj.push({ x: s.x, z: s.z });
      if (this.traj.length > TRAJ_MAX) this.traj.shift();
    }

    // ---------------- sharp-wave ripples / replay ---------------------
    this.updateRipple(s, dt, rnd);
    const rip = this.ripple;
    // during replay the hippocampus is driven by a *virtual* position
    const hx = rip.active && rip.virt ? rip.virt.x : s.x;
    const hz = rip.active && rip.virt ? rip.virt.z : s.z;

    // ---------------- place cells (CA1) -------------------------------
    const ca1 = this.byKey.place;
    const fwdX = Math.sin(s.heading), fwdZ = Math.cos(s.heading);
    let envSum = 0;
    for (let i = 0; i < ca1.n; i++) {
      const c = ca1.cells[i];
      const dx = hx - c.cx, dz = hz - c.cz;
      const env = Math.exp(-(dx * dx + dz * dz) / (2 * c.sg * c.sg));
      this.placeEnv[i] = env;
      envSum += env;
      if (rip.active) {
        // replay: compressed, theta-independent, high gain
        ca1.rate[i] = c.peak * 2.1 * env * rip.env;
      } else {
        // theta phase precession: spike phase advances through the field
        const u = clamp((dx * fwdX + dz * fwdZ) / (1.6 * c.sg), -1, 1);
        const pref = c.ph - Math.PI * u * moving;
        const gain = Math.exp(1.25 * (Math.cos(this.thetaPhase - pref) - 1));
        ca1.rate[i] = c.peak * env * (0.3 + 0.7 * gain) * (0.12 + 0.88 * moving) + 0.05;
      }
    }
    // normalised place code = feature vector for the value function
    const invEnv = envSum > 1e-6 ? 1 / envSum : 0;

    // ---------------- CA3 & DG ---------------------------------------
    for (const key of ['ca3', 'dg']) {
      const p = this.byKey[key];
      const boost = key === 'ca3' ? 2.4 : 1.8;
      for (let i = 0; i < p.n; i++) {
        const c = p.cells[i];
        const dx = hx - c.cx, dz = hz - c.cz;
        const env = Math.exp(-(dx * dx + dz * dz) / (2 * c.sg * c.sg));
        if (rip.active) {
          p.rate[i] = c.peak * boost * env * rip.env;
        } else {
          const gain = Math.exp(1.1 * (Math.cos(this.thetaPhase - c.ph) - 1));
          p.rate[i] = c.peak * env * (0.35 + 0.65 * gain) * (0.12 + 0.88 * moving) + 0.03;
        }
      }
    }

    // ---------------- grid cells (MEC) -------------------------------
    const grid = this.byKey.grid;
    for (let i = 0; i < grid.n; i++) {
      const c = grid.cells[i];
      const px = hx - c.ox, pz = hz - c.oz;
      let g = 0;
      for (let j = 0; j < 3; j++) g += Math.cos(c.kx[j] * px + c.kz[j] * pz);
      g = (2 / 3) * (g / 3 + 0.5);                  // 0..1 hexagonal lattice
      const gate = rip.active ? rip.env * 1.5 : (0.2 + 0.8 * moving);
      const th = rip.active ? 1 : 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(this.thetaPhase));
      grid.rate[i] = c.peak * Math.exp(c.beta * (g - 1)) * gate * th + 0.08;
    }

    // ---------------- speed cells ------------------------------------
    const sp = this.byKey.speed;
    for (let i = 0; i < sp.n; i++) {
      const c = sp.cells[i];
      sp.rate[i] = Math.min(c.sat, c.base + c.slope * vcm);
    }

    // ---------------- border cells -----------------------------------
    const bd = this.byKey.border;
    for (let i = 0; i < bd.n; i++) {
      const c = bd.cells[i];
      const d = wd[c.wall];
      const e = Math.exp(-((d - c.d0) ** 2) / (2 * c.sw * c.sw));
      bd.rate[i] = c.peak * e * (0.3 + 0.7 * moving) + 0.1;
    }

    // ---------------- head direction ---------------------------------
    const hdp = this.byKey.hd;
    for (let i = 0; i < hdp.n; i++) {
      const c = hdp.cells[i];
      hdp.rate[i] = c.peak * Math.exp(c.kappa * (Math.cos(angDiff(s.heading, c.pref)) - 1)) + 0.15;
    }
    const adn = this.byKey.adn;
    for (let i = 0; i < adn.n; i++) {
      const c = adn.cells[i];
      const future = s.heading + s.angVel * c.lead;     // anticipatory
      adn.rate[i] = c.peak * Math.exp(c.kappa * (Math.cos(angDiff(future, c.pref)) - 1)) + 0.2;
    }

    // ---------------- retrosplenial conjunctive ----------------------
    const rsp = this.byKey.rsp;
    for (let i = 0; i < rsp.n; i++) {
      const c = rsp.cells[i];
      const dx = s.x - c.cx, dz = s.z - c.cz;
      const env = Math.exp(-(dx * dx + dz * dz) / (2 * c.sg * c.sg));
      const dir = Math.exp(c.kappa * (Math.cos(angDiff(s.heading, c.pref)) - 1));
      rsp.rate[i] = c.peak * env * dir * (0.25 + 0.75 * moving) + 0.2;
    }

    // ---------------- olfaction --------------------------------------
    const mob = this.byKey.mob;
    const sniffGate = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(this.sniffPhase));
    for (let i = 0; i < mob.n; i++) {
      const c = mob.cells[i];
      const g = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(this.sniffPhase + c.ph));
      mob.rate[i] = c.base + 42 * c.gain * odor * g
                + 34 * c.gain * (this.predatorOdour + this.foulOdour) * g;
    }
    const pir = this.byKey.pir;
    for (let i = 0; i < pir.n; i++) {
      const c = pir.cells[i];
      // the gradient response saturates: piriform cells signal that the smell is
      // getting stronger, not by how many orders of magnitude
      pir.rate[i] = c.base + 14 * c.gain * odor * sniffGate
                  + 9 * c.dgain * Math.tanh(Math.max(0, this.odorRate))
                  + 13 * c.gain * (this.predatorOdour + this.foulOdour) * sniffGate;
    }

    // ---------------- whiskers ---------------------------------------
    const wk = this.byKey.whisk;
    const whiskAmp = 0.5 + 0.5 * Math.sin(this.whiskPhase);
    let contactMax = 0;
    for (let i = 0; i < wk.n; i++) {
      const c = wk.cells[i];
      const reach = this.rayToWall(s.x, s.z, s.heading + c.ang);
      const touch = clamp(1 - reach / 0.028, 0, 1);          // whiskers ~2.8 cm
      const near = clamp(1 - reach / 0.1, 0, 1);
      contactMax = Math.max(contactMax, touch);
      wk.rate[i] = c.base + c.peak * touch * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.whiskPhase + c.ph)))
                 + 3.5 * near * whiskAmp;
    }
    this.whiskerContact = contactMax;

    // ---------------- vision -----------------------------------------
    const flow = clamp(s.speed / 0.45, 0, 1) + 0.5 * clamp(Math.abs(s.angVel) / 3, 0, 1);
    const cheeseVis = nearest && Math.abs(nearest.bearing) < 2.4
      ? clamp(2 * Math.atan(0.035 / Math.max(nearest.d, 0.04)) / 0.6, 0, 1) : 0;
    for (const key of ['v1', 'lgd']) {
      const p = this.byKey[key];
      for (let i = 0; i < p.n; i++) {
        const c = p.cells[i];
        let drive = 0;
        if (cheeseVis > 0) {
          const d = angDiff(nearest.bearing, c.pref);
          drive = Math.exp(-(d * d) / (2 * 0.45 * 0.45)) * cheeseVis;
        }
        const lum = 0.2 + 0.8 * this.light;
        p.rate[i] = c.base + lum * (7 * c.flow * flow + c.peak * drive)
                  + 20 * this.looming * (0.4 + 0.6 * c.flow);
      }
    }

    // ---------------- motor ------------------------------------------
    const mop = this.byKey.mop;
    const vig = clamp(s.speed / 0.45, 0, 1);
    for (let i = 0; i < mop.n; i++) {
      const c = mop.cells[i];
      const step = 1 - c.depth + c.depth * (0.5 + 0.5 * Math.sin(this.stridePhase + c.ph));
      mop.rate[i] = c.base + c.gain * (26 * vig + 11 * clamp(Math.abs(s.angVel) / 3, 0, 1)) * step;
    }
    const mos = this.byKey.mos;
    for (let i = 0; i < mos.n; i++) {
      const c = mos.cells[i];
      const want = Math.max(0, c.turn * s.cmd.turn);          // directional intent
      mos.rate[i] = c.base + c.gain * (18 * want + 7 * Math.abs(s.cmd.throttle) + 5 * this.detect);
    }
    const cp = this.byKey.cp;
    const daTone = clamp(this.daRate / 12, 0, 2);
    for (let i = 0; i < cp.n; i++) {
      const c = cp.cells[i];
      const gate = c.d1 ? 0.55 + 0.45 * daTone : 1.25 - 0.4 * daTone;
      cp.rate[i] = c.base + c.gain * (13 * vig + 6 * clamp(Math.abs(s.angVel) / 3, 0, 1)) * gate;
    }
    const cb = this.byKey.cb;
    for (let i = 0; i < cb.n; i++) {
      const c = cb.cells[i];
      cb.rate[i] = c.base + c.gw * 16 * clamp(Math.abs(s.angVel) / 3, 0, 1)
                 + c.ga * 12 * clamp(Math.abs(s.accel) / 2.5, 0, 1);
    }
    const scm = this.byKey.scm;
    for (let i = 0; i < scm.n; i++) {
      const c = scm.cells[i];
      const side = nearest ? clamp(c.side * Math.sign(nearest.bearing), 0, 1) : 0;
      // the deep layers are also where a looming stimulus becomes an escape
    scm.rate[i] = c.base + c.gain * (18 * this.orient * (0.4 + 0.6 * side)
                + 5 * clamp(Math.abs(s.angVel) / 3, 0, 1) + 26 * this.looming);
    }
    const pag = this.byKey.pag;
    for (let i = 0; i < pag.n; i++) {
      const c = pag.cells[i];
      pag.rate[i] = c.base + c.gs * 7 * vig + c.gc * 6 * this.centre * (0.4 + 0.8 * this.light)
                  + 8 * this.bump + 5 * this.waterLevel
                  + (c.col === 'vl'
                      ? c.gd * 26 * this.freeze
                      : c.gd * 28 * this.flight + this.defenseGain * 12 * this.looming)
                  // the lateral column is also where nociception arrives
                  + 20 * this.pain;
    }

    // ---------------- value + dopamine (TD learning) -----------------
    // V(s) is linear in the normalised CA1 place code: the hippocampal map is
    // the state representation the critic reads. Continuous-time TD error:
    //   delta = r + dV/dt - V/tau
    let V = 0;
    for (let i = 0; i < ca1.n; i++) V += this.w[i] * this.placeEnv[i] * invEnv;
    V = clamp(V, 0, 2.2);
    this.rewardKernel = dec(this.rewardKernel, 0.18);
    const r = this.rewardKernel / 0.18;
    const dV = dt > 0 ? (V - this.valuePrev) / dt : 0;
    this.rpe = clamp(r + clamp(dV, -6, 6) - V / this.gammaTau, -6, 14);
    this.rpeSmooth += (this.rpe - this.rpeSmooth) * Math.min(1, dt * 22);
    // Dopamine neurons fire tonically and signal *departures* from the expected
    // rate, so the slow component (which in continuous TD just tracks -V/tau
    // while the animal sits in a valuable place) is removed from what they report.
    this.rpeSlow += (this.rpe - this.rpeSlow) * Math.min(1, dt / 4);
    this.rpePhasic = this.rpeSmooth - this.rpeSlow;
    this.valuePrev = V;
    this.value = V;
    this.valueMax = Math.max(this.valueMax * 0.99995, V, 0.12);
    this.valueNorm = clamp(V / this.valueMax, 0, 1);
    // eligibility trace, then weight update
    const decTr = Math.exp(-dt / this.traceTau);
    for (let i = 0; i < ca1.n; i++) {
      this.trace[i] = this.trace[i] * decTr + this.placeEnv[i] * invEnv * dt / this.traceTau;
      this.w[i] = clamp(this.w[i] + this.lr * this.rpe * this.trace[i] * dt, 0, 2.5);
    }

    const vta = this.byKey.vta, snc = this.byKey.snc;
    let daSum = 0;
    for (let i = 0; i < vta.n; i++) {
      const c = vta.cells[i];
      vta.rate[i] = clamp(c.base + c.gain * this.rpePhasic, 0, 70);
      daSum += vta.rate[i];
    }
    this.daRate = daSum / vta.n;
    for (let i = 0; i < snc.n; i++) {
      const c = snc.cells[i];
      snc.rate[i] = clamp(c.base + c.gain * this.rpePhasic, 0, 60);
    }
    const acb = this.byKey.acb;
    for (let i = 0; i < acb.n; i++) {
      const c = acb.cells[i];
      acb.rate[i] = c.base + c.gv * 9 * this.valueNorm + c.gd * 5 * Math.max(0, this.rpePhasic) + 4 * this.eating;
    }

    // ---------------- amygdala ---------------------------------------
    const bla = this.byKey.bla;
    for (let i = 0; i < bla.n; i++) {
      const c = bla.cells[i];
      // the same structure carries both valences, in different cells
      bla.rate[i] = c.base + c.gdet * 7 * this.detect + c.geat * 9 * this.eating
                  + 6 * this.fear;
    }
    const cea = this.byKey.cea;
    for (let i = 0; i < cea.n; i++) {
      const c = cea.cells[i];
      cea.rate[i] = c.base + c.gb * 11 * this.bump + c.gc * 5 * this.centre * (0.35 + 0.95 * this.light)
                  + 4 * this.waterLevel
                  // CEl -> CEm -> ventrolateral PAG is the freezing output
                  + c.gt * (17 * this.fear + 11 * this.startle) + 13 * this.pain;
    }

    // ---------------- hypothalamus -----------------------------------
    const lha = this.byKey.lha;
    for (let i = 0; i < lha.n; i++) {
      const c = lha.cells[i];
      const feed = this.drives.eat ? 1 : 0;
      // a frightened mouse stops eating, however hungry it is
      lha.rate[i] = c.base + (feed * (c.gh * 9 * this.hunger * this.detect + c.ge * 7 * this.eating)
                  + 4 * this.drives.drink * this.thirst * this.waterNear) * (1 - 0.75 * this.fear);
    }
    // AgRP neurons: scale with hunger, but shut off as soon as food is detected
    const arh = this.byKey.arh;
    for (let i = 0; i < arh.n; i++) {
      const c = arh.cells[i];
      arh.rate[i] = c.base + (this.drives.eat ? 1 : 0) * c.gh * this.hunger * (1 - c.drop * this.detect);
    }

    // ---------------- thirst circuit ---------------------------------
    // SFO switches off within seconds of drinking starting, and even at the
    // sight of water — before any of it reaches the blood (Zimmerman 2016)
    const anticip = Math.max(this.drinking, this.waterNear * 0.75);
    const sfo = this.byKey.sfo;
    for (let i = 0; i < sfo.n; i++) {
      const c = sfo.cells[i];
      sfo.rate[i] = c.base + c.gain * this.thirst * (1 - c.drop * anticip);
    }
    const mepo = this.byKey.mepo;
    for (let i = 0; i < mepo.n; i++) {
      const c = mepo.cells[i];
      mepo.rate[i] = c.base + c.gain * this.thirst * (1 - 0.5 * this.drinking);
    }
    const ovp = this.byKey.ov;
    for (let i = 0; i < ovp.n; i++) {
      const c = ovp.cells[i];
      ovp.rate[i] = c.base + c.gain * this.thirst;
    }

    // ---------------- pheromones and mating --------------------------
    const md = this.mateDrive;
    const male = this.sex === 'M' ? 1 : 0;
    const aob = this.byKey.aob;
    for (let i = 0; i < aob.n; i++) {
      const c = aob.cells[i];
      const g = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.sniffPhase + c.ph));
      // the same organ reads predator proteins; a mouse without it will walk
      // up to a sedated rat and groom it (Papes et al. 2010)
      aob.rate[i] = c.base + 26 * c.gain * this.pheromone * g
                  + 30 * c.gain * this.vnoThreat * g;
    }
    const mea = this.byKey.mea;
    for (let i = 0; i < mea.n; i++) {
      const c = mea.cells[i];
      mea.rate[i] = c.base + c.gp * 13 * this.pheromone + c.gs * 7 * this.social * (0.3 + 0.7 * md)
                  // the posterodorsal part is also the predator-odour relay,
                  // and the point where a social cue is routed to attack
                  + c.gt * (17 * this.vnoThreat + 8 * this.predatorOdour)
                  + 9 * this.aggression;
    }
    // dimorphic: the BNST principal nucleus is larger and more responsive in males
    const bst = this.byKey.bst, bstDim = male ? 1.35 : 0.7;
    for (let i = 0; i < bst.n; i++) {
      const c = bst.cells[i];
      // The BNST is the sustained-anxiety arm: it tracks a threat that is
      // around somewhere rather than one that just happened (Walker & Davis 2008).
      bst.rate[i] = c.base + bstDim * (c.gp * 9 * this.pheromone + c.gd * 11 * md)
                  + c.gt * (14 * this.predatorOdour + 6 * this.fear);
    }
    const brh = this.byKey.bstrh;
    for (let i = 0; i < brh.n; i++) {
      const c = brh.cells[i];
      brh.rate[i] = c.base + c.gain * (17 * this.infanticide + 4 * this.rivalry);
    }
    // MPN drives male courtship; VMHvl carries female receptivity
    const mpn = this.byKey.mpn;
    for (let i = 0; i < mpn.n; i++) {
      const c = mpn.cells[i];
      // Esr1 neurons: courtship.  Galanin neurons next door: parental care.
      const courtship = male
        ? (15 * md * (0.3 + 0.7 * this.social) + 20 * this.mating)
        : (3.5 * md + 5 * this.mating);
      const parenting = 16 * this.parentalDrive * (0.35 + 0.65 * Math.max(this.retrieving, this.nursing, this.pupsNear));
      mpn.rate[i] = c.base + c.gain * (courtship + parenting);
    }
    const vmh = this.byKey.vmh;
    for (let i = 0; i < vmh.n; i++) {
      const c = vmh.cells[i];
      vmh.rate[i] = c.base + c.gain * (male
        ? (8 * md * this.social + 7 * this.mating + 20 * this.aggression)
        : (14 * md * this.estrous * (0.3 + 0.7 * this.social) + 18 * this.mating
           + 16 * this.maternalAgg));
    }
    // VMHdm: the predator-defence node, quite separate from the VMHvl cells
    // above. Stimulating it produces freezing at low power and flight at high
    // power with no predator present at all (Kunwar et al. 2015; Silva 2013).
    const vmd = this.byKey.vmhdm;
    for (let i = 0; i < vmd.n; i++) {
      const c = vmd.cells[i];
      vmd.rate[i] = c.base + this.defenseGain * c.gain * (18 * this.predatorOdour
                  + 15 * this.threatSound + 13 * this.looming + 7 * this.fear);
    }
    const pmv = this.byKey.pmv;
    for (let i = 0; i < pmv.n; i++) {
      const c = pmv.cells[i];
      pmv.rate[i] = c.base + c.gain * (9 * md + 7 * this.social * this.bodyCondition);
    }

    // ---------------- hearing --------------------------------------
    // Oxytocin released while nursing retunes A1 so that pup calls stand out
    // to a mother the way they do not to a virgin (Marlin et al. 2015).
    const audp = this.byKey.audp;
    const oxyGain = 1 + 0.9 * (this.lactating ? 1 : 0);
    for (let i = 0; i < audp.n; i++) {
      const c = audp.cells[i];
      audp.rate[i] = c.base + c.gain * 4 * (0.3 + 0.7 * moving)
                   + c.pup * 16 * this.pupCall * oxyGain
                   + c.thr * 30 * this.threatSound + 26 * this.startle;
    }

    // ---------------- light and stress -------------------------------
    const sch = this.byKey.sch;
    for (let i = 0; i < sch.n; i++) {
      const c = sch.cells[i];
      sch.rate[i] = c.base + c.gain * this.light;      // irradiance coding
    }
    const pvh = this.byKey.pvh;
    for (let i = 0; i < pvh.n; i++) {
      const c = pvh.cells[i];
      pvh.rate[i] = c.base + c.gl * 8 * this.light * (0.3 + 0.7 * this.centre)
                  + c.gw * 9 * this.waterLevel + c.gb * 9 * this.bump
                  + 13 * this.nursing         // oxytocin neurons during milk let-down
                  + 15 * this.fear + 11 * this.pain;   // CRH neurons: the top of the HPA axis
    }

    // ---------------- synaptic input from connected regions ----------
    // Applied after every population's own tuning, using last frame's activity
    // (a one-step delay, which is also what a real synapse imposes).
    this.computeNetDrive();
    if (this.affIdx.length) {
      const net = this.netArr;
      for (const p of this.pops) {
        const nd = net[p.regionIdx];
        if (!nd) continue;
        const add = NET_GAIN * p.refMax * nd;
        for (let i = 0; i < p.n; i++) p.rate[i] = Math.max(0, p.rate[i] + add);
      }
    }

    // ---------------- spikes, maps, LFP ------------------------------
    const detail = this.detail;
    let total = 0;
    for (const p of this.pops) total += p.fire(dt, rnd, this.t, detail > 0, detail > 1);
    this.spikeRateTotal += (total / dt - this.spikeRateTotal) * Math.min(1, dt * 5);

    if (detail > 1) {
      this.accumulate(s, dt, rip.active);
      this.updateLFP(s, dt, moving);
    } else {
      this.updateLFPCheap(dt, moving);
    }
    this.refreshActivation();
    this.prevArr.set(this.actArr);

    return this;
  }

  // ----------------------------------------------------------- injury & death
  /**
   * A bite lands. Fighting males aim for the rump and the base of the tail,
   * which is why a wounded cage mouse is nearly always wounded there, and the
   * wound outlasts the fight by days (NC3Rs; Mertens et al. 2019).
   */
  hurt(severity) {
    if (!this.alive) return;
    this.pain = clamp(this.pain + severity * 5, 0, 1);
    this.health = clamp(this.health - severity, 0, 1);
    this.bump = 1;
    this.fear = clamp(Math.max(this.fear, 0.5 + 2 * severity), 0, 1);
    this.rewardKernel -= 0.45;      // and the place it happened loses its value
    if (this.health <= 0) this.die('fight');
  }

  /** the brain stops: nothing fires, and the field potential goes flat */
  die(cause = 'unknown') {
    if (!this.alive) return;
    this.alive = false;
    this.causeOfDeath = cause;
    this.health = 0;
    this.fear = this.freeze = this.flight = this.risk = 0;
    this.aggression = this.maternalAgg = this.infanticide = 0;
    this.hunger = this.thirst = this.libido = this.mateDrive = 0;
    this.parentalDrive = 0;
    this.daRate = 0;
    this.thetaFreq = 0;
    this.spikeRateTotal = 0;
    this.ripple.active = false;
    this.ripple.env = 0;
    for (const p of this.pops) {
      p.rate.fill(0);
      p.spikes.fill(0);
      p.mean = p.max = p.smooth = p.smoothMax = p.norm = 0;
    }
  }

  /** what a dead brain does with its frame: a flat line, and no spikes */
  silence(dt) {
    const steps = Math.max(1, Math.min(96, Math.round(dt * LFP_FS)));
    for (let k = 0; k < steps; k++) {
      this.lfpBuf[this.lfpWrite] = 0;
      this.lfpWrite = (this.lfpWrite + 1) % LFP_N;
    }
    this.lfp = this.lfpTheta = this.lfpRipple = 0;
    for (const p of this.pops) p.spikes.fill(0);
    return this;
  }

  // ----------------------------------------------------------- defence
  /**
   * What the animal makes of an aversive stimulus, and which defence it runs.
   *
   * The choice is not free: it follows how close the danger is, along what
   * Fanselow called the predatory imminence continuum.
   *
   *   potential danger   a smell in the far corner        risk assessment
   *   post-encounter     a predator heard nearby          freezing
   *   circa-strike       something coming down on you     flight
   *
   * Each has its own output path out of the hypothalamus and midbrain, and the
   * three are mutually exclusive — a mouse that is fleeing is not freezing.
   *   Fanselow & Lester 1988; Blanchard & Blanchard 1989; Tovote et al. 2016
   */
  updateDefense(s, dt) {
    const th = s.threat || null;
    const dec = (v, tau) => v * Math.exp(-dt / tau);

    const sound = th ? clamp(th.sound, 0, 1) : 0;
    const pred = th ? clamp(th.predatorOdour, 0, 1) : 0;
    const foul = th ? clamp(th.foulOdour, 0, 1) : 0;
    const loom = th ? clamp(th.looming, 0, 1) : 0;
    const socialFreeze = th ? clamp(th.socialFreeze || 0, 0, 1) : 0;
    const onset = th ? th.onset : null;
    const imminence = th ? clamp(th.imminence, 0, 1.4) : 0;

    this.threatSound = sound;
    this.threatSoundKind = th ? th.soundKind : null;
    this.predatorOdour = pred;
    this.foulOdour = foul;
    this.vnoThreat = th ? clamp(th.vno, 0, 1) : 0;
    this.looming = loom;
    this.threatSource = th ? th.source : null;
    this.threatDist = th ? th.sourceDist : Infinity;
    this.threatBearing = th ? th.sourceBearing : 0;
    this.startle = Math.max(dec(this.startle, 0.12), th ? th.startle : 0);

    // the avoidance score starts over whenever a new source is put down
    const kind = th ? th.odourKind : null;
    if (kind !== this.threatKind) {
      this.threatKind = kind;
      this.avoidT = 0;
      this.avoidIn = 0;
    }

    // Fear outlasts the stimulus: a two-second call leaves a mouse defensive
    // for the best part of a minute. Bright light makes everything worse, and
    // so does watching the other mouse freeze — fear is socially transmitted
    // (Jeon et al. 2010).
    const cue = Math.max(sound, pred * 0.9, loom, socialFreeze * 0.45);
    this.defenseGain = this.drives.fear ? 1 : 0;
    const amp = 0.75 + 0.45 * this.light;
    this.fear = Math.max(dec(this.fear, 22), clamp(cue * amp, 0, 1));
    if (!this.drives.fear) this.fear = 0;

    // ---- pick a defence, and hold it long enough to be a bout ----
    this.defenseT = Math.max(0, this.defenseT - dt);
    if (loom > 0.25 || (onset && imminence > 0.85)) {
      this.mode = 'flight';
      this.defenseT = Math.max(this.defenseT, 2.4);
    } else if (onset && imminence > 0.3) {
      // freezing bouts last tens of seconds in a real mouse; compressed here
      this.mode = 'freeze';
      this.defenseT = 5 + 7 * this.fear;
    } else if (this.startle > 0.3 && this.defenseT <= 0) {
      this.mode = 'freeze';
      this.defenseT = 1.2 + 2 * this.fear;
    } else if (pred > 0.55) {
      // right on top of the source: no more assessing, just leave
      this.mode = 'flight';
      this.defenseT = Math.max(this.defenseT, 0.9);
    } else if (this.defenseT <= 0) {
      this.mode = (this.fear > 0.18 || pred > 0.05) ? 'risk' : null;
    }
    if (!this.drives.fear) { this.mode = null; this.defenseT = 0; }

    const want = { freeze: 0, flight: 0, risk: 0 };
    if (this.mode === 'freeze') want.freeze = clamp(0.5 + 0.5 * this.fear, 0, 1);
    else if (this.mode === 'flight') want.flight = clamp(0.6 + 0.4 * Math.max(this.fear, loom), 0, 1);
    else if (this.mode === 'risk') want.risk = clamp(0.3 + 0.7 * Math.max(this.fear, pred), 0, 1);
    const k = Math.min(1, dt * 7);
    this.freeze += (want.freeze - this.freeze) * k;
    // escape is the fastest thing a mouse does: ~250 ms from stimulus to run
    this.flight += (want.flight - this.flight) * (want.flight > this.flight ? Math.min(1, dt * 20) : k);
    this.risk += (want.risk - this.risk) * k;

    // Avoidance is not the same thing as fear. A rotten smell is avoided
    // without any defensive response at all, which is the whole point of
    // having it here: disgust and fear are separate circuits.
    this.aversion = clamp(Math.max(this.fear, 1.1 * foul), 0, 1);

    // ---- the slow arm: the HPA axis ----
    // Corticosterone peaks 15-30 minutes after a stressor in a real mouse and
    // takes an hour to clear. Compressed here the way the oestrous cycle is.
    const hpa = clamp(0.9 * this.fear + 0.3 * this.light * this.centre
                    + 0.35 * this.waterLevel + 0.3 * foul, 0, 1);
    this.cort += (hpa - this.cort) * Math.min(1, dt / (hpa > this.cort ? 10 : 40));

    // ---- aversive events are negative reinforcement ----
    // The dopamine cells report the dip, and because the critic reads the same
    // place code the value map does, the spot it happened in loses its value.
    if (onset) this.rewardKernel -= 0.32 * imminence;
    this.rewardKernel -= (0.7 * pred + 0.25 * foul + 1.2 * loom) * dt;

    // ---- the measures an experimenter would actually report ----
    this.freezePct += ((this.freeze > 0.5 ? 1 : 0) - this.freezePct) * Math.min(1, dt / 30);
    const src = this.threatSource;
    if (src) {
      this.avoidT += dt;
      // the quadrant the stimulus is in: 25% of the arena, so 25% is chance
      if (Math.sign(s.x) === Math.sign(src.x) && Math.sign(s.z) === Math.sign(src.z)) {
        this.avoidIn += dt;
      }
    }
  }

  /** the defensive behaviour running right now, if any */
  get defenseState() {
    if (this.flight > 0.35) return 'FLEEING';
    if (this.freeze > 0.45) return 'FREEZING';
    // assessing needs something to assess; without it the animal is just wary
    if (this.risk > 0.35) return this.threatSource ? 'RISK ASSESSMENT' : 'WARY';
    return null;
  }

  /** fraction of time spent in the stimulus quadrant; 0.25 is chance */
  get quadrantOccupancy() {
    return this.avoidT > 2 ? this.avoidIn / this.avoidT : null;
  }

  // ------------------------------------------------------------ ripple/replay
  updateRipple(s, dt, rnd) {
    const rip = this.ripple;
    if (s.speed < 0.02) this.immobile += dt; else this.immobile = 0;

    if (rip.active) {
      rip.t += dt;
      const u = rip.t / rip.dur;
      rip.env = Math.exp(-((u - 0.45) ** 2) / (2 * 0.22 * 0.22));
      // sweep through the stored trajectory at ~18x real time
      const n = rip.path.length;
      if (n > 1) {
        const f = rip.dir > 0 ? u : 1 - u;
        const k = clamp(f, 0, 1) * (n - 1);
        const i0 = Math.floor(k), i1 = Math.min(n - 1, i0 + 1), fr = k - i0;
        rip.virt = {
          x: rip.path[i0].x + (rip.path[i1].x - rip.path[i0].x) * fr,
          z: rip.path[i0].z + (rip.path[i1].z - rip.path[i0].z) * fr,
        };
        rip.progress = f;
      }
      if (rip.t >= rip.dur) { rip.active = false; rip.env = 0; rip.virt = null; }
      return;
    }

    // Fear-induced immobility is not quiet rest. A frozen mouse is running a
    // 4 Hz respiratory rhythm, not sharp-wave ripples, so replay waits until
    // the fear has worn off.
    if (this.fear > 0.3) return;

    // ripples happen during quiet immobility, and far more often just after a reward
    if (this.immobile > 0.25 && this.traj.length > 12) {
      const boost = this.sinceReward < 3 ? 3.4 : 1;
      if (rnd() < 0.55 * boost * dt) {
        const take = Math.min(this.traj.length, 44);
        rip.active = true;
        rip.t = 0;
        rip.dur = 0.07 + rnd() * 0.05;                     // 70-120 ms
        // reverse replay dominates right after reward (Foster & Wilson 2006)
        rip.dir = this.sinceReward < 3 ? -1 : (rnd() < 0.5 ? 1 : -1);
        rip.path = this.traj.slice(this.traj.length - take);
        rip.env = 0;
        rip.progress = 0;
        this.swrCount++;
      }
    }
  }

  // --------------------------------------------------------------------- LFP
  /**
   * Generated at LFP_FS, with the components a real CA1 electrode would pick up:
   * theta whose frequency follows running speed, slow and fast gamma nested at
   * *different* theta phases (Colgin et al. 2009), ripples during immobility,
   * delta when the animal is still, and a noise floor.
   */
  updateLFP(s, dt, moving) {
    const amp = 0.25 + 0.75 * moving;
    const ph = this.lfpPhase;
    const steps = Math.max(1, Math.min(96, Math.round(dt * LFP_FS)));
    const sub = dt / steps;
    const rip = this.ripple;
    let v = 0;
    for (let k = 0; k < steps; k++) {
      ph.theta = (ph.theta + TAU * this.thetaFreq * sub) % TAU;
      ph.slow = (ph.slow + TAU * 38 * sub) % TAU;
      ph.fast = (ph.fast + TAU * 78 * sub) % TAU;
      ph.delta = (ph.delta + TAU * 2.5 * sub) % TAU;
      ph.ripple = (ph.ripple + TAU * 185 * sub) % TAU;

      const theta = amp * Math.sin(ph.theta);
      // slow gamma rides the descending phase, fast gamma rides the peak
      const slowG = 0.18 * amp * Math.sin(ph.slow) * (0.5 + 0.5 * Math.cos(ph.theta - 2.2));
      const fastG = 0.10 * amp * Math.sin(ph.fast) * (0.5 + 0.5 * Math.cos(ph.theta));
      const delta = 0.35 * (1 - moving) * Math.sin(ph.delta);
      const ripple = rip.active ? 0.9 * rip.env * Math.sin(ph.ripple) : 0;
      v = theta + slowG + fastG + delta + ripple + (this.rnd() - 0.5) * 0.05;
      this.lfpBuf[this.lfpWrite] = v;
      this.lfpWrite = (this.lfpWrite + 1) % LFP_N;
    }
    this.lfpTheta = amp * Math.sin(ph.theta);
    this.lfpRipple = rip.active ? 0.9 * rip.env * Math.sin(ph.ripple) : 0;
    this.lfp = v;
  }

  /** one sample per frame: enough for the scalar readouts, no spectrum */
  updateLFPCheap(dt, moving) {
    const amp = 0.25 + 0.75 * moving;
    const ph = this.lfpPhase;
    ph.theta = (ph.theta + TAU * this.thetaFreq * dt) % TAU;
    this.lfpTheta = amp * Math.sin(ph.theta);
    this.lfpRipple = this.ripple.active ? 0.9 * this.ripple.env : 0;
    this.lfp = this.lfpTheta + this.lfpRipple;
  }

  /** switch how much of this brain is actually computed */
  setDetail(level) {
    if (level === this.detail) return;
    this.detail = level;
    if (level > 1) { this.lfpBuf.fill(0); this.lfpWrite = 0; }
  }

  /** where the newest LFP sample sits, for a reader that wants the last N */
  lfpWindow(n) {
    return { buf: this.lfpBuf, start: (this.lfpWrite - n + LFP_N * 2) % LFP_N, n, fs: LFP_FS };
  }

  // ------------------------------------------------------- map accumulation
  accumulate(s, dt, replaying) {
    if (replaying) return;          // only real behaviour goes into the maps
    const h = this.half;
    const bx = clamp(Math.floor(((s.x + h) / this.arena) * BINS), 0, BINS - 1);
    const bz = clamp(Math.floor(((s.z + h) / this.arena) * BINS), 0, BINS - 1);
    const bin = bz * BINS + bx;
    this.occ[bin] += dt;

    const hb = clamp(Math.floor((((s.heading % TAU) + TAU) % TAU) / TAU * HD_BINS), 0, HD_BINS - 1);
    this.hdOcc[hb] += dt;

    for (const p of this.pops) {
      if (p.spikeMap) {
        for (let i = 0; i < p.n; i++) if (p.spikes[i]) p.spikeMap[i * BINS * BINS + bin] += 1;
      }
      if (p.hdMap) {
        for (let i = 0; i < p.n; i++) if (p.spikes[i]) p.hdMap[i * HD_BINS + hb] += 1;
      }
    }
  }

  /** occupancy-normalised, smoothed rate map for one cell (Hz per bin) */
  rateMap(popKey, cell) {
    const p = this.byKey[popKey];
    // one shared scratch buffer: every caller consumes the result before the
    // next call, and this runs often enough for per-call allocation to show up
    const out = (this.mapScratch ||= new Float32Array(BINS * BINS));
    if (!p || !p.spikeMap) { out.fill(0); return { data: out, peak: 0, bins: BINS }; }
    const off = cell * BINS * BINS;
    // 3x3 Gaussian smoothing of spikes and occupancy (standard in the literature)
    const K = [0.0625, 0.125, 0.0625, 0.125, 0.25, 0.125, 0.0625, 0.125, 0.0625];
    let peak = 0;
    for (let z = 0; z < BINS; z++) {
      for (let x = 0; x < BINS; x++) {
        let sp = 0, oc = 0, k = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++, k++) {
            const xx = x + dx, zz = z + dz;
            if (xx < 0 || xx >= BINS || zz < 0 || zz >= BINS) continue;
            const b = zz * BINS + xx;
            sp += p.spikeMap[off + b] * K[k];
            oc += this.occ[b] * K[k];
          }
        }
        const v = oc > 0.09 ? sp / oc : -1;      // unvisited bins stay -1
        out[z * BINS + x] = v;
        if (v > peak) peak = v;
      }
    }
    return { data: out, peak, bins: BINS };
  }

  /** directional tuning curve for one HD cell (Hz per 10 deg bin) */
  hdTuning(popKey, cell) {
    const p = this.byKey[popKey];
    const out = new Float32Array(HD_BINS);
    if (!p || !p.hdMap) return { data: out, peak: 0, bins: HD_BINS };
    let peak = 0;
    for (let i = 0; i < HD_BINS; i++) {
      let sp = 0, oc = 0;
      for (let d = -1; d <= 1; d++) {
        const j = (i + d + HD_BINS) % HD_BINS;
        const w = d === 0 ? 0.5 : 0.25;
        sp += p.hdMap[cell * HD_BINS + j] * w;
        oc += this.hdOcc[j] * w;
      }
      const v = oc > 0.06 ? sp / oc : 0;
      out[i] = v;
      if (v > peak) peak = v;
    }
    return { data: out, peak, bins: HD_BINS };
  }

  /** learned value over the arena, as a BINS x BINS field (for the floor overlay) */
  valueField() {
    const ca1 = this.byKey.place;
    const n = ca1.n;
    // The place-cell envelopes never move, so the normalised basis at every bin
    // is computed once; after that the field is a dot product with the weights
    // rather than ~74k exponentials per call.
    if (!this.vBasis) {
      const basis = new Float32Array(BINS * BINS * n);
      for (let z = 0; z < BINS; z++) {
        for (let x = 0; x < BINS; x++) {
          const px = (x + 0.5) / BINS * this.arena - this.half;
          const pz = (z + 0.5) / BINS * this.arena - this.half;
          const off = (z * BINS + x) * n;
          let sum = 0;
          for (let i = 0; i < n; i++) {
            const c = ca1.cells[i];
            const dx = px - c.cx, dz = pz - c.cz;
            const e = Math.exp(-(dx * dx + dz * dz) / (2 * c.sg * c.sg));
            basis[off + i] = e;
            sum += e;
          }
          if (sum > 1e-6) for (let i = 0; i < n; i++) basis[off + i] /= sum;
        }
      }
      this.vBasis = basis;
    }
    const basis = this.vBasis;
    const out = new Float32Array(BINS * BINS);
    let peak = 1e-6;
    for (let b = 0; b < BINS * BINS; b++) {
      const off = b * n;
      let v = 0;
      for (let i = 0; i < n; i++) v += this.w[i] * basis[off + i];
      out[b] = v;
      if (v > peak) peak = v;
    }
    return { data: out, peak, bins: BINS };
  }

  /**
   * Wire the populations together using measured anterograde tracer strengths
   * (Allen Mouse Brain Connectivity Atlas). Weights are normalised per target,
   * so a region's total afferent drive is comparable no matter how many inputs
   * it has; self-projections are dropped because each population already has
   * its own dynamics.
   */
  setConnectivity(matrix) {
    const mine = new Set(Object.keys(this.byRegion));
    const aff = {};
    for (const [src, row] of Object.entries(matrix || {})) {
      if (!mine.has(src)) continue;
      for (const [dst, w] of Object.entries(row)) {
        if (!mine.has(dst) || dst === src || !(w > 0)) continue;
        (aff[dst] ||= []).push([src, w]);
      }
    }
    for (const [dst, list] of Object.entries(aff)) {
      // compress the four-orders-of-magnitude dynamic range of projection
      // volume, then normalise, so one huge input cannot swamp everything
      const scaled = list.map(([src, w]) => [src, Math.log10(1 + w * 100)]);
      const total = scaled.reduce((a, [, w]) => a + w, 0) || 1;
      aff[dst] = scaled
        .map(([src, w]) => [src, w / total, PROJECTION_SIGN[src] ?? 1])
        .sort((a, b) => b[1] - a[1]);
    }
    this.afferents = aff;

    // flatten into CSR-style arrays for the per-frame loop
    const R = this.regionKeys.length;
    const idx = [], wts = [];
    this.affStart = new Int32Array(R + 1);
    for (let t = 0; t < R; t++) {
      this.affStart[t] = idx.length;
      for (const [src, w, sign] of aff[this.regionKeys[t]] || []) {
        const si = this.regionIndex[src];
        if (si === undefined) continue;
        idx.push(si);
        wts.push(w * sign);
      }
    }
    this.affStart[R] = idx.length;
    this.affIdx = Int32Array.from(idx);
    this.affW = Float32Array.from(wts);
    return Object.keys(aff).length;
  }

  /** synaptic input each region is receiving from the rest of the brain */
  computeNetDrive() {
    if (!this.affIdx.length) return;
    const start = this.affStart, idx = this.affIdx, w = this.affW;
    const prev = this.prevArr, net = this.netArr;
    for (let t = 0; t < net.length; t++) {
      let v = 0;
      for (let k = start[t], e = start[t + 1]; k < e; k++) v += w[k] * prev[idx[k]];
      net[t] = v;
    }
  }

  /** fill actArr from the populations, without allocating */
  refreshActivation() {
    const act = this.actArr, pops = this.regionPops, wsum = this.regionWeight;
    for (let i = 0; i < act.length; i++) {
      const list = pops[i];
      let num = 0;
      for (let j = 0; j < list.length; j++) num += list[j].norm * list[j].weight;
      act[i] = num / wsum[i];
    }
  }

  /** activation 0..1 per Allen region, for the 3-D brain */
  regionActivation(fresh) {
    const out = fresh ? {} : (this.actScratch ||= {});
    const keys = this.regionKeys, act = this.actArr;
    for (let i = 0; i < keys.length; i++) out[keys[i]] = act[i];
    return out;
  }

  /** one-line description of what a region is doing right now */
  liveLine(acr) {
    const pops = this.byRegion[acr] || [];
    const hz = pops.length ? pops.reduce((a, p) => a + p.smooth, 0) / pops.length : 0;
    const n = pops.reduce((a, p) => a + p.n, 0);
    const extra = {
      CA1: () => `${this.byKey.place.spikes.reduce((a, b) => a + b, 0)} cells spiking now`,
      ENTm: () => `modules ${this.gridModules.map((m) => (m.lambda * 100).toFixed(0)).join(' / ')} cm`,
      VTA: () => `RPE ${this.rpePhasic >= 0 ? '+' : ''}${this.rpePhasic.toFixed(2)}`,
      ACB: () => `V(s) = ${this.value.toFixed(3)}`,
      ARH: () => `hunger ${(this.hunger * 100) | 0}%`,
      MOB: () => this.predatorOdour + this.foulOdour > 0.03
        ? `aversive odour ${((this.predatorOdour + this.foulOdour) * 100) | 0}%`
        : `odour ${(this.odor * 100).toFixed(0)}%`,
      'SSp-bfd': () => `contact ${(this.whiskerContact * 100) | 0}%`,
      SFO: () => `thirst ${(this.thirst * 100) | 0}%`,
      MEPO: () => `thirst ${(this.thirst * 100) | 0}%`,
      OV: () => `thirst ${(this.thirst * 100) | 0}%`,
      AOB: () => `pheromone ${(this.pheromone * 100) | 0}%`,
      MEA: () => this.vnoThreat > 0.03 ? `predator odour ${(this.vnoThreat * 100) | 0}%`
        : `partner ${(this.social * 100) | 0}%`,
      BST: () => this.infanticide > 0.05
        ? `BSTrh infanticidal ${(this.infanticide * 100) | 0}%`
        : (this.sex === 'M' && this.paternal > 0.1 ? `paternal — cMPOA holding BSTrh down`
          : `${this.sex === 'M' ? 'male-typical (larger)' : 'female-typical'}`),
      MPN: () => this.pupCount > 0
        ? `parental drive ${(this.parentalDrive * 100) | 0}%`
        : `mate drive ${(this.mateDrive * 100) | 0}%`,
      VMH: () => this.aggression > 0.15 ? `attack drive ${(this.aggression * 100) | 0}%`
        : this.fear > 0.12
        ? `VMHdm defence ${(this.byKey.vmhdm.smooth).toFixed(0)} Hz`
        : (this.sex === 'F' ? `receptive ${(this.estrous * 100) | 0}%` : `mate drive ${(this.mateDrive * 100) | 0}%`),
      PMv: () => `body condition ${(this.bodyCondition * 100) | 0}%`,
      SCH: () => `light ${(this.light * 100) | 0}%`,
      AUDp: () => this.threatSound > 0.05 ? `predator call ${(this.threatSound * 100) | 0}%`
        : this.pupCall > 0.05 ? `pup calling ${(this.pupCall * 100) | 0}%` : 'no pup calls',
      PVH: () => `corticosterone ${(this.cort * 100) | 0}% · stress ${((this.light * this.centre + this.waterLevel) * 50) | 0}%`,
      PAG: () => this.defenseState
        ? `${this.defenseState.toLowerCase()} · vl ${(this.freeze * 100) | 0}% / dl ${(this.flight * 100) | 0}%`
        : `arousal · fear ${(this.fear * 100) | 0}%`,
      CEA: () => `fear ${(this.fear * 100) | 0}%`,
      BLA: () => `fear ${(this.fear * 100) | 0}%`,
      SCm: () => this.looming > 0.05 ? `looming ${(this.looming * 100) | 0}%` : 'orienting',
      POST: () => `${((this.popVector() * 180 / Math.PI + 360) % 360).toFixed(0)}° decoded`,
    }[acr];
    return `${n} cells · ${hz.toFixed(1)} Hz mean${extra ? ' · ' + extra() : ''}`;
  }

  /** heading decoded from the HD population vector */
  popVector() {
    const p = this.byKey.hd;
    let sx = 0, sz = 0;
    for (let i = 0; i < p.n; i++) {
      sx += p.rate[i] * Math.sin(p.cells[i].pref);
      sz += p.rate[i] * Math.cos(p.cells[i].pref);
    }
    return Math.atan2(sx, sz);
  }

  /** position decoded from the place-cell population (Bayesian-ish centroid) */
  decodedPosition() {
    const p = this.byKey.place;
    let sx = 0, sz = 0, sw = 0;
    for (let i = 0; i < p.n; i++) {
      const w = p.rate[i] ** 2;
      sx += w * p.cells[i].cx; sz += w * p.cells[i].cz; sw += w;
    }
    return sw > 1e-6 ? { x: sx / sw, z: sz / sw } : null;
  }

  /** she conceives: gestation starts and cycling stops */
  conceive(litterSize) {
    if (this.sex !== 'F' || this.pregnant) return false;
    this.pregnant = true;
    this.gestation = 0;
    this.litterSize = litterSize;
    return true;
  }

  /** the litter is born */
  giveBirth() {
    const n = this.litterSize;
    this.pregnant = false;
    this.gestation = 0;
    this.litterSize = 0;
    this.lactating = true;
    this.litters++;
    this.pupCount += n;
    this.postpartum = 18;      // fertile again within a simulated day
    this.libido = clamp(this.libido + 0.4, 0, 1);
    return n;
  }

  /** rotate the head-direction compass, as happens when the cue card is moved */
  rotateCompass(rad) {
    for (const key of ['hd', 'adn', 'rsp']) {
      const p = this.byKey[key];
      for (const c of p.cells) c.pref = (c.pref + rad) % TAU;
      if (p.hdMap) p.hdMap.fill(0);
    }
    this.hdOcc.fill(0);
  }

  reset() {
    this.occ.fill(0);
    this.hdOcc.fill(0);
    for (const p of this.pops) {
      if (p.spikeMap) p.spikeMap.fill(0);
      if (p.hdMap) p.hdMap.fill(0);
    }
    this.w.fill(0);
    this.trace.fill(0);
    this.lfpBuf.fill(0);
    for (const p of this.pops) { p.isiHist.fill(0); p.lastSpike.fill(-1); }
    this.traj.length = 0;
    this.hunger = 0.72;
    this.thirst = 0.45;
    this.libido = 0.3;
    this.cyclePhase = this.sex === 'F' ? 0.42 : 0;
    this.drinkCount = 0;
    this.mateCount = 0;
    this.pregnant = false;
    this.gestation = 0;
    this.litterSize = 0;
    this.lactating = false;
    this.litters = 0;
    this.pupCount = 0;
    this.sired = false;
    this.postpartum = 0;
    this.ateTimes.length = 0;
    this.drankTimes.length = 0;
    this.matedTimes.length = 0;
    this.cheeseCount = 0;
    this.swrCount = 0;
    this.threatSound = this.predatorOdour = this.foulOdour = this.vnoThreat = 0;
    this.looming = this.startle = this.fear = 0;
    this.freeze = this.flight = this.risk = this.cort = this.aversion = 0;
    this.mode = null;
    this.defenseT = 0;
    this.threatSource = null;
    this.threatKind = null;
    this.threatDist = Infinity;
    this.freezePct = 0;
    this.avoidT = this.avoidIn = 0;
    this.alive = true;
    this.causeOfDeath = null;
    this.health = 1;
    this.pain = this.aggression = this.maternalAgg = this.rivalry = 0;
    this.infanticide = this.paternal = 0;
    this.value = this.valuePrev = this.rpe = this.rpeSmooth = this.valueNorm = 0;
    this.rpeSlow = this.rpePhasic = 0;
    this.valueMax = 0.25;
    this.t = 0;
  }

  get roles() { return ROLES; }
  static get BINS() { return BINS; }
  static get HD_BINS() { return HD_BINS; }
}
