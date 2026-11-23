import { test, expect, type Page } from '@playwright/test';

async function recordedApplication(page: Page) {
  // Keep the replay deterministic and independent of live API availability.
  await page.route('https://rata.digitraffic.fi/**', (route) => route.abort());
  // Preserve the /RAIDE/ base path of production builds in GitHub Actions.
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Tallenne' })).toBeVisible();
  await expect(page.locator('raide-train-table .train-select').first()).toBeVisible();
  await page.getByRole('button', { name: 'Tallenne' }).click();
}

test('ensiesittelyn tallennemuutos avaa havaintohistorian loppuun asti', async ({ page }) => {
  await recordedApplication(page);
  await page.getByRole('button', { name: /Katso tallenteen esimerkkimuutokset/ }).click();
  await expect(page.getByRole('heading', { name: /Havaitse muutos/ })).toBeVisible();
  await expect(page.locator('raide-change-radar')).toBeVisible();
  await expect(page.locator('.replay-strip')).toHaveClass(/is-recorded/);
  const replay = page.getByRole('slider', { name: 'Tallenteen toistokohta' });
  await expect(replay).toHaveValue((await replay.getAttribute('max')) ?? '');
});

test('pohjoisen rataosavalinta ei sisällä Teuvaa eikä piirrä tuettomia runkoyhteyksiä', async ({
  page,
}) => {
  await recordedApplication(page);
  await page.getByRole('button', { name: 'Elävä reittiverkko' }).click();
  const network = page.locator('raide-living-network');
  await network
    .getByRole('combobox', { name: 'Valitse reittiverkon rataosa' })
    .selectOption('north');
  await expect(network.getByRole('combobox', { name: 'Valitse reittiverkon rataosa' })).toHaveValue(
    'north',
  );
  await expect(network.locator('[data-station="TUV"]')).toHaveCount(0);
  const counts = await network.locator('.living-network-svg').evaluate((svg) => ({
    backgroundPaths: svg.querySelectorAll('path[stroke="#416073"]').length,
    realConnections: svg.querySelectorAll('.living-network-edge:not(.is-gap)').length,
  }));
  expect(counts.backgroundPaths).toBeLessThanOrEqual(counts.realConnections);
});

test('havaitun viiveen valinta avaa saman junan tilanneanalyysiin', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await recordedApplication(page);
  await page.getByRole('button', { name: 'Tilanneanalyysi' }).click();
  await expect(page.getByText('Havaitse. Tutki. Vertaile.')).toBeVisible();
  const first = page.locator('.queue-item').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.case-heading')).toContainText(/\d+/);
  await expect(page.locator('.case-stops')).toBeVisible();
  expect(errors).toEqual([]);
});

test('aikataulun kolme näkymää säilyttävät junan valinnan', async ({ page }) => {
  await recordedApplication(page);
  await page.getByRole('button', { name: 'Tilanneanalyysi' }).click();
  await page.locator('.queue-item').first().click();
  const trainName = (await page.locator('.case-heading h2').innerText()).split('\n')[0];
  await page.getByRole('button', { name: /Avaa graafinen aikataulu/ }).click();
  await expect(page.getByRole('button', { name: /Aika–paikka/ })).toBeVisible();
  await page.getByRole('button', { name: /Asemamatriisi/ }).click();
  await expect(page.locator('.matrix-table')).toBeVisible();
  await page.getByRole('button', { name: /Poikkeamat/ }).click();
  await expect(page.locator('.deviation-shell')).toContainText(trainName.trim());
  await page.getByRole('button', { name: /Aika–paikka/ }).click();
  await expect(page.locator('.chart-wrap svg')).toBeVisible();
});

test('havaintohistoria on rajattavissa ja JSON-vienti toimii', async ({ page }) => {
  await recordedApplication(page);
  await page.getByRole('slider', { name: 'Tallenteen toistokohta' }).focus();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Tilanneanalyysi' }).click();
  await page.getByRole('button', { name: 'Kaikki junat' }).click();
  await expect(page.locator('.observation-row').first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Vie JSON/ }).click();
  const result = await download;
  expect(result.suggestedFilename()).toMatch(/^raide-havainnot-.*\.json$/);
});

