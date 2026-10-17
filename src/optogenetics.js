/**
 * A virtual optogenetics rig.
 *
 * Express a light-gated ion channel in one named population of neurons, shine
 * light down a fibre, and watch what the animal does. That is the whole
 * technique, and it is the reason we know which cells cause which behaviour:
 * stimulating VMHvl makes a male mouse attack, stimulating AgRP neurons makes
 * a fully fed mouse eat, silencing them stops a hungry one.
 *
 * The opsins are microbial proteins — channelrhodopsin from green algae,
 * halorhodopsin and archaerhodopsin from archaea — expressed in neurons by
 * viral delivery. Blue-light channelrhodopsins pass cations and depolarise;
 * the amber pumps and the anion channels hyperpolarise and silence. This
 * module models their real kinetics, so the differences between them matter:
 * ChR2 cannot follow a 100 Hz train, a halorhodopsin pump needs the light held
 * on continuously, and a step-function opsin latches on from a single flash.
 *
 * State is per-brain. Two animals, two independent sets of implants: light on
 * the male's VMHvl does nothing to the female.
 *
 * Integration is two lines in the host app:
 *     const optics = mountOptics({ getBrain: () => activeBrain });
 *     optics.apply(brain, dt);   // once per agent, right after brain.update()
 * With nothing expressed and no light on, `apply()` is a true no-op and the
 * baseline physiology is untouched.
 *
 * OPSIN SOURCES
 *   Nagel et al. 2003 (ChR2); Boyden et al. 2005 (millisecond neuronal
 *   control); Gunaydin et al. 2010 (ChETA); Zhang et al. 2007 and Gradinaru
 *   et al. 2010 (NpHR, eNpHR3.0); Chow et al. 2010 (Arch); Berndt et al. 2009
 *   (SSFO); Mahn et al. 2018 (stGtACR2); Marshel et al. 2019 (ChRmine).
 *   The 2026 Nobel Prize in Physiology or Medicine was awarded to Karl
 *   Deisseroth, Peter Hegemann and Georg Nagel for the discovery of
 *   light-gated ion channels and the development of optogenetics.
 *
 * BEHAVIOUR SOURCES — every mapping in TARGETS is a published optogenetic
 * result, cited on the entry.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- opsins
/**
 * `sign` +1 depolarising, -1 hyperpolarising. `tauOff` is the channel closing
 * time constant in seconds, `maxHz` the highest pulse rate the opsin can
 * follow before spikes begin to fail (0 = meant for continuous light),
 * `halfPower` the irradiance in mW/mm^2 giving half-maximal activation.
 */
export const OPSINS = {
  ChR2: {
    name: 'ChR2(H134R)', family: 'channelrhodopsin', sign: 1,
    nm: 470, colour: '#4da6ff', tauOn: 0.002, tauOff: 0.019, maxHz: 40,
    halfPower: 1.0, gain: 48,
    note: 'The workhorse. Light-gated cation channel from Chlamydomonas. Blue light depolarises and drives spiking.',
  },
  ChETA: {
    name: 'ChETA(E123T/H134R)', family: 'channelrhodopsin', sign: 1,
    nm: 470, colour: '#4da6ff', tauOn: 0.001, tauOff: 0.004, maxHz: 200,
    halfPower: 1.6, gain: 40,
    note: 'Fast variant: closes in ~4 ms instead of ~19 ms, so it follows trains to 200 Hz without spike failure.',
  },
  ChRmine: {
    name: 'ChRmine', family: 'channelrhodopsin', sign: 1,
    nm: 585, colour: '#ff8a4d', tauOn: 0.003, tauOff: 0.030, maxHz: 40,
    halfPower: 0.1, gain: 62,
    note: 'Red-shifted with a very large photocurrent, so it works at low power and through tissue — stimulation without an implanted fibre.',
  },
  SSFO: {
    name: 'SSFO', family: 'step-function opsin', sign: 1,
    nm: 470, colour: '#7aa6ff', tauOn: 0.005, tauOff: 1800, maxHz: 0,
    halfPower: 0.2, gain: 26,
    note: 'Bistable. One brief blue flash latches it on for many minutes; amber closes it. Raises excitability with the laser off.',
  },
  eNpHR3: {
    name: 'eNpHR3.0', family: 'halorhodopsin', sign: -1,
    nm: 590, colour: '#ffb84d', tauOn: 0.002, tauOff: 0.0042, maxHz: 0,
    halfPower: 2.4, gain: 0.95,
    note: 'Light-driven chloride pump. Silences neurons, but being a pump and not a channel it needs the light held on continuously.',
  },
  Arch: {
    name: 'Arch', family: 'archaerhodopsin', sign: -1,
    nm: 566, colour: '#9fe870', tauOn: 0.002, tauOff: 0.010, maxHz: 0,
    halfPower: 2.0, gain: 0.92,
    note: 'Outward proton pump. Strong, fast silencing; also needs continuous light.',
  },
  stGtACR2: {
    name: 'stGtACR2', family: 'anion channelrhodopsin', sign: -1,
    nm: 470, colour: '#6ad9ff', tauOn: 0.001, tauOff: 0.015, maxHz: 0,
    halfPower: 0.25, gain: 0.99,
    note: 'A chloride CHANNEL rather than a pump, so it silences at a fraction of the power. Soma-targeted to spare axon terminals.',
  },
};

