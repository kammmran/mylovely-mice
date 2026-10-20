/** A thirsty mouse must turn, approach water and complete a drinking bout. */
export async function checkMouseBehavior(page) {
  const before = await page.evaluate(() => {
    const s = window.sim, agent = s.agents.find((a) => a.brain === s.brain), dish = agent.box.arena.dish;
    agent.auto = true; agent.fleeUntil = 0;
    agent.brain.hunger = .1; agent.brain.thirst = .85;
    agent.mouse.x = dish.x - .18; agent.mouse.z = dish.z;
    agent.mouse.heading = -Math.PI / 2; agent.mouse.speed = 0;
    agent.behavior.interrupt(); agent.behavior.perceiveIn = 0;
    return agent.brain.drinkCount || 0;
  });
  await page.selectOption('#b-speed', '4');
  await page.waitForFunction((count) => window.sim.brain.drinkCount > count, before, { timeout: 30000 });
  await page.selectOption('#b-speed', '1');
  const valid = await page.evaluate(() => window.sim.agents.every((a) => [a.mouse.x, a.mouse.z, a.mouse.speed].every(Number.isFinite)));
  if (!valid) throw new Error('A mouse produced invalid movement coordinates');
  await page.evaluate(() => document.querySelector('#mortality [data-act="intruder"]').click());
  await page.waitForFunction(() => {
    const agents = window.sim.agents, boxes = [...new Set(agents.map((a) => a.box))];
    return agents.every((a) => a.box.agents.includes(a)) && boxes.reduce((sum, box) =>
      sum + box.herd.mesh.count + box.agents.filter((a) => a.hasRig).length, 0) === agents.length;
  }, {}, { timeout: 30000 });
}
