import { expect, test } from '@playwright/test';

/**
 * Stack smoke: real server + real web build served by vite. No model turns
 * (those stay manual): proves boot, API health, session lifecycle over HTTP,
 * and that every main tab renders without client errors.
 */
test.describe('AI-GUI stack', () => {
  test('API health reports version and runtime', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
    expect(typeof body.runtime).toBe('string');
  });

  test('home loads with sessions sidebar', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto('/');
    await expect(page.getByText('Sessions', { exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('session page renders chat tabs end-to-end', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));

    const created = await request.post('/api/sessions', {
      data: { cwd: '/tmp/ai-gui-e2e' },
    });
    expect(created.ok()).toBe(true);
    const { session } = await created.json();
    expect(typeof session.id).toBe('string');

    await page.goto(`/s/${session.id}`);
    await expect(page.getByPlaceholder(/message|prompt|ask/i).first()).toBeVisible({
      timeout: 20_000,
    });

    for (const tab of ['Hub', 'Jobs', 'Settings', 'Providers', 'MCP']) {
      await page.getByRole('button', { name: tab, exact: true }).first().click();
      await expect(page.locator('section[aria-label$="panel"]').first()).toBeVisible();
    }
    expect(errors).toEqual([]);

    await request.delete(`/api/sessions/${session.id}`);
  });
  test('command palette navigates tabs', async ({ page, request }) => {
    const created = await request.post('/api/sessions', { data: { cwd: '/tmp/ai-gui-e2e' } });
    const { session } = await created.json();
    await page.goto(`/s/${session.id}`);
    await expect(page.getByPlaceholder(/prompt/i).first()).toBeVisible({ timeout: 20_000 });

    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await page.getByLabel('Command filter').fill('hub');
    await page.getByRole('button', { name: 'Go to Hub' }).click();
    await expect(page.locator('section[aria-label="hub panel"]').first()).toBeVisible();

    await request.delete(`/api/sessions/${session.id}`);
  });

  test('theme toggle persists dark/light', async ({ page }) => {
    await page.goto('/');
    const root = page.locator('html');
    await expect(root).toHaveClass(/dark/);
    await page
      .getByRole('button', { name: /Theme: / })
      .first()
      .click();
    await expect(root).not.toHaveClass(/dark/);
    expect(await page.evaluate(() => window.localStorage.getItem('ai-gui-theme'))).toBe('light');
  });
});