// ---------------------------------------------------------------- targets
/**
 * What driving each region does to the animal. `drives` are the behavioural
 * outputs at full excitation. A target may instead supply `dose(effect)` when
 * the behaviour is not simply proportional — see VMH.
 */
export const TARGETS = {
  VMH: {
    /**
     * The headline result, and the reason dose matters. The same VMHvl
     * neurons produce different behaviour at different drive levels: weak
     * stimulation evokes mounting, stronger stimulation evokes attack, and
     * the attack stops the moment the light goes off.
     */
    dose: (e) => (e < 0.45
      ? { mating: (e / 0.45) * 0.85, aggression: 0 }
      : { mating: Math.max(0, 0.85 - ((e - 0.45) / 0.55) * 0.85), aggression: (e - 0.45) / 0.55 }),
    drives: { aggression: 1 },
    effect: 'Attack — dose-dependently. Weak stimulation of VMHvl makes the male mount; turn the power up and the same neurons drive him to attack whatever is nearby, stopping the instant the light goes off.',
    ref: 'Lin et al. 2011, Nature 470:221',
  },
  MPN: {
    drives: { mating: 1, aggression: -0.2 },
    effect: 'Courtship and mounting. Esr1+ neurons in the medial preoptic area drive the whole male courtship sequence.',
    ref: 'Wei et al. 2018, Nature Communications 9:279',
  },
  PMv: {
    drives: { aggression: 0.75 },
    effect: 'Aggression and social dominance. Brief stimulation can flip the outcome of a dominance contest, and the win persists afterwards.',
    ref: 'Stagkourakis et al. 2018, Nature Neuroscience 21:834',
  },
  MEA: {
    drives: { aggression: 0.55, mating: 0.25 },
    effect: 'Medial amygdala. Sparse stimulation drives social investigation; stronger drive tips it into attack.',
    ref: 'Hong et al. 2014, PNAS 111:E5081',
  },
  BST: {
    drives: { aggression: 0.4, fear: 0.2 },
    effect: 'BNST. Sexually dimorphic control of social approach and aggression, stronger in the male.',
    ref: 'Bayless et al. 2019, Cell 176:1190',
  },
  ARH: {
    drives: { feeding: 1 },
    effect: 'Voracious feeding. Driving AgRP neurons makes a fully fed mouse start eating within seconds; silencing them stops a hungry one.',
    ref: 'Aponte et al. 2011, Nat Neurosci 14:351; Krashes et al. 2011, J Clin Invest 121:1424',
  },
  LHA: {
    drives: { feeding: 0.8 },
    effect: 'Lateral hypothalamus. GABAergic stimulation drives appetitive approach and gnawing, even at inedible objects.',
    ref: 'Jennings et al. 2015, Cell 160:516',
  },
  SFO: {
    drives: { drinking: 1 },
    effect: 'Thirst. Stimulating SFO thirst neurons makes a water-sated mouse drink immediately.',
    ref: 'Oka et al. 2015, Nature 520:349',
  },
  PAG: {
    drives: { fear: 0.9, freeze: 0.8 },
    effect: 'Defence. Ventrolateral PAG drives freezing, dorsal PAG drives flight — defensive behaviour with no threat present.',
    ref: 'Tovote et al. 2016, Nature 534:206',
  },
  CEA: {
    drives: { fear: 0.8, freeze: 1 },
    effect: 'Central amygdala. CEAl output drives freezing directly.',
    ref: 'Ciocchi et al. 2010, Nature 468:277',
  },
  VTA: {
    drives: { reward: 1 },
    effect: 'Reward. Phasic stimulation of VTA dopamine neurons is enough on its own to produce conditioned place preference — the animal comes back to where it was stimulated.',
    ref: 'Tsai et al. 2009, Science 324:1080',
  },
  SNc: {
    drives: { reward: 0.5, locomotor: 0.6 },
    effect: 'Nigrostriatal dopamine. Sets movement vigour; stimulation raises the probability of initiating movement.',
    ref: 'da Silva et al. 2018, Nature 554:244',
  },
  ACB: {
    drives: { reward: 0.7 },
    effect: 'Accumbens. Drives motivated approach and reinforcement.',
    ref: 'Britt et al. 2012, Neuron 76:790',
  },
  SCm: {
    drives: { orienting: 1 },
    effect: 'Superior colliculus. Unilateral stimulation produces a contraversive orienting turn.',
    ref: 'Wang et al. 2015, J Neurosci 35:7992',
  },
  MOp: {
    drives: { locomotor: 1 },
    effect: 'Motor cortex. Direct stimulation evokes limb movement and raises locomotor drive.',
    ref: 'Ayling et al. 2009, Nat Methods 6:219',
  },
  PVH: {
    drives: { fear: 0.6, freeze: 0.3 },
    effect: 'CRH neurons. Stimulation drives stress behaviour — grooming, arousal, defensive posture.',
    ref: 'Füzesi et al. 2016, Nature Communications 7:11937',
  },
  CA1: {
    drives: {},
    effect: 'Hippocampus. Driving a place-cell ensemble implants a memory of somewhere the animal has never been; here you will see the decoded position pull away from the real one.',
    ref: 'Liu et al. 2012, Nature 484:381',
  },
};

