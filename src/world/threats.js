/** Stimulus presentation, spatial sensing, procedural props and optional audio.
 * Defensive choices belong to Brain.updateDefense and the movement controller.
 * Cue strengths, trajectories and durations are illustrative simulation parameters.
 */
import * as THREE from 'three';
import { PredatorVisuals } from './predators.js';
import { predatorExposure } from './threatmodel.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** where a volatile stimulus is put down: the standard "stimulus corner" */
export const SOURCE_SPOT = { x: 0.40, z: 0.40 };

/** odour half-width, metres: concentration falls as 1/(1+(d/R)^2) */
const ODOUR_R = 0.24;

/**
 * The catalogue. `imminence` places each stimulus on Fanselow's predatory
 * imminence continuum — how close the danger is — which is what decides whether
 * a mouse assesses, freezes or runs (Fanselow & Lester 1988; Blanchard 1989).
 */
export const STIMULI = {
  cat: {
    label: 'cat approach',
    icon: '🐈',
    kind: 'sound',
    key: '1',
    dur: 2.4,
    level: 1,
    imminence: 0.62,
    habituates: 0.9,
    blurb: 'A visible cat approaches beside this cage and calls.',
    detail: 'Mice orient or freeze briefly, then retreat to a known refuge. '
          + 'A close approach can trigger immediate escape; animals under cover stay hidden.',
    ref: 'Blanchard & Blanchard 1989; Staples 2010',
  },
  owl: {
    label: 'owl swoop',
    icon: '🦉',
    kind: 'sound',
    looming: true,
    key: '2',
    dur: 1.6,
    level: 1,
    imminence: 1,
    habituates: 0.9,
    blurb: 'An owl flies low across the cage, casting a moving shadow.',
    detail: 'An approaching overhead threat favors escape to a known refuge. '
          + 'Without a known shelter, mice can freeze instead. Mice already under cover stay there.',
    ref: 'Yilmaz & Meister 2013; De Franceschi et al. 2016',
  },
  burst: {
    label: 'noise burst',
    icon: '🔊',
    kind: 'sound',
    key: '3',
    dur: 0.05,
    level: 0.85,
    startle: true,
    imminence: 0.45,
    habituates: 0.55,
    blurb: 'A brief synthesized noise burst.',
    detail: 'The acoustic startle reflex: a whole-body flinch with a latency of a '
          + 'few milliseconds, carried by a three-synapse brainstem arc. It is the '
          + 'textbook example of habituation — repeat it and the jump shrinks fast, '
          + 'then recovers over minutes of quiet.',
    ref: 'Koch 1999; Davis 1980',
  },
  tmt: {
    label: 'fox odour (TMT)',
    icon: '🦊',
    kind: 'odour',
    key: '4',
    level: 1,
    predator: true,
    vno: 0.15,
    imminence: 0.38,
    habituates: 1,
    colour: 0xc98500,
    blurb: 'Trimethylthiazoline on filter paper, in the far corner.',
    detail: 'A predator-odor gradient prompts cautious sampling and avoidance. '
          + 'Close contact can trigger retreat. The response depends on concentration and shelter.',
    ref: 'Fendt et al. 2005; Rosen et al. 2015',
  },
  collar: {
    label: 'cat collar',
    icon: '🧶',
    kind: 'odour',
    key: '5',
    level: 0.92,
    predator: true,
    vno: 0.85,
    imminence: 0.42,
    habituates: 1,
    colour: 0xd55181,
    blurb: 'A collar worn by a cat, dropped in the far corner.',
    detail: 'Predator scent recruits defensive pathways and encourages cautious '
          + 'sampling from a distance. The model includes a vomeronasal contribution.',
    ref: 'Papes et al. 2010; Canteras 2002',
  },
  foul: {
    label: 'rotten smell',
    icon: '🤢',
    kind: 'odour',
    key: '6',
    level: 1,
    predator: false,
    vno: 0,
    imminence: 0.05,
    habituates: 0.95,
    colour: 0x199e70,
    blurb: 'Something decayed — unpleasant, but not dangerous.',
    detail: 'The control. Innately aversive smells drive avoidance through a '
          + 'separate part of the olfactory bulb, and the mouse keeps away from the '
          + 'corner — but it does not freeze, it does not stop eating, and the '
          + 'defensive hypothalamus stays quiet. Disgust and fear are not the same '
          + 'circuit, and the panels show the difference.',
    ref: 'Kobayakawa et al. 2007; Root et al. 2014',
  },
};

