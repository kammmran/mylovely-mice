import assert from 'node:assert/strict';
import { MouseBehavior, steerMouse, separateMice } from '../../src/world/behavior.js';

let seed = 8123;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const arena = { size: 1.2, half: .6, lightLevel: .35, dish: { x: .25, z: 0 },
  cheeses: [{ x: 0, z: 0, eaten: false }], shelter: { x: -.4, z: .36 } };
const box = { id: 0, arena, agents: [] };
const ag = { box, mouse: { x: -.3, z: 0, heading: Math.PI / 2, speed: 0,
  root: { scale: { x: 1 }, position: {} }, isProxy: true },
  brain: { hunger: .75, thirst: .1, fear: 0, mateDrive: 0, aggression: 0, drives: { eat: true, drink: true, mate: true } } };
box.agents.push(ag);
const behavior = new MouseBehavior(random);
let exits = 0;
const context = { grid: { open: true, nearestMouth: () => { exits++; return null; } } };
behavior.update(ag, .1);
assert.equal(behavior.choose(ag, context).action, 'eat', 'Exploration overrides available food');
assert.equal(exits, 0, 'The mouse considered a tunnel before its current needs');

// Discover water, then a strong need must interrupt a less urgent food goal.
ag.mouse.x = .05; ag.brain.thirst = .95;
behavior.perceiveIn = 0; behavior.update(ag, .1);
assert.equal(behavior.choose(ag, context).action, 'drink');
const rememberedWater = behavior.memory(box).water;
ag.box = { ...box, id: 1 }; behavior.update(ag, .1); ag.box = box;
assert.equal(behavior.memory(box).water, rememberedWater, 'Cage memory was discarded after a crossing');

ag.brain.thirst = .05; arena.cheeses[0].eaten = true;
behavior.interrupt(); behavior.perceiveIn = 0; behavior.update(ag, .3);
assert.notEqual(behavior.choose(ag, context).action, 'eat', 'Mouse kept chasing missing food');
behavior.pause('groom', 4, ag.mouse); behavior.interrupt('freeze');
assert.equal(behavior.bout, 0, 'An emergency did not interrupt grooming');

ag.brain.hunger = .05; ag.mouse.x = arena.shelter.x; ag.mouse.z = arena.shelter.z;
behavior.fatigue = .8;
assert.equal(behavior.choose(ag, { grid: { open: false } }).action, 'rest');
for (let i = 0; i < 80; i++) behavior.update(ag, .1);
assert(behavior.fatigue < .5, 'Rest did not recover fatigue');

const command = {};
ag.mouse.x = 0; ag.mouse.z = 0; ag.mouse.heading = 0;
steerMouse(ag, { x: 0, z: -.3 }, command);
assert.equal(command.throttle, 0, 'Mouse walks forward when its goal is behind it');
assert(Math.abs(command.turn) > .9, 'Mouse did not turn toward a goal behind it');
const other = { ...ag, mouse: { ...ag.mouse, root: { scale: { x: 1 }, position: {} } } };
box.agents.push(other);
other.mouse.z = .06;
steerMouse(ag, { x: 0, z: .3 }, command);
assert(Math.abs(command.turn) > .1, 'Mouse did not steer around a body directly ahead');
other.mouse.z = 0;
for (let i = 0; i < 8; i++) separateMice(box);
assert(Math.hypot(ag.mouse.x - other.mouse.x, ag.mouse.z - other.mouse.z) > .03, 'Overlapping bodies stayed interpenetrated');
assert(box.agents.every(({ mouse }) => Math.abs(mouse.x) < arena.half && Math.abs(mouse.z) < arena.half));
arena.waterLevel = .12; arena.dish = null; ag.brain.thirst = .8;
behavior.interrupt();
assert.equal(behavior.choose(ag, context).action, 'drink', 'Shallow water was ignored when the dish was absent');
console.log('Resource priorities, memory, interruption, rest, steering and body separation passed');
