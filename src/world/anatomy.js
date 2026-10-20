/** Procedural, schematic anatomy attached to the same joints as the visible mouse. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Mouse } from './mouse.js';

export const ANATOMY_PARTS = [
  ['skull', 'skeleton', 'Skull & jaw', '#eadfc4', 'Cranium, snout, jaw, and incisors.'],
  ['spine', 'skeleton', 'Vertebral column', '#e6d8b5', 'Supports the trunk and surrounds the spinal cord.'],
  ['ribs', 'skeleton', 'Ribs & sternum', '#eee4cb', 'The rib cage surrounds the heart and lungs.'],
  ['pelvis', 'skeleton', 'Pelvis', '#d8c7a0', 'Connects the hindlimbs to the axial skeleton.'],
  ['forelimbs', 'skeleton', 'Forelimb bones', '#efe3c6', 'Humerus, radius, ulna, and paw bones.'],
  ['hindlimbs', 'skeleton', 'Hindlimb bones', '#e2d2ac', 'Femur, tibia, fibula, and paw bones.'],
  ['tail', 'skeleton', 'Tail vertebrae', '#d9cdae', 'A flexible continuation of the vertebral column.'],
  ['heart', 'organs', 'Heart', '#d55364', 'Pumps blood through the pulmonary and systemic circuits.'],
  ['lungs', 'organs', 'Lungs', '#d995ae', 'Gas exchange occurs in the lungs.'],
  ['liver', 'organs', 'Liver', '#9c5660', 'A lobed organ in the upper abdomen.'],
  ['stomach', 'organs', 'Stomach', '#e4b386', 'Receives food before it enters the intestine.'],
  ['intestine', 'organs', 'Intestines', '#d79677', 'Digestive loops occupy much of the abdomen.'],
  ['kidneys', 'organs', 'Kidneys & bladder', '#b66b80', 'Kidneys filter blood; urine drains to the bladder.'],
  ['arteries', 'circulation', 'Systemic arteries', '#ef6472', 'The aorta and branches carry blood away from the heart. Red indicates oxygenated blood.'],
  ['veins', 'circulation', 'Systemic veins', '#659ce5', 'Venae cavae and branches return blood to the heart. Blue indicates deoxygenated blood.'],
  ['pulmonary', 'circulation', 'Pulmonary circuit', '#b48add', 'Blue pulmonary arteries lead to the lungs; red pulmonary veins return to the heart.'],
  ['brain', 'nervous', 'Brain', '#e1b86a', 'A simplified outline of the brain inside the skull.'],
  ['cord', 'nervous', 'Spinal cord', '#eccf6c', 'Runs within the vertebral column.'],
  ['nerves', 'nervous', 'Peripheral nerves', '#c9b66c', 'Schematic branches extend toward the limbs.'],
].map(([id, layer, label, color, description]) => ({ id, layer, label, color, description }));

const sphere = new THREE.SphereGeometry(1, 16, 10);
const up = new THREE.Vector3(0, 1, 0);
const position = (array) => new THREE.Vector3(...array);

export class MouseAnatomy {
  constructor(scene) {
    this.mouse = new Mouse(scene, { half: .6 }); this.mouse.setAutopilot(false);
    this.mouse.root.position.set(0, .019, 0); this.mouse.root.rotation.set(0, 0, 0);
    this.poseNodes = [];
    const collect = (node, path) => {
      if (path.length) this.poseNodes.push({ node, path });
      node.children.forEach((child, index) => collect(child, [...path, index]));
    };
    collect(this.mouse.root, []);
    this.skin = [];
    this.mouse.root.traverse((node) => {
      if (!node.isMesh && !node.isLine) return;
      if (node.isLine) { node.visible = false; return; }
      node.material = new THREE.MeshStandardMaterial({ color: 0x90b4bd, transparent: true,
        opacity: .075, depthWrite: false, roughness: .9, side: THREE.DoubleSide });
      node.renderOrder = 3; this.skin.push(node);
    });
    this.parts = new Map(ANATOMY_PARTS.map((part) => [part.id, { ...part, meshes: [],
      material: new THREE.MeshStandardMaterial({ color: part.color, roughness: .67 }) }]));
    this.flow = []; this.tailBones = [];
    this.makeSkeleton(); this.makeOrgans(); this.makeCirculation(); this.makeNervous();
    this.mergeStaticParts();
    this.setLayers(['skeleton']);
  }

  mergeStaticParts() {
    const moving = new Set([this.heart, ...this.lungs, ...this.tailBones, ...this.flow.map((entry) => entry.bead)]);
    for (const part of this.parts.values()) {
      const first = part.meshes[0];
      part.anchor = new THREE.Object3D(); part.anchor.position.copy(first.position); first.parent.add(part.anchor);
      const groups = new Map(), keep = [];
      for (const mesh of part.meshes) {
        if (moving.has(mesh)) { keep.push(mesh); continue; }
        const key = `${mesh.parent.uuid}:${mesh.material.uuid}`;
        if (!groups.has(key)) groups.set(key, { parent: mesh.parent, material: mesh.material, meshes: [] });
        groups.get(key).meshes.push(mesh);
      }
      for (const { parent, material, meshes } of groups.values()) {
        const geometries = meshes.map((mesh) => { mesh.updateMatrix(); return mesh.geometry.clone().applyMatrix4(mesh.matrix); });
        const merged = new THREE.Mesh(mergeGeometries(geometries), material);
        merged.userData.anatomyPart = part.id; parent.add(merged); keep.push(merged);
        meshes.forEach((mesh) => parent.remove(mesh)); geometries.forEach((geometry) => geometry.dispose());
      }
      part.meshes = keep;
    }
  }

  material(id) { return this.parts.get(id).material; }
  add(id, parent, geometry, material = this.material(id)) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.anatomyPart = id; parent.add(mesh); this.parts.get(id).meshes.push(mesh);
    return mesh;
  }
  oval(id, parent, at, scale, material) {
    const mesh = this.add(id, parent, sphere, material);
    mesh.position.set(...at); mesh.scale.set(...scale); return mesh;
  }
  pipe(id, parent, points, radius = .0007, material) {
    const curve = new THREE.CatmullRomCurve3(points.map(position));
    const mesh = this.add(id, parent, new THREE.TubeGeometry(curve, 24, radius, 6, false), material);
    return { mesh, curve };
  }
  bone(id, parent, from, to, radius = .0009) {
    const a = position(from), b = position(to), direction = b.clone().sub(a);
    const mesh = this.add(id, parent, new THREE.CylinderGeometry(radius * .85, radius, direction.length(), 8));
    mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(up, direction.normalize());
    this.oval(id, parent, from, [radius * 1.4, radius * 1.4, radius * 1.4]);
    return mesh;
  }

  makeSkeleton() {
    const m = this.mouse;
    this.oval('skull', m.head, [0, .001, -.002], [.0093, .008, .0098]);
    this.oval('skull', m.head, [0, -.001, .009], [.0047, .0032, .0096]);
    const socket = new THREE.MeshStandardMaterial({ color: 0x3f4545, roughness: .9 });
    for (const side of [-1, 1]) {
      this.oval('skull', m.head, [side * .0085, .0015, .004], [.0016, .003, .0035], socket);
      this.pipe('skull', m.jaw, [[side * .007, .001, -.001], [side * .006, -.003, .008], [side * .002, -.002, .016]], .001);
      this.bone('skull', m.head, [side * .006, 0, .003], [side * .004, -.001, .015], .0007);
      this.oval('skull', m.jaw, [side * .001, -.001, .017], [.0007, .0016, .0007]);
    }
    for (let i = 0; i < 7; i++) this.oval('spine', m.neck, [0, .002, -.012 + i * .002], [.0022, .002, .0011]);
    for (let i = 0; i < 13; i++) {
      const z = .023 - i * .0023;
      this.oval('spine', m.chest, [0, .005, z], [.002, .0022, .0011]);
      const width = .007 + Math.sin((i + 1) / 14 * Math.PI) * .004;
      for (const side of [-1, 1]) this.pipe('ribs', m.chest, [[0, .005, z],
        [side * width * .8, .003, z - .001], [side * width, -.003, z - .0015],
        [side * width * .65, -.009, z - .002], [side * .001, -.01, z - .0015]], .0004);
    }
    this.bone('ribs', m.chest, [0, -.01, -.004], [0, -.01, .023], .00065);
    for (let i = 0; i < 8; i++) this.oval('spine', m.pelvis, [0, .005, .015 - i * .004], [.0025, .0023, .0016]);
    for (const side of [-1, 1]) {
      const hip = this.oval('pelvis', m.pelvis, [side * .007, 0, -.001], [.004, .006, .012]);
      hip.rotation.z = side * .4;
      this.bone('pelvis', m.pelvis, [side * .01, 0, -.002], [0, -.005, -.013], .0013);
      this.oval('forelimbs', m.chest, [side * .008, .001, .018], [.004, .006, .004]);
    }
    for (const leg of m.legs) {
      const id = leg.hind ? 'hindlimbs' : 'forelimbs';
      this.bone(id, leg.hip, [0, 0, 0], [0, -leg.L1, 0], leg.hind ? .00125 : .00085);
      for (const side of [-1, 1]) this.bone(id, leg.knee, [side * .0008, 0, 0],
        [side * .0005, -leg.L2, 0], leg.hind ? .0007 : .0005);
      this.oval(id, leg.knee, [0, 0, 0], [.0018, .0018, .0018]);
      for (let digit = 0; digit < 5; digit++) {
        const x = (digit - 2) * .0011, length = leg.hind ? leg.L3 * .9 : .005;
        this.bone(id, leg.paw, [x * .4, 0, 0], [x, -.0003, length * .7], .00035);
        this.bone(id, leg.paw, [x, -.0003, length * .7], [x * 1.15, -.0005, length], .00025);
      }
    }
    for (let i = 0; i < 26; i++) this.tailBones.push(this.oval('tail', m.pelvis,
      [0, -.005, -.022 - i / 26 * .08], [.0015, .0015, .0013]));
  }

  makeOrgans() {
    const m = this.mouse;
    this.heart = this.oval('heart', m.chest, [.001, -.005, .014], [.004, .0047, .0052]);
    this.heart.rotation.z = -.25;
    this.lungs = [];
    this.lungs.push(this.oval('lungs', m.chest, [.006, -.001, .012], [.0047, .006, .010]));
    for (let i = 0; i < 4; i++) this.lungs.push(this.oval('lungs', m.chest,
      [-.005 - (i === 3 ? .001 : 0), -.001 + (i % 2) * .002, .022 - i * .0055], [.0045, .0048, .0049]));
    this.pipe('lungs', m.chest, [[0, .002, .027], [0, .001, .018], [.004, 0, .012]], .0008,
      new THREE.MeshStandardMaterial({ color: 0xc9d1cc, roughness: .7 }));
    for (const side of [-1, 1]) this.oval('liver', m.chest, [side * .005, -.003, -.004], [.007, .0044, .0065]);
    this.oval('stomach', m.chest, [.006, -.003, -.014], [.0055, .0054, .007]);
    for (let row = 0; row < 5; row++) this.pipe('intestine', m.chest, [
      [-.009, -.005, -.014 - row * .0045], [-.004, -.007, -.017 - row * .0045],
      [.004, -.007, -.014 - row * .0045], [.009, -.004, -.017 - row * .0045]], .0012);
    this.oval('intestine', m.chest, [-.006, -.003, -.031], [.0048, .004, .008]);
    for (const side of [-1, 1]) {
      const z = -.018 + (side < 0 ? .003 : 0);
      this.oval('kidneys', m.chest, [side * .008, .003, z], [.0034, .004, .0055]);
      this.pipe('kidneys', m.chest, [[side * .007, .001, z], [side * .004, -.002, -.028], [0, -.005, -.037]], .00035);
    }
    this.oval('kidneys', m.chest, [0, -.005, -.037], [.0032, .003, .004]);
    this.heartBase = this.heart.scale.clone(); this.lungBases = this.lungs.map((mesh) => mesh.scale.clone());
  }

  vessel(id, parent, points, radius = .00065, material, reverse = false) {
    const { curve } = this.pipe(id, parent, points, radius, material);
    const bead = this.oval(id, parent, points[0], [radius * 1.35, radius * 1.35, radius * 1.35],
      new THREE.MeshBasicMaterial({ color: 0xffe6b0 }));
    this.flow.push({ bead, curve, reverse, offset: this.flow.length * .137 });
  }
  makeCirculation() {
    const m = this.mouse;
    for (const [id, side] of [['arteries', -.0016], ['veins', .0016]]) {
      const reverse = id === 'veins';
      this.vessel(id, m.chest, [[side, -.002, .015], [side, .004, .009], [side, .003, -.012], [side, .002, -.037]], .00075, undefined, reverse);
      this.vessel(id, m.chest, [[side, -.002, .015], [side * 1.8, .003, .025], [side, .006, .036]], .00055, undefined, reverse);
      for (const sign of [-1, 1]) {
        this.vessel(id, m.chest, [[side, .003, -.017], [sign * .004, .003, -.017], [sign * .008, .003, -.018]], .00045, undefined, reverse);
        this.vessel(id, m.chest, [[side, .003, .013], [sign * .007, .001, .018], [sign * .0115, -.005, .022]], .0005, undefined, reverse);
        this.vessel(id, m.pelvis, [[side, .003, -.005], [sign * .008, 0, -.007], [sign * .0135, -.003, -.012]], .0005, undefined, reverse);
      }
      for (const leg of m.legs) for (const [parent, length] of [[leg.hip, leg.L1], [leg.knee, leg.L2]]) {
        this.vessel(id, parent, [[side, 0, .001], [side, -length * .5, .0012], [side, -length, .001]], .00035, undefined, reverse);
      }
    }
    for (const sign of [-1, 1]) {
      this.vessel('pulmonary', m.chest, [[-.001, -.003, .016], [sign * .003, 0, .017], [sign * .006, .001, .016]], .0006, this.material('veins'));
      this.vessel('pulmonary', m.chest, [[sign * .006, .001, .012], [sign * .004, -.001, .012], [.001, -.003, .015]], .0006, this.material('arteries'));
    }
  }

  makeNervous() {
    const m = this.mouse;
    for (const side of [-1, 1]) {
      this.oval('brain', m.head, [side * .0034, .003, -.002], [.0043, .0047, .0069]);
      this.oval('brain', m.head, [side * .0025, .002, -.009], [.0033, .0032, .0028]);
    }
    this.pipe('cord', m.chest, [[0, .005, .034], [0, .005, .014], [0, .005, -.012], [0, .005, -.035]], .0008);
    for (const leg of m.legs) {
      const node = leg.hind ? m.pelvis : m.chest;
      this.pipe('nerves', node, [[0, .005, leg.z], [leg.x * .6, .002, leg.z], [leg.x, leg.y, leg.z]], .00035);
      for (const [parent, length] of [[leg.hip, leg.L1], [leg.knee, leg.L2]])
        this.pipe('nerves', parent, [[.0015, 0, -.001], [.0015, -length * .5, -.001], [.0015, -length, -.001]], .0003);
    }
  }

  setLayers(layers, skin = true) {
    this.layers = new Set(layers);
    for (const part of this.parts.values()) {
      const ghostBones = layers.length > 1 && part.layer === 'skeleton';
      part.material.transparent = ghostBones; part.material.opacity = ghostBones ? .22 : 1;
      part.material.depthWrite = !ghostBones;
      for (const mesh of part.meshes) mesh.visible = this.layers.has(part.layer);
    }
    for (const mesh of this.skin) mesh.visible = skin;
  }
  select(id) {
    for (const part of this.parts.values()) {
      part.material.emissive.set(part.id === id ? part.color : 0x000000);
      part.material.emissiveIntensity = part.id === id ? .35 : 0;
    }
  }

  sync(agent, animate = true) {
    const source = agent.mouse;
    if (!agent.hasRig || !animate) return;
    for (const { node, path } of this.poseNodes) {
      let from = source.root;
      for (const index of path) from = from?.children[index];
      if (!from) continue;
      node.position.copy(from.position); node.quaternion.copy(from.quaternion); node.scale.copy(from.scale);
    }
    this.mouse.root.position.set(0, .019, 0); this.mouse.root.rotation.set(0, 0, 0);
    const sourcePositions = source.tail.geometry.attributes.position;
    this.mouse.tail.geometry.attributes.position.array.set(sourcePositions.array);
    this.mouse.tail.geometry.attributes.position.needsUpdate = true;
    this.mouse.tail.geometry.computeVertexNormals();
    for (let i = 0; i < this.tailBones.length; i++) {
      const index = i * (source.tail.sides + 1), bone = this.tailBones[i];
      bone.position.set((sourcePositions.getX(index) + sourcePositions.getX(index + 4)) / 2,
        (sourcePositions.getY(index) + sourcePositions.getY(index + 4)) / 2, sourcePositions.getZ(index));
      const taper = 1 - i / 28; bone.scale.set(.0016 * taper, .0016 * taper, .0012);
    }
    const t = agent.brain.t, alive = !agent.dead;
    this.heart.scale.copy(this.heartBase).multiplyScalar(1 + (alive ? Math.sin(t * 14) * .08 : 0));
    this.lungs.forEach((lung, i) => lung.scale.copy(this.lungBases[i]).multiplyScalar(1 + (alive ? Math.sin(agent.brain.sniffPhase) * .035 : 0)));
    for (const { bead, curve, reverse, offset } of this.flow) {
      const phase = ((alive ? t * .65 : 0) + offset) % 1;
      bead.position.copy(curve.getPointAt(reverse ? 1 - phase : phase));
    }
    this.simTime = t;
  }
}
