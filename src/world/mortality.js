/**
 * How mice die, and what kills them.
 *
 * Six causes, all of them things that actually happen to mice, and none of
 * them invented for the simulation:
 *
 *   fight wounds   Males fight over territory and females, and in a cage the
 *                  loser has nowhere to go. Between 1.5% and 14% of group-
 *                  housed mice are wounded by a cagemate, nearly all of them
 *                  male, and the bites land on the rump and the base of the
 *                  tail. Bad wounds kill days later, through infection, rather
 *                  than during the fight.
 *                  NC3Rs mouse-aggression guidance; Mertens et al. 2019
 *
 *   infanticide    A virgin male kills pups he finds; a male that has mated
 *                  does not. The inhibition appears days after he mates, is in
 *                  place before his own offspring would be born at 18-20 days,
 *                  and lifts again 50-60 days later. Two nuclei a millimetre
 *                  apart read out which state he is in: cMPOA for paternal,
 *                  BSTrh for infanticidal.
 *                  vom Saal & Howard 1982; Perrigo et al. 1992; Tsuneoka 2015
 *
 *   hypothermia    A pup out of the nest cannot keep itself warm — no mouse can
 *                  before about day 18 — and chills. This is the one that
 *                  reframes the others: researchers who filmed dams losing
 *                  whole litters found no evidence of pups being killed, and
 *                  concluded that females mostly eat pups that are already
 *                  dead. What gets reported as maternal infanticide is usually
 *                  cannibalism of a pup that died of cold or hunger first.
 *                  Weber & Olsson 2008; Lagerspetz 1966
 *
 *   dehydration    Days, not weeks. Thirst kills a mouse far faster than hunger.
 *   starvation     Weeks. Both are scored here the way a facility scores them,
 *                  as loss of body weight against baseline, with 20% as the
 *                  endpoint.
 *                  UC Davis IACUC-28; UNC food/water restriction standard
 *
 *   old age        Mortality doubles about every 100 days — the Gompertz law —
 *                  which puts median lifespan near 900 days for a C57BL/6J.
 *                  Mouse Phenome Database; Yuan et al. 2009
 *
 * The module owns the rules, the bookkeeping and its own panel. Deciding who
 * is near whom, and removing a body from the colony, belongs to the caller.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** one simulated day is five seconds — the same compression as brain.js */
const DAY = 5;

/** mortality doubles every ~100 days; a = the rate it doubles up from */
const GOMPERTZ_B = Math.LN2 / 100;
const GOMPERTZ_A = 9.4e-6;

const BITE_GAP = 0.8;          // seconds between bites in a sustained attack
const ATTACK_RANGE = 0.09;     // how close an attacker has to be
const CARCASS_TIME = 26;       // how long a body stays before it is removed
const WEIGHT_ENDPOINT = 0.2;   // 20% below baseline: the standard endpoint
// Days at the ceiling of each drive before that endpoint is reached. Published
// survival times are soft — 1-3 days without water, 1-3 weeks without food —
// so these sit at the forgiving end of both.
const DRY_DAYS_FATAL = 6;
const STARVE_DAYS_FATAL = 20;

export const CAUSES = {
  fight: {
    label: 'fight wounds',
    colour: '#d55181',
    note: 'Bitten on the rump and the base of the tail by another male, in a cage with nowhere to escape to.',
    ref: 'NC3Rs; Mertens et al. 2019',
  },
  wounds: {
    label: 'infected wounds',
    colour: '#c0506f',
    note: 'Died of its injuries days after the fight that caused them, which is the usual way fighting kills.',
    ref: 'NC3Rs mouse-aggression guidance',
  },
  infanticide: {
    label: 'killed by a male',
    colour: '#a84f6a',
    note: 'A male that has not mated kills pups he finds. A male that has is inhibited from it until about 50 days later.',
    ref: 'vom Saal & Howard 1982; Tsuneoka et al. 2015',
  },
  hypothermia: {
    label: 'chilled out of the nest',
    colour: '#5aa8d8',
    note: 'Pups cannot thermoregulate before about day 18. Out of the nest they cool, and most "infanticide" by mothers is a dam eating a pup that had already died this way.',
    ref: 'Lagerspetz 1966; Weber & Olsson 2008',
  },
  dehydration: {
    label: 'dehydration',
    colour: '#3987e5',
    note: 'A mouse survives days without water, against weeks without food. Scored as 20% loss of body weight, the standard humane endpoint.',
    ref: 'UC Davis IACUC-28',
  },
  starvation: {
    label: 'starvation',
    colour: '#c98500',
    note: 'Weeks rather than days, and scored the same way: 20% below baseline body weight.',
    ref: 'UNC food/water restriction standard',
  },
  drowning: {
    label: 'drowned',
    colour: '#2b6f9e',
    note: 'Mice swim well, but not indefinitely, and a flooded arena with nowhere to climb out gives them nothing else to do.',
    ref: '—',
  },
  oldAge: {
    label: 'old age',
    colour: '#9fb2c8',
    note: 'Mortality doubles roughly every 100 days. Median lifespan for a C57BL/6J is around 900 days; published figures range from 600 to 980.',
    ref: 'Mouse Phenome Database; Yuan et al. 2009',
  },
};

