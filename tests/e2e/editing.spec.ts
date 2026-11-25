import { expect, test, type Page } from '@playwright/test';

/** M3 editing flows in demo mode (edits stay in memory). SPEC §4.2, §4.6, §4.7 acceptance criteria. */

async function openDemo(page: Page, path = './') {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}demo=1`);
  await expect(page.locator('main')).toBeVisible();
  return errors;
}

test('cash: itemise a withdrawal in three taps, Spent unchanged', async ({ page }) => {
  const errors = await openDemo(page);
  await expect(page.getByTestId('home-month')).toHaveText('October 2026');
  const spent = await page.getByTestId('kpi-spent').textContent();

  await page.getByRole('link', { name: 'Activity' }).first().click();
  await page.getByRole('button', { name: 'Oct 26' }).click();
  await page
    .getByRole('button', { name: /Cash withdrawal/ })
    .first()
    .click();

  await page.getByRole('button', { name: 'What was this cash for?' }).click(); // tap 1
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Restaurants/ })
    .first()
    .click(); // tap 2
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click(); // tap 3

  await expect(
    page.getByRole('dialog').getByText('40,00 € of 40,00 € itemised', { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('40,00 € of 40,00 € itemised').first()).toBeVisible();

  await page.getByRole('link', { name: 'Home' }).first().click();
  await expect(page.getByTestId('kpi-spent')).toHaveText(spent!);
  expect(errors).toEqual([]);
});

test('excluding a transaction updates Home at once', async ({ page }) => {
  const errors = await openDemo(page, './activity');
  await page.getByRole('button', { name: 'Oct 26' }).click();
  await page
    .getByRole('button', { name: /Continente Col.*82,96/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Exclude' }).click();
  await page.getByRole('button', { name: 'Exclude from analysis' }).click();
  await expect(page.getByRole('dialog').getByText('Excluded from analysis.')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Home' }).first().click();
  await expect(page.getByTestId('kpi-spent')).toHaveText('1.651,98 €');
  await expect(page.getByTestId('sync-badge').filter({ visible: true }).first()).toContainText('1 edit');
  expect(errors).toEqual([]);
});

test('quick add: + to saved in three taps plus the amount', async ({ page }) => {
  const errors = await openDemo(page, './activity');
  await expect(page.getByTestId('txn-count')).toHaveText('414 transactions');
  await page.getByRole('button', { name: 'Quick add' }).click(); // tap 1
  await page.keyboard.type('4,50');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Groceries/ })
    .click(); // tap 2
  await page.getByTestId('quick-add-save').click(); // tap 3
  await expect(page.getByTestId('txn-count')).toHaveText('415 transactions');
  expect(errors).toEqual([]);
});

test('review inbox: naming a person clears their card', async ({ page }) => {
  const errors = await openDemo(page, './more/review');
  const before = Number((await page.getByTestId('review-count').textContent())!.match(/\d+/)![0]);
  // skip to the first "Who is this?" card
  for (let i = 0; i < 60 && !(await page.getByText('Who is this?').isVisible()); i++)
    await page.getByRole('button', { name: 'Later' }).click();
  await page.getByLabel('Nickname').fill('Flatmate');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('review-count')).toContainText(`${before - 1} to go`);
  expect(errors).toEqual([]);
});
