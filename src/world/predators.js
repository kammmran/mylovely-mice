import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { predatorPose } from './threatmodel.js';

const sphere = new THREE.SphereGeometry(1, 18, 12);
const fur = (color) => new THREE.MeshStandardMaterial({ color, roughness: .92 });
function oval(parent, material, position, scale) {
  const mesh = new THREE.Mesh(sphere, material);
  mesh.position.set(...position); mesh.scale.set(...scale); mesh.castShadow = true;
  parent.add(mesh); return mesh;
}
function tube(parent, material, points, radius) {
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p))), 20, radius, 6, false), material);
  mesh.castShadow = true; parent.add(mesh); return mesh;
}
function triangle(width, height, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0); shape.lineTo(0, height); shape.lineTo(width / 2, 0); shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .003,
    bevelThickness: .002, bevelSegments: 1, steps: 1 });
}

/** Procedural animal props, created only when a predator is first presented. */
export class PredatorVisuals {
  constructor(parent) {
    this.group = new THREE.Group(); parent.add(this.group);
    this.cat = this.makeCat(); this.owl = this.makeOwl();
    this.cat.visible = this.owl.visible = false;
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x151519, transparent: true,
      opacity: .22, depthWrite: false, side: THREE.DoubleSide });
    this.shadow = new THREE.Group(); this.shadow.visible = false;
    oval(this.shadow, shadowMat, [0, 0, 0], [.052, .001, .095]);
    for (const side of [-1, 1]) {
      const wing = oval(this.shadow, shadowMat, [side * .13, 0, -.012], [.18, .001, .055]);
      wing.rotation.y = side * -.22;
    }
    this.shadow.position.y = .004; parent.add(this.shadow);
  }

  makeCat() {
    const root = new THREE.Group(); this.group.add(root);
    const coat = fur(0x77766e), dark = fur(0x393b3b), cream = fur(0xdad3c3), pink = fur(0x977d7b);
    const eye = new THREE.MeshStandardMaterial({ color: 0xb6c765, roughness: .26 });
    oval(root, coat, [0, .115, -.035], [.068, .077, .145]);
    oval(root, cream, [0, .087, .063], [.044, .048, .062]);
    this.catLegs = [];
    for (const side of [-1, 1]) for (const z of [-.115, .065]) {
      const leg = new THREE.Group(); leg.position.set(side * .046, .085, z); root.add(leg);
      oval(leg, coat, [0, -.027, 0], [.022, .052, .024]);
      oval(leg, cream, [0, -.071, .013], [.024, .013, .035]);
      this.catLegs.push(leg);
    }
    this.catHead = new THREE.Group(); this.catHead.position.set(0, .15, .105); root.add(this.catHead);
    oval(this.catHead, coat, [0, 0, 0], [.058, .052, .048]);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(triangle(.046, .058, .014), coat);
      ear.position.set(side * .035, .025, -.012); ear.rotation.z = -side * .18; this.catHead.add(ear);
      const inner = new THREE.Mesh(triangle(.027, .036, .002), pink);
      inner.position.set(side * .035, .033, .007); inner.rotation.z = -side * .18; this.catHead.add(inner);
      oval(this.catHead, cream, [side * .019, -.018, .038], [.025, .017, .021]);
      const iris = oval(this.catHead, eye, [side * .029, .006, .037], [.015, .011, .007]);
      iris.rotation.y = side * .25;
      oval(this.catHead, dark, [side * .029, .006, .043], [.0025, .009, .0025]);
      for (let i = 0; i < 3; i++) tube(this.catHead, cream, [
        [side * .022, -.018, .053], [side * .06, -.012 + i * .007, .055],
        [side * (.09 + i * .007), -.022 + i * .018, .04]], .0007);
      for (let i = 0; i < 3; i++) {
        const stripe = oval(root, dark, [side * .062, .136, -.12 + i * .067], [.006, .045, .012]);
        stripe.rotation.x = -.35;
      }
      oval(this.catHead, dark, [side * .016, .036, .028], [.006, .018, .005]);
    }
    oval(this.catHead, pink, [0, -.014, .058], [.009, .006, .004]);
    tube(this.catHead, dark, [[0, -.019, .056], [0, -.028, .055], [.012, -.031, .052]], .001);
    this.catTail = new THREE.Group(); this.catTail.position.set(0, .13, -.16); root.add(this.catTail);
    tube(this.catTail, coat, [[0, 0, 0], [.025, .025, -.065], [.05, .085, -.12], [.025, .12, -.14]], .012);
    tube(this.catTail, dark, [[.05, .085, -.12], [.042, .11, -.135], [.025, .12, -.14]], .0123);
    return root;
  }

  makeOwl() {
    const root = new THREE.Group(); this.group.add(root);
    const brown = fur(0x78604a), dark = fur(0x453c34), light = fur(0xd5c9ab), face = fur(0xeee2c6);
    const amber = new THREE.MeshStandardMaterial({ color: 0xd9a83b, roughness: .3 });
    oval(root, brown, [0, 0, -.018], [.061, .061, .105]);
    oval(root, light, [0, -.034, .012], [.047, .033, .077]);
    oval(root, brown, [0, .025, .075], [.073, .06, .055]);
    for (const side of [-1, 1]) {
      const disc = oval(root, dark, [side * .032, .031, .116], [.037, .042, .012]); disc.rotation.z = -side * .14;
      oval(root, face, [side * .032, .031, .123], [.031, .035, .009]);
      oval(root, amber, [side * .03, .037, .133], [.013, .014, .005]);
      oval(root, dark, [side * .03, .037, .137], [.008, .011, .003]);
      oval(root, face, [side * .027, .041, .14], [.002, .003, .001]);
      const tuft = new THREE.Mesh(triangle(.027, .043, .014), brown);
      tuft.position.set(side * .052, .063, .073); tuft.rotation.z = -side * .3; root.add(tuft);
      tube(root, dark, [[side * .022, -.045, .034], [side * .023, -.076, .05], [side * .023, -.079, .071]], .005);
      for (const offset of [-.007, 0, .007]) tube(root, dark, [
        [side * .023 + offset, -.076, .05], [side * .023 + offset, -.084, .07],
        [side * .023 + offset, -.082, .081]], .002);
    }
    const beak = new THREE.Mesh(new THREE.ConeGeometry(.012, .034, 8), dark);
    beak.position.set(0, .008, .132); beak.rotation.x = -.3; root.add(beak);
    this.owlWings = [];
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group(); hinge.position.set(side * .044, .012, 0); root.add(hinge);
      const cover = oval(hinge, brown, [side * .09, 0, -.015], [.13, .022, .06]);
      cover.rotation.y = side * -.22;
      for (const [material, count, length, width] of [[dark, 9, .145, .016], [light, 8, .09, .013]]) {
        const feathers = [];
        for (let i = 0; i < count; i++) {
          const g = sphere.clone(); g.scale(width, .007, length / 2);
          g.rotateY(side * (.25 + i * .055));
          g.translate(side * (.045 + i * .025), -.004, -.047 - i * .006);
          feathers.push(g);
        }
        const mesh = new THREE.Mesh(mergeGeometries(feathers), material); mesh.castShadow = true; hinge.add(mesh);
        feathers.forEach((g) => g.dispose());
      }
      this.owlWings.push(hinge);
    }
    for (let i = -2; i <= 2; i++) {
      const tail = oval(root, i % 2 ? light : brown, [i * .013, -.005, -.12], [.013, .009, .07]);
      tail.rotation.y = i * .1;
    }
    return root;
  }

  update(predator) {
    this.cat.visible = predator?.key === 'cat'; this.owl.visible = predator?.key === 'owl';
    this.shadow.visible = this.owl.visible;
    if (!predator) return;
    const { key, t, dur } = predator, pose = predatorPose(key, t, dur);
    const root = key === 'cat' ? this.cat : this.owl;
    root.position.set(pose.x, pose.y, pose.z); root.rotation.y = pose.heading;
    if (key === 'cat') {
      this.catHead.rotation.y = Math.sin(t * .85) * .16;
      this.catHead.rotation.x = .08 + Math.sin(t * 2) * .025;
      this.catTail.rotation.z = Math.sin(t * 2.4) * .2;
      this.catTail.rotation.y = Math.sin(t * 1.5) * .25;
      this.catLegs.forEach((leg, i) => { leg.rotation.x = Math.sin(t * 6 + i * Math.PI) * .1 * (1 - pose.approach); });
    } else {
      root.rotation.x = Math.cos(pose.progress * Math.PI) * .16;
      root.rotation.z = Math.sin(pose.progress * Math.PI * 2) * .12;
      this.owlWings.forEach((wing, i) => { wing.rotation.z = (i ? -1 : 1) * (.12 + Math.sin(t * 8) * .25); });
      this.shadow.position.set(pose.x, .004, pose.z); this.shadow.rotation.y = pose.heading;
      this.shadow.scale.setScalar(.65 + .35 * pose.approach);
      this.shadow.children[0].material.opacity = .12 + .16 * pose.approach;
    }
  }
}
