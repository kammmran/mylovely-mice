/**
 * The litter: altricial newborn mice, the nest, and the ultrasonic calls that
 * bring a mother back for a stray.
 *
 * Newborn mice are helpless — naked, deaf, eyes sealed, unable to walk. They
 * grow fur in the first week, open their eyes around day 13 and wean at three
 * weeks. Out of the nest they cool quickly and call at 40-90 kHz, which is what
 * triggers retrieval. One simulated day is five seconds (see brain.js DAY).
 *
 * Sources: Ehret 2005 (pup calls); Hofer & Shair 1978 (isolation calling);
 * JAX C57BL/6J developmental milestones.
 */
import * as THREE from 'three';
import { DAY, EYES_OPEN, WEANING } from '../neuro/brain.js';

const PUP_R = 0.009;          // newborn ~1.8 cm long
const NEST_R = 0.085;
const CALL_RANGE = 0.75;      // how far a cry carries, in metres
const STRAY_DIST = 0.1;       // further than this from the nest counts as astray

const PINK = new THREE.Color(0xe8aeab);
const FURRY = new THREE.Color(0xb6ada1);
const COLD = new THREE.Color(0x9fb3c4);        // the pallor of a chilled pup

/**
 * Hypothermia.
 *
 * Newborn mice cannot thermoregulate at all. Isolated C3H pups could not hold a
 * normal body temperature until about 18 days, and before then neither body size
 * nor fur growth did much to slow heat loss. Out of the nest a pup simply cools.
 *
 * The survival *time* is a deliberate compression, like the 75 s oestrous cycle:
 * the literature pins down body temperature at 10 and 20 minutes after the dam is
 * removed, and lethal temperature thresholds, rather than times to death.
 */
const CHILL_SECONDS_DAY0 = 60;     // out in the cold, newborn
const CHILL_SECONDS_DAY13 = 150;   // older pups last longer
const THERMO_DAY = 18;             // after this they regulate for themselves
const REWARM = 2.5;                // warming up is faster than cooling down
const HEAT_SOURCE_R = 0.04;        // a brooding adult is a radiator
const HUDDLE_R = 0.025;            // pups touching each other halve the loss
const CARCASS_SECONDS = 90;        // if nobody comes for it

export class Litter {
  constructor(scene, arena) {
    this.scene = scene;
    this.arena = arena;
    this.pups = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.nest = null;
    this.born = 0;
    this.weaned = 0;
    this.lost = 0;
    this.eaten = 0;
    this.seq = 0;
  }

