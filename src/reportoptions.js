/** Shared report choices for the preview and every document export. */
export const REPORT_SECTIONS = [
  { key: 'overview', title: 'Session overview', detail: 'Population, time, births & tunnel activity' },
  { key: 'findings', title: 'Findings & observations', detail: 'Patterns noticed during this session' },
  { key: 'snapshots', title: 'Simulation images', detail: 'The platform view & brain atlas' },
  { key: 'charts', title: 'Colony charts', detail: 'Cage populations & mouse condition' },
  { key: 'signals', title: 'Neural signals', detail: 'Recorded traces & regional activity' },
  { key: 'cages', title: 'Cage comparison', detail: 'Conditions, movement & survival by cage' },
  { key: 'mice', title: 'Mouse table', detail: 'Behavior & health for the mice you choose' },
  { key: 'profiles', title: 'Detailed mouse profiles', detail: 'Internal state, circuits & individual history' },
  { key: 'timeline', title: 'Event timeline', detail: 'The recorded journal, in time order' },
  { key: 'notes', title: 'Methods & reading notes', detail: 'Time scale, data sources & interpretation' },
];

export const REPORT_DEFAULTS = Object.fromEntries(REPORT_SECTIONS.map(({ key }) => [key, key !== 'profiles']));
export const REPORT_PRESETS = {
  summary: ['overview', 'snapshots', 'charts', 'findings', 'notes'],
  visual: ['overview', 'snapshots', 'charts', 'signals', 'notes'],
  complete: REPORT_SECTIONS.map(({ key }) => key),
};

export function reportSections(saved = {}) {
  if (!saved || typeof saved !== 'object') saved = {};
  return Object.fromEntries(REPORT_SECTIONS.map(({ key }) =>
    [key, typeof saved[key] === 'boolean' ? saved[key] : REPORT_DEFAULTS[key]]));
}

export const READING_NOTES = [
  'One simulated day is five seconds. Hunger, thirst and reproductive cycles use this compressed time scale.',
  'Colony totals and cage comparisons describe the whole session. Mouse tables, profiles and condition charts use the selected mice. Neural signals describe the mouse being observed when the snapshot was captured.',
  'Traces show recorded model output over the labeled recent time window. Regional rates are a snapshot of display-smoothed activity, not a session average. No trace is invented when recording has not started.',
  'The event journal retains up to the latest 900 events. Reports include the journal available when the snapshot was captured.',
  'Brain anatomy uses Allen Mouse Brain CCFv3 meshes. Inter-region projection strengths come from the Allen Connectivity Atlas.',
  'This is a teaching and exploration model. Small analytic populations are not a basis for drawing scientific conclusions.',
];
