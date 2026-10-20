/** Sidebar navigation and readable controls around the existing simulation. */
export function mountInterface({ getState, nextMouse, togglePanel, restart, cleanView, resize }) {
  const $ = (id) => document.getElementById(id);
  const tabs = [...document.querySelectorAll('[data-tab]')];
  const mobile = matchMedia('(max-width: 700px)');
  const text = (id, value) => {
    const node = $(id);
    if (node.textContent !== String(value)) node.textContent = value;
  };

  function openTab(name, focus = false) {
    for (const tab of tabs) {
      const active = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !active;
      if (active && focus) tab.focus();
    }
    document.querySelector('.sidebar-content').scrollTop = 0;
    resize();
  }
  for (const tab of tabs) {
    tab.onclick = () => openTab(tab.dataset.tab);
    tab.onkeydown = (event) => {
      let index = tabs.indexOf(tab);
      if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else return;
      event.preventDefault();
      openTab(tabs[index].dataset.tab, true);
    };
  }

  function setMenu(open) {
    document.body.classList.toggle('sidebar-open', open);
    $('b-mobile-menu').setAttribute('aria-expanded', String(open));
    $('b-mobile-menu').setAttribute('aria-label', open ? 'Close controls' : 'Open controls');
    $('brain-pane').inert = mobile.matches && !open;
    if (mobile.matches && open) tabs.find((tab) => tab.getAttribute('aria-selected') === 'true').focus();
    else if (mobile.matches) $('b-mobile-menu').focus();
  }
  $('b-mobile-menu').onclick = () => setMenu(!document.body.classList.contains('sidebar-open'));
  $('sidebar-backdrop').onclick = () => setMenu(false);
  const panelLaunchers = new Set(['b-boxes', 'b-colony', 'b-signals', 'b-optics', 'b-mortality', 'b-report']);
  $('brain-pane').addEventListener('click', (event) => {
    if (mobile.matches && panelLaunchers.has(event.target.closest('button')?.id)) setMenu(false);
  });
  mobile.addEventListener('change', () => {
    document.body.classList.remove('sidebar-open');
    $('brain-pane').inert = mobile.matches;
    $('b-mobile-menu').setAttribute('aria-expanded', 'false');
    $('b-mobile-menu').setAttribute('aria-label', 'Open controls');
    resize();
  });
  $('brain-pane').inert = mobile.matches;
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]') && mobile.matches && document.body.classList.contains('sidebar-open')) {
      setMenu(false);
    }
    if (mobile.matches && document.body.classList.contains('sidebar-open') && event.key === 'Tab' && !document.querySelector('dialog[open]')) {
      const items = [...$('brain-pane').querySelectorAll('button,select,summary,[tabindex="0"]')]
        .filter((node) => !node.disabled && node.getClientRects().length);
      items.push($('b-mobile-menu'));
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  $('b-next-mouse').onclick = nextMouse;
  $('b-colony').onclick = () => togglePanel('colony');
  $('b-clean').onclick = () => { cleanView(); openTab('explore'); };
  $('b-shortcuts').onclick = () => $('welcome').showModal();
  $('welcome-close').onclick = () => $('welcome').close();
  $('reset-dialog').addEventListener('close', () => {
    if ($('reset-dialog').returnValue === 'restart') restart();
  });

  function enhancePanel(card) {
    const heading = card.querySelector('h5[data-fold]');
    if (!heading) return;
    const fold = document.createElement('button');
    fold.className = 'panel-fold';
    fold.type = 'button';
    fold.setAttribute('aria-expanded', String(!card.hasAttribute('data-collapsed')));
    for (const node of [...heading.childNodes]) {
      if (node.nodeName !== 'BUTTON') fold.appendChild(node);
    }
    heading.prepend(fold);
    heading.removeAttribute('data-fold');
    fold.onclick = () => {
      card.toggleAttribute('data-collapsed');
      fold.setAttribute('aria-expanded', String(!card.hasAttribute('data-collapsed')));
    };
    const existingClose = heading.querySelector('button:not(.panel-fold)');
    const persistent = ['boxes', 'colony', 'feed', 'threats', 'keys', 'mortality'].includes(card.id);
    if (existingClose && !persistent) return;
    if (!persistent && card.id !== 'signals') return;
    const close = existingClose || document.createElement('button');
    close.classList.add('panel-close');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', `Close ${card.id === 'boxes' ? 'nine cages' : card.id} panel`);
    close.onclick = (event) => {
      event.stopPropagation();
      if (persistent) togglePanel(card.id, false);
      else card.style.display = 'none';
    };
    if (!existingClose) heading.appendChild(close);
  }
  for (const card of document.querySelectorAll('.float')) enhancePanel(card);
  // Signals and optogenetics mount asynchronously after the main interface.
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === 1 && node.matches('.float')) enhancePanel(node);
    }
  }).observe(document.body, { childList: true });

  // Keep collapsible scientific cards usable from the keyboard as well.
  for (const heading of document.querySelectorAll('.pcard > h4')) {
    heading.tabIndex = 0;
    heading.setAttribute('role', 'button');
    const sync = () => heading.setAttribute('aria-expanded', String(!heading.parentElement.classList.contains('shut') && !heading.parentElement.classList.contains('folded')));
    sync();
    heading.addEventListener('click', sync);
    heading.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); heading.click(); }
    });
  }

  function update() {
    const { agent, population, time, paused, speed } = getState();
    text('ui-mouse', agent.name);
    text('ui-mouse-meta', `${agent.sex === 'F' ? 'Female' : 'Male'} · ${Math.floor(agent.ageDays)} days old`);
    text('ui-cage', agent.box.cond.name);
    text('ui-behavior', agent.state.toLowerCase().replaceAll('_', ' '));
    text('ui-population', `${population} mice`);
    text('ui-clock', time);
    text('ui-session', paused ? 'Paused' : 'Running');
    $('ui-session').classList.toggle('paused', paused);
    for (const [key, value] of [['hunger', agent.brain.hunger], ['thirst', agent.brain.thirst]]) {
      $(`ui-${key}`).value = value;
      text(`ui-${key}-value`, `${Math.round(value * 100)}%`);
    }
    text('b-auto', agent.auto ? 'Autopilot on' : 'Manual control');
    $('b-auto').classList.toggle('on', agent.auto);
    $('b-auto').setAttribute('aria-pressed', String(agent.auto));
    text('b-pause', paused ? 'Resume' : 'Pause');
    $('b-pause').setAttribute('aria-pressed', String(paused));
    $('b-speed').value = String(speed);
    for (const button of document.querySelectorAll('.btn[aria-pressed]')) {
      if (button.id !== 'b-pause') button.setAttribute('aria-pressed', String(button.classList.contains('on')));
    }
  }
  update();
  return { update, openTab };
}