export const STIMULUS_ORDER = ['cat', 'owl', 'burst', 'tmt', 'collar', 'foul'];

// --------------------------------------------------------------- sound
/** Browser-friendly synthesized cues; not calibrated animal vocalizations. */
class Siren {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }
  ensure() {
    if (this.muted) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch { return null; }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }
  noiseBuffer(secs) {
    const ctx = this.ctx;
    const n = Math.max(1, Math.floor(ctx.sampleRate * secs));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  play(key, level = 1) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (key === 'cat') this.yowl(t, level);
    else if (key === 'owl') this.screech(t, level);
    else if (key === 'burst') this.burst(t, level);
  }
  /** a two-phase yowl: rising, held, falling, with vibrato */
  yowl(t, level) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.Q.value = 3.5;
    filt.frequency.setValueAtTime(700, t);
    filt.frequency.linearRampToValueAtTime(1500, t + 0.5);
    filt.frequency.linearRampToValueAtTime(620, t + 2.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 * level, t + 0.18);
    g.gain.setValueAtTime(0.55 * level, t + 1.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
    filt.connect(g).connect(this.master);
    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    vib.frequency.value = 6.5;             // the warble of a yowl
    vibGain.gain.value = 26;
    vib.connect(vibGain);
    for (const [type, f, det] of [['sawtooth', 430, 0], ['sawtooth', 433, 7]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = det;
      o.frequency.setValueAtTime(f * 0.8, t);
      o.frequency.linearRampToValueAtTime(f * 1.25, t + 0.55);
      o.frequency.linearRampToValueAtTime(f * 0.72, t + 2.2);
      vibGain.connect(o.frequency);
      o.connect(filt);
      o.start(t); o.stop(t + 2.4);
    }
    vib.start(t); vib.stop(t + 2.4);
  }
  /** two rasping screeches, noise through a falling band-pass */
  screech(t, level) {
    const ctx = this.ctx;
    for (const off of [0, 0.5]) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(0.45);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 6;
      bp.frequency.setValueAtTime(3000, t + off);
      bp.frequency.exponentialRampToValueAtTime(900, t + off + 0.42);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + off);
      g.gain.exponentialRampToValueAtTime(0.7 * level, t + off + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.45);
      src.connect(bp).connect(g).connect(this.master);
      src.start(t + off); src.stop(t + off + 0.46);
    }
  }
  /** 40 ms of broadband noise, as square-edged as the speaker allows */
  burst(t, level) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.85 * level, t);
    g.gain.setValueAtTime(0.85 * level, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 400;
    src.connect(hp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.06);
  }
}