test('näppäimistöhaku ja lähdetietojen sulkeminen', async ({ page }) => {
  await recordedApplication(page);
  await page.keyboard.press('Control+k');
  await expect(page.locator('#global-search')).toBeFocused();
  await page.getByRole('button', { name: 'Tietoa sovelluksesta' }).click();
  await expect(page.locator('.modal-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-close')).toHaveCount(0);
});

test('rataosan valinta vaihtaa myös esitetyt liikennepaikat', async ({ page }) => {
  await recordedApplication(page);
  await page.getByRole('button', { name: 'Aikataulut' }).click();
  await page.getByRole('combobox', { name: 'Valitse rataosa' }).selectOption('commuter');
  await expect(page.locator('raide-timetable .timetable-panel')).toHaveAttribute(
    'data-corridor',
    'commuter',
  );
  await expect(page.locator('.chart-wrap')).toContainText('Riihimäki');
  await expect(page.locator('.chart-wrap')).not.toContainText('Oulu');
});

test('uudet visualisoinnit toimivat samalla aikatauluaineistolla', async ({ page }) => {
  await recordedApplication(page);
  await page.getByRole('button', { name: 'Aikataulut' }).click();
  await page.getByRole('button', { name: 'Asemaviiveet' }).click();
  await expect(page.locator('raide-heatmap .heat-cell').first()).toBeVisible();
  await page.locator('raide-heatmap .heat-cell').first().click();
  await expect(page.locator('.heat-inspector')).toBeVisible();
  await page.getByRole('button', { name: 'Junien aikajanat' }).click();
  await expect(page.locator('raide-train-lanes')).toBeVisible();
  await page.getByRole('button', { name: 'Liikennevirta' }).click();
  await expect(page.locator('raide-traffic-flow .flow-summary')).toBeVisible();
});

test('näyttöasetukset voi valita, säilyttää ja palauttaa oletuksiin', async ({ page }) => {
  await recordedApplication(page);
  await page.getByRole('button', { name: 'Aikataulut' }).click();
  await page.getByRole('button', { name: /Näyttöasetukset/ }).click();
  await page.getByRole('combobox', { name: 'Näytettävien junien määrä' }).selectOption('12');
  await expect(page.getByRole('combobox', { name: 'Näytettävien junien määrä' })).toHaveValue('12');
  await page.reload();
  await page.getByRole('button', { name: 'Aikataulut' }).click();
  await page.getByRole('button', { name: /Näyttöasetukset/ }).click();
  await expect(page.getByRole('combobox', { name: 'Näytettävien junien määrä' })).toHaveValue('12');
  await page.getByRole('button', { name: 'Palauta oletusasetukset' }).click();
  await expect(page.getByRole('combobox', { name: 'Näytettävien junien määrä' })).toHaveValue('24');
});

