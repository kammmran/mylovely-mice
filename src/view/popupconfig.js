/** Shared names, sizes and home positions for the floating workspace. */
export const POPUPS = {
  boxes: { title: 'Cages', description: 'Conditions, populations & tunnels', icon: 'grid', home: 'top-left', width: 350, height: 590 },
  genetics: { title: 'Genetics & families', description: 'Inheritance, generations & cage comparisons', icon: 'activity', home: 'top-right', width: 720, height: 760 },
  'colony-setup': { title: 'Colony setup', description: 'Choose cage counts & add mice', icon: 'sliders', home: 'top-right', width: 420, height: 740 },
  colony: { title: 'Mouse colony', description: 'Choose a mouse & adjust its habitat', icon: 'mouse', home: 'top-right', width: 350, height: 640 },
  feed: { title: 'Activity feed', description: 'Follow what happens in the colony', icon: 'activity', home: 'bottom-left', width: 350, height: 340 },
  threats: { title: 'Threat stimuli', description: 'Present a stimulus & watch the response', icon: 'bolt', home: 'top-left', width: 350, height: 610 },
  mortality: { title: 'Health & survival', description: 'Fighting, stress & causes of death', icon: 'heart', home: 'top-right', width: 350, height: 640 },
  anatomy: { title: 'Mouse anatomy', description: 'Live skeleton, organs, blood vessels & nerves', icon: 'mouse', home: 'top-right', width: 560, height: 760 },
  signals: { title: 'Neural signals', description: 'Brain waves, spikes & body activity', icon: 'activity', home: 'top-right', width: 420, height: 680 },
  optics: { title: 'Optogenetics', description: 'Control neural activity with light', icon: 'light', home: 'top-right', width: 420, height: 700 },
  report: { title: 'Session report', description: 'Review your colony & export the results', icon: 'report', home: 'center', width: 840, height: 720 },
  keys: { title: 'Keyboard shortcuts', description: 'Quick ways to navigate & explore', icon: 'keyboard', home: 'bottom-right', width: 350, height: 560 },
  'panel-menu': { title: 'Customize panels', description: 'Build a workspace that suits you', icon: 'sliders', home: 'top-right', width: 380, height: 740 },
};

const ICONS = {
  grid: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="15" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/>',
  mouse: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M19 14c0 5-3 7-7 7s-7-2-7-7 3-7 7-7 7 2 7 7Z"/><path d="M9 13h.01M15 13h.01M11 17l1 1 1-1"/>',
  activity: '<path d="M2 12h4l3-8 6 16 3-8h4"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
  heart: '<path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 1 9 8 15 7-6 12-11 8-15Z"/>',
  light: '<path d="M9 18h6M10 21h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z"/>',
  report: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10"/>',
  sliders: '<path d="M4 7h6m4 0h6M4 17h10m4 0h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
};

export function popupIcon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.grid}</svg>`;
}
