/**
 * The session report: what happened to every animal, and which of it is worth
 * looking at.
 *
 * Two halves. The first is bookkeeping — a row per mouse, a row per cage, and
 * the timeline — which is the part you would hand to someone else. The second
 * is the findings: a set of rules that each look for one pattern in the data
 * and, if it is there, say so in a sentence with the number in it and the work
 * it reproduces. A rule that finds nothing says nothing, so the report is only
 * ever about what this particular session actually did.
 *
 * Everything is generated in the browser. The report can be read on screen,
 * copied, or downloaded as Markdown, and the per-animal table also downloads
 * as CSV for anything that wants to go into a spreadsheet.
 */

import { Pdf } from './pdf.js';
import { ORDER, ROLES } from './neuro/regions.js';

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pct = (v) => `${Math.round(v * 100)}%`;
const CSS = `
#report{left:50%;top:50%;transform:translate(-50%,-50%);width:min(840px,92vw);
  max-height:86vh;display:none;flex-direction:column;z-index:40}
#report .body{padding:0 12px 12px;overflow-y:auto}
#report .rp-act{display:flex;gap:6px;padding:0 12px 10px}
#report .rp-act button{background:#101a26;border:1px solid var(--line2,#2a3a4f);border-radius:5px;
  padding:5px 9px;color:var(--ink2,#9fb2c8);font:inherit;font-size:10.5px;cursor:pointer}
#report .rp-act button:hover{background:#1b2735;color:var(--ink,#e8eef6)}
#report .rp-act .spacer{flex:1}
#report h6{margin:12px 0 6px;font-size:9px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink3,#64788f)}
#report h6:first-child{margin-top:0}
#report .rp-find{background:#101a26;border-left:2px solid #d55181;border-radius:4px;
  padding:6px 9px;margin-bottom:4px;font-size:11.5px;color:var(--ink2,#9fb2c8);line-height:1.5}
#report .rp-find b{color:var(--ink,#e8eef6)}
#report .rp-find i{font-style:normal;display:block;font-size:9.5px;color:var(--ink3,#64788f);margin-top:2px}
#report table{width:100%;border-collapse:collapse;font-size:10.5px}
#report th{text-align:left;font-weight:500;font-size:8.5px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--ink3,#64788f);padding:3px 5px;border-bottom:1px solid var(--line2,#2a3a4f)}
#report td{padding:3px 5px;border-bottom:1px solid var(--line,#15202c);color:var(--ink2,#9fb2c8);
  font-family:var(--mono,monospace);white-space:nowrap}
#report td.nm{font-family:inherit;color:var(--ink,#e8eef6)}
#report tr.dead td{opacity:.5}
#report .rp-time{font-size:10px;color:var(--ink3,#64788f);line-height:1.6;max-height:190px;
  overflow-y:auto;font-family:var(--mono,monospace)}
#report .rp-time b{color:var(--ink2,#9fb2c8);font-weight:500}
#report .rp-foot{font-size:9.5px;color:var(--ink3,#64788f);line-height:1.5;margin-top:10px;
  border-top:1px solid var(--line,#15202c);padding-top:8px}
`;

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
    mice, grid, sessionT, journal, causeLabel,
    sink: grid.sinkIndex(),
    crossings: grid.crossings,
    deaths: mortality.deaths.filter((d) => !String(d.name).startsWith('pup ')),
    allDeaths: mortality.deaths,
    pupLoss,
    births: litters.reduce((n, l) => n + (l.born || 0), 0),
    weaned: litters.reduce((n, l) => n + (l.weaned || 0), 0),
  };
}

