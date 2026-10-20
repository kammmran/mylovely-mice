import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MouseAnatomy, ANATOMY_PARTS } from '../world/anatomy.js';

const LAYERS = [
  { id: 'skeleton', label: 'Skeleton', hint: 'Bones follow this mouse’s live joints.' },
  { id: 'organs', label: 'Organs', hint: 'Explore the thorax and abdomen. Rotate to see beneath each organ.' },
  { id: 'circulation', label: 'Blood system', hint: 'Red: oxygenated · blue: deoxygenated. Flow is slowed for visibility.' },
  { id: 'nervous', label: 'Nerves', hint: 'Brain, spinal cord, and schematic peripheral branches.' },
  { id: 'overview', label: 'All systems', hint: 'Bones, organs, vessels, and nerves shown together.' },
];

export function mountAnatomy({ getAgent, ensureRig, getPaused }) {
  const panel = document.createElement('div');
  panel.id = 'anatomy'; panel.className = 'float'; panel.style.display = 'none';
  panel.innerHTML = `<h5 data-fold>Mouse anatomy <button data-act="close" aria-label="Close Mouse anatomy">×</button></h5>
    <div class="body anatomy-body">
      <div class="anatomy-subject"><div><strong id="an-name"></strong><span id="an-state"></span></div><span id="an-live" class="anatomy-live">Live</span></div>
      <div class="anatomy-tabs" role="tablist" aria-label="Anatomy systems">${LAYERS.map((layer, index) =>
        `<button role="tab" id="an-tab-${layer.id}" data-layer="${layer.id}" aria-selected="${index === 0}" aria-controls="an-view" tabindex="${index === 0 ? 0 : -1}">${layer.label}</button>`).join('')}</div>
      <div id="an-view" role="tabpanel" aria-labelledby="an-tab-skeleton">
        <div class="anatomy-stage"><canvas id="an-canvas" aria-label="Interactive mouse anatomy. Drag to rotate; scroll or pinch to zoom."></canvas>
          <div id="an-labels" aria-label="Visible anatomy labels"></div><span class="anatomy-drag-hint">Drag to rotate · scroll to zoom</span></div>
        <p id="an-hint" class="anatomy-hint"></p>
      </div>
      <div class="anatomy-options"><label><input type="checkbox" id="an-skin" checked> Body outline</label><label><input type="checkbox" id="an-label-toggle" checked> Labels</label><label><input type="checkbox" id="an-motion" checked> Follow movement</label></div>
      <div class="anatomy-camera" aria-label="Anatomy viewing angle"><span>View</span><button data-view="side">Side</button><button data-view="top">Top</button><button data-view="front">Front</button><button data-view="reset">Reset</button></div>
      <div id="an-parts" class="anatomy-parts" aria-label="Choose an anatomical structure"></div>
      <div id="an-detail" class="anatomy-detail" role="status"><strong>Select a structure</strong><p>Choose a label or a structure in the model to learn more.</p></div>
      <p class="anatomy-note">Schematic anatomy · organ size and pulses are illustrative. <a href="https://www.informatics.jax.org/cookbook/contents.shtml" target="_blank" rel="noopener noreferrer">Anatomy reference ↗</a></p>
    </div>`;
  document.body.appendChild(panel);
  const $ = (selector) => panel.querySelector(selector);
  const canvas = $('#an-canvas'), stage = $('.anatomy-stage');
  let model, renderer, scene, camera, controls, currentAgent, layer = 'skeleton', selected = null;
  let accumulated = 0;
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), point = new THREE.Vector3();
  const labels = new Map();
  const isOpen = () => panel.style.display !== 'none';
  const visible = () => isOpen() && !panel.hasAttribute('data-collapsed');

  function size() {
    if (!renderer || !visible()) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      const oldFit = Math.max(1, 1.6 / camera.aspect);
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      if (controls) camera.position.sub(controls.target).multiplyScalar(Math.max(1, 1.6 / camera.aspect) / oldFit).add(controls.target);
    }
  }
  function view(angle = 'reset') {
    if (!camera) return;
    camera.up.set(0, 1, 0);
    controls.target.set(0, .014, -.026);
    const views = { side: [.17, .045, 0], top: [0, .32, 0], front: [0, .06, .19], reset: [.17, .055, .06] };
    camera.position.copy(controls.target).add(new THREE.Vector3(...views[angle]).multiplyScalar(Math.max(1, 1.6 / camera.aspect)));
    if (angle === 'top') camera.up.set(0, 0, 1);
    controls.update();
  }
  function ensureScene() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b1720);
    scene.add(new THREE.HemisphereLight(0xdceff4, 0x495a64, 2.3));
    const light = new THREE.DirectionalLight(0xffedce, 2.4); light.position.set(.1, .2, .1); scene.add(light);
    const fill = new THREE.DirectionalLight(0x98d7e9, 1.3); fill.position.set(-.1, .05, -.1); scene.add(fill);
    camera = new THREE.PerspectiveCamera(42, 1, .001, 3);
    controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = .12;
    controls.minDistance = .09; controls.maxDistance = .45; controls.enablePan = false;
    model = new MouseAnatomy(scene);
    applyLayers(); size(); view();
  }
  function select(id) {
    selected = id; model?.select(id);
    const part = ANATOMY_PARTS.find((entry) => entry.id === id);
    if (part) {
      const title = document.createElement('strong'); title.textContent = part.label;
      const description = document.createElement('p'); description.textContent = part.description;
      $('#an-detail').replaceChildren(title, description);
    }
    for (const button of panel.querySelectorAll('[data-part]')) button.setAttribute('aria-pressed', String(button.dataset.part === id));
  }
  function applyLayers() {
    const active = layer === 'overview' ? LAYERS.filter((item) => item.id !== 'overview').map((item) => item.id) : [layer];
    model?.setLayers(active, $('#an-skin').checked);
    const parts = ANATOMY_PARTS.filter((part) => active.includes(part.layer));
    $('#an-parts').replaceChildren(); $('#an-labels').replaceChildren(); labels.clear();
    for (const part of parts) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.part = part.id;
      const swatch = document.createElement('i'); swatch.style.background = part.color; swatch.setAttribute('aria-hidden', 'true');
      button.append(swatch, document.createTextNode(part.label)); button.onclick = () => select(part.id);
      $('#an-parts').appendChild(button);
      // Keep combined views readable; the complete structure list remains below.
      if (layer === 'overview' && !['skull', 'heart', 'kidneys', 'brain'].includes(part.id)) continue;
      const label = document.createElement('button'); label.type = 'button'; label.dataset.part = part.id;
      label.textContent = part.label; label.onclick = () => select(part.id);
      $('#an-labels').appendChild(label); labels.set(part.id, label);
    }
    $('#an-hint').textContent = LAYERS.find((item) => item.id === layer).hint;
    $('#an-view').setAttribute('aria-labelledby', `an-tab-${layer}`);
    for (const tab of panel.querySelectorAll('[data-layer]')) {
      const activeTab = tab.dataset.layer === layer; tab.setAttribute('aria-selected', String(activeTab)); tab.tabIndex = activeTab ? 0 : -1;
    }
    select(parts.some((part) => part.id === selected) ? selected : parts[0].id);
  }
  for (const tab of panel.querySelectorAll('[data-layer]')) {
    tab.onclick = () => { layer = tab.dataset.layer; applyLayers(); };
    tab.onkeydown = (event) => {
      const tabs = [...panel.querySelectorAll('[data-layer]')]; let index = tabs.indexOf(tab);
      if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else return;
      event.preventDefault(); tabs[index].click(); tabs[index].focus();
    };
  }
  $('#an-skin').onchange = applyLayers;
  $('#an-label-toggle').onchange = () => { $('#an-labels').hidden = !$('#an-label-toggle').checked; };
  for (const button of panel.querySelectorAll('[data-view]')) button.onclick = () => view(button.dataset.view);
  $('[data-act="close"]').onclick = () => open(false);
  let down;
  canvas.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY }; });
  canvas.addEventListener('pointerup', (event) => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5 || !model) return;
    const rect = canvas.getBoundingClientRect();
    ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    raycaster.setFromCamera(ndc, camera);
    const meshes = [...model.parts.values()].flatMap((part) => part.meshes.filter((mesh) => mesh.visible));
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (hit) select(hit.object.userData.anatomyPart);
  });
  new ResizeObserver(size).observe(stage);

  function open(force = true) {
    panel.style.display = force ? 'flex' : 'none';
    document.getElementById('b-anatomy')?.setAttribute('aria-pressed', String(force));
    if (force) {
      panel.removeAttribute('data-collapsed');
      const ag = getAgent(); ensureRig(ag); ensureScene(); currentAgent = null;
      update(.05, true); requestAnimationFrame(size);
    }
  }
  function update(dt, force = false) {
    if (!visible() || !renderer) return;
    accumulated += dt; if (accumulated < 1 / 30 && !force) return; accumulated = 0;
    const ag = getAgent();
    const changed = ag !== currentAgent;
    if (changed) { ensureRig(ag); currentAgent = ag; $('#an-name').textContent = `${ag.name} · ${ag.sex === 'F' ? 'Female' : 'Male'}`; }
    const live = $('#an-motion').checked;
    model.sync(ag, live || force || changed);
    $('#an-state').textContent = `${Math.round(ag.ageDays)} days · ${ag.state.toLowerCase()} · ${(Math.abs(ag.mouse.speed) * 100).toFixed(1)} cm/s`;
    $('#an-live').textContent = !live ? 'View frozen' : getPaused() ? 'Paused' : ag.dead ? 'Static' : 'Live';
    $('#an-live').classList.toggle('stopped', !live || getPaused() || ag.dead);
    panel.dataset.mouse = ag.name;
    panel.dataset.pose = model.mouse.legs.map((leg) => leg.hip.rotation.x.toFixed(4)).join(',');
    size(); controls.update(); model.mouse.root.updateMatrixWorld(true);
    const placed = [];
    for (const [id, label] of labels) {
      if ($('#an-labels').hidden) continue;
      const part = model.parts.get(id);
      part.anchor.getWorldPosition(point); point.project(camera);
      let x = (point.x * .5 + .5) * stage.clientWidth, y = (-point.y * .5 + .5) * stage.clientHeight;
      x = Math.max(4, Math.min(stage.clientWidth - label.offsetWidth - 4, x + 8));
      y = Math.max(5, Math.min(stage.clientHeight - 30, y - 8));
      for (let i = 0; i < 8 && placed.some((p) => Math.abs(p.y - y) < 22 && x < p.x + p.width && x + label.offsetWidth > p.x); i++) y += 23;
      label.hidden = y > stage.clientHeight - 32 || point.z > 1;
      label.style.transform = `translate(${x}px, ${y}px)`;
      if (!label.hidden) placed.push({ x, y, width: label.offsetWidth });
    }
    renderer.render(scene, camera);
  }
  return { open, update, isOpen, get model() { return model; }, get panel() { return panel; } };
}