/** behaviours this rig can evoke, in panel order */
export const DRIVE_KEYS = ['aggression', 'mating', 'feeding', 'drinking', 'fear', 'freeze', 'reward', 'orienting', 'locomotor'];

const zeroDrives = () => Object.fromEntries(DRIVE_KEYS.map((k) => [k, 0]));

// ---------------------------------------------------------------- engine
export class Optics {
  constructor() {
    /** brain -> {label, implants: Map<region, implant>, drives, t} */
    this.subjects = new Map();
    this.log = [];
    this.enabled = true;
    this.t = 0;
  }

  // ---- subjects -------------------------------------------------------
  /** register a brain as an experimental subject; idempotent */
  attach(brain, label) {
    let s = this.subjects.get(brain);
    if (!s) {
      s = { brain, label: label || `subject ${this.subjects.size + 1}`, implants: new Map(), drives: zeroDrives(), t: 0 };
      this.subjects.set(brain, s);
    } else if (label) s.label = label;
    return s;
  }

  subjectOf(brain) { return this.subjects.get(brain) || this.attach(brain); }

  /** best-effort name for an animal, so the panel can label its tabs */
  static labelFor(brain, i) {
    for (const k of ['name', 'label', 'id', 'sex']) {
      const v = brain?.[k];
      if (typeof v === 'string' && v) return v;
    }
    return `subject ${i + 1}`;
  }

  // ---- implants -------------------------------------------------------
  install(brain, region, opsinKey, opts = {}) {
    if (!OPSINS[opsinKey]) throw new Error(`unknown opsin ${opsinKey}`);
    const s = this.subjectOf(brain);
    const im = {
      region, opsin: opsinKey,
      power: opts.power ?? 5,            // mW/mm^2 at the fibre tip
      freqHz: opts.freqHz ?? 20,         // pulse train rate
      pulseMs: opts.pulseMs ?? 5,
      on: opts.on ?? false,
      act: 0,                            // 0..1 open-channel fraction
      expression: opts.expression ?? 1,  // how well the virus took
      latched: false,                    // bistable opsins
    };
    s.implants.set(region, im);
    this.note(`${s.label}: ${OPSINS[opsinKey].name} expressed in ${region}`);
    return im;
  }

  remove(brain, region) {
    const s = this.subjectOf(brain);
    if (s.implants.delete(region)) this.note(`${s.label}: implant removed from ${region}`);
  }

  setLight(brain, region, patch) {
    const s = this.subjectOf(brain);
    const im = s.implants.get(region);
    if (!im) return null;
    Object.assign(im, patch);
    if ('on' in patch) {
      const o = OPSINS[im.opsin];
      if (o.tauOff > 10) {
        im.latched = patch.on;
        this.note(`${s.label}: ${region} ${patch.on ? 'latched ON' : 'closed'} (${o.name})`);
      } else {
        this.note(`${s.label}: ${region} light ${patch.on ? 'ON' : 'off'} · ${im.power.toFixed(1)} mW/mm²${o.sign > 0 && im.freqHz ? ` · ${im.freqHz} Hz` : ''}`);
      }
    }
    return im;
  }

  clearSubject(brain) {
    const s = this.subjectOf(brain);
    s.implants.clear();
    s.drives = zeroDrives();
    this.note(`${s.label}: all implants cleared`);
  }

  note(msg) {
    this.log.unshift({ t: this.t, msg });
    if (this.log.length > 40) this.log.pop();
  }

  /**
   * Is the fibre delivering light at all? For a pulse train this is true for
   * the whole train, not just during a pulse: a 5 ms pulse at 20 Hz cannot be
   * resolved by a 16 ms simulation step, and point-sampling it would alias
   * badly — a faster train would be "caught" more often and so look stronger,
   * which is backwards. What matters physiologically is whether the train is
   * running; how fast it can be followed is handled separately by `fidelity`.
   */
  trainOn(im) {
    const o = OPSINS[im.opsin];
    if (o.tauOff > 10) return im.latched ? 1 : 0;       // bistable: already latched
    return im.on ? 1 : 0;
  }

  /** instantaneous pulse state — for the panel's flicker only, never for physiology */
  pulseNow(im) {
    const o = OPSINS[im.opsin];
    if (!this.trainOn(im)) return 0;
    if (o.sign < 0 || !im.freqHz) return 1;             // pumps hold continuous light
    const period = 1 / im.freqHz;
    return (this.t % period) < Math.min(im.pulseMs / 1000, period) ? 1 : 0;
  }

  /** kept for callers that only want to know whether light is being delivered */
  lightGate(im) { return this.trainOn(im); }

  /** the behaviour drives currently evoked in one animal */
  drivesFor(brain) {
    return this.subjects.get(brain)?.drives || zeroDrives();
  }