/** the report as Markdown — the thing you would send somebody */
function markdown(d) {
  const L = [];
  L.push('# mylovely-mice — session report', '');
  L.push(`Simulated time: **${fmt(d.sessionT)}** (one day = 5 s, so about `
    + `${(d.sessionT / 5).toFixed(0)} simulated days).`);
  L.push(`${d.mice.filter((m) => !m.dead).length} animals alive, ${d.allDeaths.length} dead, `
    + `${d.crossings} tunnel crossings, tunnels **${d.grid.open ? 'open' : 'shut'}**.`, '');

  L.push('## What is interesting', '');
  for (const f of d.findings) {
    L.push(`- **${f.head.replace(/<\/?b>/g, '')}**`);
    L.push(`  ${f.body}${f.ref ? ` *(${f.ref})*` : ''}`);
  }
  L.push('');

  L.push('## The nine cages', '');
  L.push('| cage | condition | mice | tunnels | arrived | left | deaths |');
  L.push('|---|---|---|---|---|---|---|');
  for (const b of d.grid.boxes) {
    L.push(`| ${b.cond.name} | ${b.cond.short} | ${b.population} | ${b.links.length} `
      + `| ${b.arrived} | ${b.left} | ${b.deaths} |`);
  }
  L.push('');

  L.push('## Every mouse', '');
  L.push('| name | sex | cage | age (d) | ate | drank | mated | litters | bites | bitten | condition | crossings | maps | status |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const m of d.mice) {
    L.push(`| ${m.name} | ${m.sex} | ${m.cage} | ${m.ageDays} | ${m.ate} | ${m.drank} | ${m.mated} `
      + `| ${m.litters} | ${m.bites} | ${m.bitesTaken} | ${pct(m.condition)} | ${m.crossings} `
      + `| ${m.maps} | ${m.dead ? `dead (${d.causeLabel(m.cause)})` : m.state.toLowerCase()} |`);
  }
  L.push('');

  L.push('## What happened, in order', '');
  for (const e of d.journal) L.push(`- \`${fmt(e.t)}\` ${e.text}`);
  L.push('');

  L.push('## Notes on reading this', '');
  L.push('- One simulated day is five seconds. Hunger, thirst and the oestrous cycle are compressed to match.');
  L.push('- Nothing here is played back: every number comes from a tuning curve built to match a published result, driven by what the animal was doing at the time.');
  L.push('- The anatomy and the wiring between regions are measured — Allen CCFv3 meshes and Allen Connectivity Atlas tracer strengths.');
  L.push('- This is a teaching and exploration tool, not a simulator to draw conclusions from.');
  return L.join('\n');
}

