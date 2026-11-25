import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** M5 in-app import in demo mode (SPEC §4.8 AC): read on device, preview, commit; twice adds nothing. */

async function openImport(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('more/import?demo=1');
  await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
  return errors;
}

test('the synthetic CGD PDF is read on the device; importing it again adds nothing', async ({ page }) => {
  const errors = await openImport(page);
  await page.getByTestId('import-file').setInputFiles('fixtures/cgd/synthetic-statement.pdf');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('import-preview')).toBeVisible();
  await expect(sheet.getByText('Balance checks pass')).toBeVisible({ timeout: 15000 });
  await expect(sheet.getByText('closing balance 5.552,92 €')).toBeVisible();
  await expect(sheet.getByTestId('import-new')).toHaveText('0');
  await expect(sheet.getByText(/You imported this file on 15\/11\/2026/)).toBeVisible();
  await expect(sheet.getByTestId('import-commit')).toHaveCount(0);
  await expect(sheet.getByTestId('import-close')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a Revolut CSV adds its new rows once, then offers to track the account', async ({ page }) => {
  const errors = await openImport(page);
  await page.getByTestId('import-file').setInputFiles('fixtures/revolut/synthetic.csv');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('import-new')).toHaveText('7');
  await expect(sheet.getByText('1 row left out: not completed')).toBeVisible();
  await sheet.getByTestId('import-commit').click();
  await expect(sheet.getByTestId('import-done')).toContainText('Added 7 transactions');
  await expect(page.getByTestId('sync-badge').filter({ visible: true }).first()).toContainText('1 edit');
  await sheet.getByRole('button', { name: 'Track Revolut' }).click();
  await sheet.getByRole('button', { name: 'See them' }).click();
  await expect(page.getByText('Padaria Exemplo')).toBeVisible();

  // the same file again (same session, edits kept in memory): nothing to add
  await page.goBack();
  await page.getByTestId('import-file').setInputFiles('fixtures/revolut/synthetic.csv');
  const again = page.getByRole('dialog');
  await expect(again.getByTestId('import-new')).toHaveText('0');
  await expect(again.getByText(/You imported this file on/)).toBeVisible();
  await expect(again.getByTestId('import-commit')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a PayPal CSV names PayPal payments and sets their category', async ({ page }) => {
  const errors = await openImport(page);
  await page.getByTestId('import-file').setInputFiles('fixtures/paypal/synthetic.csv');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('paypal-matches').locator('li')).toHaveCount(4);
  await sheet.getByRole('button', { name: /^Save 1 payment/ }).click();
  await expect(sheet).toBeHidden();
  expect(errors).toEqual([]);
});

test('a statement shared from another app (Android share target) opens in the preview', async ({ page }) => {
  await page.goto('./?demo=1');
  await expect(page.locator('main')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const csv = readFileSync('fixtures/revolut/synthetic.csv', 'utf8');
  // what Chrome does when the owner shares a file to the installed app: a multipart POST navigation
  await page.evaluate((text) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.enctype = 'multipart/form-data';
    form.action = '/mealheiro/share-target';
    const input = document.createElement('input');
    input.type = 'file';
    input.name = 'file';
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'revolut.csv', { type: 'text/csv' }));
    input.files = dt.files;
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
  }, csv);
  await page.waitForURL(/\/mealheiro\/more\/import\?shared=1$/);
  // (a real install is connected to the data repo; the test reopens it in demo mode)
  await page.goto('more/import?shared=1&demo=1');
  await expect(page.getByRole('dialog').getByTestId('import-new')).toHaveText('7');
  await expect(page).not.toHaveURL(/shared=1/);
});