  /**
   * Modulate one brain's firing. Call once per step for each animal, straight
   * after that animal's `brain.update(...)`. A no-op when that animal has no
   * implant doing anything.
   */
  apply(brain, dt) {
    this.t += dt;
    const s = this.subjects.get(brain);
    if (!s) return zeroDrives();
    s.t += dt;

    // true no-op: nothing expressed, or nothing lit and nothing still open
    if (!this.enabled || !s.implants.size || !brain?.pops) {
      if (s.implants.size === 0) return s.drives;
    }
    let anyActive = false;
    for (const im of s.implants.values()) {
      if (im.act > 1e-4 || this.lightGate(im)) { anyActive = true; break; }
    }
    if (!anyActive || !this.enabled) {
      for (const k of DRIVE_KEYS) s.drives[k] = 0;
      return s.drives;
    }

    const next = zeroDrives();
    const rnd = Math.random;

    for (const im of s.implants.values()) {
      const o = OPSINS[im.opsin];

      // Engagement envelope. `sat` is how saturated the opsin is at this
      // irradiance; the envelope rises when the train starts and falls when it
      // stops, on a behavioural timescale rather than the channel's own
      // microsecond kinetics (which no simulation step here could resolve).
      const lit = this.trainOn(im);
      const sat = im.power / (im.power + o.halfPower);   // irradiance saturates
      const want = lit ? sat * im.expression : 0;
      const tau = lit ? 0.03 : Math.max(o.tauOff, 0.04);
      im.act += (want - im.act) * clamp(dt / tau, 0, 1);
      if (im.act < 1e-4) continue;

      // pulsing an excitatory opsin faster than it can close causes spike
      // failure: the membrane never gets to repolarise between pulses
      let fidelity = 1;
      if (o.sign > 0 && o.maxHz > 0 && im.freqHz > o.maxHz) {
        fidelity = clamp(o.maxHz / im.freqHz, 0.15, 1);
      }
      const effect = im.act * fidelity;

      // drive every population belonging to this region.
      // A pulse train drives roughly one spike per pulse, so the evoked rate
      // is the pulse frequency itself, capped at what the opsin can follow.
      // Continuous illumination instead gives a tonic depolarisation.
      const pops = brain.byRegion?.[im.region] || [];
      const pulsed = o.sign > 0 && im.freqHz > 0 && o.maxHz > 0;
      const add = o.sign > 0
        ? (pulsed ? Math.min(im.freqHz, o.maxHz) : o.gain) * im.act
        : 0;
      for (const p of pops) {
        if (o.sign > 0) {
          for (let i = 0; i < p.n; i++) p.rate[i] = clamp(p.rate[i] + add, 0, 400);
        } else {
          const keep = 1 - effect * o.gain;
          for (let i = 0; i < p.n; i++) p.rate[i] = Math.max(0, p.rate[i] * keep);
        }
        // redraw spikes so the raster and everything downstream agree with
        // what the light just did
        if (typeof p.fire === 'function') p.fire(dt, rnd);
      }

      // behavioural consequence
      const tgt = TARGETS[im.region];
      if (tgt) {
        const d = tgt.dose ? tgt.dose(effect) : null;
        if (d) {
          for (const [k, v] of Object.entries(d)) if (k in next) next[k] += v * o.sign;
        } else {
          for (const [k, w] of Object.entries(tgt.drives)) if (k in next) next[k] += w * effect * o.sign;
        }
      }
    }

    for (const k of DRIVE_KEYS) s.drives[k] = clamp(next[k], -1, 1);
    return s.drives;
  }

  /** one-line summary of what is being done to an animal, for a status badge */
  summary(brain) {
    const s = this.subjects.get(brain);
    if (!s) return null;
    const live = [...s.implants.values()].filter((im) => this.lightGate(im) || im.act > 0.02);
    if (!live.length) return null;
    return live.map((im) => `${im.region}${OPSINS[im.opsin].sign > 0 ? '↑' : '↓'}${(im.act * 100) | 0}%`).join(' ');
  }

  /** regions worth offering, those with a known behavioural result first */
  static catalogue(brain) {
    const known = [], other = [];
    for (const acr of Object.keys(brain?.byRegion || {})) (TARGETS[acr] ? known : other).push(acr);
    known.sort(); other.sort();
    return { known, other };
  }
}

// ---------------------------------------------------------------- panel
/**
 * Only the few rules the host stylesheet cannot already provide. Everything
 * else reuses the host's `.float`, `.body`, `.btn`, `.chip` and its CSS
 * variables, so the card looks like the rest of the interface.
 */
