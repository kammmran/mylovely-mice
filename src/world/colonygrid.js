/**
 * Nine cages in a 3x3 grid, each under different conditions, with tunnels that
 * can be opened between neighbours.
 *
 * This is Calhoun's experiment. In 1962 he connected pens with ramps and found
 * that because the end pens had one connection and the middle pens two, the
 * animals stopped distributing themselves evenly and piled into the middle —
 * the "behavioural sink" — with the crowding pathology following from that
 * aggregation rather than from any shortage of food or water. A 3x3 grid
 * reproduces the geometry for nothing: the corners have two neighbours, the
 * edges three, and the centre four. Open the tunnels and watch where they end
 * up.
 *   Calhoun 1962, "Population Density and Social Pathology"
 *
 * The second thing to watch is in the brain rather than the cage. A place cell
 * has a separate map for every environment, so an animal that crosses a tunnel
 * remaps: the hippocampal map it was using is put away and another one comes
 * out, and the first comes back if it returns. The rate map in the panel
 * starts rebuilding from scratch at the moment of the crossing.
 *   Muller & Kubie 1987; Leutgeb et al. 2005
 *
 * Coordinates: everything inside a cage is arena-local, exactly as it is with
 * one cage. Each cage is a THREE.Group translated in x and z, so the offset is
 * applied by the parent transform and nothing inside has to know about it.
 * The transform is translation only — the articulated rig measures hip height
 * against world y = 0, so a y offset or a scale would quietly break its legs.
 */
import * as THREE from 'three';
import { Arena } from './arena.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** cage pitch: 1.2 m of floor plus the gap the tunnels run through */
export const PITCH = 1.62;
const TUNNEL_R = 0.055;
const MOUTH = 0.1;             // how close to the opening counts as in it

/**
 * The nine conditions. The centre is the control, deliberately: that way any
 * aggregation there is about how many tunnels it has, not about what is in it.
 */
export const CONDITIONS = {
  control: {
    name: 'control', short: 'standard cage',
    note: 'Food, water, dim light. Everything else is measured against this one, and it sits in the centre so that crowding here means connectivity rather than resources.',
    light: 0.35, cheeses: 3, dish: true, mice: ['M', 'F'],
  },
  dry: {
    name: 'no water', short: 'dish removed',
    note: 'No water dish at all. Thirst builds, and with the tunnels shut it ends in dehydration; with them open the animals leave. Water is the drive that moves a mouse first — it survives days without it, against weeks without food.',
    light: 0.35, cheeses: 3, dish: false, mice: ['M', 'F'],
  },
  hungry: {
    name: 'scarce food', short: 'one piece',
    note: 'One piece of cheese instead of three. Hunger rises, AgRP firing with it, and foraging takes over the behaviour long before the animal is in any danger.',
    light: 0.35, cheeses: 1, dish: true, mice: ['M', 'F'],
  },
  bright: {
    name: 'bright light', short: 'lights up',
    note: 'Mice are nocturnal, and open brightly lit space is what they are built to avoid. They hug the walls, the stress axis runs higher, and they do less of everything else.',
    light: 1, cheeses: 3, dish: true, mice: ['M', 'F'],
  },
  predator: {
    name: 'fox odour', short: 'TMT in the corner',
    note: 'Trimethylthiazoline on filter paper in the far corner — the standard predator odour. They avoid that corner from the first exposure and do not habituate to it.',
    light: 0.35, cheeses: 3, dish: true, mice: ['M', 'F'], threat: 'tmt',
  },
  noisy: {
    name: 'intermittent noise', short: 'startling sounds',
    note: 'A loud noise burst every twenty seconds or so. The startle habituates within a few presentations and comes back after a quiet minute, so this cage shows habituation rather than fear.',
    light: 0.35, cheeses: 3, dish: true, mice: ['M', 'F'], noise: 20,
  },
  males: {
    name: 'all male', short: 'four males, no female',
    note: 'Four unrelated adult males and nowhere to get away from each other. Fighting, a dominance order, and wounds on the rump and the base of the tail.',
    light: 0.35, cheeses: 3, dish: true, mice: ['M', 'M', 'M', 'M'],
  },
  crowded: {
    name: 'crowded', short: 'eight in one cage',
    note: 'Eight animals in a cage sized for a pair. Crowding escalates male aggression, and it is the condition Calhoun was actually studying.',
    light: 0.35, cheeses: 4, dish: true, mice: ['M', 'F', 'M', 'F', 'M', 'F', 'M', 'F'],
  },
  rich: {
    name: 'well provisioned', short: 'food, water, dim',
    note: 'Plenty of food, water, and the lights down. If the tunnels change anything, this is the cage the others should be heading for.',
    light: 0.18, cheeses: 5, dish: true, mice: ['M', 'F'],
  },
};