test('karttanäkymästä voi vaihtaa rataosien vertailuun ja linjakaavioon', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await recordedApplication(page);
  const explorer = page.locator('raide-traffic-views .traffic-explorer');
  await expect(explorer).toHaveAttribute('data-view', 'map');
  await explorer.getByRole('button', { name: 'Rataosat' }).click();
  await expect(explorer).toHaveAttribute('data-view', 'corridors');
  await expect(page.locator('.traffic-corridor-card')).toHaveCount(6);
  await page.locator('.traffic-corridor-card').first().click();
  await expect(explorer).toHaveAttribute('data-view', 'schematic');
  await expect(page.getByRole('combobox', { name: 'Valitse linjakaavion rataosa' })).toBeVisible();
  await expect(page.locator('.traffic-station-row').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('junan kulku käyttää samaa valintaa ja avaa saman palvelun aikataulun', async ({ page }) => {
  await recordedApplication(page);
  const selected = page.locator('raide-train-table .train-select').nth(1);
  await selected.click();
  const trainName = (await selected.locator('strong').innerText()).replace(/\s+/g, ' ').trim();
  await page.locator('.traffic-view-switch').getByRole('button', { name: 'Junan kulku' }).click();
  await expect(page.locator('.traffic-journey-title h3')).toContainText(trainName);
  await page.getByRole('button', { name: /Avaa graafinen aikataulu/ }).click();
  await expect(page.locator('raide-timetable .timetable-panel')).toBeVisible();
});

test('liikennenäkymän valinta ja rataosa muistetaan selaimessa', async ({ page }) => {
  await recordedApplication(page);
  await page.locator('.traffic-view-switch').getByRole('button', { name: 'Linjakaavio' }).click();
  await page.getByRole('combobox', { name: 'Valitse linjakaavion rataosa' }).selectOption('north');
  await page.reload();
  await expect(page.locator('raide-traffic-views .traffic-explorer')).toHaveAttribute(
    'data-view',
    'schematic',
  );
  await expect(page.getByRole('combobox', { name: 'Valitse linjakaavion rataosa' })).toHaveValue(
    'north',
  );
});

test('rata-kaavio on erillinen, laajennettava ja yhdistetty junavalintaan', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await recordedApplication(page);
  await page.locator('.traffic-view-switch').getByRole('button', { name: 'Ratakaavio' }).click();
  await expect(page.locator('.traffic-explorer')).toHaveAttribute('data-view', 'rata');
  await expect(page.locator('.rail-notice')).toContainText('eivät todellisia raiteita');
  const first = page.locator('.rail-approach-card').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Laajenna näkymä' }).click();
  await expect(page.locator('.rail-schematic-view')).toHaveClass(/is-expanded/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.rail-schematic-view')).not.toHaveClass(/is-expanded/);
  expect(errors).toEqual([]);
});

test('viivekartta erottaa tunnetun nollan tuntemattomasta ja tyhjästä', async ({ page }) => {
  await recordedApplication(page);
  await page.getByRole('button', { name: 'Aikataulut' }).click();
  await page.getByRole('button', { name: 'Asemaviiveet' }).click();
  const rows = page.locator('raide-heatmap .heat-cell');
  await expect(rows.first()).toBeVisible();
  await expect(page.locator('raide-heatmap .visual-footnote')).toContainText(
    'tuntematonta viivettä',
  );
  await expect(page.locator('raide-heatmap .heat-cell.empty').first()).toBeVisible();
  await rows.first().click();
  await expect(page.locator('.heat-inspector-summary')).toContainText('Viive tiedossa');
});

test('liikenteen vasen ja oikea paneeli ovat samankorkuisia työpöydällä', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await recordedApplication(page);
  const left = await page.locator('.traffic-explorer').boundingBox();
  const right = await page.locator('.right-stack').boundingBox();
  expect(left).not.toBeNull();
  expect(right).not.toBeNull();
  expect(Math.abs(left!.height - right!.height)).toBeLessThan(2);
});

test('muutostutkan aika- ja tyyppirajaukset muuttavat samaa havaintonäkymää', async ({ page }) => {
  await recordedApplication(page);
  await page.getByRole('button', { name: 'Muutostutka' }).click();
  const radar = page.locator('raide-change-radar');
  await expect(radar).toBeVisible();
  await expect(radar.getByRole('button', { name: '15 min' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await radar.getByRole('button', { name: '60 min' }).click();
  await expect(radar.getByRole('button', { name: '60 min' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await radar.getByRole('combobox', { name: 'Rajaa havaintojen tyyppi' }).selectOption('forecast');
  await expect(radar.getByRole('combobox', { name: 'Rajaa havaintojen tyyppi' })).toHaveValue(
    'forecast',
  );
  await expect(page.locator('.ops-radar-context')).toBeVisible();
});

test('valittu juna säilyy hakusuodatuksesta huolimatta etenemisnäkymässä', async ({ page }) => {
  await recordedApplication(page);
  await page.getByRole('button', { name: 'Junan eteneminen' }).click();
  const journey = page.locator('.ops-journey-primary raide-train-progress');
  await expect(journey).toBeVisible();
  const selectedTrain = await journey.locator('.progress-hero h3').innerText();
  await page.locator('#global-search').fill('ei-ole-olemassa-999999');
  await expect(page.locator('.ops-list-heading')).toContainText('0 näkyvissä');
  await expect(journey.locator('.progress-hero h3')).toHaveText(selectedTrain);
});

test('mobiilin keskeiset näkymät pysyvät vaakasuunnassa sivun sisällä', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await recordedApplication(page);
  for (const label of ['Muutostutka', 'Junan eteneminen', 'Aikataulut']) {
    await page.getByRole('button', { name: label }).click();
    const dimensions = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 2);
  }
});

test('elävä reittiverkko vaihtaa käytävää, mittakaavaa ja tallenteen hetkeä', async ({ page }) => {
  await recordedApplication(page);
  await page.getByRole('button', { name: 'Elävä reittiverkko' }).click();
  const network = page.locator('raide-living-network');
  await expect(network.locator('.living-network-stage svg')).toBeVisible();
  await expect(network.locator('.living-network-legend')).toContainText(
    'ei turvalaitteen tilakuva',
  );

  const corridor = network.getByRole('combobox', { name: 'Valitse reittiverkon rataosa' });
  await corridor.selectOption('east');
  await expect(corridor).toHaveValue('east');
  await expect(network.locator('.living-network-svg')).toContainText('Kouvola');

  const before = await network
    .locator('.living-network-svg')
    .evaluate((node) => node.getBoundingClientRect().width);
  await network.getByRole('button', { name: 'Lähennä kaaviota' }).click();
  const after = await network
    .locator('.living-network-svg')
    .evaluate((node) => node.getBoundingClientRect().width);
  expect(after).toBeGreaterThan(before);

  const timeSlider = network.getByRole('slider', { name: 'Reittiverkon tallenteen aika' });
  await expect(timeSlider).toBeVisible();
  await network.getByRole('button', { name: 'Siirry tallenteen loppuun' }).click();
  await expect(timeSlider).toHaveValue((await timeSlider.getAttribute('max')) ?? '');
});

test('reittiverkon Sovita-toiminto tuo koko käytävän vieritysalueelle', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await recordedApplication(page);
  await page.getByRole('button', { name: 'Elävä reittiverkko' }).click();
  const network = page.locator('raide-living-network');
  const stage = network.locator('.living-network-stage');
  await network.getByRole('button', { name: 'Sovita reittiverkko näkymään' }).click();
  const dimensions = await stage.evaluate((element) => ({
    viewportWidth: element.clientWidth,
    diagramWidth: element.querySelector('svg')?.getBoundingClientRect().width ?? Infinity,
  }));
  expect(dimensions.diagramWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 3);
  await expect(network.getByRole('button', { name: 'Seuraa valittua' })).toBeVisible();
});

test('keskittymistila toimii oikeasti ja palautuu Escape-näppäimellä', async ({ page }) => {
  await recordedApplication(page);
  await page.getByRole('button', { name: 'Elävä reittiverkko' }).click();
  const mode = page.getByTestId('focus-toggle');
  await expect(mode).toHaveAttribute('aria-pressed', 'false');
  await mode.click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-focus-mode', 'true');
  await expect(mode).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-focus-mode', 'false');
  await expect(mode).toHaveAttribute('aria-pressed', 'false');
});

test('pienen näytön lähdetieto pysyy näkyvissä eri tietonäkymissä', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await recordedApplication(page);
  for (const label of ['Elävä reittiverkko', 'Aikataulut', 'Junan eteneminen']) {
    await page.getByRole('button', { name: label }).click();
    await expect(page.locator('.source-pill')).toBeVisible();
    const extent = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(extent.content).toBeLessThanOrEqual(extent.viewport + 3);
  }
});

test('tuntemattoman viiveen aikajana ei näytä ääretöntä arvoa', async ({ page }) => {
  await recordedApplication(page);
  await page.getByRole('button', { name: 'Aikataulut' }).click();
  await page.getByRole('button', { name: 'Junien aikajanat' }).click();
  await expect(page.locator('raide-train-lanes')).toBeVisible();
  await expect(page.locator('raide-train-lanes .lane-delay').first()).toBeVisible();
  expect(await page.locator('raide-train-lanes .lane-delay').allTextContents()).not.toContain(
    '-Infinity min',
  );
});
