import * as THREE from 'three';

import { COAT_ALLELES } from './genetics.js';
export const COATS = COAT_ALLELES;

let furMap, tailMap;
export function mouseTorsoGeometry(segments = 28) {
  const profile = [[.0005, -.056], [.007, -.051], [.012, -.042], [.0155, -.027],
    [.0146, -.010], [.0128, .005], [.0095, .018], [.0045, .028], [.0006, .030]];
  const geometry = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  geometry.rotateX(Math.PI / 2); geometry.scale(1, .86, 1);
  return geometry;
}

export function mouseMuzzleGeometry(segments = 24) {
  const geometry = new THREE.LatheGeometry([[.0078, 0], [.0078, .003], [.0074, .006], [.0068, .009],
    [.0058, .012], [.0043, .0148], [.0026, .0168], [.0013, .0178], [.0002, .0185]]
    .map(([r, z]) => new THREE.Vector2(r, z)), segments);
  geometry.rotateX(Math.PI / 2); geometry.scale(.9, .65, 1);
  return geometry;
}

export function furTexture() {
  if (furMap) return furMap;
  const size = 128, data = new Uint8Array(size * size * 4);
  let seed = 15431;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = (seed >>> 24) / 255;
    const previous = y ? data[((y - 1) * size + x) * 4] : 225;
    const value = Math.round(previous * .6 + (205 + grain * 50) * .4);
    const offset = (y * size + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  furMap = new THREE.DataTexture(data, size, size);
  furMap.wrapS = furMap.wrapT = THREE.RepeatWrapping;
  furMap.repeat.set(3, 3); furMap.colorSpace = THREE.SRGBColorSpace;
  furMap.magFilter = THREE.LinearFilter; furMap.minFilter = THREE.LinearMipmapLinearFilter;
  furMap.generateMipmaps = true; furMap.needsUpdate = true;
  return furMap;
}

export function tailTexture() {
  if (tailMap) return tailMap;
  const data = new Uint8Array(16 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 16; x++) {
    const offset = (y * 16 + x) * 4;
    const shade = y % 5 === 0 ? 197 : 230 + (x % 3) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = shade; data[offset + 3] = 255;
  }
  tailMap = new THREE.DataTexture(data, 16, 128);
  tailMap.needsUpdate = true; tailMap.magFilter = THREE.LinearFilter;
  return tailMap;
}

/** A shallow ear cup in the XY plane, open toward +Z. */
export function earGeometry(radius, segments = 24, rings = 6) {
  const positions = [], uv = [], indices = [];
  for (let ring = 0; ring <= rings; ring++) for (let i = 0; i <= segments; i++) {
    const r = radius * ring / rings, angle = i / segments * Math.PI * 2;
    positions.push(Math.cos(angle) * r, Math.sin(angle) * r * 1.08, -.0015 * (1 - (ring / rings) ** 2));
    uv.push(.5 + Math.cos(angle) * ring / rings / 2, .5 + Math.sin(angle) * ring / rings / 2);
    if (ring < rings && i < segments) {
      const a = ring * (segments + 1) + i, b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

/** Connected tapering rings; the same geometry is deformed rather than rebuilt. */
export class MouseTail {
  constructor(parent) {
    this.rings = 26; this.sides = 8;
    const positions = new Float32Array((this.rings + 1) * (this.sides + 1) * 3);
    const uv = [], indices = [];
    for (let ring = 0; ring <= this.rings; ring++) for (let side = 0; side <= this.sides; side++) {
      uv.push(side / this.sides, ring / this.rings);
      if (ring < this.rings && side < this.sides) {
        const a = ring * (this.sides + 1) + side, b = a + this.sides + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    this.geometry = geometry;
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb99c91, map: tailTexture(), roughness: .86 }));
    this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.update(0, 0, 0, 0, 0, 0);
  }

  update(phase, speed, turning, aggression, fear, rear, freeze = 0) {
    const attribute = this.geometry.getAttribute('position');
    for (let ring = 0; ring <= this.rings; ring++) {
      const f = ring / this.rings, envelope = f * f;
      const x = (Math.sin(phase * .5 - f * 2.2) * (.002 + .006 * speed) * envelope
        + turning * .004 * f + Math.sin(phase * 2) * aggression * .008 * envelope) * (1 - freeze);
      const y = -.004 - .012 * Math.sin(f * Math.PI / 2) + rear * f * .008 + speed * envelope * .002 - fear * f * .001;
      const z = -.022 - f * .08;
      const radius = .0026 * (1 - f) ** .85 + .00022;
      for (let side = 0; side <= this.sides; side++) {
        const angle = side / this.sides * Math.PI * 2;
        attribute.setXYZ(ring * (this.sides + 1) + side, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, z);
      }
    }
    attribute.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