/** where each condition sits. Centre is the control — that is the whole point. */
export const LAYOUT = [
  ['dry', 'bright', 'hungry'],
  ['males', 'control', 'rich'],
  ['crowded', 'predator', 'noisy'],
];

const CSS = `
#boxes{left:286px;top:92px;width:290px;display:flex;flex-direction:column}
#boxes .body{padding:0 10px 9px}
#bx-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}
.bx{background:#101a26;border:1px solid var(--line,#15202c);border-radius:5px;padding:4px 5px;
  cursor:pointer;transition:.12s;min-width:0}
.bx:hover{background:#1b2735;border-color:#3a4a5e}
.bx.here{border-color:var(--accent,#4dd4c0);background:#10241f}
.bx .bn{font-size:9px;color:var(--ink2,#9fb2c8);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;letter-spacing:.02em}
.bx .bp{font-family:var(--mono,monospace);font-size:13px;color:var(--ink,#e8eef6);line-height:1.2}
.bx .bs{font-size:8px;color:var(--ink3,#64788f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bx.empty .bp{color:var(--ink3,#64788f)}
#bx-act{display:grid;grid-template-columns:1fr auto;gap:5px;margin-top:8px}
#bx-act button{background:#101a26;border:1px solid var(--line2,#2a3a4f);border-radius:5px;
  padding:5px 7px;color:var(--ink2,#9fb2c8);font:inherit;font-size:10.5px;cursor:pointer}
#bx-act button:hover{background:#1b2735;color:var(--ink,#e8eef6)}
#bx-act button.on{border-color:var(--accent,#4dd4c0);color:var(--accent,#4dd4c0)}
#bx-note{font-size:9.5px;color:var(--ink3,#64788f);line-height:1.5;margin-top:7px;
  border-top:1px solid var(--line,#15202c);padding-top:7px}
#bx-note b{color:var(--ink2,#9fb2c8);font-weight:600}
#bx-sink{font-family:var(--mono,monospace);font-size:9.5px;color:var(--ink3,#64788f);margin-top:5px}
#bx-sink b{color:#d55181}
`;

/** one cage */
class Box {
  constructor(scene, { id, row, col, key, origin, lights }) {
    const c = CONDITIONS[key];
    this.id = id;
    this.row = row;
    this.col = col;
    this.key = key;
    this.cond = c;
    this.origin = origin;
    this.arena = new Arena(scene, {
      lights, lamp: !lights, origin,
      cheeses: c.cheeses, dish: c.dish, label: c.name,
    });
    this.arena.setLight(c.light);
    this.group = this.arena.group;      // everything in this cage hangs here
    this.agents = [];
    this.litter = null;                 // main.js gives it one when it needs it
    this.threats = null;
    this.noiseT = 2 + Math.random() * 10;
    this.deaths = 0;
    this.arrived = 0;
    this.left = 0;
  }

  get population() { return this.agents.filter((a) => !a.dead).length; }

  /** local -> world */
  toWorld(x, z) { return { x: x + this.origin.x, z: z + this.origin.z }; }
  /** world -> local */
  toLocal(x, z) { return { x: x - this.origin.x, z: z - this.origin.z }; }
  contains(wx, wz) {
    const h = this.arena.half + (PITCH - this.arena.size) / 2;
    return Math.abs(wx - this.origin.x) <= h && Math.abs(wz - this.origin.z) <= h;
  }
}

