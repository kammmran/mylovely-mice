export async function checkAnatomy(page) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  await page.evaluate(() => {
    const s = window.sim, ag = s.agents.find((a) => a.brain === s.brain);
    ag.box.threats.clear(); ag.auto = false; ag.mouse.x = 0; ag.mouse.z = 0; ag.mouse.speed = .12;
    ag.moveTarget = { x: 0, z: .4 }; ag.mouse.heading = 0;
    ag.brain.drives.fear = false; ag.brain.mode = null;
    ag.brain.fear = ag.brain.freeze = ag.brain.flight = 0;
  });
  await page.click('#b-anatomy');
  await page.waitForFunction(() => window.sim.anatomy.model?.simTime > 0);
  const pose = await page.locator('#anatomy').getAttribute('data-pose');
  await page.waitForFunction((before) => document.getElementById('anatomy').dataset.pose !== before, pose, { timeout: 30000 });
  await page.click('#b-pause');
  await page.waitForFunction(() => {
    const s = window.sim, source = s.mouse, copy = s.anatomy.model.mouse;
    return source.legs.every((leg, i) => Math.abs(leg.hip.rotation.x - copy.legs[i].hip.rotation.x) < 1e-6
      && Math.abs(leg.knee.rotation.x - copy.legs[i].knee.rotation.x) < 1e-6);
  });
  const paused = await page.locator('#anatomy').getAttribute('data-pose');
  await page.waitForTimeout(300);
  check(await page.locator('#anatomy').getAttribute('data-pose') === paused, 'Skeleton moved while the colony was paused');
  for (const layer of ['organs', 'circulation', 'nervous', 'overview', 'skeleton']) {
    await page.click(`#anatomy [data-layer="${layer}"]`);
    const valid = await page.evaluate((selected) => {
      const parts = [...window.sim.anatomy.model.parts.values()];
      return parts.every((part) => part.meshes.every((mesh) => mesh.visible === (selected === 'overview' || part.layer === selected)));
    }, layer);
    check(valid, `Anatomy layer ${layer} showed the wrong structures`);
  }
  await page.locator('#an-parts [data-part="ribs"]').click();
  check((await page.locator('#an-detail').textContent()).includes('heart and lungs'), 'Structure selection did not update its explanation');
  await page.uncheck('#an-skin');
  check(await page.evaluate(() => window.sim.anatomy.model.skin.every((mesh) => !mesh.visible)), 'Body outline could not be hidden');
  await page.check('#an-skin');
  await page.uncheck('#an-motion');
  await page.click('#b-pause');
  const frozen = await page.locator('#anatomy').getAttribute('data-pose');
  const t = await page.evaluate(() => window.sim.brain.t);
  await page.waitForFunction((before) => window.sim.brain.t > before + .25, t);
  check(await page.locator('#anatomy').getAttribute('data-pose') === frozen, 'Freezing the anatomy view did not hold its pose');
  await page.check('#an-motion');
  const oldMouse = await page.locator('#anatomy').getAttribute('data-mouse');
  await page.click('#b-next-mouse');
  await page.waitForFunction((before) => document.getElementById('anatomy').dataset.mouse !== before, oldMouse);
  await page.locator('#anatomy .panel-close').click();
  await page.click('#b-pause');
  await page.selectOption('#b-cam', 'top');
  await page.waitForTimeout(300);
  const click = await page.evaluate(() => {
    const s = window.sim, ag = s.agents.find((a) => a.brain === s.brain), rect = document.getElementById('world').getBoundingClientRect();
    const p = new s.THREE.Vector3(ag.box.origin.x + ag.mouse.x, .02, ag.box.origin.z + ag.mouse.z).project(s.camera);
    return { x: rect.left + (p.x * .5 + .5) * rect.width, y: rect.top + (-p.y * .5 + .5) * rect.height };
  });
  await page.mouse.click(click.x, click.y);
  await page.waitForFunction(() => window.sim.anatomy.isOpen());
  check(await page.evaluate(() => window.sim.agents.find((a) => a.brain === window.sim.brain).moveTarget === null), 'Clicking a mouse also sent it to a floor target');
  check(await page.locator('#anatomy').count() === 1, 'Mouse clicks created duplicate anatomy windows');
  await page.locator('#anatomy .panel-close').click();
  await page.selectOption('#b-cam', 'all nine');
  await page.waitForTimeout(500);
  const proxy = await page.evaluate(() => {
    const s = window.sim;
    const ag = s.agents.find((a) => !a.hasRig && !a.dead && a.box.agents.every((b) => b === a
      || Math.hypot(a.mouse.x - b.mouse.x, a.mouse.z - b.mouse.z) > .14));
    if (!ag) throw new Error('No isolated proxy available for anatomy picking');
    const rect = document.getElementById('world').getBoundingClientRect();
    const p = new s.THREE.Vector3(ag.box.origin.x + ag.mouse.x, .02, ag.box.origin.z + ag.mouse.z).project(s.camera);
    return { name: ag.name, x: rect.left + (p.x * .5 + .5) * rect.width, y: rect.top + (-p.y * .5 + .5) * rect.height };
  });
  await page.mouse.click(proxy.x, proxy.y);
  await page.waitForFunction((name) => window.sim.anatomy.isOpen()
    && document.getElementById('anatomy').dataset.mouse === name, proxy.name, { timeout: 30000 });
  await page.locator('#anatomy .panel-close').click();
  await page.click('#b-pause');
  await page.evaluate(() => { for (const ag of window.sim.agents) ag.brain.drives.fear = true; });
  console.log('Live skeleton joints, pause and view freeze, anatomy layers, and detailed/proxy mouse-click popups passed');
}