const CSS = `
#optics{left:12px;bottom:12px;z-index:41;width:396px;max-height:min(78vh,760px);display:flex;flex-direction:column}
#optics .body{overflow-y:auto;display:flex;flex-direction:column;gap:9px}
#optics .og-sec{border:1px solid var(--line,#1e2a3a);border-radius:6px;padding:7px 8px;background:var(--panel2,#151e2a)}
#optics .og-sec>h6{margin:0 0 6px;font-size:9px;letter-spacing:.11em;text-transform:uppercase;color:var(--ink3,#64788f);
 display:flex;justify-content:space-between;align-items:center;gap:6px;font-weight:600}
#optics .og-row{display:flex;align-items:center;gap:6px;margin:4px 0}
#optics .og-row label{flex:0 0 68px;font-size:10px;color:var(--ink2,#9fb2c8)}
#optics .og-row input[type=range]{flex:1;min-width:0;accent-color:var(--accent,#4dd4c0);height:3px}
#optics .og-row .val{flex:0 0 66px;text-align:right;font-family:var(--mono,monospace);font-size:10px;color:var(--ink,#e8eef6)}
#optics select{font:inherit;font-size:11px;color:var(--ink,#e8eef6);background:var(--panel2,#151e2a);
 border:1px solid var(--line2,#2a3a4f);border-radius:5px;padding:4px 6px;flex:1;min-width:0}
#optics .og-imp{border:1px solid var(--line,#1e2a3a);border-radius:6px;padding:7px 8px;margin-bottom:6px;background:var(--panel,#111823)}
#optics .og-imp.lit{border-color:var(--accent,#4dd4c0)}
#optics .og-imp h6{margin:0 0 5px;font-size:11px;display:flex;align-items:center;gap:6px;font-weight:600}
#optics .og-imp h6 .dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}
#optics .og-imp h6 .nm{flex:1;font-family:var(--mono,monospace)}
#optics .og-imp h6 .op{color:var(--ink3,#64788f);font-weight:400;font-size:9.5px}
#optics .og-eff{font-size:10px;color:var(--ink2,#9fb2c8);line-height:1.5;margin-top:5px;
 border-top:1px dashed var(--line2,#2a3a4f);padding-top:5px}
#optics .og-eff i{color:var(--ink3,#64788f);font-style:italic;display:block;margin-top:2px}
#optics .og-cells{display:block;width:100%;height:32px;border-radius:4px;background:#070c13;margin-top:5px}
#optics .og-drive{display:grid;grid-template-columns:70px 1fr 34px;gap:5px;align-items:center;margin:3px 0}
#optics .og-drive span{font-size:10px;color:var(--ink2,#9fb2c8);text-transform:capitalize}
#optics .og-drive .bar{height:5px;background:#0b1118;border-radius:3px;position:relative;overflow:hidden}
#optics .og-drive .fl{position:absolute;top:0;bottom:0;border-radius:3px}
#optics .og-drive b{font-family:var(--mono,monospace);font-size:9.5px;text-align:right;font-weight:500}
#optics .og-wrap{display:flex;flex-wrap:wrap;gap:4px}
#optics .og-wrap .btn{font-size:10px;padding:3px 6px}
#optics .og-log{font-family:var(--mono,monospace);font-size:9.5px;color:var(--ink3,#64788f);line-height:1.6;
 max-height:70px;overflow-y:auto}
#optics .og-note{font-size:10px;color:var(--ink3,#64788f);line-height:1.5}
#optics .og-tabs{display:flex;gap:4px;margin-bottom:7px}
#optics>h5{display:flex;align-items:center;gap:6px}
#optics>h5 .og-close{margin-left:auto;background:none;border:0;color:var(--ink3,#64788f);
 font-size:13px;line-height:1;cursor:pointer;padding:0 2px}
#optics>h5 .og-close:hover{color:var(--ink,#e8eef6)}
/* the launcher: always visible while the card is closed, so the feature is
   discoverable without knowing the hotkey */
#optics-launch{position:fixed;left:12px;bottom:12px;z-index:40;display:flex;align-items:center;gap:7px;
 font:600 11px/1 var(--mono,ui-monospace,Menlo,monospace);letter-spacing:.05em;
 color:var(--ink,#e8eef6);background:var(--panel,#111823);border:1px solid var(--accent,#4dd4c0);
 border-radius:7px;padding:8px 11px;cursor:pointer;box-shadow:0 6px 22px #0007;transition:.14s}
#optics-launch:hover{background:var(--panel2,#151e2a);box-shadow:0 6px 26px #000a,0 0 0 3px #4dd4c022}
#optics-launch .led{width:9px;height:9px;border-radius:50%;background:var(--accent,#4dd4c0);
 box-shadow:0 0 9px var(--accent,#4dd4c0);animation:og-pulse 1.9s ease-in-out infinite}
#optics-launch kbd{font:inherit;font-size:9.5px;background:#0b1118;border:1px solid var(--line2,#2a3a4f);
 border-bottom-width:2px;border-radius:3px;padding:2px 5px;color:var(--ink2,#9fb2c8)}
#optics-launch small{color:var(--ink3,#64788f);font-weight:400;letter-spacing:.02em}
@keyframes og-pulse{50%{opacity:.35;box-shadow:0 0 2px var(--accent,#4dd4c0)}}
`;

