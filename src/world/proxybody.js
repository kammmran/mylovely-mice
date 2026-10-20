/**
 * Bodies for animals nobody is looking at closely.
 *
 * Nearby animals use the articulated rig. Distant animals share instanced coat
 * and facial-detail geometry, keeping their eyes, paws and tails visible.
 *
 * ProxyBody deliberately mirrors the public surface main.js uses from Mouse, so
 * an agent can be swapped between the two without anything else noticing.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAX_RUN, MAX_WALK } from './mouse.js';
import { furTexture, mouseTorsoGeometry, mouseMuzzleGeometry } from './mouseappearance.js';

const MAX_TURN = 3.1;
const BODY_Y = 0.019;
const GREY = new THREE.Color(0x6b6b6b);
const DEAD_COLOR = new THREE.Color();

export class ProxyBody {
  constructor(arena, { x = 0, z = 0, heading = 0 } = {}) {
    this.arena = arena;
    this.x = x; this.z = z; this.heading = heading;
    this.speed = 0; this.angVel = 0; this.accel = 0; this.prevSpeed = 0;
    this.rear = 0; this.groom = 0; this.rest = 0; this.chew = 0; this.foodT = 0; this.bumped = false; this.eatAnim = 0;
    // defensive state, mirrored from the brain so the instance can show it
    this.freeze = 0; this.fear = 0;
    this.dead = false;
    this.cmd = { throttle: 0, turn: 0, sniff: 0 };
    this.isProxy = true;
    // a stand-in for the rig's root, so scaling a juvenile still works
    this.root = new THREE.Object3D();
    this.mats = { fur: new THREE.Color(0xb6ada1), belly: new THREE.Color(0xe4ded5) };
    this.bob = Math.random() * 6.28;
  }

  /** the same integration the rig does, without any of the articulation */
  update(dt, input, brain) {
    if (this.dead) {
      this.speed = 0; this.angVel = 0; this.accel = 0;
      this.cmd.throttle = 0; this.cmd.turn = 0; this.cmd.sniff = 0;
      return;
    }
    const run = input.run;
    const target = input.throttle * (run ? MAX_RUN : MAX_WALK);
    this.cmd.throttle = input.throttle;
    this.cmd.turn = input.turn;
    this.cmd.sniff = input.sniff ? 1 : 0;

    this.rear += (((input.rear ?? input.sniff) ? 1 : 0) - this.rear) * Math.min(1, dt * 7);
    this.groom += ((input.groom ? 1 : 0) - this.groom) * Math.min(1, dt * 7);
    this.rest += ((input.rest ? 1 : 0) - this.rest) * Math.min(1, dt * 3);
    const rearBrake = 1 - 0.75 * this.rear;

    this.prevSpeed = this.speed;
    const tau = target > this.speed ? 0.16 : 0.1;
    this.speed += (target * rearBrake - this.speed) * Math.min(1, dt / tau);
    if (Math.abs(this.speed) < 0.002 && Math.abs(target) < 0.002) this.speed = 0;
    this.accel = dt > 0 ? (this.speed - this.prevSpeed) / dt : 0;

    const turnRate = MAX_TURN * (0.55 + 0.45 * Math.min(1, Math.abs(this.speed) / MAX_WALK)) * rearBrake;
    this.angVel += ((-input.turn * turnRate) - this.angVel) * Math.min(1, dt * 11);
    this.heading += this.angVel * dt;

    const lim = this.arena.half - 0.022;
    const nx = this.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.z + Math.cos(this.heading) * this.speed * dt;
    this.bumped = false;
    if (nx > lim || nx < -lim) { this.bumped = Math.abs(this.speed) > 0.04; this.x = Math.max(-lim, Math.min(lim, nx)); this.speed *= 0.45; }
    else this.x = nx;
    if (nz > lim || nz < -lim) { this.bumped = this.bumped || Math.abs(this.speed) > 0.04; this.z = Math.max(-lim, Math.min(lim, nz)); this.speed *= 0.45; }
    else this.z = nz;

    this.bob += dt * (3 + 10 * Math.min(1, Math.abs(this.speed) / MAX_RUN));
    this.eatAnim = Math.max(0, this.eatAnim - dt * 2.2);
    this.chew = Math.max(0, this.chew - dt * .75);
    this.foodT = Math.max(0, this.foodT - dt);
  }

  onEat() { this.eatAnim = 1; this.chew = 1.6; this.foodT = 1.4; }
  setBehaviourDrive() { /* posture needs a rig */ }
  setAutopilot() { return false; }
  reset() {
    this.speed = 0; this.angVel = 0; this.accel = 0; this.rear = 0; this.groom = 0; this.rest = 0;
  }

  sensorState(cheeses, ate) {
    return {
      x: this.x, z: this.z, heading: this.heading, speed: this.speed,
      angVel: this.angVel, accel: this.accel,
      cheeses, cmd: this.cmd, ate, bumped: this.bumped,
    };
  }
}

