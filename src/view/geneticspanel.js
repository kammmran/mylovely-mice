import { LOCI, summarizeGenomes } from '../world/genetics.js';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const percent = (value) => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
const colors = ['#8dd5b5', '#81aceb', '#d2a0db', '#dfb77f', '#e8e2cf', '#bd9584'];
const download = (name, contents, type) => {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function chart(cohorts, locus) {
  if (!cohorts.length) return '<p class="gen-empty">No mice recorded in this cage.</p>';
  const x = (index) => cohorts.length < 2 ? 58 : 58 + index / (cohorts.length - 1) * 570;
  const y = (value) => 174 - value * 140;
  return `<svg class="gen-chart" viewBox="0 0 660 214" role="img" aria-label="${escape(locus.label)} allele frequencies by birth generation">
    ${[0, .5, 1].map((value) => `<path d="M58 ${y(value)}H628" stroke="#31434e"/><text x="48" y="${y(value) + 4}" text-anchor="end">${value * 100}%</text>`).join('')}
    ${locus.alleles.map((name, allele) => `<path d="${cohorts.map((cohort, index) => `${index ? 'L' : 'M'}${x(index)},${y(cohort.frequencies[allele])}`).join(' ')}" fill="none" stroke="${colors[allele]}" stroke-width="2.5"/>
      ${cohorts.map((cohort, index) => `<circle cx="${x(index)}" cy="${y(cohort.frequencies[allele])}" r="3.4" fill="${colors[allele]}"><title>G${cohort.generation}, ${escape(name)}: ${percent(cohort.frequencies[allele])}, ${cohort.n} mice</title></circle>`).join('')}`).join('')}
    ${cohorts.filter((_, index) => index === 0 || index === cohorts.length - 1 || index % Math.ceil(cohorts.length / 10) === 0).map((cohort) => `<text x="${x(cohorts.indexOf(cohort))}" y="198" text-anchor="middle">G${cohort.generation}</text>`).join('')}
    </svg><div class="gen-legend">${locus.alleles.map((label, index) => `<span><i style="background:${colors[index]}"></i>${escape(label)}</span>`).join('')}</div>`;
}

export function mountGenetics({ genetics, grid, getAgent, getTime, startPregnancy, watchMouse, onOpen = () => {} }) {
  const panel = document.createElement('div'); panel.id = 'genetics'; panel.className = 'float'; panel.style.display = 'none';
  panel.innerHTML = `<h5 data-fold>Genetics & families <button data-act="close">×</button></h5><div class="body genetics-body">
    <p class="gen-intro">Follow inherited alleles from both parents, compare generations, and see how each cage’s population changes.</p>
    <div class="gen-controls"><label class="field">Cage<select id="gn-cage">${grid.boxes.map((box) => `<option value="${box.id}">${escape(box.cond.name)}</option>`).join('')}</select></label>
      <label class="field">Modeled locus<select id="gn-locus">${LOCI.map((locus) => `<option value="${locus.id}">${locus.label}</option>`).join('')}</select></label></div>
    <div id="gn-stats" class="gen-stats"></div>
    <div class="gen-tabs" role="tablist" aria-label="Genetics views">${[['generations', 'Generations'], ['family', 'Family tree'], ['compare', 'Compare cages']].map(([id, label], index) => `<button role="tab" id="gn-tab-${id}" data-gen-tab="${id}" aria-controls="gn-${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${label}</button>`).join('')}</div>
    <section id="gn-generations" role="tabpanel" aria-labelledby="gn-tab-generations"><div id="gn-chart"></div><div id="gn-cohorts" class="gen-table-wrap"></div>
      <p class="gen-help">G0 contains founders and introduced mice. Later generations contain offspring born in this cage, including those that later moved or died. A mouse inherits alleles at conception; its cage does not rewrite its genes.</p>
      <details class="gen-breeding"><summary>Choose a breeding pair</summary><p>Start a pregnancy between living adult mice in this cage. Gestation and pup development continue at the simulation speed.</p>
        <form id="gn-breed"><div class="gen-controls"><label class="field">Mother<select id="gn-mother"></select></label><label class="field">Father<select id="gn-father"></select></label></div><button type="submit" class="gen-primary" id="gn-breed-submit">Start pregnancy</button><p id="gn-breed-status" role="status"></p></form></details>
    </section>
    <section id="gn-family" role="tabpanel" aria-labelledby="gn-tab-family" hidden><div class="gen-family-tools"><input type="search" id="gn-search" placeholder="Search all mice by name or ID" aria-label="Search mice and ancestors"><button id="gn-observed">Use observed mouse</button></div>
      <div id="gn-mouse-list" class="gen-mouse-list"></div><div class="gen-pager"><button id="gn-previous">Previous</button><span id="gn-page"></span><button id="gn-next">Next</button></div>
      <div id="gn-pedigree"></div><div id="gn-genotype" class="gen-table-wrap"></div></section>
    <section id="gn-compare" role="tabpanel" aria-labelledby="gn-tab-compare" hidden><p class="gen-help">Living mice and pups currently in each cage. Changes from its G0 baseline reflect inheritance, survival, migration, mutation, and chance.</p><div id="gn-comparison" class="gen-table-wrap"></div><div class="gen-pager"><button id="gn-cage-previous">Previous</button><span id="gn-cage-page"></span><button id="gn-cage-next">Next</button></div></section>
    <div class="gen-exports"><button id="gn-export-json">Download family data</button><button id="gn-export-csv">Download generation CSV</button></div>
    <p class="gen-note">Simplified independent loci with illustrative effects, not identified mouse genes. Current mutation chance: <span id="gn-rate"></span> per inherited allele.</p>
    </div>`;
  document.body.appendChild(panel);
  const $ = (id) => panel.querySelector(`#${id}`);
  let tab = 'generations', selected = null, page = 0, cagePage = 0, childPage = 0, elapsed = 0, lastRevision = -1, parentSignature = '';
  const locus = () => LOCI.find((entry) => entry.id === $('gn-locus').value);
  const cageId = () => Number($('gn-cage').value);
  const isOpen = () => panel.style.display !== 'none';
  const table = (headers, rows) => `<table><thead><tr>${headers.map((header) => `<th>${escape(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const familyButton = (record, role = '') => record ? `<button class="gen-relative${record.id === selected ? ' selected' : ''}" data-relative="${record.id}"><small>${escape(role || record.id)} · G${record.generation}</small><strong>${escape(record.name)}</strong><span>${record.sex === 'M' ? 'Male' : 'Female'} · ${record.alive && record.removedAt == null ? record.stage : record.diedAt != null ? 'died' : 'removed'}</span></button>` : '<div class="gen-unknown">Parent not recorded</div>';

  function renderParents() {
    const adults = grid.boxes[cageId()].agents.filter((agent) => !agent.dead && agent.mature);
    const signature = adults.map((agent) => `${agent.id}:${agent.brain.pregnant}`).join(',');
    if (signature === parentSignature) return; parentSignature = signature;
    for (const [id, sex] of [['gn-mother', 'F'], ['gn-father', 'M']]) {
      const select = $(id), before = select.value;
      const eligible = adults.filter((agent) => agent.sex === sex && (sex !== 'F' || !agent.brain.pregnant));
      select.innerHTML = eligible.map((agent) => `<option value="${agent.id}">${escape(agent.name)} · G${agent.genetics.generation}</option>`).join('') || '<option value="">No eligible mouse</option>';
      if (eligible.some((agent) => agent.id === before)) select.value = before;
    }
    $('gn-breed-submit').disabled = !$('gn-mother').value || !$('gn-father').value;
  }
  function renderGenerations() {
    const selectedLocus = locus(), cohorts = genetics.generations(cageId(), selectedLocus.id);
    $('gn-chart').innerHTML = chart(cohorts, selectedLocus);
    $('gn-cohorts').innerHTML = table(['Generation', 'Recorded', 'Still living', ...selectedLocus.alleles, 'New mutations'], cohorts.map((cohort) => [
      `G${cohort.generation}`, cohort.n, cohort.living, ...cohort.frequencies.map(percent), cohort.mutations]));
    if (cohorts.length === 1) $('gn-chart').insertAdjacentHTML('beforeend', '<p class="gen-empty">Founders only so far. Choose a breeding pair below, or let mice mate naturally, to follow the next generation.</p>');
    renderParents();
  }
  function renderFamily() {
    const query = $('gn-search').value.trim().toLowerCase();
    const records = [...genetics.records.values()].filter((record) => `${record.name} ${record.id}`.toLowerCase().includes(query));
    const pages = Math.max(1, Math.ceil(records.length / 12)); page = Math.min(page, pages - 1);
    $('gn-mouse-list').innerHTML = records.slice(page * 12, page * 12 + 12).map((record) => familyButton(record)).join('') || '<p class="gen-empty">No matching mice.</p>';
    $('gn-page').textContent = `${page + 1} / ${pages} · ${records.length} recorded`;
    $('gn-previous').disabled = page === 0; $('gn-next').disabled = page === pages - 1;
    const record = genetics.records.get(selected) || getAgent().genetics; selected = record.id;
    const children = record.children.map((id) => genetics.records.get(id));
    const childPages = Math.max(1, Math.ceil(children.length / 8)); childPage = Math.min(childPage, childPages - 1);
    $('gn-pedigree').innerHTML = `<h3>Family of ${escape(record.name)} <small>${record.id}</small></h3><div class="gen-parents">${familyButton(genetics.records.get(record.motherId), 'Mother')}${familyButton(genetics.records.get(record.fatherId), 'Father')}</div>
      <div class="gen-descent" aria-hidden="true">↓</div><div class="gen-selected">${familyButton(record, 'Selected mouse')}<button id="gn-watch">Watch this mouse</button></div>
      <h4>${children.length} offspring</h4><div class="gen-children">${children.slice(childPage * 8, childPage * 8 + 8).map((child) => familyButton(child, 'Offspring')).join('') || '<p class="gen-empty">No offspring recorded yet.</p>'}</div>
      ${childPages > 1 ? `<div class="gen-pager"><button data-children="-1" ${childPage === 0 ? 'disabled' : ''}>Previous offspring</button><span>${childPage + 1} / ${childPages}</span><button data-children="1" ${childPage === childPages - 1 ? 'disabled' : ''}>Next offspring</button></div>` : ''}`;
    const present = grid.boxes.some((box) => box.agents.some((agent) => agent.id === selected && !agent.dead));
    $('gn-watch').disabled = !present; $('gn-watch').onclick = () => watchMouse(selected);
    $('gn-genotype').innerHTML = `<h4>Inherited alleles · G${record.generation}</h4>${record.motherId ? '' : '<p class="gen-help">Founder alleles have no recorded parents.</p>'}` + table(['Modeled locus', 'Maternal allele', 'Paternal allele', 'New mutation'], LOCI.map((entry) => {
      const changes = record.mutations.filter((mutation) => mutation.locus === entry.id);
      return [escape(entry.label), escape(entry.alleles[record.genome[entry.id][0]]), escape(entry.alleles[record.genome[entry.id][1]]),
        changes.map((change) => `${change.parent}: ${escape(entry.alleles[change.from])} → ${escape(entry.alleles[change.to])}`).join('<br>') || '—'];
    }));
  }
  function renderComparison() {
    const selectedLocus = locus(), pages = Math.max(1, Math.ceil(grid.boxes.length / 20)); cagePage = Math.min(cagePage, pages - 1);
    $('gn-comparison').innerHTML = table(['Cage', 'Living', ...selectedLocus.alleles, `Δ ${selectedLocus.alleles[0]} vs G0`], grid.boxes.slice(cagePage * 20, cagePage * 20 + 20).map((box) => {
      const current = summarizeGenomes(genetics.living(box.id), selectedLocus.id);
      const baseline = genetics.generations(box.id, selectedLocus.id).find((cohort) => cohort.generation === 0);
      const change = current.n && baseline ? (current.frequencies[0] - baseline.frequencies[0]) * 100 : null;
      return [`<button class="gen-cage-link" data-gen-cage="${box.id}">${escape(box.cond.name)}</button>`, current.n, ...current.frequencies.map(percent), change == null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(1)} pp`];
    }));
    $('gn-cage-page').textContent = `${cagePage + 1} / ${pages}`;
    $('gn-cage-previous').disabled = cagePage === 0; $('gn-cage-next').disabled = cagePage === pages - 1;
  }
  function render() {
    const records = [...genetics.records.values()].filter((record) => record.birthCage === cageId());
    const generation = records.reduce((max, record) => Math.max(max, record.generation), 0);
    $('gn-stats').innerHTML = [[genetics.living(cageId()).length, 'Living mice + pups'], [generation, 'Latest generation'],
      [records.filter((record) => record.motherId).length, 'Offspring born'], [records.reduce((sum, record) => sum + record.mutations.length, 0), 'New mutations']]
      .map(([value, label]) => `<div><strong>${value.toLocaleString()}</strong><span>${label}</span></div>`).join('');
    $('gn-rate').textContent = percent(genetics.mutationRate);
    if (tab === 'generations') renderGenerations(); else if (tab === 'family') renderFamily(); else renderComparison();
    lastRevision = genetics.revision;
  }
  function switchTab(id) {
    tab = id;
    for (const button of panel.querySelectorAll('[data-gen-tab]')) {
      const active = button.dataset.genTab === id; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
      $(`gn-${button.dataset.genTab}`).hidden = !active;
    }
    render();
  }
  for (const button of panel.querySelectorAll('[data-gen-tab]')) {
    button.onclick = () => switchTab(button.dataset.genTab);
    button.onkeydown = (event) => {
      const buttons = [...panel.querySelectorAll('[data-gen-tab]')]; let index = buttons.indexOf(button);
      if (event.key === 'ArrowRight') index = (index + 1) % buttons.length;
      else if (event.key === 'ArrowLeft') index = (index + buttons.length - 1) % buttons.length;
      else if (event.key === 'Home') index = 0; else if (event.key === 'End') index = buttons.length - 1; else return;
      event.preventDefault(); buttons[index].click(); buttons[index].focus();
    };
  }
  $('gn-cage').onchange = () => { parentSignature = ''; render(); };
  $('gn-locus').onchange = render;
  $('gn-search').oninput = () => { page = 0; renderFamily(); };
  $('gn-observed').onclick = () => { selected = getAgent().id; childPage = 0; render(); };
  $('gn-previous').onclick = () => { page--; renderFamily(); }; $('gn-next').onclick = () => { page++; renderFamily(); };
  $('gn-cage-previous').onclick = () => { cagePage--; renderComparison(); }; $('gn-cage-next').onclick = () => { cagePage++; renderComparison(); };
  panel.addEventListener('click', (event) => {
    const relative = event.target.closest('[data-relative]');
    if (relative) { selected = relative.dataset.relative; childPage = 0; renderFamily(); }
    const offspring = event.target.closest('[data-children]');
    if (offspring) { childPage += Number(offspring.dataset.children); renderFamily(); }
    const cage = event.target.closest('[data-gen-cage]');
    if (cage) { $('gn-cage').value = cage.dataset.genCage; parentSignature = ''; switchTab('generations'); }
  });
  $('gn-breed').onsubmit = (event) => {
    event.preventDefault();
    try {
      const agents = grid.boxes[cageId()].agents;
      const count = startPregnancy(agents.find((agent) => agent.id === $('gn-mother').value), agents.find((agent) => agent.id === $('gn-father').value));
      $('gn-breed-status').textContent = `Pregnancy started · ${count} offspring. Follow birth and weaning using the simulation speed controls.`;
      parentSignature = ''; renderParents();
    } catch (error) { $('gn-breed-status').textContent = error.message; }
  };
  $('gn-export-json').onclick = () => download('mouse-families.json', JSON.stringify({ ...genetics.export(), time: getTime(), cages: grid.boxes.map((box) => ({ id: box.id, condition: box.cond.name })) }, null, 2), 'application/json');
  $('gn-export-csv').onclick = () => {
    const rows = [['cage', 'condition', 'generation', 'locus', 'allele', 'recorded_mice', 'allele_copies', 'frequency']];
    for (const box of grid.boxes) for (const entry of LOCI) for (const cohort of genetics.generations(box.id, entry.id))
      for (let i = 0; i < entry.alleles.length; i++) rows.push([box.id + 1, box.cond.name, cohort.generation, entry.label, entry.alleles[i], cohort.n, cohort.counts[i], cohort.frequencies[i]]);
    download('mouse-generations.csv', rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n'), 'text/csv');
  };
  panel.querySelector('[data-act="close"]').onclick = () => open(false);
  function open(force = true) {
    panel.style.display = force ? 'flex' : 'none'; document.getElementById('b-genetics')?.setAttribute('aria-pressed', String(force));
    if (force) { panel.removeAttribute('data-collapsed'); $('gn-cage').value = getAgent().box.id; selected = getAgent().id;
      genetics.synchronize(grid.boxes.flatMap((box) => box.agents), grid.boxes, getTime()); render(); onOpen(panel); }
  }
  function update(dt) {
    if (!isOpen() || panel.hasAttribute('data-collapsed')) return;
    elapsed += dt; if (elapsed < .7) return; elapsed = 0;
    if (lastRevision !== genetics.revision) render();
    else if (tab === 'generations') renderParents();
  }
  return { open, isOpen, update };
}
