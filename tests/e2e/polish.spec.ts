import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/** M6 polish: first-run screens, a table behind every chart, year in review, exports. */

async function open(page: Page, path = './', demo = '1') {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}demo=${demo}`);
  await expect(page.locator('main')).toBeVisible();
  return errors;
}

async function noHorizontalScroll(page: Page) {
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(w);
}

test('a fresh data repo gets a welcome and helpful empty screens', async ({ page }) => {
  const errors = await open(page, './', 'empty');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await noHorizontalScroll(page);
  for (const [path, text] of [
    ['activity', 'No transactions yet'],
    ['insights', 'after your first import'],
    ['more/review', 'Nothing to review yet'],
  ]) {
    await page.goto(`${path}?demo=empty`);
    await expect(page.getByTestId('no-data')).toContainText(text);
    await noHorizontalScroll(page);
  }
  await page.goto('more/events?demo=empty');
  await expect(page.getByText('Trips appear here on their own')).toBeVisible();
  await page.goto('./?demo=empty');
  await page.getByRole('link', { name: 'Import your first statement' }).click();
  await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('every chart has a table view', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Show budget pace as a table' }).click();
  await expect(page.getByTestId('pace-table').locator('tbody tr')).toHaveCount(31);

  await page.goto('insights?demo=1');
  for (const [what, id] of [
    ['spending over time', 'overtime-table'],
    ['money flow', 'flow-table'],
    ['spending by day', 'calendar-table'],
  ]) {
    await page.getByRole('button', { name: `Show ${what} as a table` }).click();
    await expect(page.getByTestId(id).locator('tbody tr').first()).toBeVisible();
  }
  await expect(page.getByTestId('overtime-table').locator('tbody tr')).toHaveCount(6);
  await noHorizontalScroll(page);

  await page.goto('more/events/ev-edinburgh?demo=1');
  await page.getByRole('button', { name: 'Show spending per day as a table' }).click();
  await expect(page.getByTestId('trip-day-table').locator('tbody tr')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('year in review adds up and opens the transactions behind it', async ({ page }) => {
  const errors = await open(page, 'more');
  await page.getByRole('link', { name: /Year in review/ }).click();
  await expect(page.getByTestId('year-title')).toHaveText('2026 in review');
  await expect(page.getByTestId('year-income')).toHaveText('20.257,50 €');
  await expect(page.getByTestId('year-spent')).toHaveText('17.134,83 €');
  await expect(page.getByTestId('year-saved')).toHaveText('3.122,67 €');
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Show month by month as a table' }).click();
  await expect(page.getByTestId('year-table').locator('tbody tr')).toHaveCount(10);

  await page.getByTestId('year-spent').click();
  await expect(page.getByTestId('filter-total')).toHaveText('Spent 17.134,83 €');
  expect(errors).toEqual([]);
});

test('export the filtered list as CSV and everything as a ZIP', async ({ page }) => {
  const errors = await open(page, 'activity');
  const all = await page.getByTestId('txn-count').textContent();
  await page.getByRole('button', { name: 'Sep 26' }).click();
  await expect(page.getByTestId('txn-count')).not.toHaveText(all!);
  const count = Number((await page.getByTestId('txn-count').textContent())!.split(' ')[0]);
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
  expect(csv.suggestedFilename()).toBe('mealheiro-activity-2026-10-31.csv');
  const text = readFileSync((await csv.path())!, 'utf8');
  expect(text.startsWith('﻿date,booking_date,account,merchant,')).toBe(true);
  const lines = text.trim().split('\n');
  expect(lines).toHaveLength(count + 1);
  expect(lines.slice(1).every((l) => l.startsWith('2026-09-'))).toBe(true);

  await page.goto('more?demo=1');
  const [zip] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-zip').click()]);
  expect(zip.suggestedFilename()).toMatch(/^mealheiro-data-\d{4}-\d{2}-\d{2}\.zip$/);
  const bytes = readFileSync((await zip.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(bytes.includes(Buffer.from('/transactions/2026/2026-10.csv'))).toBe(true);
  expect(errors).toEqual([]);
});

test('a dismissed tip stays dismissed on this device', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('hint-home-tap')).toBeVisible();
  await page.getByTestId('hint-home-tap').getByRole('button', { name: 'Dismiss tip' }).click();
  await expect(page.getByTestId('hint-home-tap')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByTestId('kpi-spent')).toBeVisible();
  await expect(page.getByTestId('hint-home-tap')).toHaveCount(0);
});
