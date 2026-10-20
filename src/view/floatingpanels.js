import { POPUPS } from './popupconfig.js';

/** Movable popup windows, bounded by the platform rather than the sidebar. */
export function mountFloatingPanels(platform) {
  const positions = new Map();
  const visibility = new WeakMap();
  const windows = [];
  const margin = 12;
  let scheduled = false;
  let drag = null;
  let activeCard = null;
  const trackActive = (event) => { activeCard = event.target.closest?.('.float') || null; };
  addEventListener('pointerdown', trackActive, true);
  addEventListener('focusin', trackActive);

  function raise(card) {
    const index = windows.indexOf(card);
    if (index >= 0) windows.splice(index, 1);
    windows.push(card);
    windows.forEach((window, order) => { window.style.zIndex = String(40 + order); });
  }

  function measure(card) {
    const bounds = platform.getBoundingClientRect();
    card.style.setProperty('--floating-max-width', `${Math.max(0, bounds.width - margin * 2)}px`);
    card.style.setProperty('--floating-max-height', `${Math.max(0, bounds.height - margin * 2)}px`);
    card.classList.add('is-floating');
    return bounds;
  }

  function place(card) {
    const position = positions.get(card);
    if (!position) return;
    const bounds = measure(card);
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    position.x = Math.max(margin, Math.min(position.x, bounds.width - rect.width - margin));
    position.y = Math.max(margin, Math.min(position.y, bounds.height - rect.height - margin));
    card.style.setProperty('--floating-x', `${bounds.left + position.x}px`);
    card.style.setProperty('--floating-y', `${bounds.top + position.y}px`);
  }

  function home(card) {
    const bounds = measure(card);
    const rect = card.getBoundingClientRect();
    const right = Math.max(margin, bounds.width - rect.width - margin);
    const bottom = Math.max(margin, bounds.height - rect.height - margin);
    const corners = {
      'top-left': { x: margin, y: margin }, 'top-right': { x: right, y: margin },
      'bottom-left': { x: margin, y: bottom }, 'bottom-right': { x: right, y: bottom },
      center: { x: Math.max(margin, (bounds.width - rect.width) / 2),
        y: Math.max(margin, (bounds.height - rect.height) / 2) },
    };
    const preferred = corners[POPUPS[card.id]?.home || 'top-right'];
    let position = preferred;
    // Keep the cage overview in its designated corner. On narrow screens the
    // top edge also keeps every new window's controls within easy reach.
    if (card.id !== 'boxes' && bounds.width > 700 && POPUPS[card.id]?.home !== 'center') {
      const occupied = windows.filter((other) => other !== card && positions.has(other) && other.getClientRects().length)
        .map((other) => other.getBoundingClientRect());
      const overlap = (point) => occupied.reduce((area, other) => {
        const x = bounds.left + point.x, y = bounds.top + point.y;
        return area + Math.max(0, Math.min(x + rect.width + margin, other.right) - Math.max(x - margin, other.left))
          * Math.max(0, Math.min(y + rect.height + margin, other.bottom) - Math.max(y - margin, other.top));
      }, 0);
      position = [preferred, corners['top-left'], corners['top-right'], corners['bottom-left'], corners['bottom-right']]
        .reduce((best, point) => overlap(point) < overlap(best) ? point : best, preferred);
    } else if (bounds.width <= 700) position = { x: margin, y: margin };
    positions.set(card, { ...position });
    place(card);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const pending = [...windows].sort((a, b) => Number(b.id === 'boxes') - Number(a.id === 'boxes'));
      for (const card of pending) {
        const shown = card.getClientRects().length > 0;
        if (shown) {
          if (!positions.has(card)) home(card);
          if (!visibility.get(card)) raise(card);
        }
        visibility.set(card, shown);
      }
      if (activeCard?.getClientRects().length) raise(activeCard);
      for (const card of positions.keys()) place(card);
    });
  }

  function remember(card) {
    if (positions.has(card)) return;
    const bounds = platform.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    positions.set(card, { x: rect.left - bounds.left, y: rect.top - bounds.top });
    place(card);
  }

  const observer = new ResizeObserver(schedule);
  observer.observe(platform);

  addEventListener('pointermove', (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) drag.heading.setPointerCapture(event.pointerId);
    drag.moved = true;
    const bounds = platform.getBoundingClientRect();
    positions.set(drag.card, { x: drag.left + dx - bounds.left, y: drag.top + dy - bounds.top });
    drag.heading.classList.add('dragging');
    place(drag.card);
    event.preventDefault();
  }, { passive: false });
  const finish = (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const active = drag;
    drag = null;
    active.suppress(active.moved);
    active.heading.classList.remove('dragging');
    if (active.heading.hasPointerCapture(event.pointerId)) active.heading.releasePointerCapture(event.pointerId);
    setTimeout(() => active.suppress(false), 300);
  };
  addEventListener('pointerup', finish);
  addEventListener('pointercancel', finish);

  function attach(card) {
    if (windows.includes(card)) return;
    const heading = card.querySelector('h5');
    if (!heading) return;
    windows.push(card);
    observer.observe(card);
    heading.classList.add('floating-title');
    const handle = heading.querySelector('.panel-fold') || heading;
    handle.title = 'Drag to move · Click to collapse · Alt + arrow keys to move';
    const grip = document.createElement('span');
    grip.className = 'floating-grip';
    grip.setAttribute('aria-hidden', 'true');
    handle.prepend(grip);
    const toolbar = document.createElement('div');
    toolbar.className = 'popup-toolbar';
    const hint = document.createElement('span');
    hint.textContent = 'Drag header to move';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'popup-reset';
    reset.textContent = 'Reset position';
    reset.onclick = () => { home(card); raise(card); };
    toolbar.append(hint, reset);
    heading.after(toolbar);
    let suppressClick = false;

    card.addEventListener('pointerdown', () => raise(card), true);
    heading.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary || event.target.closest('button:not(.panel-fold)')) return;
      const rect = card.getBoundingClientRect();
      drag = { card, heading, pointer: event.pointerId, startX: event.clientX,
        startY: event.clientY, left: rect.left, top: rect.top, moved: false,
        suppress: (value) => { suppressClick = value; } };
    });
    heading.addEventListener('lostpointercapture', finish);
    heading.addEventListener('click', (event) => {
      if (!suppressClick || event.target.closest('button:not(.panel-fold)')) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    handle.addEventListener('keydown', (event) => {
      if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      remember(card);
      const position = positions.get(card);
      const distance = event.shiftKey ? 40 : 12;
      if (event.key === 'ArrowLeft') position.x -= distance;
      if (event.key === 'ArrowRight') position.x += distance;
      if (event.key === 'ArrowUp') position.y -= distance;
      if (event.key === 'ArrowDown') position.y += distance;
      raise(card);
      place(card);
    });
  }

  for (const card of document.querySelectorAll('.float')) attach(card);
  // The signals and optogenetics windows mount after their data is ready.
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === 1 && node.matches('.float')) attach(node);
    }
  }).observe(document.body, { childList: true });
  addEventListener('resize', schedule);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')
      || document.body.classList.contains('sidebar-open')) return;
    const top = [...windows].reverse().find((card) => card.getClientRects().length);
    if (!top) return;
    event.preventDefault();
    const focused = top.contains(document.activeElement);
    top.querySelector('.panel-close')?.click();
    if (focused && !top.getClientRects().length) {
      const launcher = { boxes: 'b-boxes', colony: 'b-colony', mortality: 'b-mortality',
        signals: 'b-signals', optics: 'b-optics', report: 'b-report', anatomy: 'b-anatomy', genetics: 'b-genetics', 'colony-setup': 'b-colony-setup' }[top.id];
      const trigger = document.getElementById(launcher);
      (trigger?.getClientRects().length && !trigger.closest('[inert]') ? trigger
        : document.getElementById('b-mobile-menu')?.getClientRects().length ? document.getElementById('b-mobile-menu')
          : document.querySelector('[data-tab][aria-selected="true"]'))?.focus({ preventScroll: true });
    }
  });

  return {
    reset() {
      positions.clear();
      for (const card of windows) {
        card.classList.remove('is-floating');
        for (const property of ['--floating-x', '--floating-y', '--floating-max-width', '--floating-max-height', 'z-index']) {
          card.style.removeProperty(property);
        }
      }
    },
    open(card) {
      if (!positions.has(card)) home(card);
      raise(card);
      place(card);
    },
  };
}
