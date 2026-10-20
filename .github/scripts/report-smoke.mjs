import { readFile } from 'node:fs/promises';

/** Exercise real report downloads, including choices that must stay excluded. */
export async function checkReport(page) {
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const exported = async (format) => {
    const pending = page.waitForEvent('download');
    await page.click(`#report [data-act="${format}"]`);
    const download = await pending;
    return readFile(await download.path());
  };
  const validPdf = (buffer) => {
    const text = buffer.toString('latin1');
    check(text.startsWith('%PDF-1.4') && text.endsWith('%%EOF\n'), 'Report download is not a complete PDF');
    const offset = Number(text.match(/startxref\n(\d+)/)?.[1]);
    check(text.slice(offset, offset + 4) === 'xref', 'PDF cross-reference offset is invalid');
    return text;
  };

  await page.click('#b-report');
  await page.waitForFunction(() => [...document.querySelectorAll('#rp-preview img')].every((image) => image.complete && image.naturalWidth > 0));
  check(await page.locator('[data-report-preview]').count() === 9, 'Default report sections did not appear');
  check(await page.locator('[data-report-preview="snapshots"] img').count() === 2, 'Report did not capture platform and brain images');

  // Changing the observed mouse must not silently change a report under review.
  const captured = await page.locator('#rp-snapshot-label').textContent();
  await page.getByRole('tab', { name: 'Explore', exact: true }).click();
  await page.click('#b-next-mouse');
  check(await page.locator('#rp-snapshot-label').textContent() === captured, 'Report snapshot changed without a refresh');
  await page.click('#rp-refresh');
  await page.waitForFunction((old) => document.getElementById('rp-snapshot-label').textContent !== old, captured);
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();

  await page.click('#rp-clear');
  check(await page.locator('#report [data-act="pdf"]').isDisabled(), 'An empty report can be exported');
  await page.locator('[data-report-section="mice"]').check();
  await page.selectOption('#rp-scope', 'current');
  await page.fill('#rp-title', 'Selected mouse report');
  check(await page.locator('[data-report-preview="mice"] tbody').first().locator('tr').count() === 1, 'Observed-mouse scope did not filter the preview');
  const selected = validPdf(await exported('pdf'));
  check(selected.includes('(Selected mouse report)') && selected.includes('(Mouse table)'), 'Custom title or selected section is missing from PDF');
  check(!selected.includes('/Subtype /Image') && !selected.includes('(Cage comparison)')
    && !selected.includes('(Event timeline)'), 'Unchecked sections or images leaked into PDF');
  const csv = (await exported('csv')).toString('utf8');
  check(csv.trim().split('\n').length === 2, 'Mouse CSV ignored observed-mouse scope');
  const markdown = (await exported('md')).toString('utf8');
  check(markdown.includes('## Mouse table') && !markdown.includes('## Cage comparison')
    && !markdown.includes('## Event timeline'), 'Markdown ignored section choices');

  await page.selectOption('#rp-scope', 'custom');
  await page.click('#rp-mice-none');
  check(await page.locator('#report [data-act="csv"]').isDisabled(), 'Mouse CSV is enabled with no selected mice');
  await page.locator('[data-report-mouse]').nth(0).check();
  await page.locator('[data-report-mouse]').nth(1).check();
  check(await page.locator('[data-report-preview="mice"] tbody').first().locator('tr').count() === 2, 'Custom mouse selection did not filter the table');
  check((await exported('csv')).toString('utf8').trim().split('\n').length === 3, 'CSV ignored custom mouse selection');

  await page.click('[data-preset="visual"]');
  const visual = validPdf(await exported('pdf'));
  check((visual.match(/\/Subtype \/Image/g) || []).length >= 5, 'Visual PDF did not embed simulation images and charts');
  check(visual.includes('(Neural signals)') && !visual.includes('(Mouse table)'), 'Visual preset did not control PDF content');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mlm-report-v1')));
  check(stored.scope === 'custom' && stored.mouseNames.length === 2 && stored.sections.signals && !stored.sections.mice,
    'Report choices were not saved for the next visit');
  await page.locator('#report .panel-close').click();
  return failures;
}