const CSS = `
#mortality{left:286px;top:92px;width:290px;display:none;flex-direction:column;
  max-height:min(62vh,520px);overflow:hidden auto}
#mortality .body{padding:0 10px 9px}
#mortality .mo-sec{margin-top:8px;border-top:1px solid var(--line,#15202c);padding-top:7px}
#mortality .mo-sec:first-child{border-top:0;margin-top:0;padding-top:0}
#mortality h6{margin:0 0 5px;font-size:8.5px;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink3,#64788f);display:flex;justify-content:space-between;align-items:baseline;gap:8px}
#mortality h6 i{font-style:normal;color:var(--line2,#2a3a4f);text-transform:none;letter-spacing:0}
#mortality .mo-sw{display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 5px;margin:0 -5px;
  border-radius:5px}
#mortality .mo-sw:hover{background:#18222e}
#mortality .mo-sw .track{width:26px;height:14px;border-radius:8px;background:#20303f;position:relative;
  flex:none;transition:background .15s}
#mortality .mo-sw .knob{position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;
  background:#64788f;transition:left .15s,background .15s}
#mortality .mo-sw.on .track{background:#5c2436}
#mortality .mo-sw.on .knob{left:14px;background:#d55181}
#mortality .mo-sw .lb{font-size:11px;color:var(--ink2,#9fb2c8)}
#mortality .mo-sw.on .lb{color:var(--ink,#e8eef6)}
#mortality .mo-sw .st{margin-left:auto;font-family:var(--mono,monospace);font-size:8.5px;color:var(--ink3,#64788f)}
#mortality .mo-btn{width:100%;background:#101a26;border:1px solid var(--line2,#2a3a4f);border-radius:5px;
  padding:5px 7px;color:var(--ink2,#9fb2c8);font:inherit;font-size:10.5px;cursor:pointer;text-align:left}
#mortality .mo-btn:hover{background:#1b2735;color:var(--ink,#e8eef6)}
#mortality .mo-cause{display:grid;grid-template-columns:9px 1fr auto;gap:7px;align-items:center;
  font-size:10.5px;color:var(--ink2,#9fb2c8);padding:2px 0;cursor:help}
#mortality .mo-cause s{width:9px;height:9px;border-radius:2px;text-decoration:none}
#mortality .mo-cause b{font-family:var(--mono,monospace);font-size:10px;color:var(--ink,#e8eef6)}
#mortality .mo-log{font-size:10px;color:var(--ink3,#64788f);line-height:1.5;max-height:92px;overflow-y:auto}
#mortality .mo-log div{padding:1px 0}
#mortality .mo-log b{color:var(--ink2,#9fb2c8);font-weight:600}
#mortality .mo-note{font-size:9.5px;color:var(--ink3,#64788f);line-height:1.5;margin-top:5px}
#mortality .mo-note em{font-style:normal;color:var(--ink2,#9fb2c8)}
#mortality .mo-stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
#mortality .mo-stats div{background:#101a26;border:1px solid var(--line,#15202c);border-radius:5px;padding:4px 6px}
#mortality .mo-stats label{display:block;font-size:8px;letter-spacing:.07em;text-transform:uppercase;
  color:var(--ink3,#64788f)}
#mortality .mo-stats b{font-family:var(--mono,monospace);font-size:13px;color:var(--ink,#e8eef6)}
#mortality .mo-close{background:none;border:0;color:var(--ink3,#64788f);cursor:pointer;font-size:11px;padding:0 2px}
#mortality .mo-close:hover{color:var(--ink,#e8eef6)}
`;