function csv(d) {
  const head = ['name', 'sex', 'cage', 'cages_visited', 'age_days', 'ate', 'drank', 'mated',
    'litters', 'bites_given', 'bites_taken', 'dominance', 'condition', 'weight_loss', 'fear',
    'corticosterone', 'freezing_pct', 'crossings', 'maps', 'ripples', 'dead', 'cause'];
  const rows = d.mice.map((m) => [m.name, m.sex, m.cage, m.visited.join(' / '), m.ageDays, m.ate,
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
function pdf(d) {
  const doc = new Pdf({ title: 'mylovely-mice session report' });
  doc.setFooter(`mylovely-mice  -  ${fmt(d.sessionT)} of simulated time`);

  doc.h1('mylovely-mice');
  doc.text('Session report. Nine cages, each under different conditions, every animal wired to a '
    + 'running model of its own brain.', { size: 10 });
  doc.gap(2);
  doc.kvGrid([
    ['simulated time', `${fmt(d.sessionT)}  (${(d.sessionT / 5).toFixed(0)} days)`],
    ['animals alive', `${d.mice.filter((m) => !m.dead).length} of ${d.mice.length}`],
    ['deaths', `${d.allDeaths.length}`],
    ['tunnels', d.grid.open ? `open - ${d.crossings} crossings` : 'shut'],
    ['pups born', `${d.births}`],
    ['pups weaned', `${d.weaned}`],
  ], 2);

  doc.h2('What is interesting');
  if (!d.findings.length) doc.text('Nothing notable yet.');
  for (const f of d.findings) {
    doc.bullet(`${f.head.replace(/<\/?b>/g, '')}`);
    doc.text(f.body + (f.ref ? ` (${f.ref})` : ''), { size: 8.5, indent: 10, colour: [0.38, 0.4, 0.44] });
    doc.gap(2);
  }

  doc.h2('The nine cages');
  doc.table(
    ['cage', 'condition', 'mice', 'tunnels', 'arrived', 'left', 'deaths'],
    d.grid.boxes.map((b) => [b.cond.name, b.cond.short, String(b.population),
      String(b.links.length), String(b.arrived), String(b.left), String(b.deaths)]),
    [2.4, 2.6, 0.8, 0.9, 0.9, 0.7, 0.8],
  );

  doc.h2('Every mouse');
  doc.text('One section per animal: what it has done, what state it is in, and what every '
    + 'modelled region of its brain was doing when this was taken.', { size: 8.5, colour: [0.4, 0.42, 0.46] });

  for (const m of d.mice) {
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
      for (const e of m.history.slice(-14)) {
        doc.text(`${fmt(e.t)}  ${e.text}`, { size: 8, indent: 6, colour: [0.35, 0.37, 0.41], gap: 1.6 });
      }
    }
    doc.gap(4);
  }

  doc.h2('What happened, in order');
  for (const e of d.journal.slice(-160)) {
    doc.text(`${fmt(e.t)}  ${e.text}`, { size: 8, indent: 4, colour: [0.3, 0.32, 0.36], gap: 1.5 });
  }

  doc.h2('Notes on reading this');
  for (const n of [
    'One simulated day is five seconds. Hunger, thirst and the oestrous cycle are compressed to match, and are labelled where they appear.',
    'Nothing here is played back. Every number comes from a tuning curve built to match a published response property, driven by what the animal was doing at the time.',
    'The anatomy is real: Allen Mouse Brain CCFv3 structure meshes, and the strengths between regions are measured anterograde tracer projections from the Allen Connectivity Atlas.',
    'Firing rates are the display-smoothed mean across the modelled cells of each region at the moment the report was taken, not an average over the session.',
    'This is a teaching and exploration tool. The populations are small and the tuning curves are analytic rather than fitted, so it is not something to draw scientific conclusions from.',
  ]) doc.bullet(n, { size: 8.5 });

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

export class Report {
  constructor(ctx) { this.ctx = ctx; }

  /** the data and the findings — everything the panel needs */
  survey() {
    const d = gather(this.ctx);
    d.findings = RULES.map((r) => { try { return r(d); } catch { return null; } }).filter(Boolean);
    return d;
  }

  /** the same, plus the two export formats. Only built when asked for. */
  build() {
    const d = this.survey();
    d.markdown = markdown(d);
    d.csv = csv(d);
    return d;
  }

  mount(parent) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const card = document.createElement('div');
    card.className = 'float';
    card.id = 'report';
    card.dataset.panel = 'report';
    card.innerHTML = `
      <h5 data-fold><span>session report</span><span id="rp-sub"></span><span class="tw">▾</span></h5>
      <div class="rp-act">
        <button data-act="pdf">download .pdf</button>
        <button data-act="md">download .md</button>
        <button data-act="csv">download .csv</button>
        <button data-act="copy">copy</button>
        <span class="spacer"></span>
        <button data-act="close">close</button>
      </div>
      <div class="body" id="rp-body"></div>`;
    (parent || document.body).appendChild(card);
    card.style.display = 'none';
    this.card = card;
    card.querySelector('[data-act="close"]').onclick = () => this.open(false);
    card.querySelector('[data-act="md"]').onclick = () =>
      download(`mylovely-mice-report-${fmt(this.ctx.sessionT()).replace(':', 'm')}s.md`,
        this.build().markdown, 'text/markdown');
    card.querySelector('[data-act="pdf"]').onclick = () => {
      const btn = card.querySelector('[data-act="pdf"]');
      btn.textContent = 'building...';
      // let the button repaint before the document is built
      setTimeout(() => {
        try {
          pdf(this.survey()).save(`mylovely-mice-report-${Math.round(this.ctx.sessionT())}s.pdf`);
          btn.textContent = 'download .pdf';
        } catch (e) {
          btn.textContent = 'failed';
          console.error('pdf build failed:', e);
          setTimeout(() => { btn.textContent = 'download .pdf'; }, 2000);
        }
      }, 30);
    };
    card.querySelector('[data-act="csv"]').onclick = () =>
      download('mylovely-mice-mice.csv', this.build().csv, 'text/csv');
    card.querySelector('[data-act="copy"]').onclick = async () => {
      const btn = card.querySelector('[data-act="copy"]');
      try {
        await navigator.clipboard.writeText(this.build().markdown);
        btn.textContent = 'copied';
      } catch { btn.textContent = 'could not copy'; }
      setTimeout(() => { btn.textContent = 'copy'; }, 1600);
    };
    return this;
  }

  open(v) {
    if (!this.card) return;
    this.card.style.display = v ? 'flex' : 'none';
    if (v) this.render();
  }
  isOpen() { return !!this.card && this.card.style.display !== 'none'; }

  render() {
    const d = this.survey();
    const body = this.card.querySelector('#rp-body');
    const sub = this.card.querySelector('#rp-sub');
    sub.textContent = `${fmt(d.sessionT)} · ${(d.sessionT / 5).toFixed(0)} simulated days`;

    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const H = [];
    H.push('<h6>what is interesting</h6>');
    if (!d.findings.length) {
      H.push('<div class="rp-find">Nothing has happened yet. Let it run, or open the tunnels.</div>');
    }
    for (const f of d.findings) {
      H.push(`<div class="rp-find">${f.head}<i>${esc(f.body)}${f.ref ? ` — ${esc(f.ref)}` : ''}</i></div>`);
    }

    H.push('<h6>the nine cages</h6><table><tr><th>cage</th><th>condition</th><th>mice</th>'
      + '<th>tunnels</th><th>in</th><th>out</th><th>deaths</th></tr>');
    for (const b of d.grid.boxes) {
      H.push(`<tr><td class="nm">${esc(b.cond.name)}</td><td>${esc(b.cond.short)}</td>`
        + `<td>${b.population}</td><td>${b.links.length}</td><td>${b.arrived}</td>`
        + `<td>${b.left}</td><td>${b.deaths}</td></tr>`);
    }
    H.push('</table>');

    H.push(`<h6>every mouse — ${d.mice.length}</h6><table><tr><th>name</th><th>sex</th><th>cage</th>`
      + '<th>age</th><th>ate</th><th>drank</th><th>mated</th><th>bites</th><th>bitten</th>'
      + '<th>cond.</th><th>cross.</th><th>maps</th><th>status</th></tr>');
    for (const m of d.mice) {
      H.push(`<tr class="${m.dead ? 'dead' : ''}"><td class="nm">${esc(m.name)}</td>`
        + `<td>${m.sex === 'M' ? '♂' : '♀'}</td><td>${esc(m.cage)}</td><td>${m.ageDays}d</td>`
        + `<td>${m.ate}</td><td>${m.drank}</td><td>${m.mated}</td><td>${m.bites}</td>`
        + `<td>${m.bitesTaken}</td><td>${pct(m.condition)}</td><td>${m.crossings}</td>`
        + `<td>${m.maps}</td><td>${esc(m.dead ? `dead · ${d.causeLabel(m.cause)}` : m.state.toLowerCase())}</td></tr>`);
    }
    H.push('</table>');

    H.push('<h6>what happened, in order</h6><div class="rp-time">');
    const recent = d.journal.slice(-120).reverse();
    for (const e of recent) H.push(`<div><b>${fmt(e.t)}</b> ${esc(e.text)}</div>`);
    if (!recent.length) H.push('<div>nothing yet</div>');
    H.push('</div>');

    H.push('<div class="rp-foot">One simulated day is five seconds. Nothing here is played back: '
      + 'every number comes from a tuning curve built to match a published result, driven by what '
      + 'the animal was doing at the time. A teaching tool, not a simulator to draw conclusions from.</div>');
    body.innerHTML = H.join('');
  }
}

export { pdf as buildPdf };

export function mountReport(ctx) {
  return new Report(ctx).mount(ctx.mount);
}
