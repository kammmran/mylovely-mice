/**
 * The session report: what happened to every animal, and which of it is worth
 * looking at.
 *
 * A captured session, with selectable sections and mice. Findings, images and
 * recorded signal figures share the same data in the preview and PDF.
 *
 * Everything is generated in the browser. The report can be read on screen,
 * copied, or downloaded as a PDF or Markdown. Selected mice also export as CSV.
 */

import { Pdf } from './pdf.js';
import { ORDER, ROLES } from './neuro/regions.js';
import { REPORT_SECTIONS, REPORT_PRESETS, READING_NOTES, reportSections } from './reportoptions.js';
import { colonyFigures, neuralFigures } from './reportvisuals.js';

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pct = (v) => `${Math.round(v * 100)}%`;


/**
 * The findings. Each rule gets the whole session and returns a finding or
 * nothing. Order is the order they appear in.
 */
const RULES = [
  // ---------------------------------------------------------- the colony
  function behaviouralSink(d) {
    if (!d.grid.open || d.crossings < 5) return null;
    const s = d.sink;
    if (!s.total || s.share < 0.2) return null;
    const links = s.box.links.length;
    return {
      head: `<b>${pct(s.share)}</b> of the colony is in one cage — ${s.box.cond.name}, which has ${links} tunnels`,
      body: `An even spread across nine cages would be 11%. Calhoun found the same thing in 1962: `
          + `connect pens with ramps and the animals stop spreading out and pile into the ones with `
          + `the most connections. He called it the behavioural sink, and the crowding pathology `
          + `followed from the aggregation rather than from any shortage.`,
      ref: 'Calhoun 1962',
    };
  },
  function emptied(d) {
    const gone = d.grid.boxes.filter((b) => b.population === 0 && (b.cond.mice || []).length);
    if (!gone.length || !d.grid.open) return null;
    return {
      head: `<b>${gone.length} cage${gone.length > 1 ? 's' : ''} emptied</b>: ${gone.map((b) => b.cond.name).join(', ')}`,
      body: `Given somewhere to go, they left. Water is the drive that moves a mouse first — it `
          + `survives days without water against weeks without food — and an aversive cage empties `
          + `for the same reason a frightened animal leaves a corner.`,
      ref: null,
    };
  },
  function stillIsolated(d) {
    if (d.grid.open || d.sessionT < 60) return null;
    return {
      head: 'the tunnels have not been opened yet',
      body: `Nine separate experiments are running side by side. Press K and they become one `
          + `connected colony — which is the experiment Calhoun was actually doing.`,
      ref: null,
    };
  },
  // ---------------------------------------------------------- hippocampus
  function remapping(d) {
    const total = d.mice.reduce((n, m) => n + m.maps, 0);
    const best = d.mice.reduce((a, m) => (m.maps > (a ? a.maps : 0) ? m : a), null);
    if (!best || best.maps < 2) return null;
    return {
      head: `<b>${total} hippocampal maps</b> built across the colony — ${best.name} has ${best.maps} of them`,
      body: `A place cell does not carry one map around. Each environment gets its own, independent `
          + `of the others, and the first comes back intact when the animal returns to the first `
          + `cage. Grid modules keep their spacing across the move; head-direction cells do not `
          + `remap at all, which is what lets an animal know which way it is facing somewhere new.`,
      ref: 'Muller & Kubie 1987; Leutgeb et al. 2005; Fyhn et al. 2007',
    };
  },
  function replay(d) {
    const swr = d.mice.reduce((n, m) => n + m.swr, 0);
    if (swr < 20) return null;
    return {
      head: `<b>${swr} sharp-wave ripples</b>`,
      body: `Each one is the hippocampus replaying a run it just did, compressed into about a tenth `
          + `of a second while the animal stands still. After a reward they run backwards.`,
      ref: 'Foster & Wilson 2006',
    };
  },
  // ---------------------------------------------------------- mortality
  function deaths(d) {
    if (!d.deaths.length) return null;
    const byCause = {};
    for (const x of d.deaths) byCause[x.cause] = (byCause[x.cause] || 0) + 1;
    const list = Object.entries(byCause)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${d.causeLabel(k)}`)
      .join(', ');
    return {
      head: `<b>${d.deaths.length} died</b> — ${list}`,
      body: `Every one of these is something that happens to real mice: wounds from fighting that `
          + `kill days later through infection, dehydration faster than starvation, pups that chill `
          + `out of the nest, and Gompertz mortality that doubles about every hundred days.`,
      ref: null,
    };
  },
  function fighting(d) {
    const biters = d.mice.filter((m) => m.bites > 0).sort((a, b) => b.bites - a.bites);
    if (!biters.length) return null;
    const top = biters[0];
    const victim = d.mice.slice().sort((a, b) => b.bitesTaken - a.bitesTaken)[0];
    return {
      head: `<b>${top.name}</b> landed ${top.bites} bites; <b>${victim.name}</b> took ${victim.bitesTaken}`
          + (victim.condition < 0.6 ? ` and is down to ${pct(victim.condition)} condition` : ''),
      body: `Males fight over territory and females, and in a cage the loser has nowhere to go. `
          + `Between 1.5% and 14% of group-housed mice are wounded by a cagemate, nearly all male, `
          + `and the bites land on the rump and the base of the tail.`,
      ref: 'NC3Rs; Mertens et al. 2019',
    };
  },
  function pupLosses(d) {
    const cold = d.pupLoss.hypothermia || 0;
    const killed = d.pupLoss.infanticide || 0;
    if (!cold && !killed) return null;
    return {
      head: `<b>${cold + killed} pups lost</b> — ${cold} chilled out of the nest, ${killed} killed by a male`,
      body: `This is the distinction the literature argues about. Researchers who filmed dams losing `
          + `whole litters found no evidence of pups being killed, and concluded that females mostly `
          + `eat pups that had already died of cold. Males are the ones that kill pups, and only `
          + `until they have mated.`,
      ref: 'Weber & Olsson 2008; vom Saal & Howard 1982',
    };
  },
  function paternalSwitch(d) {
    const fathers = d.mice.filter((m) => m.paternal > 0.6 && m.sex === 'M');
    const virgins = d.mice.filter((m) => m.sex === 'M' && m.paternal < 0.2 && m.mature);
    if (!fathers.length || !virgins.length) return null;
    return {
      head: `<b>${fathers.length}</b> male${fathers.length > 1 ? 's have' : ' has'} switched out of infanticide, `
          + `${virgins.length} ${virgins.length > 1 ? 'have' : 'has'} not`,
      body: `A male that has mated stops killing pups. The inhibition appears days after he mates, `
          + `is in place before his own offspring would be born at 18-20 days, and lifts again 50-60 `
          + `days later. cMPOA activity means paternal, BSTrh means infanticidal, and the first holds `
          + `the second down through a GABAergic projection.`,
      ref: 'vom Saal & Howard 1982; Tsuneoka et al. 2015',
    };
  },
  // ---------------------------------------------------------- physiology
  function wasting(d) {
    const thin = d.mice.filter((m) => m.weightLoss > 0.05);
    if (!thin.length) return null;
    const worst = thin.sort((a, b) => b.weightLoss - a.weightLoss)[0];
    return {
      head: `<b>${thin.length}</b> animal${thin.length > 1 ? 's are' : ' is'} losing weight — `
          + `${worst.name} is ${pct(worst.weightLoss)} below baseline`,
      body: `20% below baseline is the humane endpoint a facility would actually use, and it is the `
          + `threshold used here. Water runs the clock far faster than food does.`,
      ref: 'UC Davis IACUC-28',
    };
  },
  function fearful(d) {
    const scared = d.mice.filter((m) => m.fear > 0.3);
    if (!scared.length) return null;
    const worst = scared.sort((a, b) => b.fear - a.fear)[0];
    return {
      head: `<b>${scared.length}</b> animal${scared.length > 1 ? 's are' : ' is'} still frightened — `
          + `${worst.name} at ${pct(worst.fear)} fear, ${pct(worst.cort)} corticosterone`,
      body: `Fear outlasts the stimulus that caused it by the best part of a minute, and the slow arm `
          + `of the stress response outlasts the behaviour by minutes more.`,
      ref: null,
    };
  },
  function breeding(d) {
    if (!d.births) return null;
    return {
      head: `<b>${d.births} pups born</b>, ${d.weaned} weaned to adulthood`,
      body: `Gestation runs 19.5 days, the pups are born naked and blind, their eyes open on day 13 `
          + `and they wean at three weeks — at which point each one becomes a mouse of its own with `
          + `its own brain.`,
      ref: null,
    };
  },
  function learning(d) {
    const fed = d.mice.filter((m) => m.ate >= 3);
    if (!fed.length) return null;
    const top = fed.sort((a, b) => b.ate - a.ate)[0];
    return {
      head: `<b>${top.name}</b> has eaten ${top.ate} pieces of cheese`,
      body: `Worth watching the dopamine trace while it does: the burst moves off the cheese and onto `
          + `the moment the smell is detected, and eating becomes unsurprising. Turn on the value `
          + `overlay to see what it has learned about the floor.`,
      ref: 'Schultz et al. 1997',
    };
  },
];

/** everything the rules and the tables read, gathered once */
function gather(ctx) {
  const { agents, grid, mortality, causeLabel } = ctx;
  // the live values are read through getters: the report is built long after
  // the module is wired up, and some of what it reads is declared later in it
  const sessionT = ctx.sessionT();
  const journal = typeof ctx.journal === 'function' ? ctx.journal() : (ctx.journal || []);
  const mice = agents.map((ag) => {
    const b = ag.brain;
    const s = ag.surv || {};
    return {
      name: ag.name,
      sex: ag.sex,
      cage: ag.box ? ag.box.cond.name : '—',
      visited: ag.visited ? [...ag.visited] : [],
      crossings: ag.crossings || 0,
      ageDays: Math.round(ag.ageDays || 0),
      mature: !!ag.mature,
      dead: !!ag.dead,
      cause: ag.cause || null,
      ate: b.cheeseCount || 0,
      drank: b.drinkCount || 0,
      mated: b.mateCount || 0,
      litters: b.litters || 0,
      pups: b.pupCount || 0,
      bites: s.bites || 0,
      bitesTaken: s.bitesTaken || 0,
      rank: s.rank == null ? 0.5 : s.rank,
      condition: b.health == null ? 1 : b.health,
      weightLoss: s.weightLoss || 0,
      fear: b.fear || 0,
      cort: b.cort || 0,
      freezePct: b.freezePct || 0,
      paternal: b.paternal || 0,
      maps: Object.keys(b.envs || {}).length || 1,
      swr: b.swrCount || 0,
      state: ag.state || '',
    };
  });
  // the full picture of one animal, which is what the PDF prints
  for (const m of mice) {
    const ag = agents.find((a) => a.name === m.name);
    const b = ag.brain;
    m.brain = {
      theta: b.thetaFreq || 0,
      dopamine: b.daRate || 0,
      value: b.value || 0,
      valueNorm: b.valueNorm || 0,
      spikes: b.spikeRateTotal || 0,
      hunger: b.hunger || 0,
      thirst: b.thirst || 0,
      libido: b.libido || 0,
      mateDrive: b.mateDrive || 0,
      bodyCondition: b.bodyCondition || 0,
      estrous: b.estrous || 0,
      pregnant: !!b.pregnant,
      gestation: b.gestation || 0,
      lactating: !!b.lactating,
      parental: b.parentalDrive || 0,
      paternal: b.paternal || 0,
      // the spike count is only drawn for animals being inspected closely:
      // the rates below are computed for every animal at every detail level
      detail: b.detail == null ? 2 : b.detail,
      infanticide: b.infanticide || 0,
      aggression: b.aggression || 0,
      rivalry: b.rivalry || 0,
      risk: b.risk || 0,
      freeze: b.freeze || 0,
      flight: b.flight || 0,
      aversion: b.aversion || 0,
      quadrant: typeof b.quadrantOccupancy === 'number' ? b.quadrantOccupancy : null,
      drives: { ...b.drives },
      alive: b.alive !== false,
      // every modelled region, with what it is doing right now
      regions: ORDER.map((acr) => {
        const pops = b.byRegion[acr] || [];
        const hz = pops.length ? pops.reduce((n, q) => n + q.smooth, 0) / pops.length : 0;
        return { acr, hz, role: ROLES[acr] ? ROLES[acr].short : '' };
      }),
    };
    // "male 1" must not match "male 10", so the name is matched whole
    const nameRe = new RegExp(`\\b${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    m.history = journal.filter((e) => nameRe.test(e.text));
  }

  const pupLoss = {};
  for (const d of mortality.deaths) {
    if (String(d.name).startsWith('pup ')) pupLoss[d.cause] = (pupLoss[d.cause] || 0) + 1;
  }
  const litters = grid.boxes.map((b) => b.litter).filter(Boolean);
  return {
    mice, sessionT, causeLabel,
    grid: { open: grid.open, boxes: grid.boxes.map((b) => ({
      cond: { name: b.cond.name, short: b.cond.short, mice: [...(b.cond.mice || [])] },
      population: b.population, links: new Array(b.links.length).fill(null),
      arrived: b.arrived, left: b.left, deaths: b.deaths,
    })) },
    journal: journal.map((event) => ({ t: event.t, text: event.text })),
    observedMouse: ctx.observedMouse?.() || mice[0]?.name || '',
    signalTracks: ctx.signalTracks?.() || [],
    sink: grid.sinkIndex(),
    crossings: grid.crossings,
    deaths: mortality.deaths.filter((d) => !String(d.name).startsWith('pup ')).map((d) => ({ ...d })),
    allDeaths: mortality.deaths.map((d) => ({ ...d })),
    pupLoss,
    births: litters.reduce((n, l) => n + (l.born || 0), 0),
    weaned: litters.reduce((n, l) => n + (l.weaned || 0), 0),
  };
}

/** the report as Markdown — the thing you would send somebody */
function selectedMice(d, options = {}) {
  if (options.scope === 'current') return d.mice.filter((m) => m.name === d.observedMouse);
  if (options.scope === 'custom') return d.mice.filter((m) => options.mouseNames?.includes(m.name));
  return d.mice;
}

function markdown(d, options = {}) {
  const sections = reportSections(options.sections);
  const mice = selectedMice(d, options);
  const L = [];
  L.push(`# ${options.title || 'Session report'}`, '', `mylovely-mice · Snapshot ${fmt(d.sessionT)}${sections.signals || sections.snapshots ? ` · Observed mouse: ${d.observedMouse}` : ''}`, '');
  if (sections.overview) {
    L.push('## Session overview', '');
    L.push(`Simulated time: **${fmt(d.sessionT)}** (one day = 5 s, so about `
      + `${(d.sessionT / 5).toFixed(0)} simulated days).`);
    L.push(`${d.mice.filter((m) => !m.dead).length} animals alive, ${d.allDeaths.length} dead, `
      + `${d.crossings} tunnel crossings, tunnels **${d.grid.open ? 'open' : 'shut'}**.`, '');
  }

  if (sections.findings) {
    L.push('## Findings & observations', '');
    if (!d.findings.length) L.push('No notable patterns yet.');
    for (const f of d.findings) {
      L.push(`- **${f.head.replace(/<\/?b>/g, '')}**`);
      L.push(`  ${f.body}${f.ref ? ` *(${f.ref})*` : ''}`);
    }
    L.push('');
  }

  for (const key of ['snapshots', 'charts', 'signals']) if (sections[key]) {
    L.push(`## ${REPORT_SECTIONS.find((s) => s.key === key).title}`, '');
    for (const item of d.figures?.[key] || []) L.push(`- **${item.title}** — ${item.caption}`);
    if (key === 'signals') {
      const mouse = d.mice.find((m) => m.name === d.observedMouse);
      if (mouse) L.push('', '| Region | Mean firing rate (Hz) |', '|---|---|',
        ...mouse.brain.regions.map((r) => `| ${r.acr} | ${r.hz.toFixed(1)} |`));
      if (!(d.signalTracks || []).some((t) => t.values.length >= 2)) L.push('No recorded signal history yet. Run the simulation, then refresh the snapshot.');
    }
    L.push('', 'Images and plotted figures are embedded in the PDF export.', '');
  }

  if (sections.cages) {
    L.push('## Cage comparison', '');
    L.push('| cage | condition | mice | tunnels | arrived | left | deaths |');
    L.push('|---|---|---|---|---|---|---|');
    for (const b of d.grid.boxes) {
      L.push(`| ${b.cond.name} | ${b.cond.short} | ${b.population} | ${b.links.length} `
        + `| ${b.arrived} | ${b.left} | ${b.deaths} |`);
    }
    L.push('');
  }

  if (sections.mice) {
    L.push('## Mouse table', '');
    L.push('| name | sex | cage | age (d) | ate | drank | mated | litters | bites | bitten | condition | crossings | maps | status |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const m of mice) {
      L.push(`| ${m.name} | ${m.sex} | ${m.cage} | ${m.ageDays} | ${m.ate} | ${m.drank} | ${m.mated} `
        + `| ${m.litters} | ${m.bites} | ${m.bitesTaken} | ${pct(m.condition)} | ${m.crossings} `
        + `| ${m.maps} | ${m.dead ? `dead (${d.causeLabel(m.cause)})` : m.state.toLowerCase()} |`);
    }
    L.push('');
  }

  if (sections.profiles) {
    L.push('## Detailed mouse profiles', '');
    for (const m of mice) {
      L.push(`### ${m.name}`, '', `${m.sex} · ${m.ageDays} days · ${m.cage} · ${m.dead ? 'died' : m.state.toLowerCase()}`, '',
        `Body condition: ${pct(m.condition)}. Hunger: ${pct(m.brain.hunger)}. Thirst: ${pct(m.brain.thirst)}.`,
        `Ate: ${m.ate}. Drank: ${m.drank}. Matings: ${m.mated}. Bites given / taken: ${m.bites} / ${m.bitesTaken}.`,
        `Theta: ${m.brain.theta.toFixed(1)} Hz. Dopamine: ${m.brain.dopamine.toFixed(1)} Hz. Maps: ${m.maps}.`, '',
        '| Region | Rate (Hz) |', '|---|---|', ...m.brain.regions.map((r) => `| ${r.acr} | ${r.hz.toFixed(1)} |`), '');
      for (const event of m.history) L.push(`- ${fmt(event.t)} ${event.text}`);
      L.push('');
    }
  }

  if (sections.timeline) {
    L.push('## Event timeline', '');
    for (const e of d.journal) L.push(`- \`${fmt(e.t)}\` ${e.text}`);
    L.push('');
  }

  if (sections.notes) L.push('## Methods & reading notes', '', ...READING_NOTES.map((note) => `- ${note}`));
  return L.join('\n');
}

function csv(d, options = {}) {
  const head = ['name', 'sex', 'cage', 'cages_visited', 'age_days', 'ate', 'drank', 'mated',
    'litters', 'bites_given', 'bites_taken', 'dominance', 'condition', 'weight_loss', 'fear',
    'corticosterone', 'freezing_pct', 'crossings', 'maps', 'ripples', 'dead', 'cause'];
  const rows = selectedMice(d, options).map((m) => [m.name, m.sex, m.cage, m.visited.join(' / '), m.ageDays, m.ate,
    m.drank, m.mated, m.litters, m.bites, m.bitesTaken, m.rank.toFixed(2), m.condition.toFixed(2),
    m.weightLoss.toFixed(3), m.fear.toFixed(2), m.cort.toFixed(2), m.freezePct.toFixed(2),
    m.crossings, m.maps, m.swr, m.dead ? 'yes' : 'no', m.cause || '']);
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [head, ...rows].map((r) => r.map(esc).join(',')).join('\n');
}

/**
 * The long form: every animal, everything known about it, and the state of
 * every modelled region in its brain at the moment the report was taken.
 */
function pdf(d, options = {}) {
  const sections = reportSections(options.sections);
  const mice = selectedMice(d, options);
  const doc = new Pdf({ title: options.title || 'Session report' });
  doc.setFooter(`mylovely-mice  -  ${fmt(d.sessionT)} of simulated time`);

  doc.line('MYLOVELY-MICE / SESSION REPORT', { size: 9, font: 'F2', colour: [0.08, 0.42, 0.37], gap: 8 });
  doc.h1(options.title || 'Session report');
  doc.text(`Snapshot ${fmt(d.sessionT)} · ${mice.length} ${mice.length === 1 ? 'mouse' : 'mice'} included in tables and profiles${sections.signals || sections.snapshots ? ` · Observed mouse: ${d.observedMouse}` : ''}.`, { size: 9 });
  doc.text(`Included: ${REPORT_SECTIONS.filter((s) => sections[s.key]).map((s) => s.title).join(', ')}.`, { size: 8, colour: [0.4, 0.44, 0.48] });
  doc.gap(2);
  if (sections.overview) {
    doc.h2('Session overview');
    doc.metrics([['Living mice', String(d.mice.filter((m) => !m.dead).length)],
      ['Recorded deaths', String(d.allDeaths.length)], ['Tunnel crossings', String(d.crossings)]]);
    doc.kvGrid([
      ['simulated time', `${fmt(d.sessionT)}  (${(d.sessionT / 5).toFixed(0)} days)`],
      ['animals alive', `${d.mice.filter((m) => !m.dead).length} of ${d.mice.length}`],
      ['deaths', `${d.allDeaths.length}`],
      ['tunnels', d.grid.open ? `open - ${d.crossings} crossings` : 'shut'],
      ['pups born', `${d.births}`],
      ['pups weaned', `${d.weaned}`],
    ], 2);
  }

  if (sections.findings) {
    doc.h2('Findings & observations');
    if (!d.findings.length) doc.text('Nothing notable yet.');
    for (const f of d.findings) {
      doc.bullet(`${f.head.replace(/<\/?b>/g, '')}`);
      doc.text(f.body + (f.ref ? ` (${f.ref})` : ''), { size: 8.5, indent: 10, colour: [0.38, 0.4, 0.44] });
      doc.gap(2);
    }
  }

  for (const key of ['snapshots', 'charts', 'signals']) if (sections[key]) {
    const figures = d.figures?.[key] || [];
    doc.room(figures.length ? 380 : 70);
    doc.h2(REPORT_SECTIONS.find((s) => s.key === key).title);
    if (!figures.length) doc.text(key === 'snapshots' ? 'Simulation images were not available at this snapshot.' : 'No figure data available.');
    for (const item of figures) doc.image(item, { maxHeight: key === 'snapshots' ? 265 : 400 });
    if (key === 'signals' && !(d.signalTracks || []).some((t) => t.values.length >= 2)) {
      doc.text('No recorded signal history yet. Run the simulation, then refresh the snapshot.');
    }
  }

  if (sections.cages) {
    doc.h2('Cage comparison');
    doc.table(
      ['cage', 'condition', 'mice', 'tunnels', 'arrived', 'left', 'deaths'],
      d.grid.boxes.map((b) => [b.cond.name, b.cond.short, String(b.population),
        String(b.links.length), String(b.arrived), String(b.left), String(b.deaths)]),
      [2.4, 2.6, 0.8, 0.9, 0.9, 0.7, 0.8],
    );
  }

  if (sections.mice) {
    doc.h2('Mouse table');
    if (!mice.length) doc.text('No mice selected.');
    else {
      const tables = mouseTables(mice, d);
      doc.h3('Identity & health');
      doc.table(tables[0].headers, tables[0].rows, [1.4, 0.5, 1.7, 0.7, 1, 1.4], { size: 8 });
      doc.h3('Behavior & learning');
      doc.table(tables[1].headers, tables[1].rows, [1.4, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.9, 0.7], { size: 8 });
    }
  }

  if (sections.profiles) {
    doc.h2('Detailed mouse profiles');
    doc.text('One section per animal: what it has done, what state it is in, and what every '
      + 'modelled region of its brain was doing when this was taken.', { size: 8.5, colour: [0.4, 0.42, 0.46] });

    if (!mice.length) doc.text('No mice selected.');
    for (const m of mice) {
      const br = m.brain;
      doc.room(150);
      doc.gap(6);
      doc.h3(m.name, m.dead ? `dead - ${d.causeLabel(m.cause)}`
        : `${m.state.toLowerCase()} - ${m.cage}`);
      doc.rule([0.86, 0.88, 0.9]);

      doc.kvGrid([
        ['age', `${m.ageDays} days${m.mature ? '' : ' (juvenile)'}`],
        ['cage', m.cage],
        ['tunnel crossings', String(m.crossings)],
        ['dominance', m.rank.toFixed(2)],
        ['body condition', pct(m.condition)],
        ['weight loss', pct(m.weightLoss)],
      ], 2);
      // a long list of its own: it does not fit in half a column
      doc.kv('cages lived in', m.visited.join(', ') || m.cage, { size: 8.5, labelW: 112 });
      doc.kv('status', m.dead ? `dead - ${d.causeLabel(m.cause)}` : m.state.toLowerCase(),
        { size: 8.5, labelW: 112 });

      doc.gap(3);
      doc.line('behaviour', { size: 8, font: 'F2', colour: [0.45, 0.47, 0.5], gap: 1 });
      doc.kvGrid([
        ['cheese eaten', String(m.ate)],
        ['drinks', String(m.drank)],
        ['matings', String(m.mated)],
        ['litters', String(m.litters)],
        ['pups in care', String(m.pups)],
        ['bites given', String(m.bites)],
        ['bites taken', String(m.bitesTaken)],
        ['sharp-wave ripples', String(m.swr)],
      ], 2);

      doc.gap(3);
      doc.line('internal state', { size: 8, font: 'F2', colour: [0.45, 0.47, 0.5], gap: 1 });
      doc.kvGrid([
        ['hunger', pct(br.hunger)],
        ['thirst', pct(br.thirst)],
        ['libido', pct(br.libido)],
        ['mate drive', pct(br.mateDrive)],
        ['body condition', pct(br.bodyCondition)],
        [m.sex === 'F' ? 'oestrus' : 'paternal state', m.sex === 'F' ? pct(br.estrous) : pct(br.paternal)],
        ['fear', pct(br.fear || m.fear)],
        ['corticosterone', pct(br.cort || m.cort)],
        ['freezing (30 s avg)', pct(m.freezePct)],
        ['aggression', pct(br.aggression)],
        ['infanticidal drive', pct(br.infanticide)],
        ['avoidance of stim. quadrant', br.quadrant == null ? 'n/a' : pct(br.quadrant)],
      ], 2);
      if (br.pregnant) doc.kv('pregnant', `day ${(br.gestation * 19.5).toFixed(0)} of 19.5`);
      if (br.lactating) doc.kv('lactating', `parental drive ${pct(br.parental)}`);
      const off = Object.entries(br.drives).filter(([, v]) => !v).map(([k]) => k);
      if (off.length) doc.kv('circuits switched off', off.join(', '));

      doc.gap(3);
      doc.line('hippocampus and reward', { size: 8, font: 'F2', colour: [0.45, 0.47, 0.5], gap: 1 });
      doc.kvGrid([
        ['theta', `${br.theta.toFixed(1)} Hz`],
        ['dopamine', `${br.dopamine.toFixed(1)} Hz`],
        ['learned value V(s)', br.value.toFixed(3)],
        ['maps held', `${m.maps} of nine cages`],
        ['population rate', br.detail > 0 ? `${(br.spikes / 1000).toFixed(1)} k spikes/s` : 'not sampled'],
        ['alive', br.alive ? 'yes' : 'no'],
      ], 2);

      doc.gap(4);
      doc.line('every region, now', { size: 8, font: 'F2', colour: [0.45, 0.47, 0.5], gap: 2 });
      // three columns of acronym + rate, so 38 regions fit in a few lines
      const regs = br.regions;
      const per = Math.ceil(regs.length / 3);
      for (let i = 0; i < per; i++) {
        const row = [regs[i], regs[i + per], regs[i + per * 2]].filter(Boolean);
        doc.room(11);
        doc.y -= 8.5;
        row.forEach((r, j) => {
          const x = doc.left + j * (doc.width / 3);
          doc.ops.push(`BT /F2 8 Tf 0.3 0.33 0.38 rg 1 0 0 1 ${x.toFixed(1)} ${doc.y.toFixed(1)} Tm (${r.acr}) Tj ET`);
          doc.ops.push(`BT /F3 8 Tf 0.12 0.14 0.17 rg 1 0 0 1 ${(x + 46).toFixed(1)} ${doc.y.toFixed(1)} Tm (${r.hz.toFixed(1)} Hz) Tj ET`);
        });
        doc.y -= 1.5;
      }

      if (m.history.length) {
        doc.gap(4);
        doc.line('what happened to it', { size: 8, font: 'F2', colour: [0.45, 0.47, 0.5], gap: 2 });
        for (const e of m.history) {
          doc.text(`${fmt(e.t)}  ${e.text}`, { size: 8, indent: 6, colour: [0.35, 0.37, 0.41], gap: 1.6 });
        }
      }
      doc.gap(4);
    }
  }

  if (sections.timeline) {
    doc.h2('Event timeline');
    if (!d.journal.length) doc.text('No events recorded yet.');
    for (const e of d.journal) {
      doc.text(`${fmt(e.t)}  ${e.text}`, { size: 8, indent: 4, colour: [0.3, 0.32, 0.36], gap: 1.5 });
    }
  }

  if (sections.notes) {
    doc.h2('Methods & reading notes');
    for (const note of READING_NOTES) doc.bullet(note, { size: 8.5 });
  }

  return doc;
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (value) => String(value).replace(/<[^>]*>/g, '');
const sectionHeading = (key) => REPORT_SECTIONS.find((section) => section.key === key).title;
const PREFERENCE_KEY = 'mlm-report-v1';

function readOptions() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PREFERENCE_KEY) || '{}') || {}; } catch { /* private mode */ }
  return {
    title: typeof saved.title === 'string' ? saved.title.slice(0, 80) : 'Session report',
    sections: reportSections(saved.sections),
    scope: ['all', 'current', 'custom'].includes(saved.scope) ? saved.scope : 'all',
    mouseNames: Array.isArray(saved.mouseNames) ? saved.mouseNames.filter((name) => typeof name === 'string') : [],
  };
}