export class Mortality {
  constructor(ctx = {}) {
    this.ctx = ctx;
    this.lethal = true;         // can a fight kill, or only wound?
    this.infanticideOn = true;
    this.deaths = [];
    this.byCause = {};
    this.drowningWarned = false;
  }

  now() { return this.ctx.now ? this.ctx.now() : 0; }
  agents() { return this.ctx.getAgents ? this.ctx.getAgents() : []; }
  litter() { return this.ctx.getLitter ? this.ctx.getLitter() : null; }
  log(group, html) { if (this.ctx.onEvent) this.ctx.onEvent(group, html); }

  /** the survival bookkeeping an animal needs, created on first sight */
  state(ag) {
    if (ag.surv) return ag.surv;
    ag.surv = {
      dryDays: 0, starveDays: 0, swimT: 0, weightLoss: 0,
      bites: 0, bitesTaken: 0, rank: 0.5, attackT: 0, escalate: 0, stage: 0,
      joinedAt: this.now(), intruder: false,
    };
    return ag.surv;
  }

  /**
   * How familiar two animals are with each other, 0..1. A stranger is attacked
   * where a cagemate is tolerated; that difference is the entire basis of the
   * resident-intruder test, and it wears off as the newcomer settles in.
   */
  familiarity(a, b) {
    const sa = this.state(a), sb = this.state(b);
    const together = this.now() - Math.max(sa.joinedAt, sb.joinedAt);
    return clamp(together / 90, 0, 1);
  }

  // ------------------------------------------------------------- the frame
  step(dt) {
    if (dt <= 0) return;
    this.attachLitter(this.litter());
    this.stepFights(dt);
    this.stepInfanticide(dt);
    this.stepHealth(dt);
    this.stepCarcasses(dt);
  }

  // ------------------------------------------------------------- fighting
  /**
   * A mouse fight is a sequence, not a switch: tail rattling, then chasing,
   * then bites to the rump. Motivation gets an animal to the first stage; the
   * encounter itself escalates from there, which is why two males left
   * together get worse rather than settling down.
   */
  stepFights(dt) {
    const agents = this.agents();
    for (const a of agents) {
      if (a.dead) continue;
      const st = this.state(a);
      const motive = Math.max(a.brain.aggression || 0, (a.opto && a.opto.aggression) || 0);
      const target = this.ctx.nearestOther ? this.ctx.nearestOther(a) : null;
      const d = target && !target.dead
        ? Math.hypot(a.mouse.x - target.mouse.x, a.mouse.z - target.mouse.z) : Infinity;

      if (!target || target.dead || motive < 0.25 || d > ATTACK_RANGE * 3) {
        st.escalate = Math.max(0, (st.escalate || 0) - dt * 0.6);
        st.attackT = 0;
        st.stage = 0;
        continue;
      }
      // A subordinate does not fight: once an animal has lost a few exchanges
      // it submits and keeps out of the way, which is how a cage settles into
      // a dominance order instead of everyone killing everyone.
      if (st.rank < 0.3) {
        st.escalate = 0; st.attackT = 0; st.stage = 0;
        a.fightHeat = 0;
        if (d < ATTACK_RANGE * 2) a.fleeUntil = Math.max(a.fleeUntil || 0, this.now() + 2);
        continue;
      }
      // squaring up: the longer they stay nose to nose, the worse it gets
      st.escalate = clamp((st.escalate || 0) + dt * (0.25 + 0.55 * motive), 0, 1);
      const heat = clamp((motive + 0.6 * st.escalate * (0.4 + motive)) * (0.7 + 0.6 * st.rank), 0, 1);
      a.fightHeat = heat;

      // tail rattling comes first, and is worth reporting: it is the warning
      if (heat > 0.3 && !st.stage) {
        st.stage = 1;
        this.log('state', `<b>${a.name}</b> is tail-rattling at <b>${target.name}</b> — the warning before an attack`);
      }
      if (heat < 0.5 || d > ATTACK_RANGE) { st.attackT = Math.max(0, st.attackT - dt * 0.4); continue; }
      st.attackT += dt;
      if (st.attackT >= BITE_GAP) {
        st.attackT = 0;
        this.bite(a, target, heat);
      }
    }
  }

