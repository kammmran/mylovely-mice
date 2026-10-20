import { SpatialIndex } from './spatial.js';
/** Local resource memory and short, interruptible behavioral bouts.
 * Timings and utility weights are simulation parameters, not fitted measurements.
 */
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angle = (value) => Math.atan2(Math.sin(value), Math.cos(value));

export class MouseBehavior {
  constructor(random = Math.random) {
    this.random = random;
    this.cages = new Map();
    this.action = 'explore';
    this.goal = null;
    this.bout = 0;
    this.fatigue = 0;
    this.decisionIn = 0;
    this.perceiveIn = 0;
    this.groomIn = 10 + random() * 20;
    this.socialIn = 4 + random() * 12;
    this.boldness = .25 + random() * .6;
    this.lastPosition = null;
    this.stuck = 0;
  }

  memory(box) {
    if (!this.cages.has(box.id)) this.cages.set(box.id, { food: [], water: null, shelter: null,
      visits: new Float32Array(81), time: 0 });
    return this.cages.get(box.id);
  }

  update(ag, dt) {
    const { mouse: m, box, brain: b } = ag;
    const memory = this.memory(box);
    this.decisionIn -= dt; this.perceiveIn -= dt;
    this.groomIn -= dt; this.socialIn -= dt;
    this.bout = Math.max(0, this.bout - dt);
    this.fatigue = clamp(this.fatigue + dt * (Math.abs(m.speed) > .025 ? .018 : -.045), 0, 1);
    const cell = clamp(Math.floor((m.x / box.arena.size + .5) * 9), 0, 8)
      + 9 * clamp(Math.floor((m.z / box.arena.size + .5) * 9), 0, 8);
    memory.visits[cell] += dt;
    if (this.lastPosition && this.goal && !this.bout && distance(m, this.goal) > .08) {
      this.stuck = distance(m, this.lastPosition) < dt * .004 ? this.stuck + dt : Math.max(0, this.stuck - dt * 2);
    } else this.stuck = 0;
    this.lastPosition = { x: m.x, z: m.z };
    if (this.stuck > 2) { this.goal = null; this.decisionIn = 0; this.stuck = 0; }
    if (this.perceiveIn > 0) return;
    this.perceiveIn = .25;
    // Food is detected locally; remembered positions survive a cage crossing.
    const range = .26 + .28 * (b.hunger || 0);
    for (const food of box.arena.cheeses) if (!food.eaten && distance(m, food) < range) {
      if (!memory.food.some((known) => distance(known, food) < .025)) memory.food.push({ x: food.x, z: food.z });
    }
    memory.food = memory.food.filter((known) => distance(m, known) > range
      || box.arena.cheeses.some((food) => !food.eaten && distance(food, known) < .025));
    if (box.arena.shelter && distance(m, box.arena.shelter) < .5) memory.shelter = { ...box.arena.shelter };
    if (!box.arena.shelter) memory.shelter = null;
    if (box.arena.dish && distance(m, box.arena.dish) < .48) memory.water = { ...box.arena.dish };
    if (!box.arena.dish && memory.water && distance(m, memory.water) < .48) memory.water = null;
  }

  interrupt(action = 'alert') {
    this.action = action; this.bout = 0; this.goal = null; this.decisionIn = 0;
  }

  consume(kind, point) {
    this.action = kind; this.goal = { x: point.x, z: point.z };
    this.bout = kind === 'eat' ? 1.4 + this.random() * .8 : 1.1;
    this.decisionIn = 0;
  }

