/**
 * The open field: a 120 x 120 cm plate with low walls and a polarising cue
 * card, the geometry used in rodent place- and grid-cell experiments.
 * Also owns the cheese, the odour plume, the path trail, the learned-value
 * floor overlay and the replay ghost.
 */
import * as THREE from 'three';
import { SEQ_VALUE, ramp } from '../view/palette.js';

const SIZE = 1.2;            // arena side, metres
const MOUSE_START = { x: -0.35, z: -0.35 };   // keep cheese away from where the mouse appears
const DISH = { x: 0.40, z: -0.40, r: 0.075 };  // the water dish
const WALL_H = 0.17;
const TRAIL_MAX = 1400;

// --------------------------------------------------------------- textures
let _floorTex = null, _plumeTex = null;
function floorTexture() {
  if (_floorTex) return _floorTex;
  return (_floorTex = buildFloorTexture());
}
function buildFloorTexture() {
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#24282e'; g.fillRect(0, 0, S, S);
  // subtle paper-like noise
  for (let i = 0; i < 24000; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.042})`;
    g.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
  }
  // 10 cm grid
  const step = S / 12;
  g.strokeStyle = 'rgba(150,180,210,0.17)'; g.lineWidth = 1;
  for (let i = 0; i <= 12; i++) {
    g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, S); g.stroke();
    g.beginPath(); g.moveTo(0, i * step); g.lineTo(S, i * step); g.stroke();
  }
  // centre cross
  g.strokeStyle = 'rgba(150,180,210,0.32)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(S / 2, S / 2 - 26); g.lineTo(S / 2, S / 2 + 26);
  g.moveTo(S / 2 - 26, S / 2); g.lineTo(S / 2 + 26, S / 2); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function plumeTexture() {
  if (_plumeTex) return _plumeTex;
  return (_plumeTex = buildPlumeTexture());
}
function buildPlumeTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,200,90,0.5)');
  grd.addColorStop(0.25, 'rgba(255,184,77,0.2)');
  grd.addColorStop(0.6, 'rgba(255,184,77,0.05)');
  grd.addColorStop(1, 'rgba(255,184,77,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

// --------------------------------------------------------------- cheese
function makeCheese() {
  const g = new THREE.Group();
  const W = 0.052, D = 0.032;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, -W / 2.6);
  shape.lineTo(W / 2, -W / 2.6);
  shape.lineTo(-W / 2, W / 1.7);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: true, bevelSize: 0.0025, bevelThickness: 0.0025, bevelSegments: 2 });
  geo.center();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffc83d, roughness: 0.55, metalness: 0.02, emissive: 0x3a2400, emissiveIntensity: 0.5 });
  const body = new THREE.Mesh(geo, mat);
  body.castShadow = true;
  g.add(body);
  // holes
  const hmat = new THREE.MeshStandardMaterial({ color: 0xcf8f14, roughness: 0.9 });
  const hs = [[-0.012, 0.004, D / 2], [0.008, -0.006, D / 2], [-0.004, 0.015, D / 2],
              [-0.010, 0.000, -D / 2], [0.006, 0.008, -D / 2]];
  for (const [x, y, z] of hs) {
    const r = 0.0035 + Math.random() * 0.0028;
    const h = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), hmat);
    h.position.set(x, y, z * 0.92);
    g.add(h);
  }
  g.rotation.x = -Math.PI / 2;
  g.rotation.z = Math.random() * Math.PI;
  return g;
}

// --------------------------------------------------------------- the arena
export class Arena {
  /**
   * One cage. Several of these can share a scene — a grid of them, each with
   * its own conditions — in which case only one owns the global light rig and
   * the rest are lit by it plus a lamp of their own. Everything an arena draws
   * goes in `this.group`, so `origin` offsets the whole cage and the animals
   * inside it keep using arena-local coordinates.
   */
  constructor(scene, opts = {}) {
    const {
      lights = true,          // owns the scene-wide light rig?
      lamp = false,           // a local lamp, for a cage that does not
      origin = null,          // where this cage sits in the world
      cheeses = 3,            // how much food it starts with
      dish = true,            // is there a water dish at all?
      label = null,
    } = opts;
    this.scene = scene;
    this.size = SIZE;
    this.half = SIZE / 2;
    this.cheeses = [];
    this.cheeseCount = cheeses;
    this.hasDish = dish;
    this.label = label;
    this.origin = origin ? { x: origin.x, z: origin.z } : { x: 0, z: 0 };
    this.group = new THREE.Group();
    if (origin) this.group.position.set(origin.x, 0, origin.z);
    scene.add(this.group);

    // ---- lighting ----
    this.hemi = null; this.key = null; this.rim = null; this.lamp = null;
    if (lamp) {
      // one cage in a grid: lit locally, so its light level is visibly its own
      this.lamp = new THREE.PointLight(0xfff0d8, 1.2, 2.2, 1.6);
      this.lamp.position.set(0, 0.55, 0);
      this.group.add(this.lamp);
    }
    if (!lights) {
      this.lightLevel = 0.35;
      this.buildPlate();
      return;
    }
    this.hemi = new THREE.HemisphereLight(0x9ab4d4, 0x141a22, 0.8);
    scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xfff0d8, 1.9);
    this.key = key;
    key.position.set(0.8, 1.5, 0.75);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -0.9; key.shadow.camera.right = 0.9;
    key.shadow.camera.top = 0.9; key.shadow.camera.bottom = -0.9;
    key.shadow.camera.near = 0.2; key.shadow.camera.far = 4;
    key.shadow.bias = -0.0008;
    key.shadow.radius = 2.5;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8fb6ff, 0.45);
    fill.position.set(-1, 0.8, -0.6);
    scene.add(fill);
    const rim = new THREE.PointLight(0x4dd4c0, 0.5, 3);
    rim.position.set(0, 0.6, -0.8);
    scene.add(rim);
    this.rim = rim;
    this.lightLevel = 0.35;

    this.buildPlate();
  }

  /** everything that is not the scene-wide light rig */
  buildPlate() {
    const scene = this.scene;
    // ---- plate ----
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(SIZE, 0.03, SIZE),
      new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.92, metalness: 0 }),
    );
    plate.position.y = -0.015;
    plate.receiveShadow = true;
    this.plate = plate;
    this.group.add(plate);

    // plate skirt / table
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(SIZE + 0.05, 0.05, SIZE + 0.05),
      new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.8 }),
    );
    skirt.position.y = -0.055;
    this.group.add(skirt);

    // ---- walls ----
    const wmat = new THREE.MeshStandardMaterial({
      color: 0x3c4a5c, roughness: 0.4, metalness: 0.1,
      transparent: true, opacity: 0.44, side: THREE.DoubleSide,
    });
    const T = 0.012;
    const walls = [
      [SIZE + T, WALL_H, T, 0, WALL_H / 2, this.half],
      [SIZE + T, WALL_H, T, 0, WALL_H / 2, -this.half],
      [T, WALL_H, SIZE + T, this.half, WALL_H / 2, 0],
      [T, WALL_H, SIZE + T, -this.half, WALL_H / 2, 0],
    ];
    for (const [w, h, d, x, y, z] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wmat);
      m.position.set(x, y, z);
      this.group.add(m);
      // bright top rail so the boundary reads clearly
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.004, d),
        new THREE.MeshStandardMaterial({ color: 0x5f7a92, roughness: 0.5 }),
      );
      rail.position.set(x, h, z);
      this.group.add(rail);
    }

    // ---- polarising cue card (anchors the head-direction compass) ----
    this.cueAngle = 0;
    this.cue = new THREE.Group();
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, WALL_H * 0.8),
      new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.85, side: THREE.DoubleSide, emissive: 0x223044, emissiveIntensity: 0.6 }),
    );
    card.position.set(0, WALL_H * 0.45, -this.half + 0.008);
    this.cue.add(card);
    this.group.add(this.cue);

    // ---- value-map overlay ----
    const vc = document.createElement('canvas');
    vc.width = vc.height = 32;
    this.valueCanvas = vc;
    this.valueTex = new THREE.CanvasTexture(vc);
    this.valueTex.colorSpace = THREE.SRGBColorSpace;
    this.valueMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE, SIZE),
      new THREE.MeshBasicMaterial({ map: this.valueTex, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.valueMesh.rotation.x = -Math.PI / 2;
    this.valueMesh.position.y = 0.0015;
    this.valueMesh.visible = false;
    this.group.add(this.valueMesh);

    // ---- path trail ----
    const tg = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(TRAIL_MAX * 3);
    this.trailCol = new Float32Array(TRAIL_MAX * 3);
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    tg.setDrawRange(0, 0);
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, toneMapped: false }));
    this.trail.frustumCulled = false;
    this.trailN = 0;
    this.group.add(this.trail);

    // ---- replay ghost (hippocampal sequence during a sharp-wave ripple) ----
    const rg = new THREE.BufferGeometry();
    this.replayPos = new Float32Array(64 * 3);
    rg.setAttribute('position', new THREE.BufferAttribute(this.replayPos, 3));
    rg.setDrawRange(0, 0);
    this.replayLine = new THREE.Line(rg, new THREE.LineBasicMaterial({ color: 0xd55181, transparent: true, opacity: 0.9, toneMapped: false }));
    this.replayLine.frustumCulled = false;
    this.replayLine.visible = false;
    this.group.add(this.replayLine);
    this.replayDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xe8749d, transparent: true, opacity: 0.95, toneMapped: false }),
    );
    this.replayDot.visible = false;
    this.group.add(this.replayDot);

    // ---- decoded-position marker (what the place cells say) ----
    this.decoded = new THREE.Mesh(
      new THREE.RingGeometry(0.022, 0.028, 24),
      new THREE.MeshBasicMaterial({ color: 0x4dd4c0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.decoded.rotation.x = -Math.PI / 2;
    this.decoded.position.y = 0.004;
    this.group.add(this.decoded);

    // ---- water dish -------------------------------------------------
    // A cage can be run without one, which is the point of the dry box in a
    // grid: the animals in it have to go and find water somewhere else.
    this.dish = this.hasDish === false ? null : { ...DISH };
    const dishGrp = new THREE.Group();
    dishGrp.visible = this.hasDish !== false;
    dishGrp.position.set(DISH.x, 0, DISH.z);
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(DISH.r, DISH.r * 0.86, 0.016, 28, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x5a6675, roughness: 0.45, metalness: 0.25, side: THREE.DoubleSide }),
    );
    bowl.position.y = 0.008;
    bowl.castShadow = true;
    dishGrp.add(bowl);
    this.dishWater = new THREE.Mesh(
      new THREE.CircleGeometry(DISH.r * 0.93, 28),
      new THREE.MeshStandardMaterial({
        color: 0x2f7fb8, roughness: 0.08, metalness: 0.5,
        transparent: true, opacity: 0.82,
        emissive: 0x0d2c45, emissiveIntensity: 0.6,
      }),
    );
    this.dishWater.rotation.x = -Math.PI / 2;
    this.dishWater.position.y = 0.0135;
    dishGrp.add(this.dishWater);
    this.group.add(dishGrp);

    // ---- floodable water surface over the whole arena ----------------
    this.waterLevel = 0;
    const wgeo = new THREE.PlaneGeometry(SIZE, SIZE, 30, 30);
    this.waterBase = Float32Array.from(wgeo.attributes.position.array);
    this.water = new THREE.Mesh(wgeo, new THREE.MeshStandardMaterial({
      color: 0x2b6f9e, roughness: 0.06, metalness: 0.55,
      transparent: true, opacity: 0.58, side: THREE.DoubleSide,
      emissive: 0x08202f, emissiveIntensity: 0.5,
    }));
    this.water.rotation.x = -Math.PI / 2;
    this.water.visible = false;
    this.group.add(this.water);

    this.plumeTex = plumeTexture();
    for (let i = 0; i < (this.cheeseCount ?? 3); i++) this.addCheese(this.randomSpot(MOUSE_START));
  }

  // ------------------------------------------------------------- cheese
  addCheese(pos) {
    const g = makeCheese();
    const p = pos || this.randomSpot();
    g.position.set(p.x, 0.016, p.z);
    const plume = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ map: this.plumeTex, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    plume.rotation.x = -Math.PI / 2;
    plume.position.set(p.x, 0.003, p.z);
    this.group.add(g);
    this.group.add(plume);
    const c = { mesh: g, plume, x: p.x, z: p.z, spin: Math.random() * 6.28, eaten: 0 };
    this.cheeses.push(c);
    return c;
  }

  randomSpot(away) {
    const m = this.half - 0.12;
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() * 2 - 1) * m, z = (Math.random() * 2 - 1) * m;
      if (away && Math.hypot(x - away.x, z - away.z) < 0.35) continue;
      let ok = true;
      for (const c of this.cheeses) if (!c.eaten && Math.hypot(x - c.x, z - c.z) < 0.3) ok = false;
      if (ok) return { x, z };
    }
    return { x: (Math.random() * 2 - 1) * m, z: (Math.random() * 2 - 1) * m };
  }

  /** returns the cheese eaten this frame, or null */
  tryEat(mx, mz, mouthReach = 0.055) {
    for (const c of this.cheeses) {
      if (c.eaten) continue;
      if (Math.hypot(c.x - mx, c.z - mz) < mouthReach) {
        c.eaten = 1;
        return c;
      }
    }
    return null;
  }

  // ------------------------------------------------------------- per frame
  update(dt, t, mouse, brain) {
    // cheese bob + respawn after being eaten
    for (let i = this.cheeses.length - 1; i >= 0; i--) {
      const c = this.cheeses[i];
      c.spin += dt * 0.7;
      if (c.eaten) {
        c.eaten += dt * 3.2;
        const k = Math.max(0, 1 - (c.eaten - 1));
        c.mesh.scale.setScalar(k);
        c.mesh.position.y = 0.016 + (1 - k) * 0.05;
        c.plume.material.opacity = 0.45 * k;
        if (c.eaten > 2) {
          this.group.remove(c.mesh, c.plume);
          c.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
          this.cheeses.splice(i, 1);
          this.addCheese(this.randomSpot({ x: mouse.x, z: mouse.z }));
        }
        continue;
      }
      c.mesh.position.y = 0.017 + Math.sin(t * 1.9 + c.spin) * 0.003;
      c.mesh.rotation.z += dt * 0.25;
      // the plume breathes with the sniff rhythm, scaled by how close the nose is
      const d = Math.hypot(c.x - mouse.x, c.z - mouse.z);
      const near = Math.max(0, 1 - d / 0.7);
      c.plume.material.opacity = 0.14 + 0.3 * near * (0.55 + 0.45 * Math.sin(brain.sniffPhase));
      c.plume.scale.setScalar(1 + 0.08 * Math.sin(brain.sniffPhase * 0.5));
    }

    // water surface ripples - recomputing 961 vertices and their normals every
    // frame is wasted work for a 1.6 mm ripple, so run it at ~20 Hz
    this.waterAcc = (this.waterAcc || 0) + dt;
    if (this.water.visible && this.waterAcc > 0.05) {
      this.waterAcc = 0;
      const pos = this.water.geometry.attributes.position;
      const b = this.waterBase;
      for (let i = 0; i < pos.count; i++) {
        const x = b[i * 3], y = b[i * 3 + 1];
        pos.array[i * 3 + 2] = Math.sin(x * 11 + t * 1.9) * 0.0016
                             + Math.sin(y * 13 - t * 1.4) * 0.0016;
      }
      pos.needsUpdate = true;
      this.waterNormalTick = (this.waterNormalTick || 0) + 1;
      if (this.waterNormalTick % 3 === 0) this.water.geometry.computeVertexNormals();
    }
    this.dishWater.position.y = 0.0135 + Math.sin(t * 1.3) * 0.0004;

    // trail
    if (this.trailN === 0 || Math.hypot(mouse.x - this.lastTX, mouse.z - this.lastTZ) > 0.008) {
      this.pushTrail(mouse.x, mouse.z, mouse.speed);
      this.lastTX = mouse.x; this.lastTZ = mouse.z;
    }

    // decoded position from the place-cell population
    const dec = brain.decodedPosition();
    if (dec) {
      this.decoded.position.x += (dec.x - this.decoded.position.x) * Math.min(1, dt * 12);
      this.decoded.position.z += (dec.z - this.decoded.position.z) * Math.min(1, dt * 12);
      const err = Math.hypot(dec.x - mouse.x, dec.z - mouse.z);
      this.decoded.material.opacity = 0.25 + 0.6 * Math.max(0, 1 - err / 0.4);
    }

    // replay ghost
    const rip = brain.ripple;
    if (rip.active && rip.path.length > 1) {
      const n = Math.min(64, rip.path.length);
      for (let i = 0; i < n; i++) {
        const p = rip.path[Math.floor((i / (n - 1)) * (rip.path.length - 1))];
        this.replayPos[i * 3] = p.x;
        this.replayPos[i * 3 + 1] = 0.006;
        this.replayPos[i * 3 + 2] = p.z;
      }
      this.replayLine.geometry.setDrawRange(0, n);
      this.replayLine.geometry.attributes.position.needsUpdate = true;
      this.replayLine.visible = true;
      this.replayLine.material.opacity = 0.35 + 0.6 * rip.env;
      if (rip.virt) {
        this.replayDot.position.set(rip.virt.x, 0.016, rip.virt.z);
        this.replayDot.visible = true;
        this.replayDot.scale.setScalar(0.6 + rip.env * 1.1);
      }
    } else {
      this.replayLine.visible = false;
      this.replayDot.visible = false;
    }
  }

  pushTrail(x, z, speed) {
    const i = this.trailN % TRAIL_MAX;
    this.trailPos[i * 3] = x;
    this.trailPos[i * 3 + 1] = 0.002;
    this.trailPos[i * 3 + 2] = z;
    // teal when slow, amber when running (written linear: the material is not tone-mapped)
    const k = Math.min(1, speed / 0.35);
    this.trailCol[i * 3] = 0.077 + 0.92 * k;
    this.trailCol[i * 3 + 1] = 0.66 - 0.19 * k;
    this.trailCol[i * 3 + 2] = 0.54 - 0.47 * k;
    this.trailN++;
    const n = Math.min(this.trailN, TRAIL_MAX);
    this.trail.geometry.setDrawRange(0, n);
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.color.needsUpdate = true;
  }

  clearTrail() {
    this.trailN = 0;
    this.trail.geometry.setDrawRange(0, 0);
  }

  /** paint the learned value function onto the floor */
  drawValue(field) {
    const g = this.valueCanvas.getContext('2d');
    const B = field.bins, peak = Math.max(field.peak, 1e-4);
    const img = g.createImageData(B, B);
    for (let i = 0; i < B * B; i++) {
      const v = Math.max(0, field.data[i]) / peak;
      // sequential, one hue; zero recedes into the floor
      const t = Math.pow(v, 0.75);
      const [r, gg, b] = ramp(SEQ_VALUE, t);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = gg;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255 * Math.min(1, t * 1.3);
    }
    g.putImageData(img, 0, 0);
    this.valueTex.needsUpdate = true;
  }

  /** 0 = dark (mice are nocturnal and prefer this), 1 = brightly lit */
  setLight(v) {
    this.lightLevel = Math.max(0, Math.min(1, v));
    const k = this.lightLevel;
    if (this.lamp) this.lamp.intensity = 0.25 + 2.6 * k;
    // a cage without the global rig still has to look lit or unlit
    if (this.plate && this.plate.material) {
      this.plate.material.emissive.setRGB(0.05 * k, 0.05 * k, 0.045 * k);
      this.plate.material.emissiveIntensity = 0.4 + 1.6 * k;
    }
    if (!this.hemi) return;
    this.hemi.intensity = 0.35 + 1.5 * k;
    this.key.intensity = 0.8 + 3.1 * k;
    this.rim.intensity = 0.55 - 0.35 * k;
    this.scene.background.setRGB(0.027 + 0.1 * k, 0.038 + 0.12 * k, 0.055 + 0.14 * k);
    if (this.scene.fog) this.scene.fog.color.copy(this.scene.background);
  }

  /** world position of a point given in this cage's local coordinates */
  toWorld(x, z) { return { x: x + this.origin.x, z: z + this.origin.z }; }

  /** 0 = dry, 1 = deep enough to swim in */
  setWater(v) {
    this.waterLevel = Math.max(0, Math.min(1, v));
    this.water.visible = this.waterLevel > 0.012;
    this.water.position.y = 0.002 + this.waterLevel * 0.055;
    this.water.material.opacity = 0.3 + 0.34 * this.waterLevel;
  }

  /** is the nose at drinkable water? */
  atWater(x, z) {
    if (this.waterLevel > 0.04) return true;
    if (!this.dish) return false;
    return Math.hypot(x - this.dish.x, z - this.dish.z) < this.dish.r;
  }

  rotateCue(rad) {
    this.cueAngle += rad;
    this.cue.rotation.y = this.cueAngle;
  }

  reset() {
    this.clearTrail();
    for (const c of this.cheeses) {
      this.group.remove(c.mesh, c.plume);
    }
    this.cheeses.length = 0;
    for (let i = 0; i < (this.cheeseCount ?? 3); i++) this.addCheese(this.randomSpot(MOUSE_START));
  }
}

export { SIZE as ARENA_SIZE, WALL_H };
