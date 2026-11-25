import { expect, test } from '@playwright/test';

test.describe('demo mode smoke test', () => {
  test('lists all 412 + 2 demo transactions with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('./');
    await page.getByRole('button', { name: 'Try the demo' }).click();
    await page.getByRole('link', { name: 'Activity' }).first().click();
    await expect(page.getByTestId('txn-count')).toHaveText('414 transactions');
    expect(errors).toEqual([]);
  });

  test('every tab renders, and the Spent total taps through to the same total', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('./?demo=1');
    await expect(page.getByTestId('home-month')).toHaveText('October 2026');
    const spent = (await page.getByTestId('kpi-spent').textContent())!.trim();
    expect(spent).toBe('1.734,94\u00a0€');
    await page.getByTestId('kpi-spent').click();
    await expect(page.getByTestId('filter-total')).toHaveText(`Spent ${spent}`);

    await page.getByRole('link', { name: 'Insights' }).first().click();
    await expect(page.locator('main canvas').first()).toBeVisible();
    // a merchant tap-through filters by merchant without putting the name in the URL
    await page.getByRole('link', { name: /^Rent/ }).first().click();
    await expect(page.getByText('Rent · Last 6 months')).toBeVisible();
    expect(page.url()).not.toContain('Rent');
    await page.goBack();
    await page.getByRole('link', { name: 'More' }).first().click();
    await page
      .getByRole('link', { name: /Imports/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: /Imports/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('works offline after the first load', async ({ page, context }) => {
    await page.goto('./?demo=1');
    await expect(page.locator('main')).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    // reload so the activated service worker (precache complete) controls the page
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.goto('./activity?demo=1');
    await expect(page.getByTestId('txn-count')).toHaveText('414 transactions');
    await context.setOffline(false);
  });

  test('serves a web app manifest with installable icons', async ({ request }) => {
    const res = await request.get('manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/mealheiro/?source=pwa');
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
  });
});