// --------------------------------------------------------------- the rig
export class Threats {
  constructor(scene, arena) {
    this.arena = arena;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.siren = new Siren();

    this.sound = null;          // the sound playing right now, if any
    this.loom = null;           // the current owl flyover, if any
    this.predator = null;
    this.predatorVisuals = null; // built on first presentation
    this.odour = null;          // the volatile source on the floor, if any
    this.onset = null;          // key of a stimulus that started this frame
    this.pendingOnset = null;   // set by trigger(), published by the next update()
    this.startle = 0;           // decaying impulse from a startling sound
    this.count = {};            // how many times each stimulus has been given
    this.habit = {};            // per-stimulus habituation, 1 = fully responsive
    this.lastAt = {};

    // ---- props: the source on the floor ----
    this.srcGroup = new THREE.Group();
    this.srcGroup.visible = false;
    this.srcGroup.position.set(SOURCE_SPOT.x, 0, SOURCE_SPOT.z);
    const paper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.0025, 24),
      new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.95 }),
    );
    paper.position.y = 0.0015;
    paper.castShadow = true;
    this.srcGroup.add(paper);
    this.srcPlume = new THREE.Mesh(
      new THREE.ConeGeometry(0.045, 0.12, 18, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xc98500, transparent: true, opacity: 0.2,
        side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      }),
    );
    this.srcPlume.position.y = 0.062;
    this.srcGroup.add(this.srcPlume);
    // the floor ring shows how far the plume reaches, which is also the region
    // the mouse will refuse to enter
    this.srcRing = new THREE.Mesh(
      new THREE.RingGeometry(ODOUR_R - 0.004, ODOUR_R, 48),
      new THREE.MeshBasicMaterial({
        color: 0xc98500, transparent: true, opacity: 0.3,
        side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      }),
    );
    this.srcRing.rotation.x = -Math.PI / 2;
    this.srcRing.position.y = 0.0025;
    this.srcGroup.add(this.srcRing);
    this.group.add(this.srcGroup);

    // ---- props: an expanding ring marking a sound ----
    this.ping = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 0.96, 60),
      new THREE.MeshBasicMaterial({
        color: 0xd55181, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthWrite: false, toneMapped: false,
      }),
    );
    this.ping.rotation.x = -Math.PI / 2;
    this.ping.position.y = 0.2;
    this.group.add(this.ping);
    this.pingT = 99;
  }

  get muted() { return this.siren.muted; }
  setMuted(on) { this.siren.muted = !!on; }

  /**
   * How responsive the animal still is to this stimulus. Sounds lose their
   * effect with repetition and get it back over a couple of quiet minutes;
   * predator odours are set to habituate: 1 and so never lose theirs.
   */
  responsiveness(key, now) {
    const st = STIMULI[key];
    let h = this.habit[key] ?? 1;
    const since = now - (this.lastAt[key] ?? -1e9);
    h = clamp(h + (1 - h) * (1 - Math.exp(-since / 110)), 0, 1);   // recovery, tau 110 s
    return st.habituates >= 1 ? 1 : h;
  }

  /**
   * Present a stimulus. Sounds and looming play once; odours are put down in
   * the stimulus corner and stay until they evaporate or are cleared.
   * Returns a short description of what was presented, for the event feed.
   */
  trigger(key, now = 0) {
    const st = STIMULI[key];
    if (!st) return null;
    const resp = this.responsiveness(key, now);
    this.count[key] = (this.count[key] || 0) + 1;
    this.habit[key] = resp * st.habituates;
    this.lastAt[key] = now;
    const level = st.level * resp;

    if (st.kind === 'sound') {
      this.sound = { key, t: 0, dur: st.dur, level, st };
      this.pendingOnset = key;
      this.pingT = 0;
      this.siren.play(key, level);
      if (st.startle) this.startle = level;
      if (key === 'cat' || key === 'owl') {
        this.predator = { key, t: 0, dur: key === 'cat' ? 10 : 4.2, level: Math.max(.75, level) };
        this.loom = key === 'owl' ? this.predator : null;
        this.predatorVisuals ||= new PredatorVisuals(this.group);
        this.predatorVisuals.update(this.predator);
      }
    } else {
      this.odour = { key, t: 0, level, st, x: SOURCE_SPOT.x, z: SOURCE_SPOT.z };
      this.pendingOnset = key;
      const c = st.colour ?? 0xc98500;
      this.srcPlume.material.color.setHex(c);
      this.srcRing.material.color.setHex(c);
      this.srcGroup.visible = true;
    }
    return { label: st.label, level, repeat: this.count[key], responsiveness: resp };
  }

  /** take the odour source away */
  clearOdour() {
    this.odour = null;
    this.srcGroup.visible = false;
  }

  /** Remove the current presentation; the animal's recovery is independent. */
  clear() {
    this.clearOdour();
    this.sound = this.loom = this.predator = null;
    this.onset = this.pendingOnset = null;
    this.startle = 0;
    this.predatorVisuals?.update(null);
    this.ping.material.opacity = 0; this.pingT = 99;
  }

  /** everything off, habituation included */
  reset() {
    this.clear();
    this.sound = null;
    this.loom = null;
    this.onset = null;
    this.pendingOnset = null;
    this.startle = 0;
    this.count = {};
    this.habit = {};
    this.lastAt = {};
    this.ping.material.opacity = 0;
    this.pingT = 99;
  }

  /** animate the props and let everything decay; call once per frame */
  update(dt, t) {
    // a stimulus triggered between frames is new to the animals *this* frame
    this.onset = this.pendingOnset;
    this.pendingOnset = null;
    this.startle *= Math.exp(-dt / 0.12);

    if (this.sound) {
      this.sound.t += dt;
      if (this.sound.t > this.sound.dur) this.sound = null;
    }

    if (this.predator) {
      this.predator.t += dt;
      if (this.predator.t >= this.predator.dur) this.predator = this.loom = null;
      this.predatorVisuals.update(this.predator);
    }

    // the odour evaporates: strong for a minute, gone within about four
    if (this.odour) {
      this.odour.t += dt;
      this.odour.level *= Math.exp(-dt / 150);
      const o = this.odour;
      if (o.level < 0.06) {
        this.clearOdour();
      } else {
        const k = 0.75 + 0.25 * Math.sin(t * 1.7);
        this.srcPlume.scale.set(1, 0.7 + 0.5 * o.level * k, 1);
        this.srcPlume.material.opacity = 0.1 + 0.22 * o.level * k;
        this.srcRing.material.opacity = 0.1 + 0.26 * o.level;
      }
    }

    // the sound ring
    this.pingT += dt;
    if (this.pingT < 0.9) {
      const u = this.pingT / 0.9;
      this.ping.scale.setScalar(0.35 + u * 0.9);
      this.ping.material.opacity = 0.5 * (1 - u);
    } else if (this.ping.material.opacity) {
      this.ping.material.opacity = 0;
    }
  }

  /** odour concentration at a point, 0..1 */
  odourAt(x, z) {
    const o = this.odour;
    if (!o) return 0;
    const d = Math.hypot(x - o.x, z - o.z);
    return clamp(o.level / (1 + (d / ODOUR_R) ** 2), 0, 1);
  }

  /**
   * What a mouse at (x, z) is currently exposed to. Sound reaches the whole
   * cage; the odour is a gradient the animal has to move through, which is what
   * makes avoidance measurable.
   */
  sense(x, z, heading = 0, sheltered = false) {
    const out = {
      sound: 0, soundKind: null, onset: null, startle: this.startle,
      odour: 0, odourKind: null, predatorOdour: 0, foulOdour: 0, vno: 0,
      visual: 0, predatorKind: null, looming: 0, imminence: 0, source: null, sourceDist: Infinity, sourceBearing: 0,
      odourSource: null, sourceKind: null, sheltered,
    };
    if (this.sound) {
      const s = this.sound;
      // the call is loudest while it sounds and stops when it stops
      out.sound = s.level * (s.st.startle ? 1 : 0.55 + 0.45 * Math.sin(s.t * 3.1) ** 2);
      out.sound *= sheltered && s.key !== 'burst' ? .3 : 1;
      out.soundKind = s.key;
      out.imminence = Math.max(out.imminence, s.st.imminence * s.level);
    }
    if (this.onset) out.onset = this.onset;
    const exposure = predatorExposure(this.predator, x, z, heading, sheltered);
    if (this.predator && exposure.visual > .015) {
      Object.assign(out, exposure);
      out.visual *= this.predator.level;
      out.predatorKind = this.predator.key;
      out.sourceKind = this.predator.key;
    }
    const o = this.odour;
    if (o) {
      const c = this.odourAt(x, z);
      out.odour = c;
      out.odourKind = o.key;
      out.odourSource = { x: o.x, z: o.z };
      if (!out.source || out.visual < c * .6) {
        out.source = out.odourSource;
        out.sourceKind = o.key;
        out.sourceDist = Math.hypot(x - o.x, z - o.z);
        out.sourceBearing = Math.atan2(o.x - x, o.z - z);
      }
      if (o.st.predator) {
        out.predatorOdour = c;
        out.vno = c * o.st.vno;
        // a smell is a *potential* danger: imminence rises as the mouse
        // approaches the source, which is what graded avoidance comes from
        out.imminence = Math.max(out.imminence, o.st.imminence * c);
      } else {
        out.foulOdour = c;
      }
    }
    return out;
  }

  /** live stimuli, for the panel */
  status() {
    return {
      sound: this.sound ? STIMULI[this.sound.key].label : null,
      odour: this.odour ? { label: STIMULI[this.odour.key].label, level: this.odour.level, key: this.odour.key } : null,
      looming: !!this.loom,
      predator: this.predator ? { key: this.predator.key, label: STIMULI[this.predator.key].label } : null,
    };
  }
}

export { ODOUR_R };