function tableHtml(headers, rows) {
  return `<div class="rp-table-wrap" tabindex="0" role="region" aria-label="${escapeHtml(headers[0])} table"><table><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function mouseTables(mice, d) {
  return [{
    title: 'Identity & health', headers: ['Mouse', 'Sex', 'Cage', 'Age (d)', 'Condition', 'Status'],
    rows: mice.map((mouse) => [mouse.name, mouse.sex, mouse.cage, mouse.ageDays, pct(mouse.condition), mouse.dead ? `Died · ${d.causeLabel(mouse.cause)}` : mouse.state.toLowerCase()]),
  }, {
    title: 'Behavior & learning', headers: ['Mouse', 'Ate', 'Drank', 'Mated', 'Litters', 'Bites', 'Bitten', 'Crossings', 'Maps'],
    rows: mice.map((mouse) => [mouse.name, mouse.ate, mouse.drank, mouse.mated, mouse.litters, mouse.bites, mouse.bitesTaken, mouse.crossings, mouse.maps]),
  }];
}

function profileHtml(mouse, d) {
  const brain = mouse.brain;
  return `<details class="rp-profile"><summary><strong>${escapeHtml(mouse.name)}</strong><span>${escapeHtml(mouse.cage)} · ${mouse.dead ? 'Died' : `${pct(mouse.condition)} condition`}</span></summary>
    <p>${mouse.sex === 'F' ? 'Female' : 'Male'} · ${mouse.ageDays} days old · ${escapeHtml(mouse.dead ? d.causeLabel(mouse.cause) : mouse.state.toLowerCase())}</p>
    <dl class="rp-profile-facts">${[
      ['Food / water', `${mouse.ate} meals / ${mouse.drank} drinks`], ['Bites given / taken', `${mouse.bites} / ${mouse.bitesTaken}`],
      ['Matings / litters', `${mouse.mated} / ${mouse.litters}`], ['Crossings / maps', `${mouse.crossings} / ${mouse.maps}`],
      ['Hunger / thirst', `${pct(brain.hunger)} / ${pct(brain.thirst)}`], ['Fear / stress', `${pct(mouse.fear)} / ${pct(mouse.cort)}`],
      ['Theta / dopamine', `${brain.theta.toFixed(1)} Hz / ${brain.dopamine.toFixed(1)} Hz`],
      ['Condition / weight loss', `${pct(mouse.condition)} / ${pct(mouse.weightLoss)}`],
      ['Dominance', mouse.rank.toFixed(2)], ['Cages visited', mouse.visited.join(', ') || mouse.cage],
      ['Libido / mate drive', `${pct(brain.libido)} / ${pct(brain.mateDrive)}`],
      ['Oestrus / paternal state', `${pct(brain.estrous)} / ${pct(brain.paternal)}`],
      ['Pregnancy', brain.pregnant ? `Day ${(brain.gestation * 19.5).toFixed(0)} of 19.5` : 'Not pregnant'],
      ['Lactation / parental drive', `${brain.lactating ? 'Lactating' : 'Not lactating'} / ${pct(brain.parental)}`],
      ['Freezing (30 s average)', pct(mouse.freezePct)], ['Aggression / infanticidal drive', `${pct(brain.aggression)} / ${pct(brain.infanticide)}`],
      ['Stimulus quadrant occupancy', brain.quadrant == null ? 'Not sampled' : pct(brain.quadrant)],
      ['Learned value / ripples', `${brain.value.toFixed(3)} / ${mouse.swr}`],
      ['Population spike rate', brain.detail > 0 ? `${(brain.spikes / 1000).toFixed(1)} k spikes/s` : 'Not sampled'],
      ['Circuits disabled', Object.entries(brain.drives).filter(([, value]) => !value).map(([name]) => name).join(', ') || 'None'],
    ].map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
    ${tableHtml(['Brain region', 'Rate (Hz)', 'Role'], brain.regions.map((region) => [region.acr, region.hz.toFixed(1), region.role]))}
    <div class="rp-timeline">${mouse.history.map((event) => `<div><time>${fmt(event.t)}</time><span>${escapeHtml(event.text)}</span></div>`).join('') || '<p>No individual events recorded yet.</p>'}</div>
  </details>`;
}

export class Report {
  constructor(ctx) {
    this.ctx = ctx;
    this.options = readOptions();
    this.snapshot = null;
    this.busy = false;
    this.chartScope = null;
  }

  survey() {
    const d = gather(this.ctx);
    d.findings = RULES.map((rule) => { try { return rule(d); } catch { return null; } }).filter(Boolean);
    return d;
  }

  refresh() {
    const d = this.survey();
    d.figures = { snapshots: [], charts: [], signals: neuralFigures(d) };
    try { d.figures.snapshots = this.ctx.captureImages?.() || []; }
    catch { d.imageNote = 'The simulation images could not be captured. Refresh the snapshot to try again.'; }
    this.snapshot = d;
    this.chartScope = null;
    this.renderMouseChoices();
    this.render();
  }

  data() {
    if (!this.snapshot) this.refresh();
    const mice = selectedMice(this.snapshot, this.options);
    const key = JSON.stringify(mice.map((mouse) => mouse.name));
    if (key !== this.chartScope) {
      this.snapshot.figures.charts = colonyFigures(this.snapshot, mice);
      this.chartScope = key;
    }
    return this.snapshot;
  }

  build() {
    const d = this.data();
    const options = { ...this.options, title: this.options.title.trim() || 'Session report' };
    return { ...d, markdown: markdown(d, options), csv: csv(d, options) };
  }

  saveOptions() {
    try { localStorage.setItem(PREFERENCE_KEY, JSON.stringify(this.options)); } catch { /* private mode */ }
  }

  mount(parent) {
    const card = document.createElement('div');
    card.className = 'float'; card.id = 'report'; card.dataset.panel = 'report';
    card.innerHTML = `
      <h5 data-fold><span>Session report</span><span id="rp-sub"></span><span class="tw">▾</span></h5>
      <div class="body" id="rp-body">
        <div class="rp-workspace-bar"><span id="rp-snapshot-label"></span><button type="button" id="rp-refresh">Refresh snapshot</button></div>
        <div class="rp-layout">
          <details class="rp-options" id="rp-options" ${matchMedia('(min-width: 1051px)').matches ? 'open' : ''}>
            <summary>Report options <span id="rp-section-count"></span></summary>
            <div class="rp-options-content">
              <label class="rp-field">Report title<input id="rp-title" maxlength="80" type="text" placeholder="Session report"></label>
              <div class="rp-option-label">Quick presets</div>
              <div class="rp-presets" role="group" aria-label="Report preset">
                <button type="button" data-preset="summary">Summary</button><button type="button" data-preset="visual">Visual</button><button type="button" data-preset="complete">Complete</button>
              </div>
              <div class="rp-section-label"><strong>Include in report</strong><button type="button" id="rp-clear">Clear</button></div>
              <fieldset class="rp-section-list"><legend class="sr-only">Report sections</legend>${REPORT_SECTIONS.map((section) => `
                <label><input type="checkbox" data-report-section="${section.key}"><span><strong>${section.title}</strong><small>${section.detail}</small></span></label>`).join('')}</fieldset>
              <label class="rp-field">Mice in tables & profiles<select id="rp-scope"><option value="all">All mice</option><option value="current">Observed mouse only</option><option value="custom">Choose mice…</option></select></label>
              <fieldset class="rp-mouse-choices" id="rp-mouse-choices" hidden><legend>Choose mice</legend><div class="rp-mouse-actions"><button type="button" id="rp-mice-all">Select all mice</button><button type="button" id="rp-mice-none">Clear selection</button></div><div id="rp-mouse-list"></div></fieldset>
              <p class="rp-option-hint">Colony totals cover all cages. Signals and images show the observed mouse at snapshot time.</p>
            </div>
          </details>
          <article class="rp-preview" id="rp-preview" aria-label="Report preview"></article>
        </div>
      </div>
      <div class="rp-export-footer">
        <div class="rp-export-line"><strong id="rp-export-count"></strong><span id="rp-status" role="status" aria-live="polite"></span></div>
        <div class="rp-act"><button type="button" class="rp-download" data-act="pdf">Download PDF</button><button type="button" data-act="md">Markdown</button><button type="button" data-act="csv">Mouse CSV</button><button type="button" data-act="copy">Copy text</button></div>
        <p>PDF includes selected images and figures. Markdown includes their descriptions; CSV contains the selected mice.</p>
      </div>`;
    (parent || document.body).appendChild(card);
    card.style.display = 'none'; this.card = card;
    const $ = (selector) => card.querySelector(selector);
    $('#rp-title').value = this.options.title;
    $('#rp-title').oninput = (event) => { this.options.title = event.target.value; this.saveOptions(); this.render(); };
    $('#rp-scope').onchange = (event) => {
      this.options.scope = event.target.value;
      if (this.options.scope === 'custom' && !this.options.mouseNames.length) this.options.mouseNames = this.snapshot.mice.map((mouse) => mouse.name);
      this.saveOptions(); this.render();
    };
    $('#rp-mice-all').onclick = () => { this.options.mouseNames = this.snapshot.mice.map((mouse) => mouse.name); this.saveOptions(); this.render(); };
    $('#rp-mice-none').onclick = () => { this.options.mouseNames = []; this.saveOptions(); this.render(); };
    $('#rp-options').addEventListener('change', (event) => {
      const input = event.target;
      if (input.dataset.reportSection) this.options.sections[input.dataset.reportSection] = input.checked;
      else if (input.dataset.reportMouse) {
        const names = new Set(this.options.mouseNames);
        if (input.checked) names.add(input.dataset.reportMouse); else names.delete(input.dataset.reportMouse);
        this.options.mouseNames = [...names];
      } else return;
      this.saveOptions(); this.render();
    });
    for (const button of card.querySelectorAll('[data-preset]')) button.onclick = () => {
      const preset = REPORT_PRESETS[button.dataset.preset];
      for (const section of REPORT_SECTIONS) this.options.sections[section.key] = preset.includes(section.key);
      this.saveOptions(); this.render();
    };
    $('#rp-clear').onclick = () => {
      for (const section of REPORT_SECTIONS) this.options.sections[section.key] = false;
      this.saveOptions(); this.render();
    };
    $('#rp-refresh').onclick = () => {
      $('#rp-refresh').disabled = true;
      requestAnimationFrame(() => { try { this.refresh(); } finally { $('#rp-refresh').disabled = false; } });
    };
    $('[data-act="md"]').onclick = () => download(this.filename('md'), this.build().markdown, 'text/markdown');
    $('[data-act="csv"]').onclick = () => download(this.filename('csv'), this.build().csv, 'text/csv');
    $('[data-act="copy"]').onclick = async () => {
      try { await navigator.clipboard.writeText(this.build().markdown); $('#rp-status').textContent = 'Report text copied'; }
      catch { $('#rp-status').textContent = 'Copy unavailable. Download Markdown instead.'; }
    };
    $('[data-act="pdf"]').onclick = () => {
      if (this.busy) return;
      const source = this.data(), d = { ...source, figures: { ...source.figures } };
      const options = structuredClone(this.options), filename = this.filename('pdf');
      options.title = options.title.trim() || 'Session report';
      this.busy = true; this.render(); $('#rp-status').textContent = 'Building PDF…';
      setTimeout(() => {
        try { pdf(d, options).save(filename); $('#rp-status').textContent = 'PDF downloaded'; }
        catch (error) { $('#rp-status').textContent = 'PDF could not be built. Please try again.'; console.error('PDF export failed:', error); }
        finally { this.busy = false; this.updateExportState(); }
      }, 40);
    };
    return this;
  }

  filename(extension) { return `mylovely-mice-report-${Math.round(this.snapshot.sessionT)}s.${extension}`; }

  open(value) {
    if (!this.card) return;
    this.card.style.display = value ? 'flex' : 'none';
    if (value) { this.card.removeAttribute('data-collapsed'); this.refresh(); }
  }
  isOpen() { return !!this.card && this.card.style.display !== 'none'; }

  renderMouseChoices() {
    this.card.querySelector('#rp-mouse-list').innerHTML = this.snapshot.mice.map((mouse) =>
      `<label><input type="checkbox" data-report-mouse="${escapeHtml(mouse.name)}"><span>${escapeHtml(mouse.name)}<small>${escapeHtml(mouse.cage)}${mouse.dead ? ' · died' : ''}</small></span></label>`).join('');
  }

  updateExportState() {
    const count = Object.values(this.options.sections).filter(Boolean).length;
    const mouseCount = selectedMice(this.snapshot, this.options).length;
    this.card.querySelector('#rp-section-count').textContent = `${count} / ${REPORT_SECTIONS.length}`;
    this.card.querySelector('#rp-export-count').textContent = `${count} sections · ${mouseCount} ${mouseCount === 1 ? 'mouse' : 'mice'}`;
    for (const button of this.card.querySelectorAll('[data-act]')) button.disabled = this.busy || (button.dataset.act === 'csv' ? !mouseCount : !count);
    this.card.querySelector('[data-act="pdf"]').textContent = this.busy ? 'Building PDF…' : 'Download PDF';
  }

  render() {
    if (!this.snapshot || !this.card) return;
    const d = this.data(), sections = this.options.sections, mice = selectedMice(d, this.options);
    this.card.querySelector('#rp-sub').textContent = `${fmt(d.sessionT)} · ${(d.sessionT / 5).toFixed(0)} simulated days · snapshot`;
    this.card.querySelector('#rp-snapshot-label').textContent = `Captured at ${fmt(d.sessionT)} · ${d.observedMouse}`;
    this.card.querySelector('#rp-scope').value = this.options.scope;
    this.card.querySelector('#rp-mouse-choices').hidden = this.options.scope !== 'custom';
    for (const input of this.card.querySelectorAll('[data-report-section]')) input.checked = sections[input.dataset.reportSection];
    for (const input of this.card.querySelectorAll('[data-report-mouse]')) input.checked = this.options.mouseNames.includes(input.dataset.reportMouse);
    this.updateExportState();
    const H = [];
    const add = (key, html) => { if (sections[key]) H.push(`<section class="rp-section" data-report-preview="${key}"><h3>${sectionHeading(key)}</h3>${html}</section>`); };
    const figures = (key) => (d.figures[key] || []).map((item) => `<figure><img src="${item.url}" width="${item.width}" height="${item.height}" alt="${escapeHtml(item.title)}"><figcaption>${escapeHtml(item.caption)}</figcaption></figure>`).join('');
    if (!Object.values(sections).some(Boolean)) H.push('<div class="rp-empty"><h2>Build your report</h2><p>Choose a preset or select the sections you want to include.</p></div>');
    else H.push(`<header class="rp-document-heading"><small>MYLOVELY-MICE · SESSION SNAPSHOT</small><h2>${escapeHtml(this.options.title.trim() || 'Session report')}</h2><p>${fmt(d.sessionT)} simulated time · ${(d.sessionT / 5).toFixed(0)} simulated days<br>${mice.length} ${mice.length === 1 ? 'mouse' : 'mice'} in tables and profiles${sections.signals || sections.snapshots ? ` · Observed: ${escapeHtml(d.observedMouse)}` : ''}</p></header>`);
    add('overview', `<div class="rp-summary-grid">${[['Living mice', d.mice.filter((mouse) => !mouse.dead).length], ['Deaths', d.allDeaths.length], ['Crossings', d.crossings]].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('')}</div><p>Tunnels ${d.grid.open ? 'open' : 'closed'} · ${d.births} pups born · ${d.weaned} weaned</p>`);
    add('findings', d.findings.map((finding) => `<div class="rp-finding"><strong>${escapeHtml(plain(finding.head))}</strong><p>${escapeHtml(finding.body)}</p>${finding.ref ? `<small>${escapeHtml(finding.ref)}</small>` : ''}</div>`).join('') || '<p class="rp-empty-note">No notable patterns yet. Run the simulation, then refresh the snapshot.</p>');
    add('snapshots', figures('snapshots') + (d.imageNote ? `<p class="rp-empty-note">${d.imageNote}</p>` : d.figures.snapshots.length < 2 ? '<p class="rp-empty-note">The brain atlas is still loading. Refresh the snapshot to include it.</p>' : ''));
    add('charts', figures('charts'));
    add('signals', `<p>Observed mouse: <strong>${escapeHtml(d.observedMouse)}</strong></p>${figures('signals')}${!(d.signalTracks || []).some((track) => track.values.length >= 2) ? '<p class="rp-empty-note">No recorded signal history yet. Run the simulation, then refresh the snapshot.</p>' : ''}`);
    add('cages', tableHtml(['Cage', 'Condition', 'Mice', 'Tunnels', 'Arrivals', 'Departures', 'Deaths'], d.grid.boxes.map((box) => [box.cond.name, box.cond.short, box.population, box.links.length, box.arrived, box.left, box.deaths])));
    add('mice', mice.length ? mouseTables(mice, d).map((table) => `<h4>${table.title}</h4>${tableHtml(table.headers, table.rows)}`).join('') : '<p class="rp-empty-note">No mice selected. Choose mice in Report options.</p>');
    add('profiles', mice.map((mouse) => profileHtml(mouse, d)).join('') || '<p class="rp-empty-note">No mice selected. Choose mice in Report options.</p>');
    add('timeline', `<p>Recorded journal · ${d.journal.length} events, in time order</p><div class="rp-timeline">${d.journal.map((event) => `<div><time>${fmt(event.t)}</time><span>${escapeHtml(event.text)}</span></div>`).join('') || '<p>No events recorded yet.</p>'}</div>`);
    add('notes', `<ul class="rp-notes">${READING_NOTES.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`);
    this.card.querySelector('#rp-preview').innerHTML = H.join('');
  }
}

export { pdf as buildPdf };

export function mountReport(ctx) {
  return new Report(ctx).mount(ctx.mount);
}
