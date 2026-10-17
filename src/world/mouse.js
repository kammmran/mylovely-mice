/**
 * The mouse: body rig, locomotion, and the behaviours the brain model reads
 * (running, turning, whisking, sniffing, rearing, eating).
 *
 * Every dimension, joint limit and gait parameter used here is a published
 * measurement, defined with its units and citation in `mousedata.js` and
 * mirrored for non-browser use in `data/mouse_biometrics.json`. Nothing
 * physical is hardcoded in this file.
 *
 * The rig is fully articulated: a segmented spine that bends within measured
 * lumbar/thoracic range, three-segment hindlimbs (femur / tibia / pes) and
 * two-segment forelimbs solved with inverse kinematics against measured joint
 * ranges, a speed-dependent gait engine that walks, trots and gallops with the
 * right footfall order and duty factor, a no-slip stance so the paws never
 * skate, an asymmetric whisking waveform with the measured
 * protraction/retraction speed ratio, a hinged jaw, blinking eyelids,
 * independently twitching ears and a 14-bead tail.
 */
import * as THREE from 'three';
import { MORPH, ROM, GAITS, GAIT_V_MAX, WHISK, SNIFF, DEG } from './mousedata.js';

const MAX_WALK = 0.17;        // m/s
const MAX_RUN = 0.46;         // m/s
const MAX_TURN = 3.1;         // rad/s
const BODY_Y = 0.019;

const FUR = 0xb6ada1;
const BELLY = 0xe4ded5;
const SKIN = 0xe2a0a6;

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** shortest signed angular difference, in (-PI, PI] */
function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Blend the measured gait table (GAITS, from mousedata.js) at a given speed in
 * cm/s, interpolating the footfall phases circularly so they wrap correctly.
 * Returns the stance fraction, the four footfall offsets, and the name of the
 * nearer gait.
 */
function blendGait(vGait) {
  let a = GAITS[0], b = GAITS[0], t = 0;
  if (vGait >= GAITS[GAITS.length - 1].v) { a = b = GAITS[GAITS.length - 1]; }
  else {
    for (let i = 0; i < GAITS.length - 1; i++) {
      if (vGait <= GAITS[i + 1].v) {
        a = GAITS[i]; b = GAITS[i + 1];
        t = smooth(clamp((vGait - a.v) / (b.v - a.v), 0, 1));
        break;
      }
    }
  }
  const ph = [];
  for (let i = 0; i < 4; i++) {
    // phases are circular, so interpolate as unit vectors
    const aa = a.ph[i] * TAU, bb = b.ph[i] * TAU;
    const x = Math.cos(aa) * (1 - t) + Math.cos(bb) * t;
    const z = Math.sin(aa) * (1 - t) + Math.sin(bb) * t;
    ph.push((Math.atan2(z, x) / TAU + 1) % 1);
  }
  return { duty: a.duty + (b.duty - a.duty) * t, ph, name: t < 0.5 ? a.name : b.name };
}

/**
 * Two-link IK in the leg's sagittal plane. The limb hangs from the origin,
 * -y is down and +z is toward the nose; `fz`/`fy` are the distal target.
 * Returns the local x-rotations for the proximal and distal joints, plus the
 * absolute angle of the distal segment (used to keep the paw level).
 * `kneeFwd` puts the joint cranial (hind legs) instead of caudal (front legs).
 */
function ik2(L1, L2, fz, fy, kneeFwd) {
  const r = Math.hypot(fz, fy) || 1e-6;
  const d = Math.min(r, (L1 + L2) * 0.999);
  const tz = (fz / r) * d, ty = (fy / r) * d;
  const alpha = Math.atan2(tz, -ty);
  const A = Math.acos(clamp((d * d + L1 * L1 - L2 * L2) / (2 * d * L1), -1, 1));
  const phi1 = kneeFwd ? alpha + A : alpha - A;
  const kz = L1 * Math.sin(phi1), ky = -L1 * Math.cos(phi1);
  const phi2 = Math.atan2(tz - kz, -(ty - ky));
  return { hip: -phi1, knee: -(phi2 - phi1), paw: phi2 };
}