const PRESETS = [
  { label: 'VMHvl → mount', region: 'VMH', opsin: 'ChR2', power: 1.2, freqHz: 20, ref: 'Lin 2011 — low power' },
  { label: 'VMHvl → ATTACK', region: 'VMH', opsin: 'ChR2', power: 12, freqHz: 20, ref: 'Lin 2011 — high power' },
  { label: 'AgRP → feeding', region: 'ARH', opsin: 'ChR2', power: 6, freqHz: 20, ref: 'Krashes 2011' },
  { label: 'VTA → reward', region: 'VTA', opsin: 'ChR2', power: 5, freqHz: 30, ref: 'Tsai 2009' },
  { label: 'SFO → thirst', region: 'SFO', opsin: 'ChRmine', power: 3, freqHz: 20, ref: 'Oka 2015' },
  { label: 'PAG → freeze', region: 'PAG', opsin: 'ChR2', power: 7, freqHz: 20, ref: 'Tovote 2016' },
  { label: 'MPN → courtship', region: 'MPN', opsin: 'ChR2', power: 6, freqHz: 20, ref: 'Wei 2018' },
  { label: 'silence VMHvl', region: 'VMH', opsin: 'stGtACR2', power: 4, freqHz: 0, ref: 'Mahn 2018' },
  { label: 'silence AgRP', region: 'ARH', opsin: 'eNpHR3', power: 8, freqHz: 0, ref: 'Aponte 2011' },
];

/**
 * Build the control card and attach it to the document.
 *
 * @param {object}   opts
 * @param {()=>any}  opts.getBrain   the brain currently being driven
 * @param {()=>any[]}[opts.getBrains] every brain, so the panel can offer tabs
 * @param {string}   [opts.hotkey]   key that opens/closes the card, default 'g'
 * @param {Element}  [opts.mount]    where to attach, default document.body
 * @returns {Optics}
 */
