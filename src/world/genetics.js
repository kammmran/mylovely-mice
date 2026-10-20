/** Independent toy loci, not identified mouse genes or fitted trait associations. */
export const COAT_ALLELES = [
  { label: 'Agouti', fur: 0x8b7b67, belly: 0xcfc3ae }, { label: 'Gray', fur: 0x686b70, belly: 0xbfc1c1 },
  { label: 'Dark', fur: 0x49433d, belly: 0xaaa192 }, { label: 'Cream', fur: 0xc8b697, belly: 0xe7ddc8 },
  { label: 'White', fur: 0xe2dfd5, belly: 0xf0ece2 }, { label: 'Warm', fur: 0x716354, belly: 0xc4b9a6 },
];
export const LOCI = [
  { id: 'coat', label: 'Coat tone', alleles: COAT_ALLELES.map((coat) => coat.label), effect: 'The two inherited colors are blended.' },
  { id: 'explore', label: 'Exploration', alleles: ['Cautious', 'Exploratory'], effect: 'Changes exploration preference.' },
  { id: 'metabolism', label: 'Metabolism', alleles: ['Lower demand', 'Higher demand'], effect: 'Changes how quickly food and water needs rise.' },
  { id: 'vigilance', label: 'Threat sensitivity', alleles: ['Less sensitive', 'More sensitive'], effect: 'Changes the strength of defensive responses.' },
  { id: 'size', label: 'Body size', alleles: ['Smaller', 'Larger'], effect: 'Changes adult display size.' },
];
const clone = (genome) => Object.fromEntries(LOCI.map(({ id }) => [id, [...genome[id]]]));
const mix = (a, b) => [16, 8, 0].reduce((color, shift) => color | Math.round(((a >> shift & 255) + (b >> shift & 255)) / 2) << shift, 0);
export function founderGenome(random = Math.random, coat) {
  return Object.fromEntries(LOCI.map((locus) => [locus.id, [0, 1].map(() => locus.id === 'coat' && coat != null
    ? coat : Math.floor(random() * locus.alleles.length))]));
}
export function inheritGenome(mother, father, { random = Math.random, mutationRate = .01 } = {}) {
  const genome = {}, transmissions = {}, mutations = [];
  for (const locus of LOCI) {
    const pair = [], origin = [];
    for (const [parent, source] of [[mother, 'mother'], [father, 'father']]) {
      const alleleIndex = random() < .5 ? 0 : 1, before = parent[locus.id][alleleIndex];
      let after = before;
      if (random() < mutationRate) after = (before + 1 + Math.floor(random() * (locus.alleles.length - 1))) % locus.alleles.length;
      pair.push(after); origin.push({ parent: source, alleleIndex, before, after });
      if (after !== before) mutations.push({ locus: locus.id, parent: source, from: before, to: after });
    }
    genome[locus.id] = pair; transmissions[locus.id] = origin;
  }
  return { genome, transmissions, mutations };
}
export function expressGenome(genome) {
  const dosage = (id) => (genome[id][0] + genome[id][1]) / 2;
  const [a, b] = genome.coat.map((index) => COAT_ALLELES[index]);
  return { fur: mix(a.fur, b.fur), belly: mix(a.belly, b.belly),
    boldness: .25 + .6 * dosage('explore'), metabolicRate: .8 + .4 * dosage('metabolism'),
    defenseGain: .75 + .5 * dosage('vigilance'), bodyScale: .92 + .16 * dosage('size') };
}
export function summarizeGenomes(records, locusId) {
  const locus = LOCI.find((entry) => entry.id === locusId);
  const counts = Array(locus.alleles.length).fill(0);
  let heterozygotes = 0;
  for (const record of records) {
    for (const allele of record.genome[locusId]) counts[allele]++;
    if (record.genome[locusId][0] !== record.genome[locusId][1]) heterozygotes++;
  }
  return { n: records.length, counts, frequencies: counts.map((count) => records.length ? count / (records.length * 2) : null),
    heterozygosity: records.length ? heterozygotes / records.length : null };
}