  choose(ag, { grid, mate, threatAt = () => 0 }) {
    const { mouse: m, brain: b, box } = ag, arena = box.arena;
    const memory = this.memory(box);
    const hunger = b.drives.eat ? b.hunger : 0, thirst = b.drives.drink ? b.thirst : 0;
    const urgent = Math.max(hunger, thirst) > .82;
    if ((this.action === 'eat' && !b.drives.eat)
      || (this.action === 'drink' && (!b.drives.drink || !arena.dish && !(arena.waterLevel > .04)))) this.bout = 0;
    if (thirst > .35 && arena.waterLevel > .04 && arena.waterLevel < .35) return this.pause('drink', 1.2, m);
    if (this.bout > 0 && (!urgent || this.action === 'eat' || this.action === 'drink')) {
      return { action: this.action, goal: this.goal, stationary: true, urgency: .2 };
    }
    const currentValid = this.goal && (this.action !== 'eat' || hunger > .18 && memory.food.some((food) => distance(food, this.goal) < .025))
      && (this.action !== 'drink' || thirst > .12 && memory.water && arena.dish);
    if (currentValid && this.decisionIn > 0 && distance(m, this.goal) > .035 && !urgent) {
      return { action: this.action, goal: this.goal, urgency: this.urgency };
    }
    const choices = [];
    for (const food of memory.food) choices.push({ action: 'eat', goal: food, urgency: hunger,
      utility: hunger * 1.5 - distance(m, food) * .3 - threatAt(food.x, food.z) * 1.8 });
    if (memory.water && arena.dish) choices.push({ action: 'drink', goal: memory.water, urgency: thirst,
      utility: thirst * 1.75 - distance(m, memory.water) * .25 - threatAt(memory.water.x, memory.water.z) });
    if (mate && b.drives.mate && b.mateDrive > .3 && mate.brain.mateDrive > .15) {
      choices.push({ action: 'court', goal: { x: mate.mouse.x, z: mate.mouse.z }, urgency: b.mateDrive,
        utility: b.mateDrive * 1.1 - distance(m, mate.mouse) * .25 });
    }
    const best = choices.sort((a, c) => c.utility - a.utility)[0];
    // Completing a useful task gets a small preference over switching goals.
    if (best && best.utility > .2) {
      const previous = choices.find((choice) => choice.action === this.action && this.goal && distance(choice.goal, this.goal) < .03);
      return this.commit(previous && previous.utility + .14 > best.utility ? previous : best, 1.2);
    }
    if (!urgent && b.fear < .2) {
      if (this.fatigue > .55) {
        const home = arena.shelter || { x: -.46, z: .42 };
        if (distance(m, home) < .06) return this.pause('rest', 3 + this.random() * 4, home);
        return this.commit({ action: 'return home', goal: home, urgency: .3 }, 1.5);
      }
      if (this.groomIn <= 0 && Math.abs(m.speed) < .04) {
        this.groomIn = 18 + this.random() * 25;
        return this.pause('groom', 1.8 + this.random() * 2, { x: m.x, z: m.z });
      }
      if (mate && this.socialIn <= 0 && b.aggression < .2 && !mate.dead) {
        this.socialIn = 8 + this.random() * 14;
        if (distance(m, mate.mouse) < .11) return this.pause('investigate', .8 + this.random(), mate.mouse);
        return this.commit({ action: 'investigate', goal: { x: mate.mouse.x, z: mate.mouse.z }, urgency: .25 }, .7);
      }
    }
    if (this.goal && distance(m, this.goal) < .045 && this.action === 'explore') {
      return this.pause(this.random() < .24 ? 'rear' : 'sniff', .4 + this.random() * .8, this.goal);
    }
    // Explore connected cages after checking food and water, rather than
    // abandoning a needed resource to repeatedly go through the nearest tunnel.
    if (grid?.open && this.random() < .18 && !urgent && b.fear < .4) {
      const mouth = grid.nearestMouth(box, m.x, m.z, (far) => !this.cages.has(far.id));
      if (mouth) return this.commit({ action: 'explore', goal: { ...mouth.mouth }, urgency: .4 }, 2.5);
    }
    let candidate = null, score = -Infinity;
    for (let i = 0; i < 20; i++) {
      const x = Math.floor(this.random() * 9), z = Math.floor(this.random() * 9);
      const point = { x: (x / 8 - .5) * (arena.size - .12), z: (z / 8 - .5) * (arena.size - .12) };
      const edge = Math.max(Math.abs(point.x), Math.abs(point.z)) / arena.half;
      const wallPreference = .65 + arena.lightLevel * .4 + b.fear * .8 - this.boldness * .25;
      const value = edge * wallPreference - Math.min(3, memory.visits[x + z * 9] * .18)
        - Math.abs(distance(m, point) - .28) * .8 - threatAt(point.x, point.z) * 4 + this.random() * .25;
      if (value > score) { score = value; candidate = point; }
    }
    return this.commit({ action: 'explore', goal: candidate, urgency: .25 + this.boldness * .2 }, 1.5);
  }