  /**
   * One bite. Severity scales with how worked up the attacker is; a single
   * bite is never fatal, and a sustained attack on an animal that cannot get
   * away is.
   */
  bite(attacker, victim, agg) {
    const sa = this.state(attacker), sv = this.state(victim);
    let sev = 0.025 + 0.075 * agg;
    // with lethal fighting off they still fight and still wound each other,
    // but the loser is never taken below the point of recovery
    if (!this.lethal) sev = Math.min(sev, Math.max(0, victim.brain.health - 0.3));
    if (sev <= 0) return;

    victim.brain.hurt(sev);
    victim.fleeUntil = this.now() + 4;
    sa.bites++;
    sv.bitesTaken++;
    // dominance is just who is doing the biting, accumulated
    sa.rank = clamp(sa.rank + 0.06, 0, 1);
    sv.rank = clamp(sv.rank - 0.06, 0, 1);

    const where = ['the rump', 'the base of the tail', 'the back'][sa.bites % 3];
    if (sa.bites % 3 === 1 || victim.brain.health < 0.4) {
      this.log('state', `<b>${attacker.name}</b> bit <b>${victim.name}</b> on ${where}`
        + ` — ${victim.brain.health > 0.4 ? 'wounded' : `<b>badly wounded</b> (${(victim.brain.health * 100) | 0}% condition)`}`);
    }
    if (!victim.brain.alive) this.kill(victim, 'fight', attacker);
  }

  // ------------------------------------------------------------- infanticide
  stepInfanticide(dt) {
    const litter = this.litter();
    if (!litter || !litter.pups || !litter.pups.length) return;
    const agents = this.agents();
    for (const ag of agents) {
      if (ag.dead) continue;
      const b = ag.brain;
      if (!this.infanticideOn || (b.infanticide || 0) < 0.4) { ag.pupAttackT = 0; continue; }
      // the nearest pup he can actually reach
      let pup = null, pd = Infinity;
      for (const p of litter.pups) {
        if (p.dead || p.carried) continue;
        const d = Math.hypot(p.x - ag.mouse.x, p.z - ag.mouse.z);
        if (d < pd) { pd = d; pup = p; }
      }
      if (!pup || pd > 0.05) { ag.pupAttackT = 0; continue; }
      // the mother drives him off: a lactating female near her pups is the
      // most aggressive animal in the cage
      const guarded = agents.some((g) => !g.dead && g !== ag && g.brain.lactating
        && Math.hypot(g.mouse.x - pup.x, g.mouse.z - pup.z) < 0.18);
      if (guarded) { ag.pupAttackT = 0; continue; }

      ag.pupAttackT = (ag.pupAttackT || 0) + dt;
      if (ag.pupAttackT < 1.1) continue;
      ag.pupAttackT = 0;
      this.killPup(pup, 'infanticide', ag);
    }
  }

  /**
   * Pup deaths are the litter's to carry out — it owns the body, the chill
   * clock and the carcass. This records them and says what they mean.
   */
  attachLitter(litter) {
    if (!litter || litter._mortalityAttached) return;
    litter._mortalityAttached = true;
    litter.onPupLost = (pup, cause) => {
      const key = cause === 'killed' ? 'infanticide' : 'hypothermia';
      this.record(`pup ${pup.id}`, key, null, 0);
      if (key === 'hypothermia') {
        this.log('state', `pup ${pup.id} <b>died of cold</b> out of the nest — `
          + `a pup cannot keep itself warm before about day 18`);
      }
      this.render();
    };
    litter.onPupEaten = (pup, by) => {
      this.log('state', `<b>${by ? by.name : 'the dam'}</b> ate the body of pup ${pup.id}`
        + ` — this is what most reported maternal infanticide actually is`);
    };
  }

  /** a male kills a pup he has found */
  killPup(pup, cause, by) {
    const litter = this.litter();
    if (!litter || pup.dead) return;
    if (typeof litter.killPup === 'function') {
      litter.killPup(pup);                      // fires onPupLost(pup, 'killed')
    } else {
      pup.dead = true;                          // fallback: no litter support
      const i = litter.pups.indexOf(pup);
      if (i >= 0) litter.pups.splice(i, 1);
      try { if (pup.mesh) litter.group.remove(pup.mesh); } catch { /* nothing to remove */ }
      this.record(`pup ${pup.id}`, cause, by, 0);
    }
    if (by) {
      this.log('state', `<b>${by.name}</b> killed pup ${pup.id} — a male that has not sired a`
        + ` litter does this, and one that has does not (<b>BSTrh</b> at`
        + ` ${by.brain.byKey.bstrh.smooth.toFixed(0)} Hz)`);
    }
  }

