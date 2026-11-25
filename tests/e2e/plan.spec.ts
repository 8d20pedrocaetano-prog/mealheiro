import { expect, test, type Page } from '@playwright/test';

/** M4 "done when" (ROADMAP): proposed trips confirm with correct totals, and next month's budgets are set. */

async function openDemo(page: Page, path = './') {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}demo=1`);
  await expect(page.locator('main')).toBeVisible();
  return errors;
}

test('confirm the proposed July trip: total 165,85 €', async ({ page }) => {
  const errors = await openDemo(page, 'more/events');
  await page.getByRole('button', { name: /Trip 2026-07-03/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('proposal-total')).toContainText('165,85 €');
  await sheet.getByLabel('Name').fill('Lisbon long weekend');
  await sheet.getByRole('button', { name: 'Confirm trip' }).click();

  await expect(page.getByText('Proposed trips')).toHaveCount(0);
  await page.getByRole('link', { name: /Lisbon long weekend/ }).click();
  await expect(page.getByRole('heading', { name: 'Lisbon long weekend' })).toBeVisible();
  await expect(page.getByText('165,85 €').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("set next month's budget; this month's limit stays", async ({ page }) => {
  const errors = await openDemo(page, 'plan');
  await expect(page.getByTestId('plan-month')).toHaveText('October 2026');
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByTestId('plan-month')).toHaveText('November 2026');
  await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();

  await page
    .getByTestId('budget-list')
    .getByRole('button', { name: /Groceries/ })
    .click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Monthly limit (€)').fill('300');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('budget-list').getByRole('button', { name: /Groceries/ })).toContainText(
    '/ 300 €',
  );

  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.getByTestId('budget-list').getByRole('button', { name: /Groceries/ })).toContainText(
    '/ 260 €',
  );

  // Suggest fills unbudgeted categories from their averages
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('button', { name: 'Suggest' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Set \d+ budgets?/ })
    .click();
  expect(await page.getByTestId('budget-list').locator('li').count()).toBeGreaterThan(6);
  expect(errors).toEqual([]);
});

test('Insights: compare and gross views, panels render', async ({ page }) => {
  const errors = await openDemo(page, 'insights');
  const net = await page.getByTestId('period-spent').textContent();
  await page.getByRole('radio', { name: 'Gross' }).click();
  const gross = await page.getByTestId('period-spent').textContent();
  expect(gross).not.toEqual(net);
  await page.getByLabel('Compare to').selectOption('previous');
  await expect(page.getByTestId('compare-table')).toBeVisible();
  await expect(page.getByText('Money flow')).toBeVisible();
  await expect(page.getByTestId('recurring-monthly')).toBeVisible();
  await page.getByTestId('calendar').getByRole('link').first().click();
  await expect(page).toHaveURL(/activity/);
  expect(errors).toEqual([]);
});
