/**
 * Bodies for animals nobody is looking at closely.
 *
 * The articulated rig is 64 meshes, so a hundred of them is 6,400 draw calls and
 * the frame rate collapses. Only the few animals nearest the camera get a real
 * rig; the rest run the same locomotion on a stripped body and are drawn as a
 * single instanced mesh — one draw call for the whole colony.
 *
 * ProxyBody deliberately mirrors the public surface main.js uses from Mouse, so
 * an agent can be swapped between the two without anything else noticing.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAX_RUN, MAX_WALK } from './mouse.js';

const MAX_TURN = 3.1;
const BODY_Y = 0.019;
const GREY = new THREE.Color(0x6b6b6b);
const DEAD_COLOR = new THREE.Color();

export class ProxyBody {
  constructor(arena, { x = 0, z = 0, heading = 0 } = {}) {
    this.arena = arena;
    this.x = x; this.z = z; this.heading = heading;
    this.speed = 0; this.angVel = 0; this.accel = 0; this.prevSpeed = 0;
    this.rear = 0; this.bumped = false; this.eatAnim = 0;
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

    this.rear += ((input.sniff ? 1 : 0) - this.rear) * Math.min(1, dt * 7);
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
  }

  onEat() { this.eatAnim = 1; }
  setBehaviourDrive() { /* posture needs a rig */ }
  setAutopilot() { return false; }
  reset() {
    this.speed = 0; this.angVel = 0; this.accel = 0; this.rear = 0;
  }

  sensorState(cheeses, ate) {
    return {
      x: this.x, z: this.z, heading: this.heading, speed: this.speed,
      angVel: this.angVel, accel: this.accel,
      cheeses, cmd: this.cmd, ate, bumped: this.bumped,
    };
  }
}

/** Draws every proxy body in a single instanced mesh. */
export class ProxyHerd {
  constructor(scene, max = 128) {
    const body = new THREE.CapsuleGeometry(0.016, 0.042, 4, 10);
    body.rotateX(Math.PI / 2);
    const head = new THREE.SphereGeometry(0.0135, 10, 8);
    head.translate(0, 0.004, 0.036);
    const snout = new THREE.ConeGeometry(0.0085, 0.016, 8);
    snout.rotateX(Math.PI / 2);
    snout.translate(0, 0.001, 0.05);
    const earL = new THREE.SphereGeometry(0.008, 8, 6);
    earL.scale(1, 1, 0.4); earL.translate(-0.011, 0.012, 0.027);
    const earR = earL.clone(); earR.translate(0.022, 0, 0);
    const tail = new THREE.CylinderGeometry(0.0022, 0.0009, 0.06, 5);
    tail.rotateX(Math.PI / 2); tail.translate(0, 0.002, -0.055);

    const geo = mergeGeometries([body, head, snout, earL, earR, tail], false);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.max = max;
    this.dummy = new THREE.Object3D();
    this.colorsSet = new WeakSet();
  }

  /** @param bodies array of ProxyBody, each with a .furColor and .scale */
  sync(bodies) {
    const n = Math.min(bodies.length, this.max);
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
        if (b.furColor) {
          DEAD_COLOR.copy(b.furColor).lerp(GREY, 0.55);
          this.mesh.setColorAt(i, DEAD_COLOR);
        }
        continue;
      }
      const fz = b.freeze || 0, fr = b.fear || 0;
      // a frozen mouse flattens itself to the floor and stops moving; a merely
      // frightened one piloerects, which reads as a slightly bigger body
      const crouch = 1 - 0.34 * fz;
      const puff = 1 + 0.05 * fr;
      const hop = Math.sin(b.bob) * 0.0022 * Math.min(1, Math.abs(b.speed) / 0.2) * (1 - fz);
      d.position.set(b.x, BODY_Y * s * crouch + hop, b.z);
      d.rotation.set(-b.rear * 0.7 + 0.12 * fz, b.heading, 0);
      d.scale.set(s * puff, s * crouch * puff, s * puff);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      if (b.furColor) this.mesh.setColorAt(i, b.furColor);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** move locomotion state between a rig and a proxy, so swapping is invisible */
export function transferBody(from, to) {
  to.x = from.x; to.z = from.z; to.heading = from.heading;
  to.speed = from.speed; to.angVel = from.angVel; to.accel = from.accel;
  to.rear = from.rear;
  if (from.root && to.root) to.root.scale.copy(from.root.scale);
}
