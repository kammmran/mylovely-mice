/** Exercise actual predator presentation, per-cage sensing, navigation and cover. */
export async function checkThreatBehavior(page) {
  await page.evaluate(() => {
    const s = window.sim, ag = s.agents.find((a) => a.brain === s.brain);
    ag.box.threats.clear(); ag.box.threats.setMuted(true);
    ag.auto = true; ag.moveTarget = null; ag.fleeUntil = 0;
    ag.mouse.x = -.12; ag.mouse.z = .12; ag.mouse.speed = 0;
    ag.brain.fear = ag.brain.freeze = ag.brain.flight = 0;
    ag.brain.mode = null; ag.brain.defenseT = 0;
    ag.brain.hunger = ag.brain.thirst = .1;
    ag.behavior.interrupt();
    // The mouse has explored and remembers this refuge before the presentation.
    ag.behavior.memory(ag.box).shelter = { ...ag.box.arena.shelter };
    document.querySelector('[data-stimulus="owl"]').click();
  });
  await page.waitForFunction(() => window.sim.brain.flight > .35, {}, { timeout: 30000 });
  const exposed = await page.evaluate(() => {
    const s = window.sim, ag = s.agents.find((a) => a.brain === s.brain), t = ag.box.threats;
    const other = s.agents.find((a) => a.box !== ag.box && a.box.condition !== 'predator');
    return t.predatorVisuals.owl.visible && t.predatorVisuals.shadow.visible
      && !!ag.brain.escapeTarget && other.brain.visualThreat === 0 && other.brain.looming === 0;
  });
  if (!exposed) throw new Error('Owl visuals, refuge target or per-cage threat isolation failed');
  await page.waitForFunction(() => window.sim.brain.defenseState === 'HIDING'
    && Math.abs(window.sim.mouse.speed) < .025, {}, { timeout: 30000 });
  const hiding = await page.evaluate(() => {
    const s = window.sim, ag = s.agents.find((a) => a.brain === s.brain);
    return Math.hypot(ag.mouse.x - ag.box.arena.shelter.x, ag.mouse.z - ag.box.arena.shelter.z) < .09
      && Math.abs(ag.mouse.speed) < .025;
  });
  if (!hiding) throw new Error('Mouse did not stop beneath the refuge after escape');
  await page.evaluate(() => document.querySelector('#b-thr-clear').click());
  const cleared = await page.evaluate(() => {
    const s = window.sim, ag = s.agents.find((a) => a.brain === s.brain), t = ag.box.threats;
    return !t.predator && !t.predatorVisuals.owl.visible && !t.predatorVisuals.shadow.visible && s.brain.fear > .05;
  });
  if (!cleared) throw new Error('Removing the owl failed or reset the animal’s fear immediately');
  await page.evaluate(() => {
    const s = window.sim, ag = s.agents.find((a) => a.brain === s.brain);
    ag.mouse.x = .15; ag.mouse.z = .12; ag.mouse.heading = Math.PI / 2;
    document.querySelector('[data-stimulus="cat"]').click();
  });
  await page.waitForFunction(() => window.sim.brain.visualThreat > .15 && window.sim.brain.threatKind === 'cat', {}, { timeout: 30000 });
  const cat = await page.evaluate(() => {
    const s = window.sim, ag = s.agents.find((a) => a.brain === s.brain), t = ag.box.threats;
    return t.predatorVisuals.cat.visible && !t.predatorVisuals.owl.visible && t.predatorVisuals.cat.position.x > ag.box.arena.half;
  });
  if (!cat) throw new Error('Cat prop is missing or was placed inside the cage');
  await page.evaluate(() => document.querySelector('#b-thr-clear').click());
  console.log('Cat and owl visuals, cage isolation, directed escape, hiding and gradual recovery passed');
}
