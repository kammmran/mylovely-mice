import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { buildPdf } from '../../src/report.js';
import { REPORT_SECTIONS, reportSections } from '../../src/reportoptions.js';

// Detailed profiles exercise long values and page breaks without a browser.
const brain = Object.fromEntries(['hunger', 'thirst', 'libido', 'mateDrive', 'bodyCondition',
  'estrous', 'paternal', 'parental', 'aggression', 'infanticide', 'theta', 'dopamine',
  'value', 'spikes', 'detail'].map((key) => [key, 0.5]));
brain.drives = { defence: false, mating: false };
brain.regions = Array.from({ length: 43 }, (_, i) => ({ acr: `REG${i}`, hz: i / 3 }));
brain.alive = true;
const mouse = { name: 'Chosen mouse', sex: 'M', cage: 'intermittent noise', state: 'walking', ageDays: 70,
  mature: true, dead: false, rank: .5, condition: .93, weightLoss: .01, fear: .2, cort: .3,
  freezePct: .1, crossings: 12, maps: 9, swr: 8, ate: 2, drank: 3, mated: 1,
  litters: 0, pups: 0, bites: 2, bitesTaken: 1, brain,
  visited: Array.from({ length: 9 }, (_, i) => `long cage name number ${i}`),
  history: Array.from({ length: 60 }, (_, i) => ({ t: i, text: `Chosen mouse explored a new habitat and recorded event ${i}.` })),
};
const d = { mice: [mouse, { ...mouse, name: 'Excluded mouse' }], observedMouse: 'Excluded mouse',
  sessionT: 90, grid: { open: false, boxes: [] }, findings: [], allDeaths: [], journal: [],
  crossings: 12, births: 0, weaned: 0, causeLabel: () => 'unknown', figures: {} };
const sections = Object.fromEntries(REPORT_SECTIONS.map(({ key }) => [key, key === 'profiles']));
const doc = buildPdf(d, { title: 'A'.repeat(80), scope: 'custom', mouseNames: ['Chosen mouse'], sections });
const text = Buffer.from(doc.bytes()).toString('latin1');
assert(text.includes('(Chosen mouse)'));
assert(!text.includes('Excluded mouse'), 'Unselected mouse appears in a profile-only PDF');
assert(!text.includes('(Cage comparison)') && !text.includes('(Event timeline)'));
assert(text.includes('recorded event 59'), 'The end of an individual history was lost');
assert(text.includes('(REG42)'), 'The last brain region was lost');
assert(doc.pages.length > 1, 'A long profile did not paginate');
assert.deepEqual(reportSections(null), reportSections(), 'Invalid saved choices do not fall back to defaults');

const xrefOffset = Number(text.match(/startxref\n(\d+)/)[1]);
assert.equal(text.slice(xrefOffset, xrefOffset + 4), 'xref');
const entries = text.slice(xrefOffset).split('\n');
const count = Number(entries[1].split(' ')[1]);
for (let id = 1; id < count; id++) {
  const offset = Number(entries[id + 2].slice(0, 10));
  assert.equal(text.slice(offset, offset + `${id} 0 obj`.length), `${id} 0 obj`, `Object ${id} has an invalid byte offset`);
}
if (process.env.REPORT_PDF) await writeFile(process.env.REPORT_PDF, doc.bytes());
console.log(`Report selection, full histories and PDF pagination checked (${doc.pages.length} pages)`);