  // ------------------------------------------------------------- the body
  stepHealth(dt) {
    const agents = this.agents();
    const arena = this.ctx.getArena ? this.ctx.getArena() : null;
    const days = dt / DAY;
    const crowded = clamp(agents.length / 40, 0, 1);

    for (const ag of agents) {
      if (ag.dead) continue;
      const b = ag.brain;
      const st = this.state(ag);

      // ---- wounds heal, or they do not ----
      if (b.health < 1) {
        // a bad wound gets infected, and that is what actually kills: mice die
        // of fight injuries days after the fight, not during it
        const infection = b.health < 0.25 ? 0.14 * days : 0;
        b.health = clamp(b.health + 0.06 * days - infection, 0, 1);
        if (b.health <= 0) { this.kill(ag, 'wounds'); continue; }
      }

      // ---- water, then food ----
      // Only counts while the drive is pinned at its ceiling, which means the
      // animal has been trying and failing to find any: a mouse that drinks
      // occasionally never accumulates this at all.
      if (b.thirst >= 0.99 && b.drives.drink) st.dryDays += days;
      else st.dryDays = Math.max(0, st.dryDays - days * 3);
      if (b.hunger >= 0.99 && b.drives.eat) st.starveDays += days;
      else st.starveDays = Math.max(0, st.starveDays - days * 2);
      // Water kills far faster than food — days against weeks — and both are
      // scored the way a facility scores them, as loss of body weight, with
      // 20% below baseline as the endpoint.
      st.weightLoss = clamp(st.dryDays / DRY_DAYS_FATAL * WEIGHT_ENDPOINT
                          + st.starveDays / STARVE_DAYS_FATAL * WEIGHT_ENDPOINT, 0, 1);
      if (st.weightLoss > WEIGHT_ENDPOINT * 0.5 && !st.wastingNote) {
        st.wastingNote = true;
        this.log('state', `<b>${ag.name}</b> has lost <b>${(st.weightLoss * 100) | 0}%</b> of its body weight`
          + ` — ${st.dryDays > st.starveDays ? 'it cannot find water' : 'it cannot find food'}`);
      }
      if (st.weightLoss < WEIGHT_ENDPOINT * 0.2) st.wastingNote = false;
      if (st.weightLoss >= WEIGHT_ENDPOINT) {
        this.kill(ag, st.dryDays / DRY_DAYS_FATAL > st.starveDays / STARVE_DAYS_FATAL
          ? 'dehydration' : 'starvation');
        continue;
      }

      // ---- deep water with nowhere to climb out ----
      if (arena && arena.waterLevel > 0.9) {
        st.swimT += dt;
        if (st.swimT > 55 && !this.drowningWarned) {
          this.drowningWarned = true;
          this.log('state', 'the arena is too deep to stand in — they are swimming with nowhere to rest');
        }
        if (st.swimT > 115) { this.kill(ag, 'drowning'); continue; }
      } else {
        st.swimT = Math.max(0, st.swimT - dt * 2);
        if (!agents.some((g) => this.state(g).swimT > 20)) this.drowningWarned = false;
      }

      // ---- old age ----
      // Gompertz, so the risk is negligible for most of the animal's life and
      // then is not. Crowding shortens it, as it does in a real facility.
      const hazard = GOMPERTZ_A * Math.exp(GOMPERTZ_B * (ag.ageDays || 0)) * (1 + 0.5 * crowded);
      if (Math.random() < hazard * days) { this.kill(ag, 'oldAge'); continue; }
      if ((ag.ageDays || 0) > 600 && !st.agedNote) {
        st.agedNote = true;
        this.log('state', `<b>${ag.name}</b> is getting old — ${Math.round(ag.ageDays)} days, against a median lifespan near 900`);
      }
    }
  }

  // ------------------------------------------------------------- death
  kill(ag, cause, by) {
    if (ag.dead) return;
    ag.dead = true;
    ag.cause = cause;
    ag.diedAt = this.now();
    ag.auto = false;
    ag.brain.die(cause);
    // hand the rig back: a corpse does not need an articulated spine, and the
    // instanced body knows how to lie on its side
    if (ag.hasRig && this.ctx.releaseRig) this.ctx.releaseRig(ag);
    if (ag.mouse) {
      ag.mouse.dead = true;
      ag.mouse.speed = 0;
      ag.mouse.angVel = 0;
      if (ag.mouse.root && !ag.hasRig) ag.mouse.root.rotation.z = 1.5;
    }
    ag.state = 'DEAD';
    this.record(ag.name, cause, by, ag.ageDays || 0);

    const c = CAUSES[cause] || { label: cause };
    this.log('state', `<b>${ag.name}</b> died — <b>${c.label}</b>`
      + (by ? `, after a fight with ${by.name}` : '')
      + ` · ${Math.round(ag.ageDays || 0)} days old`);
    if (this.ctx.onDeath) this.ctx.onDeath(ag, cause);
    this.render();
  }

