import { readFile } from 'node:fs/promises';

export async function checkGenetics(page) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => localStorage.removeItem('mlm-world-v1'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.sim?.genetics.records.size === 26);
  await page.click('#b-pause');
  await page.click('#b-colony-setup');
  await page.fill('#add-mice-count', '160');
  await page.locator('#add-mice-form').getByRole('button', { name: 'Add mice', exact: true }).click();
  await page.waitForFunction(() => window.sim.agents.length === 186, {}, { timeout: 60000 });
  await page.waitForFunction(() => {
    const s = window.sim;
    return s.grid.boxes.reduce((sum, box) => sum + box.herd.mesh.count + box.agents.filter((a) => a.hasRig).length, 0) === s.agents.length;
  });
  check(await page.evaluate(() => window.sim.grid.centre.herd.max >= 160), 'Proxy rendering did not grow beyond its original capacity');
  await page.locator('#colony-setup .panel-close').click();
  await page.click('#b-colony');
  await page.fill('#colony-search', 'male 20');
  check(await page.locator('#cgrid').textContent().then((text) => text.includes('male 20')), 'Mice beyond the first page cannot be found');
  await page.locator('#colony .panel-close').click();
  await page.click('#b-genetics');
  await page.locator('.gen-breeding summary').click();
  await page.evaluate(() => {
    const s = window.sim; s.genetics.mutationRate = 0;
    for (const ag of s.agents) ag.brain.drives.mate = false;
  });
  const parents = await page.evaluate(() => {
    const s = window.sim, box = s.grid.centre;
    const mother = box.agents.find((a) => a.sex === 'F'), father = box.agents.find((a) => a.sex === 'M');
    return { mother: mother.id, father: father.id, m: mother.genetics.genome, f: father.genetics.genome };
  });
  await page.selectOption('#gn-mother', parents.mother); await page.selectOption('#gn-father', parents.father);
  await page.click('#gn-breed-submit');
  const litterSize = await page.evaluate((ids) => {
    const s = window.sim, mother = s.agents.find((a) => a.id === ids.mother);
    if (!mother.brain.pregnant) throw new Error('Breeding controls did not start pregnancy');
    // A later sire reference must not change an already conceived litter.
    mother.lastSire = mother.box.agents.find((a) => a.sex === 'M' && a.id !== ids.father);
    mother.brain.gestation = 1;
    return mother.brain.litterSize;
  }, parents);
  await page.click('#b-pause');
  await page.waitForFunction((count) => [...window.sim.genetics.records.values()].filter((record) => record.generation === 1).length === count, litterSize);
  await page.click('#b-pause');
  const children = await page.evaluate(() => [...window.sim.genetics.records.values()].filter((record) => record.generation === 1));
  for (const child of children) {
    check(child.fatherId === parents.father && child.motherId === parents.mother, 'Offspring parentage changed after conception');
    for (const key of Object.keys(child.genome)) {
      check(parents.m[key].includes(child.genome[key][0]) && parents.f[key].includes(child.genome[key][1]), 'Birth did not transmit both parents’ alleles');
    }
  }
  await page.evaluate(() => { for (const pup of window.sim.grid.centre.litter.pups) pup.age = 106; });
  await page.click('#b-pause');
  await page.waitForFunction((ids) => ids.every((id) => window.sim.agents.some((a) => a.id === id)), children.map((child) => child.id));
  await page.click('#b-pause');
  const nextParent = await page.evaluate((ids) => {
    const s = window.sim, child = s.agents.find((a) => a.id === ids.child);
    child.ageDays = 50; child.mature = true;
    const mother = child.sex === 'F' ? child : s.agents.find((a) => a.id === ids.mother);
    const father = child.sex === 'M' ? child : s.agents.find((a) => a.id === ids.father);
    s.startPregnancy(mother, father); mother.brain.gestation = 1;
    return { mother: mother.id, father: father.id, child: child.id };
  }, { ...parents, child: children[0].id });
  await page.click('#b-pause');
  await page.waitForFunction(() => [...window.sim.genetics.records.values()].some((record) => record.generation === 2));
  await page.click('#b-pause');
  const valid = await page.evaluate((parent) => {
    const s = window.sim, grandchildren = [...s.genetics.records.values()].filter((record) => record.generation === 2);
    return grandchildren.every((record) => record.fatherId === parent.father && record.motherId === parent.mother)
      && s.genetics.records.get(parent.child).children.length === grandchildren.length;
  }, nextParent);
  check(valid, 'Grandchild generation or family links are wrong');
  await page.locator('#genetics .panel-close').click(); await page.click('#b-genetics');
  check(await page.locator('#gn-cohorts tbody tr').count() === 3, 'Per-cage generations did not include G0, G1 and G2');
  await page.click('[data-gen-tab="family"]');
  await page.fill('#gn-search', nextParent.child);
  await page.locator(`#gn-mouse-list [data-relative="${nextParent.child}"]`).click();
  check(await page.locator(`#gn-pedigree [data-relative="${parents.father}"]`).count() > 0, 'Recorded father is missing from the family tree');
  const pending = page.waitForEvent('download'); await page.click('#gn-export-json');
  const exported = JSON.parse(await readFile(await (await pending).path(), 'utf8'));
  check(exported.records.some((record) => record.generation === 2 && record.motherId), 'Family export lost descendants');
  await page.locator('#genetics .panel-close').click();

  const configure = async (cages, mice) => {
    await page.click('#b-colony-setup'); await page.fill('#world-cages', String(cages)); await page.fill('#world-mice', mice == null ? '' : String(mice));
    const navigation = page.waitForNavigation({ waitUntil: 'load' });
    await page.locator('#world-settings-form').getByRole('button', { name: 'Start new colony', exact: true }).click(); await navigation;
    await page.waitForFunction((count) => window.sim?.grid.boxes.length === count, cages, { timeout: 60000 });
  };
  await configure(12, 3);
  check(await page.locator('.bx').count() === 12, 'Custom cage count did not reach the cage menu');
  check(await page.evaluate(() => window.sim.agents.length) === 36, 'Starting population input was ignored');
  check(await page.evaluate(() => window.sim.grid.tunnels.length) === 17, 'Custom cages were connected incorrectly');
  await page.click('#b-pause'); await page.selectOption('#b-cam', 'all nine'); await page.waitForTimeout(250);
  const framed = await page.evaluate(() => {
    const s = window.sim;
    return s.grid.boxes.every((box) => [-.6, .6].every((x) => [-.6, .6].every((z) => {
      const p = new s.THREE.Vector3(box.origin.x + x, 0, box.origin.z + z).project(s.camera);
      return Math.abs(p.x) <= 1.01 && Math.abs(p.y) <= 1.01;
    })));
  });
  check(framed, 'Overview camera clipped a custom cage layout');
  await configure(1, null);
  check(await page.evaluate(() => window.sim.agents.length === 2 && window.sim.grid.tunnels.length === 0 && window.sim.genetics.records.size === 2), 'Single-cage setup failed or retained the old pedigree');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#b-mobile-menu'); await page.click('#b-genetics');
  const box = await page.locator('#genetics').boundingBox(), world = await page.locator('#world').boundingBox();
  check(box.x >= 12 && box.x + box.width <= world.width - 11, 'Genetics popup escaped the phone platform');
  check(await page.locator('#b-mobile-menu').getAttribute('aria-expanded') === 'false', 'Mobile genetics launcher left the controls open');
  await page.locator('#genetics .panel-close').click();
  console.log('Inherited G1/G2 families, stable fathers, weaning, exports, 186+ mice, custom cages, camera framing and mobile genetics passed');
}
