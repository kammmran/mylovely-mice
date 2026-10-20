import { DEFAULT_WORLD, WORLD_SETTINGS_KEY, validateWorldSettings, positiveInteger } from '../world/settings.js';

export function mountColonySetup({ settings, grid, getAgent, addMice, onOpen = () => {} }) {
  const panel = document.createElement('div'); panel.className = 'float'; panel.id = 'colony-setup'; panel.style.display = 'none';
  panel.innerHTML = `<h5 data-fold>Colony setup <button data-act="close">×</button></h5><div class="body setup-body">
    <section><h3>Start a new colony</h3><p>Choose the cage count. This starts a fresh session and clears its mice, family history, and report.</p>
      <form id="world-settings-form">
        <label class="field">Number of cages<input id="world-cages" type="number" min="1" step="1" required value="${settings.cages}"></label>
        <label class="field">Starting mice per cage <span class="setup-optional">optional</span><input id="world-mice" type="number" min="1" step="1" placeholder="Use each cage’s default" value="${settings.micePerCage ?? ''}"></label>
        <label class="field">Mutation chance per inherited allele (%)<input id="world-mutation" type="number" min="0" max="100" step="0.1" required value="${settings.mutationRate * 100}"></label>
        <p class="setup-note">Default: 9 cages. Cages repeat the habitat conditions in a grid. Mutation rates and traits are illustrative model settings.</p>
        <div class="setup-actions"><button type="button" id="world-defaults">Use defaults</button><button type="submit" class="setup-primary">Start new colony</button></div>
        <p id="world-error" class="setup-error" role="alert"></p>
      </form>
    </section>
    <section><h3>Add mice to this session</h3><p>Population has no fixed cap. Mice and rendering capacity grow as needed; practical capacity depends on your device.</p>
      <form id="add-mice-form"><label class="field">Cage<select id="add-mice-cage">${grid.boxes.map((box) => `<option value="${box.id}">${box.cond.name}</option>`).join('')}</select></label>
        <label class="field">Number of mice<input id="add-mice-count" type="number" min="1" step="1" value="10" required></label>
        <label class="field">Sex<select id="add-mice-sex"><option value="mixed">Mixed · male and female</option><option value="M">Males</option><option value="F">Females</option></select></label>
        <div class="setup-actions"><button type="submit" class="setup-primary" id="add-mice-submit">Add mice</button><button type="button" id="add-mice-cancel" hidden>Stop adding</button></div>
        <p id="add-mice-status" role="status"></p>
      </form>
    </section></div>`;
  document.body.appendChild(panel);
  const $ = (id) => panel.querySelector(`#${id}`);
  let cancel = false, adding = false;
  panel.querySelector('[data-act="close"]').onclick = () => open(false);
  $('world-defaults').onclick = () => {
    $('world-cages').value = DEFAULT_WORLD.cages; $('world-mice').value = ''; $('world-mutation').value = DEFAULT_WORLD.mutationRate * 100;
    $('world-error').textContent = '';
  };
  $('world-settings-form').onsubmit = (event) => {
    event.preventDefault();
    try {
      const next = validateWorldSettings({ cages: $('world-cages').value, micePerCage: $('world-mice').value,
        mutationRate: Number($('world-mutation').value) / 100 });
      localStorage.setItem(WORLD_SETTINGS_KEY, JSON.stringify(next)); location.reload();
    } catch (error) { $('world-error').textContent = error.message; }
  };
  $('add-mice-cancel').onclick = () => { cancel = true; };
  $('add-mice-form').onsubmit = async (event) => {
    event.preventDefault(); if (adding) return;
    try {
      const count = positiveInteger($('add-mice-count').value, 'Mouse count');
      adding = true; cancel = false; $('add-mice-submit').disabled = true; $('add-mice-cancel').hidden = false;
      const added = await addMice(count, Number($('add-mice-cage').value), $('add-mice-sex').value,
        (done) => { $('add-mice-status').textContent = `Added ${done.toLocaleString()} of ${count.toLocaleString()} mice…`; }, () => cancel);
      $('add-mice-status').textContent = `${added.toLocaleString()} mice added${cancel ? ' · stopped' : ''}.`;
    } catch (error) { $('add-mice-status').textContent = error.message; }
    finally { adding = false; $('add-mice-submit').disabled = false; $('add-mice-cancel').hidden = true; }
  };
  function open(force = true) {
    panel.style.display = force ? 'flex' : 'none';
    document.getElementById('b-colony-setup')?.setAttribute('aria-pressed', String(force));
    if (force) { panel.removeAttribute('data-collapsed'); $('add-mice-cage').value = getAgent().box.id; onOpen(panel); }
  }
  return { open, isOpen: () => panel.style.display !== 'none' };
}
