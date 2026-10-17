/**
 * The 3-D brain panel: real Allen CCFv3 structure meshes, lit by the live
 * firing rate of the population that region holds.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ROLES, GROUPS } from '../neuro/regions.js';

const SCALE = 1 / 50;   // stored ints are 1/50 mm

function labelSprite(text) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 44;
  const g = c.getContext('2d');
  g.font = '600 26px ui-monospace, monospace';
  g.fillStyle = 'rgba(150,175,200,0.85)';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 22);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.scale.set(3.2, 1.1, 1);
  return s;
}

export class BrainView {
  constructor(canvas, tipEl) {
    this.canvas = canvas;
    this.tipEl = tipEl;
    this.regions = {};
    this.selected = null;
    this.hovered = null;
    this.onSelect = null;
    this.ready = false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 500);
    this.camera.position.set(10.5, 6.5, 14.5);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 9;
    this.controls.maxDistance = 60;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.42;

    this.scene.add(new THREE.HemisphereLight(0xa8c4e0, 0x0a0e14, 0.75));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.0); d1.position.set(1, 1.2, 1.4);
    const d2 = new THREE.DirectionalLight(0x7aa8ff, 0.45); d2.position.set(-1.2, -0.4, -1);
    this.scene.add(d1, d2);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-9, -9);
    this.pickable = [];

    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.pointerPx = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.pointerInside = true;
      this.controls.autoRotate = false;
      this.idle = 0;
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer.set(-9, -9);
      this.pointerInside = false;
      this.hovered = null;
      if (this.tipEl) this.tipEl.style.display = 'none';
    });
    canvas.addEventListener('click', () => {
      if (this.hovered) this.select(this.hovered);
    });
    this.idle = 0;
    this.pointerInside = false;
    this.pickAcc = 0;
  }

  async load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`cannot load brain data (${res.status}) from ${url}`);
    const data = await res.json();
    this.data = data;

    // Building 38 meshes (and computing their normals) in one go blocks the main
    // thread for long enough to look like a hang, so yield between small batches.
    const entries = Object.entries(data.regions);
    let built = 0;
    for (const [acr, r] of entries) {
      const geo = new THREE.BufferGeometry();
      const n = r.positions.length / 3;
      const pos = new Float32Array(r.positions.length);
      for (let i = 0; i < r.positions.length; i++) pos[i] = r.positions[i] * SCALE;
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(r.indices);
      geo.computeVertexNormals();

      const isRoot = acr === 'root';
      const base = new THREE.Color(r.color);
      const role = ROLES[acr];
      const mat = isRoot
        ? new THREE.MeshStandardMaterial({
            color: 0x9fbada, transparent: true, opacity: 0.055, roughness: 0.45,
            side: THREE.DoubleSide, depthWrite: false,
          })
        : new THREE.MeshStandardMaterial({
            color: base.clone().multiplyScalar(0.34),
            emissive: base, emissiveIntensity: 0.06,
            roughness: 0.52, metalness: 0.06,
            transparent: true, opacity: 0.95,
          });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = isRoot ? 3 : 1;
      mesh.userData = { acr, name: r.name, id: r.id, base, group: role?.group };
      this.root.add(mesh);
      if (!isRoot) this.pickable.push(mesh);
      this.regions[acr] = { mesh, mat, base, info: r, act: 0 };
      // Yield to the event loop (not to the next animation frame - that would
      // tie loading to the frame rate and take seconds on a slow GPU).
      if (++built % 6 === 0) {
        if (this.onProgress) this.onProgress(built, entries.length);
        await new Promise((res) => setTimeout(res, 0));
      }
    }

    // selection highlight
    this.halo = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.22 }),
    );
    this.halo.visible = false;
    this.root.add(this.halo);

    // anatomical orientation cues
    const a = labelSprite('anterior'); a.position.set(0, 2.2, -7.6); this.root.add(a);
    const d = labelSprite('dorsal'); d.position.set(0, 6.6, 1.2); this.root.add(d);

    this.ready = true;
    return data;
  }

  select(acr) {
    this.selected = acr;
    const r = this.regions[acr];
    if (r) {
      const c = r.info.centroid;
      const box = new THREE.Box3().setFromObject(r.mesh);
      const sz = box.getSize(new THREE.Vector3());
      this.halo.visible = true;
      this.halo.position.set(c[0], c[1], c[2]);
      this.halo.scale.set(Math.max(sz.x, 0.6) * 0.62, Math.max(sz.y, 0.6) * 0.62, Math.max(sz.z, 0.6) * 0.62);
    }
    if (this.onSelect) this.onSelect(acr);
  }

  /** @param {Object<string,number>} act acronym -> 0..1 activation */
  update(dt, act, brain) {
    if (!this.ready) return;
    this.idle += dt;
    if (this.idle > 6) this.controls.autoRotate = true;

    for (const [acr, r] of Object.entries(this.regions)) {
      if (acr === 'root') continue;
      const target = act[acr] ?? 0;
      r.act += (target - r.act) * Math.min(1, dt * 10);
      const a = r.act;
      r.mat.emissiveIntensity = 0.05 + a * a * 2.9;
      r.mat.color.copy(r.base).multiplyScalar(0.28 + a * 0.72);
      r.mat.opacity = 0.82 + a * 0.18;
      if (acr === this.selected) r.mat.emissiveIntensity += 0.35;
    }

    // ripple: flash the hippocampal trio
    if (brain?.ripple?.active) {
      for (const acr of ['CA1', 'CA3', 'DG']) {
        const r = this.regions[acr];
        if (r) r.mat.emissiveIntensity += 2.2 * brain.ripple.env;
      }
    }

    if (this.halo.visible) {
      const p = 1 + 0.035 * Math.sin(performance.now() * 0.004);
      this.halo.scale.multiplyScalar(p / (this.haloP || 1));
      this.haloP = p;
    }

    // Hover picking ray-tests every region mesh, so only do it while the pointer
    // is actually over this canvas, and at most ~16 times a second.
    this.pickAcc += dt;
    if (this.pointerInside && this.pickAcc > 0.06) {
      this.pickAcc = 0;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.pickable, false);
      this.hovered = hits.length ? hits[0].object.userData.acr : null;
      this.canvas.style.cursor = this.hovered ? 'pointer' : 'grab';
    }
    const hit = this.pointerInside ? this.hovered : null;
    if (this.tipEl) {
      if (hit && this.pointerPx) {
        const r = this.regions[hit];
        const pops = brain?.byRegion?.[hit] || [];
        const hz = pops.length ? pops.reduce((s, p) => s + p.smooth, 0) / pops.length : 0;
        this.tipEl.style.display = 'block';
        this.tipEl.style.left = `${this.pointerPx.x}px`;
        this.tipEl.style.top = `${this.pointerPx.y}px`;
        this.tipEl.innerHTML = `<b style="color:${r.info.color}">${hit}</b> &nbsp;${hz.toFixed(1)} Hz`;
      } else {
        this.tipEl.style.display = 'none';
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    // only touch the drawing buffer when the size really changed
    if (w === this._w && h === this._h && dpr === this._dpr) return;
    this._w = w; this._h = h; this._dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

export { GROUPS };
