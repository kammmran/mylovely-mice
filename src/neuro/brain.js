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

// ---------------------------------------------------------------- population
class Population {
  constructor(key, region, label, n, refMax, opts = {}) {
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
  }
  /** Poisson draw for every cell, given rates already written into this.rate */
  fire(dt, rnd) {
    const s = this.spikes;
    let sum = 0, count = 0, max = 0;
    for (let i = 0; i < this.n; i++) {
      const r = this.rate[i];
      sum += r;
      if (r > max) max = r;
      const p = 1 - Math.exp(-Math.max(0, r) * dt);
      const k = rnd() < p ? 1 : 0;
      s[i] = k;
      count += k;
    }
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

    this.sex = sex;            // 'M' or 'F' — several nuclei below are dimorphic
    this.name = name;

    // ------------------------------------------------ homeostatic drives
    // Each can be switched off from the panel; off means the circuit is silent
    // and the behaviour it motivates is unavailable.
    this.drives = { eat: true, drink: true, mate: true };
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
    const pag = new Population('pag', 'PAG', 'PAG neurons', 16, 10);
    for (let i = 0; i < pag.n; i++) {
      pag.cells.push({ gs: 0.4 + rnd() * 1.2, gc: 0.4 + rnd() * 1.5, base: 2 + rnd() * 3.5 });
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
      cea.cells.push({ gb: 0.8 + rnd() * 2.4, gc: 0.4 + rnd() * 1.4, base: 1 + rnd() * 2.5 });
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
    for (let i = 0; i < mea.n; i++) mea.cells.push({ base: 0.8 + rnd() * 2, gp: 0.6 + rnd() * 1.5, gs: 0.4 + rnd() * 1.2 });
    P.push(mea);
    // BNST principal nucleus is markedly larger in males (Bayless et al. 2019)
    const bst = new Population('bst', 'BST', 'BNST neurons', 14, 12);
    for (let i = 0; i < bst.n; i++) bst.cells.push({ base: 0.8 + rnd() * 2, gp: 0.5 + rnd() * 1.3, gd: 0.6 + rnd() * 1.5 });
    P.push(bst);
    const mpn = new Population('mpn', 'MPN', 'Esr1 neurons', 14, 14);
    for (let i = 0; i < mpn.n; i++) mpn.cells.push({ base: 0.5 + rnd() * 1.6, gain: 0.6 + rnd() * 1.6 });
    P.push(mpn);
    const vmh = new Population('vmh', 'VMH', 'VMHvl neurons', 14, 14);
    for (let i = 0; i < vmh.n; i++) vmh.cells.push({ base: 0.5 + rnd() * 1.6, gain: 0.6 + rnd() * 1.6 });
    P.push(vmh);
    const pmv = new Population('pmv', 'PMv', 'PMv neurons', 10, 10);
    for (let i = 0; i < pmv.n; i++) pmv.cells.push({ base: 0.8 + rnd() * 1.8, gain: 0.5 + rnd() * 1.4 });
    P.push(pmv);

    // ---- hearing, tuned to the pup-call band (Ehret 2005) --------------
    const audp = new Population('audp', 'AUDp', 'A1 neurons', 16, 14);
    for (let i = 0; i < audp.n; i++) {
      audp.cells.push({ base: 1.5 + rnd() * 3.5, gain: 0.5 + rnd() * 1.5, pup: 0.4 + rnd() * 1.6 });
    }
    P.push(audp);

    // ---- light and stress ---------------------------------------------
    const sch = new Population('sch', 'SCH', 'SCN neurons', 10, 12);
    for (let i = 0; i < sch.n; i++) sch.cells.push({ base: 1.2 + rnd() * 2.5, gain: 8 + rnd() * 12 });
    P.push(sch);
    const pvh = new Population('pvh', 'PVH', 'CRH neurons', 12, 12);
    for (let i = 0; i < pvh.n; i++) pvh.cells.push({ base: 0.8 + rnd() * 2, gl: 0.5 + rnd() * 1.4, gw: 0.6 + rnd() * 1.6, gb: 0.5 + rnd() * 1.5 });
    P.push(pvh);

    this.pops = P;
    this.byKey = {};
    for (const p of P) this.byKey[p.key] = p;

    // region -> populations
    this.byRegion = {};
    for (const p of P) (this.byRegion[p.region] ||= []).push(p);

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
    this.t += dt;
    const vcm = s.speed * 100;                  // cm/s
    const moving = clamp(vcm / 5, 0, 1);        // 0 at rest, 1 above 5 cm/s

    // ---------------- oscillators -------------------------------------
    // theta frequency rises linearly with running speed (Rivas 1996; Wells 2013)
    this.thetaFreq = clamp(6.7 + 0.055 * vcm, 6.2, 12);
    this.thetaPhase = (this.thetaPhase + TAU * this.thetaFreq * dt) % TAU;
    // sniffing: ~5 Hz at rest, 8-10 Hz while investigating (Wachowiak 2011)
    const sniffF = 5 + 4.5 * Math.max(moving, s.cmd.sniff ? 1 : 0);
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
    this.odorRate = dt > 0 ? (odor - this.odor) / dt : 0;
    this.odorPrev = this.odor;
    this.odor = odor;
    this.detect = clamp(odor * 1.5, 0, 1);
    this.nearest = nearest;

    // decaying transients
    const dec = (v, tau) => v * Math.exp(-dt / tau);
    this.eating = dec(this.eating, 0.45);
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
    this.mateDrive = (this.drives.mate && !this.pregnant)
      ? clamp(this.libido * this.estrous * (0.35 + 0.65 * this.bodyCondition), 0, 1) : 0;

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
      mob.rate[i] = c.base + 42 * c.gain * odor * g;
    }
    const pir = this.byKey.pir;
    for (let i = 0; i < pir.n; i++) {
      const c = pir.cells[i];
      pir.rate[i] = c.base + 14 * c.gain * odor * sniffGate + 26 * c.dgain * Math.max(0, this.odorRate);
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
        p.rate[i] = c.base + lum * (7 * c.flow * flow + c.peak * drive);
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
      scm.rate[i] = c.base + c.gain * (18 * this.orient * (0.4 + 0.6 * side) + 5 * clamp(Math.abs(s.angVel) / 3, 0, 1));
    }
    const pag = this.byKey.pag;
    for (let i = 0; i < pag.n; i++) {
      const c = pag.cells[i];
      pag.rate[i] = c.base + c.gs * 7 * vig + c.gc * 6 * this.centre * (0.4 + 0.8 * this.light)
                  + 8 * this.bump + 5 * this.waterLevel;
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
      bla.rate[i] = c.base + c.gdet * 7 * this.detect + c.geat * 9 * this.eating;
    }
    const cea = this.byKey.cea;
    for (let i = 0; i < cea.n; i++) {
      const c = cea.cells[i];
      cea.rate[i] = c.base + c.gb * 11 * this.bump + c.gc * 5 * this.centre * (0.35 + 0.95 * this.light)
                  + 4 * this.waterLevel;
    }

    // ---------------- hypothalamus -----------------------------------
    const lha = this.byKey.lha;
    for (let i = 0; i < lha.n; i++) {
      const c = lha.cells[i];
      const feed = this.drives.eat ? 1 : 0;
      lha.rate[i] = c.base + feed * (c.gh * 9 * this.hunger * this.detect + c.ge * 7 * this.eating)
                  + 4 * this.drives.drink * this.thirst * this.waterNear;
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
      aob.rate[i] = c.base + 26 * c.gain * this.pheromone * g;
    }
    const mea = this.byKey.mea;
    for (let i = 0; i < mea.n; i++) {
      const c = mea.cells[i];
      mea.rate[i] = c.base + c.gp * 13 * this.pheromone + c.gs * 7 * this.social * (0.3 + 0.7 * md);
    }
    // dimorphic: the BNST principal nucleus is larger and more responsive in males
    const bst = this.byKey.bst, bstDim = male ? 1.35 : 0.7;
    for (let i = 0; i < bst.n; i++) {
      const c = bst.cells[i];
      bst.rate[i] = c.base + bstDim * (c.gp * 9 * this.pheromone + c.gd * 11 * md);
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
        ? (8 * md * this.social + 7 * this.mating)
        : (14 * md * this.estrous * (0.3 + 0.7 * this.social) + 18 * this.mating));
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
                   + c.pup * 16 * this.pupCall * oxyGain;
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
                  + 13 * this.nursing;        // oxytocin neurons during milk let-down
    }