  record(name, cause, by, ageDays) {
    this.deaths.push({ name, cause, by: by ? by.name : null, ageDays, t: this.now() });
    this.byCause[cause] = (this.byCause[cause] || 0) + 1;
  }

  /** a body stays where it fell for a while, then is taken out of the cage */
  stepCarcasses(dt) {
    const agents = this.agents();
    for (const ag of agents) {
      if (!ag.dead) continue;
      if (this.now() - ag.diedAt < CARCASS_TIME) continue;
      if (agents.length <= 1) continue;           // never empty the cage entirely
      if (this.ctx.removeAgent) {
        this.ctx.removeAgent(ag);
        this.log('state', `<b>${ag.name}</b> was found dead and removed from the cage`);
      }
    }
  }

  reset() {
    this.deaths.length = 0;
    this.byCause = {};
    this.drowningWarned = false;
    for (const ag of this.agents()) {
      ag.surv = null;
      ag.dead = false;
      ag.cause = null;
    }
    this.render();
  }

  // ------------------------------------------------------------- the panel
  mount(parent) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const card = document.createElement('div');
    card.className = 'float';
    card.id = 'mortality';
    card.dataset.panel = 'mortality';
    card.innerHTML = `
      <h5 data-fold><span>fighting &amp; mortality</span><span class="tw">▾</span>
        <button class="mo-close" title="close">✕</button></h5>
      <div class="body">
        <div class="mo-sec">
          <div class="mo-sw on" data-sw="fight"><span class="track"><span class="knob"></span></span>
            <span class="lb">fighting</span><span class="st">on</span></div>
          <div class="mo-sw on" data-sw="lethal"><span class="track"><span class="knob"></span></span>
            <span class="lb">fights can kill</span><span class="st">on</span></div>
          <div class="mo-sw on" data-sw="infanticide"><span class="track"><span class="knob"></span></span>
            <span class="lb">infanticide</span><span class="st">on</span></div>
        </div>
        <div class="mo-sec">
          <h6>resident–intruder <i>the standard assay</i></h6>
          <button class="mo-btn" data-act="intruder">put an unfamiliar male in the cage</button>
          <div class="mo-note">A resident attacks a strange male and tolerates a cagemate.
            Familiarity builds over about a minute here, so the fight is in the first
            few seconds after he arrives.</div>
        </div>
        <div class="mo-sec">
          <h6>colony <i id="mo-alive"></i></h6>
          <div class="mo-stats">
            <div title="Animals alive in the cage right now"><label>alive</label><b id="mo-n">2</b></div>
            <div title="Total deaths this session, pups included"><label>deaths</label><b id="mo-d">0</b></div>
            <div title="Mean age at death, in simulated days"><label>mean age</label><b id="mo-age">—</b></div>
          </div>
          <div id="mo-causes" style="margin-top:6px"></div>
          <div class="mo-note" id="mo-pups"></div>
        </div>
        <div class="mo-sec">
          <h6>what killed them</h6>
          <div class="mo-log" id="mo-log"><div>nobody has died yet.</div></div>
        </div>
        <div class="mo-sec">
          <div class="mo-note"><em>On pups.</em> Researchers who filmed dams losing whole
            litters found no evidence of pups being killed, and concluded that females
            mostly eat pups that had already died — of cold, out of the nest. So the
            common cause here is hypothermia and the mother eating the body afterwards,
            not a mother killing her litter. Males are the ones that kill pups, and only
            until they have mated.
            <br>Weber &amp; Olsson 2008; vom Saal &amp; Howard 1982; Tsuneoka et al. 2015</div>
        </div>
      </div>`;
    (parent || document.body).appendChild(card);
    // explicit, so isOpen() can read it: an unset inline style is not 'none'
    card.style.display = 'none';
    this.card = card;