export class Genetics {
  constructor({ random = Math.random, mutationRate = .01 } = {}) {
    this.random = random; this.mutationRate = mutationRate; this.records = new Map(); this.sequence = 0; this.revision = 0;
  }
  reset() { this.records.clear(); this.sequence = 0; this.revision++; }
  register({ name, sex, boxId, bornAt = 0, stage = 'adult', genome, motherId = null, fatherId = null,
    generation = 0, transmissions = {}, mutations = [], immigrant = false }) {
    const id = `M${String(++this.sequence).padStart(5, '0')}`;
    const record = { id, name, sex, birthCage: boxId, currentCage: boxId, bornAt, stage, alive: true,
      motherId, fatherId, generation, genome: clone(genome), transmissions, mutations, immigrant,
      children: [], diedAt: null, removedAt: null };
    this.records.set(id, record);
    for (const parentId of [motherId, fatherId]) this.records.get(parentId)?.children.push(id);
    this.revision++; return record;
  }
  founder({ coat, ...details }) { return this.register({ ...details, genome: founderGenome(this.random, coat) }); }
  conceive(mother, father, count) {
    const m = mother.genetics || mother, f = father.genetics || father;
    return Array.from({ length: count }, () => ({
      ...inheritGenome(m.genome, f.genome, this), motherId: m.id, fatherId: f.id,
      generation: 1 + Math.max(m.generation, f.generation), sex: this.random() < .5 ? 'M' : 'F',
    }));
  }
  birth(plan, { name, boxId, bornAt }) { return this.register({ ...plan, name, boxId, bornAt, stage: 'pup' }); }
  synchronize(agents, boxes, time) {
    const present = new Set();
    for (const agent of agents) {
      const record = agent.genetics; if (!record) continue;
      present.add(record.id);
      const stage = agent.dead ? 'dead' : agent.mature ? 'adult' : 'juvenile';
      if (record.name !== agent.name || record.stage !== stage || record.currentCage !== agent.box.id) this.revision++;
      record.name = agent.name; record.stage = stage; record.currentCage = agent.box.id;
      record.alive = !agent.dead;
      if (agent.dead && record.diedAt == null) { record.diedAt = time; this.revision++; }
    }
    for (const box of boxes) for (const pup of box.litter.pups) {
      const record = pup.genetics; if (!record) continue;
      present.add(record.id);
      if (record.currentCage !== box.id || record.alive !== !pup.dead) this.revision++;
      record.currentCage = box.id; record.alive = !pup.dead;
      if (pup.dead && record.diedAt == null) { record.diedAt = time; this.revision++; }
    }
    for (const record of this.records.values()) if (!present.has(record.id) && record.removedAt == null) {
      record.removedAt = time;
      if (record.alive) record.stage = 'removed';
      this.revision++;
    }
  }
  living(cageId = null) { return [...this.records.values()].filter((record) => record.alive && record.removedAt == null && (cageId == null || record.currentCage === cageId)); }
  generations(cageId, locusId) {
    const cohorts = new Map();
    for (const record of this.records.values()) if (record.birthCage === cageId) {
      if (!cohorts.has(record.generation)) cohorts.set(record.generation, []);
      cohorts.get(record.generation).push(record);
    }
    return [...cohorts.entries()].sort(([a], [b]) => a - b).map(([generation, records]) => ({ generation,
      ...summarizeGenomes(records, locusId), living: records.filter((record) => record.alive && record.removedAt == null).length,
      mutations: records.reduce((sum, record) => sum + record.mutations.length, 0) }));
  }
  export() { return { model: 'Independent illustrative loci; not real gene-trait associations', mutationRate: this.mutationRate,
    loci: LOCI, records: [...this.records.values()] }; }
}