/** Two instanced meshes per cage, regardless of its population. */
export class ProxyHerd {
  constructor(scene, max = 128) {
    const coats = [], details = [];
    const ellipsoid = (rx, ry, rz, x, y, z) => {
      const geometry = new THREE.SphereGeometry(1, 10, 6);
      geometry.scale(rx, ry, rz); geometry.translate(x, y, z);
      return geometry;
    };
    const colored = (geometry, color) => {
      const rgb = new THREE.Color(color), array = [];
      for (let i = 0; i < geometry.getAttribute('position').count; i++) array.push(rgb.r, rgb.g, rgb.b);
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(array, 3));
      details.push(geometry);
    };
    const torso = mouseTorsoGeometry(16); torso.translate(0, 0, .012); coats.push(torso);
    coats.push(ellipsoid(.0104, .010, .0128, 0, .005, .029));
    const snout = mouseMuzzleGeometry(12); snout.translate(0, .002, .034); coats.push(snout);
    for (const side of [-1, 1]) {
      const ear = ellipsoid(.0078, .0084, .0016, 0, 0, 0); ear.rotateY(side * .65); ear.translate(side * .010, .0155, .0245); coats.push(ear);
      const inner = ellipsoid(.0060, .0065, .0008, 0, 0, .0015); inner.rotateY(side * .65); inner.translate(side * .010, .016, .0245); colored(inner, 0xcba7a1);
      colored(ellipsoid(.0019, .0019, .0019, side * .0087, .0073, .0365), 0x101116);
      colored(ellipsoid(.0004, .0004, .0004, side * .0097, .0083, .0377), 0xf0f1ef);
      colored(ellipsoid(.003, .0014, .005, side * .011, -.0165, .023), 0xcba7a1);
      colored(ellipsoid(.0033, .0015, .009, side * .013, -.0165, -.018), 0xcba7a1);
    }
    colored(ellipsoid(.0015, .0013, .0015, 0, .002, .0525), 0xcba7a1);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -.004, -.043),
      new THREE.Vector3(.004, -.012, -.078), new THREE.Vector3(.009, -.017, -.123)]);
    const tail = new THREE.TubeGeometry(curve, 16, .0025, 6, false);
    const positions = tail.getAttribute('position');
    for (let ring = 0; ring <= 16; ring++) {
      const point = curve.getPointAt(ring / 16), taper = 1 - ring / 16 * .9;
      for (let side = 0; side <= 6; side++) {
        const index = ring * 7 + side;
        positions.setXYZ(index, point.x + (positions.getX(index) - point.x) * taper,
          point.y + (positions.getY(index) - point.y) * taper, point.z + (positions.getZ(index) - point.z) * taper);
      }
    }
    tail.computeVertexNormals(); colored(tail, 0xb99c91);
    const geometry = mergeGeometries(coats, false);
    const detailGeometry = mergeGeometries(details, false);
    const material = new THREE.MeshStandardMaterial({ roughness: .96, map: furTexture() });
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.details = new THREE.InstancedMesh(detailGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .82 }), max);
    for (const mesh of [this.mesh, this.details]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true; mesh.frustumCulled = false; mesh.count = 0; scene.add(mesh);
    }
    [...coats, ...details].forEach((part) => part.dispose());
    this.scene = scene; this.max = max;
    this.dummy = new THREE.Object3D();
    this.colorsSet = new WeakSet();
  }

  ensureCapacity(count) {
    if (count <= this.max) return;
    const capacity = Math.max(count, this.max * 2);
    for (const key of ['mesh', 'details']) {
      const old = this[key], mesh = new THREE.InstancedMesh(old.geometry, old.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true; mesh.frustumCulled = false; mesh.count = 0;
      this.scene.remove(old); old.dispose(); this.scene.add(mesh); this[key] = mesh;
    }
    this.max = capacity;
  }

  /** @param bodies array of ProxyBody, each with a .furColor and .scale */
  sync(bodies) {
    this.ensureCapacity(bodies.length);
    const n = bodies.length;
    const d = this.dummy;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      const s = b.root.scale.x || 1;
      if (b.dead) {
        // lying on its side, not animating
        d.position.set(b.x, 0.011 * s, b.z);
        d.rotation.set(0, b.heading, Math.PI / 2.1);
        d.scale.setScalar(s);
        d.updateMatrix();
        this.mesh.setMatrixAt(i, d.matrix);
        this.details.setMatrixAt(i, d.matrix);
        if (b.furColor) {
          DEAD_COLOR.copy(b.furColor).lerp(GREY, 0.55);
          this.mesh.setColorAt(i, DEAD_COLOR);
        }
        continue;
      }
      const fz = b.freeze || 0, fr = b.fear || 0;
      // a frozen mouse flattens itself to the floor and stops moving; a merely
      // frightened one piloerects, which reads as a slightly bigger body
      const risk = b.risk || 0;
      const crouch = 1 - .34 * fz - .12 * b.rest - .1 * risk;
      const puff = 1 + 0.05 * fr;
      const hop = Math.sin(b.bob) * 0.0022 * Math.min(1, Math.abs(b.speed) / 0.2) * (1 - fz);
      d.position.set(b.x, BODY_Y * s * crouch + hop + (b.startle || 0) * .004, b.z);
      d.rotation.set(-b.rear * .7 - b.groom * .14 + .12 * fz, b.heading, Math.sin(b.bob * 2) * b.groom * .025);
      d.scale.set(s * puff, s * crouch * puff, s * puff * (1 + risk * .1));
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      this.details.setMatrixAt(i, d.matrix);
      if (b.furColor) this.mesh.setColorAt(i, b.furColor);
    }
    this.mesh.count = this.details.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.details.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** move locomotion state between a rig and a proxy, so swapping is invisible */
export function transferBody(from, to) {
  to.x = from.x; to.z = from.z; to.heading = from.heading;
  to.speed = from.speed; to.angVel = from.angVel; to.accel = from.accel;
  to.rear = from.rear; to.groom = from.groom || 0; to.rest = from.rest || 0;
  to.eatAnim = from.eatAnim || 0; to.chew = from.chew || 0;
  to.foodT = from.foodT || 0;
  if (from.root && to.root) to.root.scale.copy(from.root.scale);
}
