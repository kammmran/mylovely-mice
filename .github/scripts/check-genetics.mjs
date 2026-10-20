import assert from 'node:assert/strict';
import { Genetics, LOCI, founderGenome, inheritGenome, expressGenome, summarizeGenomes } from '../../src/world/genetics.js';
import { cageLayout, validateWorldSettings, readWorldSettings } from '../../src/world/settings.js';
import { SpatialIndex } from '../../src/world/spatial.js';
import { Brain } from '../../src/neuro/brain.js';

let seed = 9763;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const mother = founderGenome(random), father = founderGenome(random);
for (let trial = 0; trial < 100; trial++) {
  const child = inheritGenome(mother, father, { random, mutationRate: 0 });
  for (const { id } of LOCI) {
    assert(mother[id].includes(child.genome[id][0]), 'Maternal allele was not inherited');
    assert(father[id].includes(child.genome[id][1]), 'Paternal allele was not inherited');
  }
  assert.equal(child.mutations.length, 0);
  assert(Object.values(expressGenome(child.genome)).every(Number.isFinite));
}
const mutated = inheritGenome(mother, father, { random, mutationRate: 1 });
assert.equal(mutated.mutations.length, LOCI.length * 2);
for (const { id, alleles } of LOCI) for (const transmission of mutated.transmissions[id]) {
  assert.notEqual(transmission.before, transmission.after);
  assert(transmission.after >= 0 && transmission.after < alleles.length);
}

const registry = new Genetics({ random, mutationRate: 0 });
const mom = registry.founder({ name: 'Mother', sex: 'F', boxId: 0, coat: 0 });
const dad = registry.founder({ name: 'Father', sex: 'M', boxId: 0, coat: 4 });
const plan = registry.conceive(mom, dad, 1)[0];
const first = registry.birth(plan, { name: 'Son', boxId: 0, bornAt: 1 });
assert.equal(first.generation, 1); assert.equal(first.motherId, mom.id); assert.equal(first.fatherId, dad.id);
assert.deepEqual(mom.children, [first.id]); assert.deepEqual(dad.children, [first.id]);
const grandchild = registry.birth(registry.conceive(mom, first, 1)[0], { name: 'Grandchild', boxId: 1, bornAt: 2 });
assert.equal(grandchild.generation, 2); assert.equal(grandchild.fatherId, first.id);
const cohort = registry.generations(0, 'coat');
assert.equal(cohort.length, 2); assert.equal(cohort[1].n, 1);
assert.deepEqual(cohort[1].counts, [1, 0, 0, 0, 1, 0]);
const summary = summarizeGenomes([first], 'coat');
assert.equal(summary.heterozygosity, 1); assert.equal(summary.frequencies.reduce((a, b) => a + b), 1);
first.currentCage = 1;
assert(registry.living(1).includes(first)); assert.equal(registry.generations(0, 'coat')[1].n, 1, 'Migration rewrote birth cohorts');
first.alive = false; first.diedAt = 3;
assert(!registry.living(1).includes(first)); assert.equal(registry.generations(0, 'coat')[1].living, 0);
assert.equal(registry.records.get(grandchild.fatherId), first, 'A dead parent disappeared from the pedigree');
assert.doesNotThrow(() => JSON.stringify(registry.export()));
registry.reset(); assert.equal(registry.records.size, 0);

for (const count of [1, 2, 4, 9, 12, 25, 101]) {
  const layout = cageLayout(count);
  assert.equal(layout.cells.length, count); assert(layout.centre >= 0 && layout.centre < count);
  assert.equal(layout.cells[layout.centre].key, 'control');
  assert.equal(new Set(layout.cells.map((cell) => `${cell.x}:${cell.z}`)).size, count);
}
assert.deepEqual(cageLayout(9).cells.map((cell) => cell.key), ['dry', 'bright', 'hungry', 'males', 'control', 'rich', 'crowded', 'predator', 'noisy']);
assert.equal(validateWorldSettings({ cages: 12, micePerCage: 250 }).micePerCage, 250);
for (const cages of [0, -1, 1.2, 'x', Infinity]) assert.throws(() => validateWorldSettings({ cages }));
assert.equal(readWorldSettings({ getItem: () => '{broken' }).cages, 9);

const box = { arena: { size: 1.2 }, agents: [] };
box.agents = Array.from({ length: 400 }, () => ({ box, mouse: { x: random() * 1.2 - .6, z: random() * 1.2 - .6 } }));
const spatial = new SpatialIndex().rebuild(box);
for (const agent of box.agents.slice(0, 40)) {
  const expected = box.agents.filter((other) => other !== agent).sort((a, b) => Math.hypot(a.mouse.x - agent.mouse.x, a.mouse.z - agent.mouse.z)
    - Math.hypot(b.mouse.x - agent.mouse.x, b.mouse.z - agent.mouse.z))[0];
  assert.equal(spatial.closest(agent), expected, 'Spatial nearest-neighbor search differs from exact search');
}
const brain = new Brain({ detail: 0 });
assert(brain.pops.every((population) => !population.spikeMap && !population.hdMap), 'Background brain allocated detailed maps');
brain.setDetail(2);
assert(brain.pops.filter((population) => population.mapped).every((population) => population.spikeMap?.length > 0));
console.log('Inheritance, mutations, pedigrees, cage cohorts, layouts, spatial search and lazy brain maps passed');