  /** mice nest tucked against a wall, not out in the open */
  makeNest(near) {
    const h = this.arena.half - 0.1;
    let best = { x: -h, z: -h }, bd = -1;
    for (let i = 0; i < 24; i++) {
      const edge = Math.random() < 0.5;
      const p = edge
        ? { x: (Math.random() * 2 - 1) * h, z: (Math.random() < 0.5 ? -1 : 1) * h }
        : { x: (Math.random() < 0.5 ? -1 : 1) * h, z: (Math.random() * 2 - 1) * h };
      const d = near ? Math.hypot(p.x - near.x, p.z - near.z) : 1;
      const clear = Math.min(...this.arena.cheeses.map((c) => Math.hypot(c.x - p.x, c.z - p.z)), 9);
      const score = clear - d * 0.35;
      if (score > bd) { bd = score; best = p; }
    }
    this.nest = best;

    const g = new THREE.Group();
    g.position.set(best.x, 0, best.z);
    // a shallow ring of bedding
    const bed = new THREE.Mesh(
      new THREE.TorusGeometry(NEST_R, 0.016, 8, 22),
      new THREE.MeshStandardMaterial({ color: 0x6b5f4e, roughness: 0.95 }),
    );
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = 0.008;
    bed.castShadow = true;
    bed.receiveShadow = true;
    g.add(bed);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(NEST_R, 22),
      new THREE.MeshStandardMaterial({ color: 0x4a4134, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.002;
    g.add(floor);
    this.nestMesh = g;
    this.group.add(g);
    return best;
  }

  // ------------------------------------------------------------------ birth
  birth(n, mother, owner) {
    if (!this.nest) this.makeNest({ x: mother.x, z: mother.z });
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const r = Math.random() * NEST_R * 0.55;
      const pup = this.addPup(this.nest.x + Math.cos(a) * r, this.nest.z + Math.sin(a) * r);
      // sex is settled at conception; it decides what it grows into
      pup.sex = Math.random() < 0.5 ? 'M' : 'F';
      pup.owner = owner || null;
      out.push(pup);
    }
    this.born += n;
    return out;
  }

  addPup(x, z) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: PINK.clone(), roughness: 0.72 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(PUP_R, 12, 9), mat);
    body.scale.set(1, 0.82, 1.7);
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(PUP_R * 0.66, 10, 8), mat);
    head.position.set(0, PUP_R * 0.18, PUP_R * 1.5);
    g.add(head);
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(PUP_R * 0.16, PUP_R * 1.5, 3, 5), mat);
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, -PUP_R * 0.2, -PUP_R * 1.9);
    g.add(tail);

    // the calling halo, shown only while it is astray
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.016, 0.021, 20),
      new THREE.MeshBasicMaterial({ color: 0xd55181, transparent: true, opacity: 0, side: THREE.DoubleSide, toneMapped: false }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.004;
    g.add(halo);

    g.position.set(x, PUP_R * 0.8, z);
    this.group.add(g);

    const pup = {
      id: ++this.seq, mesh: g, mat, halo, body, head,
      x, z, age: 0, heading: Math.random() * Math.PI * 2,
      carried: null, calling: 0, wrig: Math.random() * 6.28, eyes: null,
      chill: 0, dead: false, deadT: 0,
    };
    this.pups.push(pup);
    return pup;
  }

  // ------------------------------------------------------------------ frame
  update(dt, t, carriers) {
    for (let i = this.pups.length - 1; i >= 0; i--) {
      const p = this.pups[i];
      p.age += dt;
      const days = p.age / DAY;

      if (p.dead) {
        p.mesh.position.set(p.x, PUP_R * 0.55 * p.mesh.scale.x, p.z);
        p.mesh.rotation.set(0, p.heading, Math.PI / 2.2);
      } else if (p.carried) {
        // riding in a parent's mouth
        const m = p.carried;
        p.x = m.x + Math.sin(m.heading) * 0.03;
        p.z = m.z + Math.cos(m.heading) * 0.03;
        p.mesh.position.set(p.x, 0.026, p.z);
      } else if (!p.dead) {
        // helpless wriggling: they cannot really walk until about two weeks
        const mobility = Math.min(1, Math.max(0, (days - 9) / 8));
        const crawl = (0.004 + 0.05 * mobility) * dt;
        p.wrig += dt * (2.5 + 2 * p.calling);
        p.heading += Math.sin(p.wrig * 0.7) * dt * 1.6;
        const lim = this.arena.half - 0.03;
        p.x = Math.max(-lim, Math.min(lim, p.x + Math.sin(p.heading) * crawl));
        p.z = Math.max(-lim, Math.min(lim, p.z + Math.cos(p.heading) * crawl));
        p.mesh.position.set(p.x, PUP_R * 0.8, p.z);
        p.mesh.rotation.y = p.heading;
        p.mesh.rotation.z = Math.sin(p.wrig * 2.2) * 0.22 * (1 - mobility * 0.6);
      }

      // growth: naked and pink, then furred, then eyes open
      const grow = 1 + Math.min(1, days / WEANING * DAY / DAY) * 0;
      const scale = 1 + Math.min(1.1, days / 21 * 1.1);
      p.mesh.scale.setScalar(scale);
      const fur = Math.min(1, Math.max(0, (days - 3) / 6));
      p.mat.color.copy(PINK).lerp(FURRY, fur).lerp(COLD, p.dead ? 0.85 : p.chill * 0.8);
      if (!p.eyes && p.age >= EYES_OPEN) this.openEyes(p);

      const fromNest = this.nest ? Math.hypot(p.x - this.nest.x, p.z - this.nest.z) : 0;
      const astray = !p.carried && fromNest > STRAY_DIST;

      // ---- heat balance ----
      if (!p.dead) {
        const warm = !astray || p.carried || this.nearAdult(p, carriers);
        const span = CHILL_SECONDS_DAY0
          + (CHILL_SECONDS_DAY13 - CHILL_SECONDS_DAY0) * Math.min(1, days / 13);
        const rate = days >= THERMO_DAY ? 0 : 1 / span;
        if (warm) {
          p.chill = Math.max(0, p.chill - rate * REWARM * dt);
        } else {
          // huddling with a sibling is thermoregulation in its own right
          const huddle = this.touchingSibling(p) ? 0.5 : 1;
          p.chill = Math.min(1, p.chill + rate * huddle * dt);
        }
        if (p.chill >= 1) this.die(p, 'cold');
      }

      // ---- isolation calls ----
      // Calling rises as the pup cools, peaks around chill 0.5-0.6, then fades as
      // it goes torpid. A silent pup is in worse trouble than a screaming one.
      let want = 0;
      if (astray && !p.dead) {
        const c = p.chill;
        const shape = Math.exp(-((c - 0.55) ** 2) / (2 * 0.3 * 0.3));
        const torpor = 1 - Math.min(1, Math.max(0, (c - 0.75) / 0.25));
        const canSelfRegulate = Math.min(1, Math.max(0, (days - 12) / 6));
        want = shape * torpor * (1 - canSelfRegulate * 0.85);
      }
      p.calling += (want - p.calling) * Math.min(1, dt * 1.6);
      const pulse = 0.5 + 0.5 * Math.sin(t * 11 + p.id);
      p.halo.material.opacity = p.calling * 0.75 * pulse;
      p.halo.scale.setScalar(1 + p.calling * pulse * 0.7);

      // a carcass nobody collects eventually goes
      if (p.dead) {
        p.deadT += dt;
        if (p.deadT > CARCASS_SECONDS) { this.remove(p, i); continue; }
      }

      // weaned: they leave the nest for good
      if (!p.dead && p.age > WEANING) {
        this.remove(p, i);
        this.weaned++;
        if (this.onWean) this.onWean(p);
      }
    }
  }

  /** detach a pup from the scene and the list */
  remove(p, i) {
    this.group.remove(p.mesh);
    p.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    const at = i !== undefined && this.pups[i] === p ? i : this.pups.indexOf(p);
    if (at >= 0) this.pups.splice(at, 1);
  }

  /** is a live adult close enough to be a heat source? */
  nearAdult(p, carriers) {
    if (!carriers) return false;
    for (const a of carriers) {
      const m = a.mouse || a;
      if (!m || (a.brain && a.brain.alive === false)) continue;
      if (Math.hypot(m.x - p.x, m.z - p.z) < HEAT_SOURCE_R) return true;
    }
    return false;
  }

  /** pups in contact lose heat more slowly than a pup on its own */
  touchingSibling(p) {
    for (const q of this.pups) {
      if (q === p || q.dead || q.carried) continue;
      if (Math.hypot(q.x - p.x, q.z - p.z) < HUDDLE_R) return true;
    }
    return false;
  }

  /** @param cause 'cold' | 'killed' */
  die(p, cause) {
    if (p.dead) return;
    p.dead = true;
    p.deadT = 0;
    p.calling = 0;
    p.carried = null;
    p.halo.material.opacity = 0;
    this.lost++;
    if (this.onPupLost) this.onPupLost(p, cause);
  }

  /** male infanticide: the decision is the caller's, the mechanics are here */
  killPup(p) { this.die(p, 'killed'); }

  /**
   * An adult eats a carcass. Filmed dams losing whole litters were not seen to
   * kill pups: what looks like maternal infanticide is mostly a female consuming
   * a pup that had already died of cold or starvation.
   */
  consume(p, byAgent) {
    if (!p || !p.dead) return false;
    this.remove(p);
    this.eaten++;
    if (this.onPupEaten) this.onPupEaten(p, byAgent);
    return true;
  }

  /** the nearest carcass to a point, for an adult to collect */
  nearestCarcass(x, z) {
    let best = null, bd = 1e9;
    for (const p of this.pups) {
      if (!p.dead) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { pup: best, dist: bd } : null;
  }

  openEyes(p) {
    const em = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.3 });
    p.eyes = [];
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(PUP_R * 0.17, 8, 6), em);
      e.position.set(sx * PUP_R * 0.33, PUP_R * 0.3, PUP_R * 1.85);
      p.mesh.add(e);
      p.eyes.push(e);
    }
    if (this.onEyesOpen) this.onEyesOpen(p);
  }

  // ------------------------------------------------------------- queries
  /** loudness of pup calls heard at (x,z), 0..1 */
  callLevel(x, z) {
    let v = 0;
    for (const p of this.pups) {
      if (p.calling < 0.05 || p.carried || p.dead) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      v = Math.max(v, p.calling * Math.max(0, 1 - d / CALL_RANGE));
    }
    return Math.min(1, v);
  }

  /** how close this animal is to its litter, 0..1 */
  nearLevel(x, z) {
    let v = 0;
    for (const p of this.pups) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      v = Math.max(v, Math.max(0, 1 - d / 0.2));
    }
    return v;
  }

  /** the stray most in need of fetching, if any */
  nearestStray(x, z) {
    let best = null, bd = 1e9;
    for (const p of this.pups) {
      if (p.carried || p.dead || !this.nest) continue;
      if (Math.hypot(p.x - this.nest.x, p.z - this.nest.z) <= STRAY_DIST) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { pup: best, dist: bd } : null;
  }

  inNest(p) {
    return this.nest && Math.hypot(p.x - this.nest.x, p.z - this.nest.z) <= STRAY_DIST;
  }

  pickUp(pup, carrier) { pup.carried = carrier; }
  putDown(pup) {
    pup.carried = null;
    pup.mesh.position.y = PUP_R * 0.8;
  }

  /** move a pup by hand — the classic pup-retrieval test */
  displace(pup, x, z) {
    pup.carried = null;
    pup.x = x; pup.z = z;
    pup.mesh.position.set(x, PUP_R * 0.8, z);
  }

  /** topmost pup under a pointer ray, for click-to-pick */
  pickAt(raycaster) {
    const hits = raycaster.intersectObjects(this.pups.map((p) => p.mesh), true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !this.pups.some((p) => p.mesh === o)) o = o.parent;
    return this.pups.find((p) => p.mesh === o) || null;
  }

  /** live pups; a carcass is no longer something to care for */
  get count() { return this.pups.reduce((n, p) => n + (p.dead ? 0 : 1), 0); }
  get carcasses() { return this.pups.filter((p) => p.dead); }
  get strays() {
    return this.pups.filter((p) => !p.dead && !p.carried && !this.inNest(p)).length;
  }
  /** worst chill among the live pups, for a readout */
  get coldest() { return this.pups.reduce((m, p) => (p.dead ? m : Math.max(m, p.chill)), 0); }
  /** age of the litter in simulated days */
  get days() { return this.pups.length ? this.pups[0].age / DAY : 0; }

  reset() {
    for (const p of this.pups) {
      this.group.remove(p.mesh);
      p.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.pups.length = 0;
    if (this.nestMesh) { this.group.remove(this.nestMesh); this.nestMesh = null; }
    this.nest = null;
    this.born = 0; this.weaned = 0; this.lost = 0; this.eaten = 0;
  }
}

export { NEST_R, STRAY_DIST };