  commit(choice, seconds) {
    this.action = choice.action; this.goal = choice.goal; this.urgency = choice.urgency;
    this.decisionIn = seconds;
    return choice;
  }

  pause(action, duration, point) {
    this.action = action; this.goal = { x: point.x, z: point.z }; this.bout = duration;
    return { action, goal: this.goal, stationary: true, urgency: .2 };
  }
}

/** Slow before a sharp turn, and make room for nearby bodies. */
export function steerMouse(ag, goal, out, urgency = .5) {
  const m = ag.mouse;
  let dx = goal.x - m.x, dz = goal.z - m.z;
  const dist = Math.hypot(dx, dz);
  let vx = dx / Math.max(dist, .001), vz = dz / Math.max(dist, .001);
  for (const other of ag.box.spatial?.nearby(m.x, m.z, .12) || ag.box.agents || []) {
    if (other === ag || other.dead || other.box !== ag.box) continue;
    const ox = m.x - other.mouse.x, oz = m.z - other.mouse.z;
    const gap = Math.hypot(ox, oz);
    if (gap < .11 && gap > .001 && dist > .05) {
      const weight = clamp((.11 - gap) / .11, 0, 1) * .85;
      vx += ox / gap * weight; vz += oz / gap * weight;
      // A lateral component breaks a head-on standoff without random turns.
      if ((goal.x - m.x) * -ox + (goal.z - m.z) * -oz > 0) {
        vx -= oz / gap * weight * .7; vz += ox / gap * weight * .7;
      }
    }
  }
  const source = ag.brain?.threatSource;
  if (source && ag.brain.threatKind !== 'owl' && ag.brain.aversion > .15) {
    const px = m.x + vx * .12, pz = m.z + vz * .12;
    const danger = Math.hypot(px - source.x, pz - source.z);
    if (danger < .25) {
      const ox = (px - source.x) / Math.max(.03, danger), oz = (pz - source.z) / Math.max(.03, danger);
      vx += ox - oz * .55; vz += oz + ox * .55;
    }
  }
  const err = angle(Math.atan2(vx, vz) - m.heading);
  out.turn = clamp(-err * 2.2, -1, 1);
  out.throttle = dist < .035 ? 0 : Math.max(0, Math.cos(err)) ** 2 * clamp(dist / .12, .15, 1);
  out.run = urgency > .68 && dist > .24 && Math.abs(err) < .45;
  out.sniff = dist < .11 && urgency < .8;
  out.rear = false;
  return dist;
}

/** Resolve body overlap locally, including proxies and juveniles. */
export function separateMice(box) {
  const mice = box.agents.filter((ag) => !ag.dead);
  const index = (box.spatial ||= new SpatialIndex()).rebuild(box), order = new Map(mice.map((ag, i) => [ag, i]));
  for (let i = 0; i < mice.length; i++) for (const other of index.nearby(mice[i].mouse.x, mice[i].mouse.z, .06)) {
    if ((order.get(other) ?? -1) <= i) continue;
    const a = mice[i].mouse, b = other.mouse;
    let dx = b.x - a.x, dz = b.z - a.z, gap = Math.hypot(dx, dz);
    const min = .036 * ((a.root.scale.x || 1) + (b.root.scale.x || 1)) / 2;
    if (gap >= min) continue;
    if (gap < .0001) { dx = 1; dz = 0; gap = 1; }
    const move = Math.min(.005, (min - Math.hypot(b.x - a.x, b.z - a.z)) * .5);
    const lim = box.arena.half - .024;
    for (const [body, sign] of [[a, -1], [b, 1]]) {
      body.x = clamp(body.x + sign * dx / gap * move, -lim, lim);
      body.z = clamp(body.z + sign * dz / gap * move, -lim, lim);
      if (!body.isProxy) { body.root.position.x = body.x; body.root.position.z = body.z; }
    }
  }
}