export class ColonyGrid {
  /**
   * @param scene          where the cages go
   * @param onEvent        (group, html) for the event feed
   */
  constructor(scene, { onEvent = () => {} } = {}) {
    this.scene = scene;
    this.onEvent = onEvent;
    this.open = false;
    this.boxes = [];
    this.tunnels = [];
    this.crossings = 0;

    let id = 0;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const key = LAYOUT[row][col];
        const origin = { x: (col - 1) * PITCH, z: (row - 1) * PITCH };
        // the centre cage owns the scene-wide light rig; the rest are lit by
        // it plus a lamp of their own, so their light level still reads
        const lights = row === 1 && col === 1;
        this.boxes.push(new Box(scene, { id: id++, row, col, key, origin, lights }));
      }
    }
    this.centre = this.boxes[4];

    // ---- tunnels between neighbours: 12 of them in a 3x3 ----
    this.group = new THREE.Group();
    scene.add(this.group);
    for (const a of this.boxes) {
      for (const b of this.boxes) {
        if (b.id <= a.id) continue;
        const dr = b.row - a.row, dc = b.col - a.col;
        if (Math.abs(dr) + Math.abs(dc) !== 1) continue;
        this.tunnels.push(this.makeTunnel(a, b, dc ? 'x' : 'z'));
      }
    }
    for (const box of this.boxes) {
      box.links = this.tunnels.filter((t) => t.a === box || t.b === box);
    }
    this.setOpen(false);
  }

  /**
   * A tube between two cages, with a mouth in each. `axis` is which wall it
   * crosses; the mouth sits at the middle of that wall.
   */
  makeTunnel(a, b, axis) {
    const mid = {
      x: (a.origin.x + b.origin.x) / 2,
      z: (a.origin.z + b.origin.z) / 2,
    };
    const len = PITCH - a.arena.size + 0.02;
    const geo = new THREE.CylinderGeometry(TUNNEL_R, TUNNEL_R, len, 14, 1, true);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0x6f7f93, roughness: 0.55, metalness: 0.15,
      transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    }));
    mesh.rotation.z = Math.PI / 2;
    if (axis === 'z') mesh.rotation.y = Math.PI / 2;
    mesh.position.set(mid.x, TUNNEL_R * 0.85, mid.z);
    this.group.add(mesh);

    const half = a.arena.half;
    // where an animal stands in each cage to be at the opening, in that
    // cage's own coordinates
    const mouthA = axis === 'x'
      ? { x: (b.origin.x > a.origin.x ? half : -half), z: 0 }
      : { x: 0, z: (b.origin.z > a.origin.z ? half : -half) };
    const mouthB = axis === 'x'
      ? { x: -mouthA.x, z: 0 }
      : { x: 0, z: -mouthA.z };
    return { a, b, axis, mesh, mouthA, mouthB, uses: 0 };
  }

  /** the mouth of this tunnel in the given cage, and the cage on the far side */
  side(tunnel, box) {
    return box === tunnel.a
      ? { mouth: tunnel.mouthA, far: tunnel.b, farMouth: tunnel.mouthB }
      : { mouth: tunnel.mouthB, far: tunnel.a, farMouth: tunnel.mouthA };
  }

  setOpen(v) {
    this.open = !!v;
    for (const t of this.tunnels) {
      t.mesh.material.opacity = this.open ? 0.5 : 0.14;
      t.mesh.material.color.setHex(this.open ? 0x7fd4c4 : 0x5a6675);
    }
    this.render();
  }

  /**
   * Has this animal reached an opening? Returns the crossing to make, or null.
   * Only when the tunnels are open, and only from inside the cage it is in.
   */
  crossingFor(ag) {
    if (!this.open || ag.dead) return null;
    const box = ag.box;
    if (!box) return null;
    const m = ag.mouse;
    for (const t of box.links) {
      const { mouth, far, farMouth } = this.side(t, box);
      if (Math.hypot(m.x - mouth.x, m.z - mouth.z) > MOUTH) continue;
      // it comes out of the far mouth, a little way inside the next cage
      const inward = 0.06;
      const to = {
        x: farMouth.x === 0 ? 0 : farMouth.x - Math.sign(farMouth.x) * inward,
        z: farMouth.z === 0 ? 0 : farMouth.z - Math.sign(farMouth.z) * inward,
      };
      return { tunnel: t, from: box, to: far, at: to };
    }
    return null;
  }

  /** the nearest open tunnel mouth in this cage, in cage coordinates */
  nearestMouth(box, x, z, preferTowards = null) {
    if (!this.open || !box) return null;
    let best = null, bd = Infinity;
    for (const t of box.links) {
      const { mouth, far } = this.side(t, box);
      let d = Math.hypot(x - mouth.x, z - mouth.z);
      // a mouse that wants water heads for a cage that has some
      if (preferTowards && !preferTowards(far)) d += 2.5;
      if (d < bd) { bd = d; best = { mouth, far, tunnel: t, dist: d }; }
    }
    return best;
  }

  /** which cage a world point is in */
  boxAt(wx, wz) {
    for (const b of this.boxes) if (b.contains(wx, wz)) return b;
    return null;
  }

  /** the measure Calhoun's result is stated in: share of the colony in one cage */
  sinkIndex() {
    const total = this.boxes.reduce((s, b) => s + b.population, 0);
    if (!total) return { total: 0, share: 0, box: this.centre };
    let top = this.boxes[0];
    for (const b of this.boxes) if (b.population > top.population) top = b;
    return { total, share: top.population / total, box: top, even: 1 / 9 };
  }

  // ------------------------------------------------------------- panel
  mount(parent, { onPick } = {}) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const card = document.createElement('div');
    card.className = 'float';
    card.id = 'boxes';
    card.dataset.panel = 'boxes';
    card.innerHTML = `
      <h5 data-fold><span>nine cages</span><span id="bx-sub"></span><span class="tw">▾</span></h5>
      <div class="body">
        <div id="bx-grid"></div>
        <div id="bx-act">
          <button id="bx-open">open the tunnels</button>
          <button id="bx-view" title="look at all nine from above">view all</button>
        </div>
        <div id="bx-sink"></div>
        <div id="bx-note"></div>
      </div>`;
    (parent || document.body).appendChild(card);
    card.style.display = 'flex';
    this.card = card;

    const grid = card.querySelector('#bx-grid');
    this.cells = this.boxes.map((box) => {
      const el = document.createElement('div');
      el.className = 'bx';
      el.innerHTML = `<div class="bn">${box.cond.name}</div><div class="bp">0</div>`
        + `<div class="bs">${box.cond.short}</div>`;
      el.title = `${box.cond.name} — ${box.cond.note}`;
      el.onclick = () => { this.describe(box); if (onPick) onPick(box); };
      grid.appendChild(el);
      return { box, el, pop: el.querySelector('.bp') };
    });

    card.querySelector('#bx-open').onclick = () => {
      this.setOpen(!this.open);
      this.onEvent('state', this.open
        ? 'the <b>tunnels are open</b> — nine cages became one connected colony'
        : 'the <b>tunnels are shut</b> — every cage is on its own again');
    };
    this.viewBtn = card.querySelector('#bx-view');
    this.here = this.here || this.centre;
    this.describe(this.centre);
    this.render();
    return this;
  }

  describe(box) {
    this.picked = box;
    const note = this.card && this.card.querySelector('#bx-note');
    if (!note) return;
    const links = box.links.length;
    note.innerHTML = `<b>${box.cond.name}</b> — ${box.cond.note}`
      + ` <b>${links}</b> tunnel${links === 1 ? '' : 's'}`
      + (box === this.centre ? ' — the most connected cage in the grid.' : '.');
  }

  openPanel(v) { if (this.card) this.card.style.display = v ? 'flex' : 'none'; }
  isOpen() { return !!this.card && this.card.style.display !== 'none'; }

  render() {
    if (!this.card) return;
    for (const c of this.cells) {
      const n = c.box.population;
      c.pop.textContent = n;
      c.el.classList.toggle('empty', n === 0);
      c.el.classList.toggle('here', c.box === this.here);
    }
    const btn = this.card.querySelector('#bx-open');
    if (btn) {
      btn.textContent = this.open ? 'shut the tunnels' : 'open the tunnels';
      btn.classList.toggle('on', this.open);
    }
    const sub = this.card.querySelector('#bx-sub');
    if (sub) sub.textContent = this.open ? `${this.crossings} crossings` : 'isolated';

    const sink = this.card.querySelector('#bx-sink');
    if (sink) {
      const s = this.sinkIndex();
      if (!s.total) { sink.textContent = ''; return; }
      const pct = Math.round(s.share * 100);
      sink.innerHTML = `busiest cage: <b>${s.box.cond.name}</b> with ${pct}% of ${s.total}`
        + ` <span style="color:var(--line2,#2a3a4f)">· even split is 11%</span>`;
    }
  }
}