    card.querySelector('.mo-close').onclick = (e) => { e.stopPropagation(); this.open(false); };
    for (const sw of card.querySelectorAll('[data-sw]')) {
      sw.onclick = () => this.toggle(sw.dataset.sw);
    }
    card.querySelector('[data-act="intruder"]').onclick = () => {
      if (this.ctx.addIntruder) {
        const ag = this.ctx.addIntruder();
        if (ag) {
          const st = this.state(ag);
          st.intruder = true;
          st.rank = 0.36;            // residents win: that is the residency effect
        }
      }
    };
    this.render();
    return this;
  }

  toggle(key) {
    if (key === 'fight') {
      const on = !this.agents()[0].brain.drives.fight;
      for (const ag of this.agents()) ag.brain.drives.fight = on;
      this.log('state', on
        ? '<b>fighting</b> switched back on'
        : '<b>fighting</b> switched off — no aggression, and no infanticide either');
    } else if (key === 'lethal') {
      this.lethal = !this.lethal;
      this.log('state', this.lethal
        ? '<b>fights can kill</b> — a sustained attack on an animal that cannot escape is fatal'
        : '<b>fights wound but no longer kill</b> — the loser is held above the point of recovery');
    } else if (key === 'infanticide') {
      this.infanticideOn = !this.infanticideOn;
      this.log('state', this.infanticideOn ? '<b>infanticide</b> switched back on'
        : '<b>infanticide</b> switched off');
    }
    this.render();
  }

  open(v) {
    if (!this.card) return;
    this.card.style.display = v ? 'flex' : 'none';
    if (v) this.render();
  }

  isOpen() { return !!this.card && this.card.style.display !== 'none'; }

  /** the panel, redrawn on a change rather than every frame */
  render() {
    const card = this.card;
    if (!card) return;
    const agents = this.agents();
    const sw = (key, on) => {
      const el = card.querySelector(`[data-sw="${key}"]`);
      if (!el) return;
      el.classList.toggle('on', on);
      el.querySelector('.st').textContent = on ? 'on' : 'off';
    };
    sw('fight', !!(agents[0] && agents[0].brain.drives.fight));
    sw('lethal', this.lethal);
    sw('infanticide', this.infanticideOn);

    const alive = agents.filter((a) => !a.dead).length;
    card.querySelector('#mo-n').textContent = alive;
    card.querySelector('#mo-d').textContent = this.deaths.length;
    const aged = this.deaths.filter((d) => d.ageDays > 0);
    card.querySelector('#mo-age').textContent = aged.length
      ? `${Math.round(aged.reduce((s, d) => s + d.ageDays, 0) / aged.length)}d` : '—';

    const causes = card.querySelector('#mo-causes');
    causes.textContent = '';
    const entries = Object.entries(this.byCause).sort((a, b) => b[1] - a[1]);
    for (const [key, n] of entries) {
      const c = CAUSES[key] || { label: key, colour: '#64788f', note: '', ref: '' };
      const row = document.createElement('div');
      row.className = 'mo-cause';
      row.title = `${c.note}\n\n${c.ref}`;
      row.innerHTML = `<s style="background:${c.colour}"></s><span>${c.label}</span><b>${n}</b>`;
      causes.appendChild(row);
    }

    const litter = this.litter();
    const pupsEl = card.querySelector('#mo-pups');
    if (pupsEl) {
      pupsEl.textContent = litter && litter.born
        ? `pups: ${litter.count || 0} alive · ${litter.lost || 0} lost · ${litter.eaten || 0} eaten`
          + (litter.carcasses ? ` · ${litter.carcasses} uncollected` : '')
        : '';
    }

    const log = card.querySelector('#mo-log');
    log.textContent = '';
    const recent = this.deaths.slice(-8).reverse();
    if (!recent.length) {
      log.innerHTML = '<div>nobody has died yet.</div>';
    } else {
      for (const d of recent) {
        const c = CAUSES[d.cause] || { label: d.cause };
        const row = document.createElement('div');
        row.innerHTML = `<b>${d.name}</b> — ${c.label}`
          + (d.ageDays ? ` · ${Math.round(d.ageDays)}d` : '')
          + (d.by ? ` · ${d.by}` : '');
        log.appendChild(row);
      }
    }
  }
}

/** build the rig and its panel in one call, the way the optogenetics rig does */
export function mountMortality(ctx = {}) {
  const m = new Mortality(ctx);
  m.mount(ctx.mount);
  return m;
}