    // ---------------- spikes, maps, LFP ------------------------------
    let total = 0;
    for (const p of this.pops) total += p.fire(dt, rnd);
    this.spikeRateTotal += (total / dt - this.spikeRateTotal) * Math.min(1, dt * 5);

    this.accumulate(s, dt, rip.active);
    this.updateLFP(s, dt, moving);

    return this;
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
  updateLFP(s, dt, moving) {
    const amp = 0.25 + 0.75 * moving;
    this.lfpTheta = amp * Math.sin(this.thetaPhase);
    // gamma nested in theta (stronger on the descending phase)
    const g = 0.17 * amp * Math.sin(this.thetaPhase * 9.5) * (0.5 + 0.5 * Math.cos(this.thetaPhase));
    const rip = this.ripple;
    this.lfpRipple = rip.active ? 0.95 * rip.env * Math.sin(this.t * TAU * 180) : 0;
    this.lfp = this.lfpTheta + g + this.lfpRipple + (this.rnd() - 0.5) * 0.06;
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

  /** activation 0..1 per Allen region, for the 3-D brain */
  regionActivation() {
    const out = (this.actScratch ||= {});
    for (const [acr, pops] of Object.entries(this.byRegion)) {
      let num = 0, den = 0;
      for (const p of pops) { num += p.norm * p.weight; den += p.weight; }
      out[acr] = den ? num / den : 0;
    }
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
      MOB: () => `odour ${(this.odor * 100).toFixed(0)}%`,
      'SSp-bfd': () => `contact ${(this.whiskerContact * 100) | 0}%`,
      SFO: () => `thirst ${(this.thirst * 100) | 0}%`,
      MEPO: () => `thirst ${(this.thirst * 100) | 0}%`,
      OV: () => `thirst ${(this.thirst * 100) | 0}%`,
      AOB: () => `pheromone ${(this.pheromone * 100) | 0}%`,
      MEA: () => `partner ${(this.social * 100) | 0}%`,
      BST: () => `${this.sex === 'M' ? 'male-typical (larger)' : 'female-typical'}`,
      MPN: () => this.pupCount > 0
        ? `parental drive ${(this.parentalDrive * 100) | 0}%`
        : `mate drive ${(this.mateDrive * 100) | 0}%`,
      VMH: () => this.sex === 'F' ? `receptive ${(this.estrous * 100) | 0}%` : `mate drive ${(this.mateDrive * 100) | 0}%`,
      PMv: () => `body condition ${(this.bodyCondition * 100) | 0}%`,
      SCH: () => `light ${(this.light * 100) | 0}%`,
      AUDp: () => this.pupCall > 0.05 ? `pup calling ${(this.pupCall * 100) | 0}%` : 'no pup calls',
      PVH: () => `stress load ${((this.light * this.centre + this.waterLevel) * 50) | 0}%`,
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
    this.value = this.valuePrev = this.rpe = this.rpeSmooth = this.valueNorm = 0;
    this.rpeSlow = this.rpePhasic = 0;
    this.valueMax = 0.25;
    this.t = 0;
  }

  get roles() { return ROLES; }
  static get BINS() { return BINS; }
  static get HD_BINS() { return HD_BINS; }
}
