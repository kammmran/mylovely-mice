import assert from 'node:assert/strict';
import { Brain } from '../../src/neuro/brain.js';
import { predatorExposure, predatorPose } from '../../src/world/threatmodel.js';

const refuge = { x: -.4, z: .36 };
const step = (brain, threat, seconds = .1, point = { x: 0, z: 0 }) => {
  for (let t = 0; t < seconds; t += .02) {
    brain.updateDefense({ ...point, threat }, .02);
    // An onset is an event, not a continuous signal.
    threat = { ...threat, onset: null, startle: 0 };
  }
};
const makeBrain = () => {
  const brain = new Brain({ seed: 7 });
  brain.light = .35; brain.centre = .5; brain.waterLevel = 0;
  return brain;
};

const cat = { key: 'cat', t: 2, dur: 10 };
const near = predatorExposure(cat, .5, .12, Math.PI / 2);
const far = predatorExposure(cat, -.5, -.4, Math.PI / 2);
assert(near.visual > far.visual && near.imminence > far.imminence, 'Cat proximity did not change exposure');
const front = predatorExposure(cat, 0, .12, Math.PI / 2);
const back = predatorExposure(cat, 0, .12, -Math.PI / 2);
assert(front.visual > back.visual, 'Facing direction did not affect visual detection');
assert(predatorExposure(cat, 0, .12, Math.PI / 2, true).visual < front.visual * .2, 'Refuge did not reduce visual exposure');
for (const key of ['cat', 'owl']) for (let t = 0; t <= 4; t += .05) {
  const pose = predatorPose(key, t, key === 'cat' ? 10 : 4.2);
  assert(Object.values(pose).every(Number.isFinite), 'Predator trajectory became invalid');
}

let brain = makeBrain();
step(brain, { sound: .85, soundKind: 'burst', onset: 'burst', startle: .85, imminence: .45 }, .1);
assert.equal(brain.mode, 'freeze', 'Noise did not briefly interrupt movement');
assert(brain.fear < .01, 'Neutral noise was treated as a sustained predator cue');
step(brain, {}, 2);
assert.equal(brain.mode, null, 'Noise response did not recover');

brain = makeBrain();
const approaching = { ...front, predatorKind: 'cat', onset: 'cat', shelterTarget: refuge, sound: .6, soundKind: 'cat' };
step(brain, approaching, .1);
assert.equal(brain.mode, 'freeze', 'Distant cat did not prompt an initial pause');
step(brain, { ...approaching, onset: null }, 1);
assert.equal(brain.mode, 'flight', 'Mouse did not leave its pause to escape to known shelter');

brain = makeBrain();
step(brain, { looming: .8, visual: .85, imminence: .8, predatorKind: 'owl', shelterTarget: refuge }, .2);
assert.equal(brain.mode, 'flight', 'Known shelter did not permit directed escape');
assert.deepEqual(brain.escapeTarget, refuge);
brain = makeBrain();
step(brain, { looming: .8, visual: .85, imminence: .8, predatorKind: 'owl' }, .2);
assert.equal(brain.mode, 'freeze', 'A mouse without shelter knowledge always fled');

brain = makeBrain();
step(brain, { ...near, predatorKind: 'cat', shelterTarget: refuge }, .2, { x: .5, z: .12 });
assert.equal(brain.mode, 'flight', 'Close ground predator did not trigger escape');
step(brain, { sheltered: true, shelterTarget: refuge, visual: .07, source: { x: .8, z: .1 }, predatorKind: 'cat' }, .3, refuge);
assert.equal(brain.defenseState, 'HIDING', 'Arrival in refuge did not stop escape');
const fear = brain.fear;
step(brain, { sheltered: true, shelterTarget: refuge }, 20, refuge);
assert(brain.fear < fear * .1, 'Fear failed to subside under cover');
assert.equal(brain.mode, null, 'Mouse remained hidden after recovery');
assert.equal(brain.threatSource, null, 'Old predator position was remembered indefinitely');

brain = makeBrain();
step(brain, { foulOdour: .8, odourKind: 'foul', source: { x: .4, z: .4 } }, 1);
assert(brain.aversion > .8 && brain.fear === 0 && brain.mode === null, 'Rotten smell became predator fear');
step(brain, { predatorOdour: .25, odourKind: 'tmt', source: { x: .4, z: .4 } }, 1);
assert.equal(brain.mode, 'risk', 'Moderate predator odor did not prompt risk assessment');
brain.drives.fear = false;
step(brain, { looming: 1, visual: 1, imminence: 1, shelterTarget: refuge }, 2);
assert.equal(brain.mode, null, 'Disabled defensive drive still chose escape');
assert.equal(brain.fear, 0);
console.log('Predator perception, noise startle, shelter escape, hiding, odor avoidance and recovery passed');
