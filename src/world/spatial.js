/** Cage-local spatial buckets keep encounters and overlap checks local. */
export class SpatialIndex {
  constructor(size = .12) { this.size = size; this.cells = new Map(); this.maxRing = 12; }
  rebuild(box) {
    this.cells.clear(); this.maxRing = Math.ceil(box.arena.size / this.size) + 2;
    for (const agent of box.agents) if (!agent.dead) {
      const key = `${Math.floor(agent.mouse.x / this.size)},${Math.floor(agent.mouse.z / this.size)}`;
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(agent);
    }
    return this;
  }
  *nearby(x, z, radius) {
    for (let cx = Math.floor((x - radius) / this.size); cx <= Math.floor((x + radius) / this.size); cx++)
      for (let cz = Math.floor((z - radius) / this.size); cz <= Math.floor((z + radius) / this.size); cz++)
        yield* this.cells.get(`${cx},${cz}`) || [];
  }
  closest(agent) {
    const { x, z } = agent.mouse, cx = Math.floor(x / this.size), cz = Math.floor(z / this.size);
    let best = null, distance = Infinity;
    for (let ring = 0; ring < this.maxRing; ring++) {
      for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
        if (ring && Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
        for (const other of this.cells.get(`${cx + dx},${cz + dz}`) || []) {
          if (other === agent || other.dead || other.box !== agent.box) continue;
          const d = Math.hypot(x - other.mouse.x, z - other.mouse.z);
          if (d < distance) { distance = d; best = other; }
        }
      }
      const boundary = Math.min(x - (cx - ring) * this.size, (cx + ring + 1) * this.size - x,
        z - (cz - ring) * this.size, (cz + ring + 1) * this.size - z);
      if (best && distance <= boundary) break;
    }
    return best;
  }
}