export function mountOptics({ getBrain, getBrains, hotkey = 'g', mount } = {}) {
  const optics = new Optics();

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const card = document.createElement('div');
  card.className = 'float';
  card.id = 'optics';
  card.innerHTML = `
    <h5 data-fold>optogenetics <span class="tw">▾</span><button class="og-close" title="close (G)">✕</button></h5>
    <div class="body">
      <div class="og-tabs" id="og-tabs"></div>
      <div class="og-sec">
        <h6>classic experiments <span style="color:var(--line2,#2a3a4f);letter-spacing:.04em;text-transform:none">one click</span></h6>
        <div class="og-wrap" id="og-presets"></div>
      </div>
      <div class="og-sec">
        <h6>express an opsin</h6>
        <div class="og-row"><label>region</label><select id="og-region"></select></div>
        <div class="og-row"><label>opsin</label><select id="og-opsin"></select></div>
        <div class="og-note" id="og-opsin-note"></div>
        <div class="og-row" style="margin-top:7px">
          <button class="btn" id="og-install" style="flex:1">inject virus</button>
          <button class="btn" id="og-clear">clear</button>
        </div>
      </div>
      <div class="og-sec">
        <h6>implants <span id="og-count" style="letter-spacing:.04em;text-transform:none">none</span></h6>
        <div id="og-implants"></div>
      </div>
      <div class="og-sec">
        <h6>evoked behaviour</h6>
        <div id="og-drives"></div>
      </div>
      <div class="og-sec">
        <h6>lab log</h6>
        <div class="og-log" id="og-log"></div>
      </div>
    </div>`;
  (mount || document.body).appendChild(card);

  const $ = (id) => card.querySelector('#' + id);

  // A persistent launcher, so the rig is discoverable without knowing the
  // hotkey: the card starts hidden and this sits in its place.
  const launch = document.createElement('button');
  launch.id = 'optics-launch';
  launch.type = 'button';
  launch.innerHTML = '<span class="led"></span>optogenetics<kbd>G</kbd>'
    + '<small>drive the brain</small>';
  launch.title = 'Express an opsin and stimulate a brain region with light';
  (mount || document.body).appendChild(launch);

  // Sit clear of the host's furniture: above the trace footer, and above the
  // scale bar that occupies the bottom-left of the 3-D view. Measured rather
  // than hardcoded, so it survives a resize or a change to the layout.
  const seat = () => {
    const footer = document.querySelector('footer');
    const fh = footer ? Math.round(footer.getBoundingClientRect().height) : 0;
    // sit on the bottom edge of the 3-D view, just right of the scale bar,
    // which keeps it clear of the event feed above and the traces below
    const scale = document.querySelector('#scalebar');
    const left = scale ? Math.round(scale.getBoundingClientRect().right) + 16 : 12;
    launch.style.left = `${left}px`;
    launch.style.bottom = `${fh + 10}px`;
    card.style.bottom = `${fh + 12}px`;
    card.style.maxHeight = `min(${Math.max(240, innerHeight - fh - 40)}px, 760px)`;
  };
  seat();
  addEventListener('resize', seat);
  // the footer can be laid out after we mount, so re-measure once it settles
  requestAnimationFrame(seat);
  setTimeout(seat, 400);

  // the host's fold handler is delegated, so h5[data-fold] already collapses;
  // this shows and hides the whole card, swapping it with the launcher
  card.style.display = 'none';
  const open = (v) => {
    card.style.display = v ? 'flex' : 'none';
    launch.style.display = v ? 'none' : 'flex';
    if (v) { refreshRegions(); buildTabs(); }
  };
  launch.onclick = () => open(true);
  // the close button sits inside h5[data-fold]; don't let it also fold the card
  card.querySelector('.og-close').addEventListener('click', (e) => {
    e.stopPropagation();
    open(false);
  });
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === hotkey && !/input|select|textarea/i.test(e.target.tagName)) {
      e.preventDefault();
      open(card.style.display === 'none');
    }
  });

  // ---- which animal are we operating on ----
  let active = null;
  const brains = () => (getBrains?.() || [getBrain?.()]).filter(Boolean);
  function buildTabs() {
    const list = brains();
    list.forEach((b, i) => optics.attach(b, Optics.labelFor(b, i)));
    if (!active || !list.includes(active)) active = getBrain?.() || list[0] || null;
    const host = $('og-tabs');
    host.innerHTML = '';
    if (list.length < 2) { host.style.display = 'none'; return; }
    host.style.display = 'flex';
    for (const b of list) {
      const s = optics.subjectOf(b);
      const t = document.createElement('button');
      t.className = 'btn' + (b === active ? ' on' : '');
      t.textContent = s.label;
      t.onclick = () => { active = b; buildTabs(); buildImplants(); };
      host.appendChild(t);
    }
  }

  // ---- opsin picker ----
  const opsinSel = $('og-opsin');
  for (const [k, o] of Object.entries(OPSINS)) {
    const op = document.createElement('option');
    op.value = k;
    op.textContent = `${o.name} · ${o.nm} nm · ${o.sign > 0 ? 'excite' : 'silence'}`;
    opsinSel.appendChild(op);
  }
  const showNote = () => {
    const o = OPSINS[opsinSel.value];
    $('og-opsin-note').innerHTML =
      `<span style="color:${o.colour}">■</span> ${o.note} <span style="color:var(--line2,#2a3a4f)">`
      + `τoff ${o.tauOff >= 1 ? `${o.tauOff} s` : `${(o.tauOff * 1000).toFixed(0)} ms`}`
      + `${o.maxHz ? ` · follows to ${o.maxHz} Hz` : ' · continuous light'}</span>`;
  };
  opsinSel.onchange = showNote;
  showNote();

  // ---- region picker, filled from whatever the brain actually models ----
  let filled = false;
  function refreshRegions() {
    const brain = active || getBrain?.();
    if (!brain || filled) return;
    const { known, other } = Optics.catalogue(brain);
    const sel = $('og-region');
    sel.innerHTML = '';
    const add = (acr, g) => {
      const o = document.createElement('option');
      o.value = acr;
      const t = TARGETS[acr];
      o.textContent = t ? `${acr} — ${Object.keys(t.dose ? t.dose(1) : t.drives)[0] || 'readout'}` : acr;
      (g || sel).appendChild(o);
    };
    if (known.length) {
      const g = document.createElement('optgroup');
      g.label = 'known behavioural result';
      known.forEach((a) => add(a, g));
      sel.appendChild(g);
    }
    if (other.length) {
      const g = document.createElement('optgroup');
      g.label = 'other modelled regions';
      other.forEach((a) => add(a, g));
      sel.appendChild(g);
    }
    filled = true;
  }

  $('og-install').onclick = () => {
    const region = $('og-region').value;
    if (!region || !active) return;
    optics.install(active, region, opsinSel.value, { power: 5, freqHz: 20, on: false });
    buildImplants();
  };
  $('og-clear').onclick = () => { if (active) optics.clearSubject(active); buildImplants(); };

  // ---- presets ----
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = p.label;
    b.title = `${p.ref} — express and switch on`;
    b.onclick = () => {
      if (!active) return;
      if (!active.byRegion?.[p.region]) { optics.note(`${p.region} is not modelled here`); return drawLog(); }
      optics.install(active, p.region, p.opsin, { power: p.power, freqHz: p.freqHz, on: true });
      if (OPSINS[p.opsin].tauOff > 10) optics.setLight(active, p.region, { on: true });
      buildImplants();
    };
    $('og-presets').appendChild(b);
  }

  // ---- implant cards ----
  const cards = new Map();
  function buildImplants() {
    const host = $('og-implants');
    host.innerHTML = '';
    cards.clear();
    const s = active ? optics.subjectOf(active) : null;
    if (!s || !s.implants.size) {
      host.innerHTML = '<div class="og-note">No implants. Pick a region above, or run one of the classic experiments.</div>';
      $('og-count').textContent = 'none';
      return;
    }
    for (const im of s.implants.values()) {
      const o = OPSINS[im.opsin];
      const t = TARGETS[im.region];
      const el = document.createElement('div');
      el.className = 'og-imp';
      el.innerHTML = `
        <h6><span class="dot" style="background:${o.colour}"></span>
            <span class="nm">${im.region}</span><span class="op">${o.name}</span>
            <button class="btn og-light" style="padding:2px 8px">light</button>
            <button class="btn og-del" style="padding:2px 6px">✕</button></h6>
        <div class="og-row"><label>power</label><input type="range" class="og-pw" min="0" max="20" step="0.5" value="${im.power}"><span class="val og-pwv"></span></div>
        <div class="og-row"><label>frequency</label><input type="range" class="og-fq" min="0" max="100" step="1" value="${im.freqHz}"><span class="val og-fqv"></span></div>
        <div class="og-row"><label>expression</label><input type="range" class="og-ex" min="0" max="1" step="0.05" value="${im.expression}"><span class="val og-exv"></span></div>
        <canvas class="og-cells" width="380" height="32"></canvas>
        ${t ? `<div class="og-eff">${t.effect}<i>${t.ref}</i></div>`
            : '<div class="og-eff og-note">No published behavioural result wired up for this region — the firing will change, but no new behaviour.</div>'}`;
      host.appendChild(el);

      el.querySelector('.og-light').onclick = () => {
        optics.setLight(active, im.region, { on: !(OPSINS[im.opsin].tauOff > 10 ? im.latched : im.on) });
        drawLog();
      };
      el.querySelector('.og-del').onclick = () => { optics.remove(active, im.region); buildImplants(); drawLog(); };
      const pw = el.querySelector('.og-pw'), fq = el.querySelector('.og-fq'), ex = el.querySelector('.og-ex');
      pw.oninput = () => { im.power = +pw.value; };
      fq.oninput = () => { im.freqHz = +fq.value; };
      ex.oninput = () => { im.expression = +ex.value; };
      cards.set(im.region, { el, im, o,
        light: el.querySelector('.og-light'),
        pwv: el.querySelector('.og-pwv'), fqv: el.querySelector('.og-fqv'), exv: el.querySelector('.og-exv'),
        cv: el.querySelector('.og-cells') });
    }
    $('og-count').textContent = `${s.implants.size} expressed`;
  }
  buildImplants();

  // ---- behaviour bars ----
  const driveEls = {};
  for (const k of DRIVE_KEYS) {
    const row = document.createElement('div');
    row.className = 'og-drive';
    row.innerHTML = `<span>${k}</span><span class="bar"><i class="fl"></i></span><b>0</b>`;
    $('og-drives').appendChild(row);
    driveEls[k] = { fl: row.querySelector('.fl'), b: row.querySelector('b') };
  }

  function drawLog() {
    $('og-log').innerHTML = optics.log.length
      ? optics.log.map((l) => `<div>${l.t.toFixed(1)}s · ${l.msg}</div>`).join('')
      : '<div style="opacity:.5">nothing yet</div>';
  }
  drawLog();

  // ---- per-frame refresh ----
  let lastLog = 0;
  function tick() {
    requestAnimationFrame(tick);
    if (card.style.display === 'none' || !active) return;

    for (const c of cards.values()) {
      const { im, o } = c;
      const lit = optics.pulseNow(im);
      c.el.classList.toggle('lit', !!optics.trainOn(im) || im.act > 0.02);
      c.light.classList.toggle('on', o.tauOff > 10 ? im.latched : im.on);
      c.pwv.textContent = `${im.power.toFixed(1)} mW`;
      c.exv.textContent = `${(im.expression * 100) | 0}%`;
      if (o.sign < 0) { c.fqv.textContent = 'continuous'; c.fqv.style.color = ''; }
      else if (o.maxHz && im.freqHz > o.maxHz) { c.fqv.textContent = `${im.freqHz} Hz ⚠`; c.fqv.style.color = '#ff6b8a'; }
      else { c.fqv.textContent = im.freqHz ? `${im.freqHz} Hz` : 'steady'; c.fqv.style.color = ''; }

      // one bar per neuron: watch the light take hold cell by cell
      const pops = active.byRegion?.[im.region] || [];
      const g = c.cv.getContext('2d');
      const W = c.cv.width, H = c.cv.height;
      g.fillStyle = '#070c13'; g.fillRect(0, 0, W, H);
      const n = pops.reduce((a, p) => a + p.n, 0) || 1;
      const cw = W / n;
      let x = 0;
      for (const p of pops) {
        for (let i = 0; i < p.n; i++) {
          const v = clamp(p.rate[i] / (p.refMax || 20), 0, 1);
          const h = Math.max(1, v * (H - 2));
          g.fillStyle = p.spikes[i] ? '#ffffff' : o.colour;
          g.globalAlpha = p.spikes[i] ? 0.95 : 0.22 + 0.6 * v;
          g.fillRect(x, H - h, Math.max(1, cw - 0.4), h);
          x += cw;
        }
      }
      g.globalAlpha = 1;
      if (lit) { g.fillStyle = o.colour; g.globalAlpha = 0.13; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    }

    const d = optics.drivesFor(active);
    for (const k of DRIVE_KEYS) {
      const v = d[k] || 0;
      const el = driveEls[k];
      const pct = Math.abs(v) * 50;
      el.fl.style.width = `${pct}%`;
      el.fl.style.left = v >= 0 ? '50%' : `${50 - pct}%`;
      el.fl.style.background = v >= 0 ? 'var(--accent,#4dd4c0)' : '#ff6b8a';
      el.b.textContent = v.toFixed(2);
      el.b.style.color = Math.abs(v) > 0.05 ? (v > 0 ? 'var(--accent,#4dd4c0)' : '#ff6b8a') : 'var(--ink3,#64788f)';
    }

    if (optics.log.length !== lastLog) { lastLog = optics.log.length; drawLog(); }
  }
  requestAnimationFrame(tick);

  buildTabs();
  optics.card = card;
  optics.open = open;
  optics.rebuild = () => { buildTabs(); buildImplants(); };
  return optics;
}

export default Optics;