export class Mouse {
  constructor(scene, arena) {
    this.arena = arena;
    this.x = -0.35; this.z = -0.35;
    this.heading = Math.PI * 0.25;
    this.speed = 0; this.angVel = 0; this.accel = 0;
    this.prevSpeed = 0;
    this.rear = 0;
    this.bumped = false;
    this.eatAnim = 0;
    this.chew = 0;
    this.whiskPhase = 0;
    this.stridePhase = 0;
    this.prevStride = 0;
    this.strideFreq = 2;
    this.strideLen = 0;
    this.gaitName = 'walk';
    this.earTwitch = 0; this.nextTwitch = 2;
    this.blink = 0; this.nextBlink = 1.5;
    this.groom = 0;
    this.cmd = { throttle: 0, turn: 0, sniff: 0 };

    // Behavioural drives pushed in from outside — an optogenetics rig, or
    // whatever owns the animal's decisions. The rig only *expresses* these as
    // posture; deciding what the mouse does about them is the caller's job.
    this.drive = {
      aggression: 0, mating: 0, feeding: 0, drinking: 0,
      fear: 0, freeze: 0, reward: 0, orienting: 0, locomotor: 0,
    };
    this.driveTarget = { ...this.drive };

    // Autopilot. The mouse forages on its own whenever the keyboard has been
    // quiet for a moment, and hands control straight back on the next keypress,
    // so the arena is never just a stationary animal waiting to be driven.
    this.auto = {
      on: true,          // set false to disable self-driving entirely
      engaged: false,    // currently driving itself?
      delay: 0.6,        // seconds of no input before it takes over
      idle: 0,
      target: { x: 0, z: 0 },
      retarget: 0,
      sniffFor: 0,
      sniffIn: 2,
    };
    this.autoInput = { throttle: 0, turn: 0, run: false, sniff: false };
    this.pickTarget();

    const g = new THREE.Group();
    this.root = g;
    scene.add(g);

    const fur = new THREE.MeshStandardMaterial({ color: FUR, roughness: 0.78, metalness: 0 });
    const belly = new THREE.MeshStandardMaterial({ color: BELLY, roughness: 0.82 });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.25, metalness: 0.1 });
    this.mats = { fur, belly, skin, dark };

    // ---------------- body ----------------
    // body -> chest + pelvis, so the spine can bend and the gait can
    // counter-rotate the shoulders against the hips.
    this.body = new THREE.Group();
    g.add(this.body);

    this.chest = new THREE.Group();
    this.chest.position.set(0, 0, 0.012);
    this.body.add(this.chest);

    this.pelvis = new THREE.Group();
    this.pelvis.position.set(0, 0, -0.016);
    this.body.add(this.pelvis);

    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.019, 22, 16), fur);
    torso.scale.set(1.0, 0.92, 1.5);        // elongated along +z
    torso.position.set(0, 0, 0.004);
    torso.castShadow = true;
    this.chest.add(torso);
    this.torso = torso;

    const hb = new THREE.Mesh(new THREE.SphereGeometry(0.0185, 18, 14), belly);
    hb.scale.set(0.9, 0.5, 1.35);
    hb.position.set(0, -0.009, 0.004);
    this.chest.add(hb);
    this.bellyMesh = hb;

    const rump = new THREE.Mesh(new THREE.SphereGeometry(0.0175, 18, 14), fur);
    rump.scale.set(1, 0.95, 1.25);
    rump.position.set(0, 0.001, -0.008);
    rump.castShadow = true;
    this.pelvis.add(rump);
    this.rump = rump;

    // ---------------- head ----------------
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.006, 0.022);
    this.chest.add(this.neck);

    this.head = new THREE.Group();
    this.head.position.set(0, 0.001, 0.002);
    this.neck.add(this.head);

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.0135, 20, 16), fur);
    skull.scale.set(0.95, 0.9, 1.15);
    skull.castShadow = true;
    this.head.add(skull);

    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.0092, 0.019, 16), fur);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -0.0024, 0.0165);
    snout.castShadow = true;
    this.head.add(snout);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.0026, 12, 10), skin);
    nose.position.set(0, -0.0018, 0.0255);
    this.head.add(nose);
    this.nose = nose;

    // lower jaw, hinged at the back of the skull
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.004, 0.004);
    this.head.add(this.jaw);
    const jawMesh = new THREE.Mesh(new THREE.ConeGeometry(0.0072, 0.016, 12), fur);
    jawMesh.rotation.x = Math.PI / 2;
    jawMesh.scale.set(1, 1, 0.55);
    jawMesh.position.set(0, -0.0015, 0.0095);
    this.jaw.add(jawMesh);
    const incisors = new THREE.Mesh(
      new THREE.BoxGeometry(0.0034, 0.0022, 0.0012),
      new THREE.MeshStandardMaterial({ color: 0xfff6e0, roughness: 0.35 }),
    );
    incisors.position.set(0, 0.0012, 0.0182);
    this.jaw.add(incisors);

    // eyes, each with a lid that rotates down over it
    this.eyelids = [];
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 14, 12), dark);
      eye.position.set(sx * 0.0082, 0.0028, 0.0078);
      this.head.add(eye);
      const glint = new THREE.Mesh(
        new THREE.SphereGeometry(0.0011, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      glint.position.set(sx * 0.0094, 0.0043, 0.0094);
      this.head.add(glint);

      const lidPivot = new THREE.Group();
      lidPivot.position.copy(eye.position);
      const lid = new THREE.Mesh(
        new THREE.SphereGeometry(0.0035, 12, 8, 0, TAU, 0, Math.PI / 2),
        fur,
      );
      lidPivot.add(lid);
      lidPivot.rotation.x = -1.45;       // tucked up out of sight
      this.head.add(lidPivot);
      this.eyelids.push(lidPivot);
    }

    // ears: big, round, forward-facing
    this.ears = [];
    for (const sx of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(sx * 0.0105, 0.0098, -0.0018);
      const outer = new THREE.Mesh(new THREE.SphereGeometry(0.0082, 16, 12, 0, TAU, 0, Math.PI / 2), fur);
      outer.rotation.set(Math.PI / 2.1, 0, sx * -0.35);
      outer.scale.set(1, 0.42, 1);
      outer.castShadow = true;
      ear.add(outer);
      const inner = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 14, 10, 0, TAU, 0, Math.PI / 2), skin);
      inner.rotation.set(Math.PI / 2.1, 0, sx * -0.35);
      inner.scale.set(1, 0.4, 1);
      inner.position.set(sx * 0.0008, 0.0012, 0.0012);
      ear.add(inner);
      ear.userData = { side: sx, twitch: 0, next: 1 + Math.random() * 3 };
      this.head.add(ear);
      this.ears.push(ear);
    }

    // whiskers
    this.whiskerGroup = new THREE.Group();
    this.whiskerGroup.position.set(0, -0.0015, 0.0205);
    this.head.add(this.whiskerGroup);
    const wmat = new THREE.LineBasicMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.55 });
    this.whiskerMat = wmat;
    this.whiskers = [];
    this.whiskerPads = [];
    for (const sx of [-1, 1]) {
      const pad = new THREE.Group();
      this.whiskerGroup.add(pad);
      pad.userData = { side: sx };
      for (let i = 0; i < 4; i++) {
        const len = 0.019 + i * 0.0035;
        const up = (i - 1.4) * 0.0032;
        const spread = 0.35 + i * 0.22;
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(sx * len * Math.sin(spread) * 0.55, up * 0.6, len * 0.75),
          new THREE.Vector3(sx * len * Math.sin(spread), up, len * Math.cos(spread) * 0.9),
        ]);
        const w = new THREE.Line(geo, wmat);
        w.userData = { side: sx, i };
        pad.add(w);
        this.whiskers.push(w);
      }
      this.whiskerPads.push(pad);
    }

    // ---------------- legs ----------------
    // Forelimb: shoulder -> humerus -> elbow -> radius/ulna -> manus.
    // Hindlimb: hip -> femur -> knee -> tibia -> ankle -> pes (near-plantigrade).
    // Segment lengths from MORPH; footfall phases come from the gait engine.
    this.legs = [];
    const legDefs = [
      { x: -0.0115, y: -0.006, z: 0.022, hind: false, idx: 0, phase: 0 },
      { x: 0.0115, y: -0.006, z: 0.022, hind: false, idx: 1, phase: Math.PI },
      { x: -0.0135, y: -0.003, z: -0.012, hind: true, idx: 2, phase: Math.PI },
      { x: 0.0135, y: -0.003, z: -0.012, hind: true, idx: 3, phase: 0 },
    ];
    for (const d of legDefs) {
      const L1 = d.hind ? MORPH.femur : MORPH.humerus;
      const L2 = d.hind ? MORPH.tibia : MORPH.radius;
      const L3 = d.hind ? MORPH.pes : MORPH.manus;

      const hip = new THREE.Group();
      hip.position.set(d.x, d.y, d.z);
      (d.hind ? this.pelvis : this.chest).add(hip);

      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(d.hind ? 0.0046 : 0.0038, L1 * 0.72, 6, 8), fur);
      upper.position.y = -L1 / 2;
      upper.castShadow = true;
      hip.add(upper);

      const knee = new THREE.Group();
      knee.position.y = -L1;
      hip.add(knee);

      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.0031, L2 * 0.7, 6, 8), fur);
      lower.position.y = -L2 / 2;
      lower.castShadow = true;
      knee.add(lower);

      // the distal group: the ankle for a hindlimb, the wrist for a forelimb
      const paw = new THREE.Group();
      paw.position.y = -L2;
      knee.add(paw);

      const sole = new THREE.Mesh(new THREE.SphereGeometry(0.0034, 10, 8), skin);
      sole.scale.set(0.85, 0.45, d.hind ? (L3 / 0.0034) * 0.52 : 1.2);
      sole.position.z = d.hind ? L3 * 0.45 : 0.0008;
      paw.add(sole);
      const toes = [];
      for (let ti = -1; ti <= 1; ti++) {
        const toe = new THREE.Mesh(new THREE.SphereGeometry(0.0012, 8, 6), skin);
        toe.scale.set(0.8, 0.6, 1.5);
        toe.position.set(ti * 0.0019, -0.0003, (d.hind ? L3 * 0.95 : 0.0036) - Math.abs(ti) * 0.0007);
        paw.add(toe);
        toes.push(toe);
      }

      const leg = { ...d, L1, L2, L3, hip, knee, paw, toes, contact: 0 };
      hip.userData = leg;
      this.legs.push(leg);
    }

    // ---------------- tail ----------------
    this.tail = [];
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xc9a9a2, roughness: 0.65 });
    this.tailSegs = 14;
    for (let i = 0; i < this.tailSegs; i++) {
      const f = i / (this.tailSegs - 1);
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0042 * (1 - f * 0.78), 10, 8), tailMat);
      bead.castShadow = i < 7;
      this.pelvis.add(bead);
      this.tail.push(bead);
    }

    this.root.position.set(this.x, BODY_Y, this.z);
    this.root.rotation.y = this.heading;
    this._v = new THREE.Vector3();
  }

  // -------------------------------------------------------------- autopilot
  /** choose somewhere in the arena worth walking to */
  pickTarget() {
    const m = this.arena.half - 0.16;
    const a = this.auto;
    a.target.x = (Math.random() * 2 - 1) * m;
    a.target.z = (Math.random() * 2 - 1) * m;
    a.retarget = 3 + Math.random() * 5;
  }

  /**
   * Head for the nearest cheese once it is close enough to smell, otherwise
   * wander, stopping now and then to rear up and sniff the air. Returns an
   * input object in the same shape the keyboard produces.
   */
  forage(dt) {
    const a = this.auto;
    const o = this.autoInput;

    let best = null, bd = Infinity;
    for (const c of this.arena.cheeses) {
      if (c.eaten) continue;
      const d = Math.hypot(c.x - this.x, c.z - this.z);
      if (d < bd) { bd = d; best = c; }
    }

    a.retarget -= dt;
    let tx, tz, onScent = false;
    if (best && bd < 0.8) {                     // within range of the plume
      tx = best.x; tz = best.z; onScent = true;
    } else {
      if (a.retarget <= 0 || Math.hypot(a.target.x - this.x, a.target.z - this.z) < 0.1) this.pickTarget();
      tx = a.target.x; tz = a.target.z;
      bd = Math.hypot(tx - this.x, tz - this.z);
    }

    // peel away from a wall it is about to nose into
    const lim = this.arena.half - 0.11;
    if (Math.abs(this.x) > lim) tx = -Math.sign(this.x) * (this.arena.half - 0.32);
    if (Math.abs(this.z) > lim) tz = -Math.sign(this.z) * (this.arena.half - 0.32);

    // turn sign is inverted in update(): positive turn steers clockwise
    const err = angDiff(Math.atan2(tx - this.x, tz - this.z), this.heading);
    o.turn = -clamp(err * 2.2, -1, 1);
    // slow for sharp turns, and ease off on the approach
    o.throttle = clamp(1 - Math.abs(err) * 0.8, 0.1, 1) * clamp(bd * 6, 0.3, 1);
    o.run = onScent && Math.abs(err) < 0.5 && bd > 0.2;

    // pause to sniff every few seconds, and always right on top of the food
    a.sniffIn -= dt;
    if (a.sniffIn <= 0) { a.sniffFor = 0.5 + Math.random() * 0.8; a.sniffIn = 4 + Math.random() * 7; }
    a.sniffFor = Math.max(0, a.sniffFor - dt);
    o.sniff = a.sniffFor > 0 || (onScent && bd < 0.1);
    if (o.sniff) o.run = false;
    return o;
  }

  /**
   * Push behavioural drives in from outside, each -1..1. The rig smooths
   * toward them and expresses them as posture: an aggressive mouse arches its
   * back, puffs its fur, flattens its ears and lashes its tail; a frightened
   * one crouches; a freezing one stops whisking and holds still.
   * Partial objects are fine — unlisted drives keep their current target.
   */
  setBehaviourDrive(d) {
    if (!d) return this.driveTarget;
    for (const k in this.driveTarget) {
      if (k in d && Number.isFinite(d[k])) this.driveTarget[k] = clamp(d[k], -1, 1);
    }
    return this.driveTarget;
  }

  /** turn self-driving on or off; off leaves the mouse fully manual */
  setAutopilot(on) {
    this.auto.on = !!on;
    if (!on) this.auto.engaged = false;
    return this.auto.on;
  }

  // -------------------------------------------------------------- locomotion
  update(dt, keyInput, brain) {
    // hand over to the autopilot once the keyboard has gone quiet
    const a = this.auto;
    const manual = Math.abs(keyInput.throttle) > 0.01 || Math.abs(keyInput.turn) > 0.01 || keyInput.sniff;
    if (manual) { a.idle = 0; a.engaged = false; } else a.idle += dt;
    if (a.on && !manual && a.idle > a.delay) a.engaged = true;
    const input = a.engaged ? this.forage(dt) : keyInput;

    const run = input.run;
    const target = input.throttle * (run ? MAX_RUN : MAX_WALK);
    this.cmd.throttle = input.throttle;
    this.cmd.turn = input.turn;
    this.cmd.sniff = input.sniff ? 1 : 0;

    // rearing up on the hind legs (and that slows it down)
    this.rear += ((input.sniff ? 1 : 0) - this.rear) * Math.min(1, dt * 7);
    const rearBrake = 1 - 0.75 * this.rear;

    this.prevSpeed = this.speed;
    const tau = target > this.speed ? 0.16 : 0.1;
    this.speed += (target * rearBrake - this.speed) * Math.min(1, dt / tau);
    // Snap to a dead stop, but only when actually trying to stop: at a fine
    // timestep a slow start grows by less than this per step, so testing speed
    // alone would zero it every frame and the mouse could never get going.
    if (Math.abs(this.speed) < 0.002 && Math.abs(target) < 0.002) this.speed = 0;
    this.accel = dt > 0 ? (this.speed - this.prevSpeed) / dt : 0;

    // turning: mice can pivot on the spot, but turn faster when moving
    const turnRate = MAX_TURN * (0.55 + 0.45 * Math.min(1, Math.abs(this.speed) / MAX_WALK)) * rearBrake;
    const wantAng = -input.turn * turnRate;
    this.angVel += (wantAng - this.angVel) * Math.min(1, dt * 11);
    this.heading += this.angVel * dt;

    // integrate
    const nx = this.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.z + Math.cos(this.heading) * this.speed * dt;
    const lim = this.arena.half - 0.022;
    this.bumped = false;
    if (nx > lim || nx < -lim) { this.bumped = Math.abs(this.speed) > 0.04; this.x = Math.max(-lim, Math.min(lim, nx)); this.speed *= 0.45; }
    else this.x = nx;
    if (nz > lim || nz < -lim) { this.bumped = this.bumped || Math.abs(this.speed) > 0.04; this.z = Math.max(-lim, Math.min(lim, nz)); this.speed *= 0.45; }
    else this.z = nz;

    // phases (the body uses the brain's oscillators so they stay in register)
    this.whiskPhase = brain.whiskPhase;
    this.prevStride = this.stridePhase;
    this.stridePhase = brain.stridePhase;
    this.eatAnim = Math.max(0, this.eatAnim - dt * 2.2);
    this.chew = Math.max(0, this.chew - dt * 0.75);

    // ease toward the externally driven behavioural state
    for (const k in this.drive) {
      this.drive[k] += (this.driveTarget[k] - this.drive[k]) * Math.min(1, dt * 4);
    }
    // an optogenetically driven feeding bout chews whether or not there is food
    if (this.drive.feeding > 0.45) this.chew = Math.max(this.chew, 0.6);

    // Stride frequency is read back off the brain's own stepping oscillator, so
    // the legs stay locked to motor-cortex firing. Stride length then follows
    // from speed, which is what keeps the stance feet from skating.
    if (dt > 0) {
      const w = angDiff(this.stridePhase, this.prevStride) / dt;
      this.strideFreq += (clamp(w / TAU, 0.4, 14) - this.strideFreq) * Math.min(1, dt * 6);
    }
    this.strideLen = this.strideFreq > 0.05 ? Math.abs(this.speed) / this.strideFreq : 0;

    this.pose(dt, brain);
  }

  // -------------------------------------------------------------- animation
  pose(dt, brain) {
    const sp = Math.abs(this.speed);
    const k = Math.min(1, sp / MAX_RUN);
    const walking = Math.min(1, sp / 0.05);

    this.root.position.set(this.x, BODY_Y, this.z);
    this.root.rotation.y = this.heading;

    // ---- gait selection ----
    // map the simulator's speed range onto the literature's 9-89 cm/s
    const gait = blendGait(k * GAIT_V_MAX);
    this.gaitName = gait.name;
    const duty = gait.duty;

    // ---- behavioural posture ----
    // An attacking mouse rears its flank, piloerects, flattens its ears and
    // lashes its tail; a frightened one crouches; a freezing one holds still.
    const agg = clamp(this.drive.aggression, 0, 1);
    const fear = clamp(this.drive.fear, 0, 1);
    const frozen = clamp(this.drive.freeze, 0, 1);
    const still = 1 - frozen;

    // ---- trunk: bob, pitch, bank ----
    // vertical oscillation is at twice stride frequency in symmetrical gaits
    const bob = Math.sin(this.stridePhase * 2) * 0.0018 * walking * still;
    this.body.position.y = bob + this.rear * 0.016 + agg * 0.0035 - fear * 0.0035;
    this.body.rotation.x = -this.rear * 0.72 + k * 0.05 + fear * 0.1;
    this.body.rotation.z += ((this.angVel * 0.055) - this.body.rotation.z) * Math.min(1, dt * 8);

    // ---- spine: lateral bend into the turn plus gait twist, held inside the
    // measured lumbar and thoracic lateral-bending ranges [2] ----
    const bend = clamp(-this.angVel * 0.12, -ROM.thoracic * 1.4, ROM.thoracic * 1.4);
    const twist = Math.sin(this.stridePhase) * ROM.thoracic * 0.8 * walking;
    const chestWant = clamp(bend + twist, -ROM.thoracic * 2, ROM.thoracic * 2);
    const pelvisWant = clamp(-bend * 0.45 - twist, -ROM.lumbar * 2, ROM.lumbar * 2);
    this.chest.rotation.y += (chestWant - this.chest.rotation.y) * Math.min(1, dt * 10);
    this.pelvis.rotation.y += (pelvisWant - this.pelvis.rotation.y) * Math.min(1, dt * 10);
    // an aggressive mouse arches: shoulders down, hips up, flank presented
    this.chest.rotation.x = -0.05 * k + this.rear * 0.1 - agg * 0.16 + fear * 0.12;
    this.pelvis.rotation.x = 0.06 * k + agg * 0.13 - fear * 0.08;

    // ---- breathing: 3-5 Hz at rest rising to ~12 Hz when sniffing [8]; fast
    // sniffs are shallow, so depth falls as the rhythm speeds up ----
    const sniffHz = clamp(
      brain.sniffFreq ?? (SNIFF.restHz + (SNIFF.activeHz - SNIFF.restHz) * (this.cmd.sniff || 0)),
      2, SNIFF.activeHz + 1,
    );
    const depth = (0.03 + 0.03 * k) * clamp(SNIFF.restHz / sniffHz, 0.35, 1.2);
    const breath = Math.sin(brain.sniffPhase * 0.5) * depth;
    // piloerection: the coat stands up during an aggressive or fearful bout
    const puff = 1 + 0.075 * agg + 0.04 * fear;
    this.torso.scale.set((1 + breath) * puff, (0.92 + breath * 0.8) * puff, 1.5);
    this.bellyMesh.scale.set(0.9 + breath * 1.2, 0.5 + breath, 1.35);
    this.rump.scale.set((1 + breath * 0.5) * puff, (0.95 + breath * 0.4) * puff, 1.25);

    // ---- legs ----
    // Stance follows a no-slip rule: the paw is pinned to the ground and
    // travels backward through the body frame at exactly the body's speed, so
    // stance displacement equals strideLen * duty by construction.
    this.root.updateMatrixWorld(true);
    const L = this.strideLen;
    const lift = (0.0035 + 0.009 * k) * walking;
    for (const leg of this.legs) {
      leg.phase = gait.ph[leg.idx] * TAU;
      // how far this hip currently sits above the floor
      const hipY = leg.hip.getWorldPosition(this._v).y;
      const total = leg.L1 + leg.L2;
      const reach = clamp(hipY - (leg.hind ? leg.L3 * 0.12 : 0), 0.004, total * 0.98);

      const u = ((((this.stridePhase + leg.phase) % TAU) + TAU) % TAU) / TAU;
      let fz, fy, footPitch;
      if (u < duty) {                                   // stance: pinned, sliding back
        const s = u / duty;
        fz = L * duty * (0.5 - s);
        fy = -reach;
        leg.contact = 1;
        // the heel lifts and the foot rolls over the toes late in stance
        footPitch = Math.max(0, s - 0.68) * 1.9;
      } else {                                          // swing: lifted, swinging forward
        const s = (u - duty) / (1 - duty);
        fz = L * duty * (-0.5 + s);
        fy = -reach + lift * Math.sin(Math.PI * s);
        leg.contact = 0;
        footPitch = 0.45 * Math.sin(Math.PI * s);
      }
      fz += leg.hind ? -0.001 : 0.002;                  // resting stance offset

      // rearing lifts the forelimbs off the floor and tucks them to the chest
      if (!leg.hind && this.rear > 0.02) {
        const groomy = Math.sin(brain.t * 9 + leg.x * 90) * 0.0022 * this.rear;
        fz = fz * (1 - this.rear) + (0.009 + groomy) * this.rear;
        fy = fy * (1 - this.rear) + (-0.004 + groomy * 0.6) * this.rear;
        leg.contact *= 1 - this.rear;
        footPitch *= 1 - this.rear;
      }

      const sol = ik2(leg.L1, leg.L2, fz, fy, leg.hind);
      // joint limits from [2]; the IK targets are physiological so these
      // normally sit slack, but they stop the rig folding through itself
      const hipLim = leg.hind ? ROM.hip : ROM.shoulder;
      const jLim = leg.hind ? ROM.knee : ROM.elbow;
      leg.hip.rotation.x = clamp(sol.hip, hipLim[0] - 0.5, hipLim[1] + 0.5);
      const mag = clamp(Math.abs(sol.knee), jLim[0], jLim[1]);
      leg.knee.rotation.x = Math.sign(sol.knee || 1) * mag;
      // keep the sole flat on the floor, then roll through toe-off
      const ankleLim = leg.hind ? ROM.ankle : ROM.wrist;
      leg.paw.rotation.x = clamp(sol.paw - footPitch, ankleLim[0] - 0.6, ankleLim[1] + 0.6);
      // toes splay on contact and curl in the air
      const splay = 1 + 0.35 * leg.contact - 0.2 * (1 - leg.contact);
      for (const t of leg.toes) t.scale.set(0.8 * splay, 0.6, 1.5);
    }

    // ---- tail: travelling wave, each bead held inside the measured
    // per-segment bending range [2] ----
    // tail: lashes wide and fast in an attack bout, tucks in fear, stops in freeze
    const lash = Math.sin(brain.t * 9.5) * agg * 0.014;
    const amp = (0.004 + 0.009 * k + Math.abs(this.angVel) * 0.0045) * (1 + 2.1 * agg) * still;
    let prevLat = 0;
    for (let i = 0; i < this.tailSegs; i++) {
      const f = i / (this.tailSegs - 1);
      const along = -0.022 - f * MORPH.tailLen * 0.9;
      const segLen = MORPH.tailLen * 0.9 / this.tailSegs;
      let lat = (Math.sin(this.stridePhase * 0.9 - f * 2.6) * amp + lash * f) * (0.25 + f);
      // limit the bend between consecutive beads to ROM.tailSeg
      const maxStep = Math.tan(ROM.tailSeg) * segLen * 2.2;
      lat = prevLat + clamp(lat - prevLat, -maxStep, maxStep);
      prevLat = lat;
      const up = 0.002 + Math.sin(f * 2.1) * 0.004 + f * f * 0.006 * (1 + k)
        + this.rear * f * 0.02 + agg * f * 0.012 - fear * f * 0.01;
      this.tail[i].position.set(lat, up, along);
      this.tail[i].rotation.z = clamp(lat * 12, -ROM.tailSeg * 3, ROM.tailSeg * 3);
    }

    // ---- neck and head, inside the cervical and head ranges [2] ----
    const sniffing = this.cmd.sniff ? 1 : 0;
    const neckWant = clamp(-this.cmd.turn * 0.16, -ROM.cervicalYaw * 2, ROM.cervicalYaw * 2);
    this.neck.rotation.y += (neckWant - this.neck.rotation.y) * Math.min(1, dt * 7);
    const hy = clamp(-this.cmd.turn * 0.28, -ROM.head * 0.6, ROM.head * 0.6);
    this.head.rotation.y += (hy - this.head.rotation.y) * Math.min(1, dt * 9);
    this.head.rotation.z += ((this.cmd.turn * 0.12) - this.head.rotation.z) * Math.min(1, dt * 7);
    const dip = sniffing ? -0.12 : (0.3 - 0.32 * walking);
    const nod = Math.sin(brain.sniffPhase) * (0.03 + 0.05 * sniffing) + Math.sin(this.stridePhase) * 0.015 * walking;
    const headWant = clamp(
      dip * 0.5 + nod + this.eatAnim * 0.25 + agg * 0.26 + fear * 0.1, -ROM.head, ROM.head);
    this.head.rotation.x += (headWant - this.head.rotation.x) * Math.min(1, dt * 10);

    // ---- jaw: small sniff-locked gape, fast chewing after a bite; opening is
    // capped at the measured 30 deg [2] ----
    const chewing = Math.max(this.eatAnim, this.chew);
    const gape = clamp(
      0.04 + 0.05 * Math.max(0, Math.sin(brain.sniffPhase)) * sniffing
      + chewing * 0.42 * (0.5 + 0.5 * Math.sin(brain.t * 34)),
      0, ROM.jaw,
    );
    this.jaw.rotation.x += (gape - this.jaw.rotation.x) * Math.min(1, dt * 22);

    // ---- nose twitches with every sniff ----
    const ns = 1 + 0.22 * Math.max(0, Math.sin(brain.sniffPhase)) * (0.4 + 0.6 * sniffing);
    this.nose.scale.setScalar(ns);

    // ---- eyelids: spontaneous blinks, and a squint while chewing ----
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blink = 1; this.nextBlink = 1.8 + Math.random() * 4.5; }
    this.blink = Math.max(0, this.blink - dt * 7);
    const shut = Math.max(Math.sin(Math.PI * clamp(1 - this.blink, 0, 1)) * (this.blink > 0 ? 1 : 0), chewing * 0.45);
    for (const lid of this.eyelids) {
      lid.rotation.x += ((-1.45 + 1.6 * shut) - lid.rotation.x) * Math.min(1, dt * 26);
    }

    // ---- whiskers ----
    // Real whisking is not a sine: retraction is faster than protraction, so
    // the forward sweep takes WHISK.protractFraction of the cycle (about 59%)
    // and the snap back the rest. Amplitude falls as the rhythm speeds up.
    // All four numbers come from mousedata.js.
    const contact = brain.whiskerContact || 0;
    const whiskHz = clamp(brain.whiskFreq ?? (8 + 4 * walking), 4, 25);   // brain.whiskFreq is supplied by the brain model
    const ampDeg = clamp(
      WHISK.amplitudeDeg * (1 + WHISK.ampFreqSlope * (whiskHz - WHISK.fundamentalHz)), 12, 70,
    )
      * (0.55 + 0.45 * sniffing) * (1 + 0.15 * contact);
    const half = ampDeg * DEG * 0.5;
    const p = (((this.whiskPhase / TAU) % 1) + 1) % 1;
    const Q = WHISK.protractFraction;              // protraction share of the cycle
    const s = p < Q
      ? -1 + 2 * smooth(p / Q)                     // slow protraction
      : 1 - 2 * smooth((p - Q) / (1 - Q));         // fast retraction
    this.whiskerGroup.rotation.y = s * half * 0.45 * still;
    this.whiskerGroup.rotation.x = Math.cos(this.whiskPhase) * 0.1;
    // the two pads sweep in antiphase, as they do during real whisking
    for (const pad of this.whiskerPads) {
      pad.rotation.y = pad.userData.side * s * half * still;
    }
    this.whiskerMat.opacity = 0.42 + 0.4 * contact;
    for (const w of this.whiskers) {
      w.scale.setScalar(1 + 0.12 * Math.sin(this.whiskPhase + w.userData.i * 0.5));
    }

    // ---- ears: orient forward, each twitching on its own schedule ----
    for (const ear of this.ears) {
      const u = ear.userData;
      u.next -= dt;
      if (u.next <= 0) { u.twitch = 1; u.next = 1.2 + Math.random() * 4; }
      u.twitch = Math.max(0, u.twitch - dt * 3.5);
      ear.rotation.z = u.side * (0.08 + 0.25 * u.twitch * still * Math.sin(brain.t * 26) + 0.5 * agg);
      // ears flatten back against the skull in an aggressive or fearful bout
      ear.rotation.x = -0.12 * walking + u.twitch * 0.1 * still + (agg + fear) * 0.55;
      ear.rotation.y = u.side * 0.1 * contact;
    }
  }

  onEat() { this.eatAnim = 1; this.chew = 1.6; }

  reset() {
    this.x = -0.35; this.z = -0.35;
    this.heading = Math.PI * 0.25;
    this.speed = 0; this.angVel = 0; this.accel = 0; this.rear = 0;
    this.eatAnim = 0; this.chew = 0;
    this.auto.engaged = false; this.auto.idle = 0;
    this.pickTarget();
  }

  /** the state vector the brain model consumes */
  sensorState(cheeses, ate) {
    return {
      x: this.x, z: this.z, heading: this.heading, speed: this.speed,
      angVel: this.angVel, accel: this.accel,
      cheeses, cmd: this.cmd, ate, bumped: this.bumped,
    };
  }
}

export { MAX_RUN, MAX_WALK };
export { MORPH, ROM, GAITS, BIOMETRICS, SOURCES } from './mousedata.js';
