import { expect, test } from '@playwright/test';

/**
 * Stack smoke: real server + real web build served by vite. No model turns
 * (those stay manual): proves boot, API health, session lifecycle over HTTP,
 * and that every main tab renders without client errors.
 */
test.describe('Grove stack', () => {
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
    const sidebar = page.getByRole('complementary', { name: 'Sessions' });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'New Chat' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('session page renders chat tabs end-to-end', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));

    const created = await request.post('/api/sessions', {
      data: { cwd: '/tmp/grove-e2e' },
    });
    expect(created.ok()).toBe(true);
    const { session } = await created.json();
    expect(typeof session.id).toBe('string');

    await page.goto(`/s/${session.id}`);
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({
      timeout: 20_000,
    });

    for (const tab of ['Hub', 'Jobs', 'Settings', 'Providers', 'MCP']) {
      await page.getByRole('button', { name: tab, exact: true }).first().click();
      await expect(page.locator('section[aria-label$="panel"]').first()).toBeVisible();
    }
    expect(errors).toEqual([]);

    await request.delete(`/api/sessions/${session.id}`);
  });
  test('a session is listed as soon as it is created', async ({ request }) => {
    const created = await request.post('/api/sessions', { data: { cwd: '/tmp/grove-e2e' } });
    expect(created.ok()).toBe(true);
    const { session } = await created.json();

    // `listSessions` scans the session directory, so a session whose journal is
    // still empty used to be invisible to every client until its first message.
    const listed = await request.get('/api/sessions');
    const ids = ((await listed.json()).sessions as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(session.id);

    await request.delete(`/api/sessions/${session.id}`);
  });

  test('forking a session keeps the source reachable', async ({ request }) => {
    const created = await request.post('/api/sessions', { data: { cwd: '/tmp/grove-e2e' } });
    const { session } = await created.json();

    const forked = await request.post(`/api/sessions/${session.id}/fork`);
    expect(forked.ok()).toBe(true);
    const forkId = (await forked.json()).session.id as string;
    expect(forkId).not.toBe(session.id);

    const listed = await request.get('/api/sessions');
    const ids = ((await listed.json()).sessions as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(session.id);
    expect(ids).toContain(forkId);

    // The source must still serve its journal instead of 404ing.
    expect((await request.get(`/api/sessions/${session.id}/messages`)).status()).toBe(200);

    await request.delete(`/api/sessions/${forkId}`);
    await request.delete(`/api/sessions/${session.id}`);
  });

  test('caller conditions answer 4xx, not 500 or 200', async ({ request }) => {
    // Regression for the 2026-09-21 audit: unknown sessions answered 200 for
    // jobs and 500 for process, bad thinking levels were accepted, and a missing
    // file read as a server fault.
    expect((await request.get('/api/sessions/does-not-exist/jobs')).status()).toBe(404);
    expect((await request.get('/api/sessions/does-not-exist/messages')).status()).toBe(404);
    expect(
      (await request.post('/api/sessions/does-not-exist/process', { data: { op: 'ps' } })).status(),
    ).toBe(404);

    const created = await request.post('/api/sessions', { data: { cwd: '/tmp/grove-e2e' } });
    const { session } = await created.json();
    const badThinking = await request.post(`/api/sessions/${session.id}/thinking`, {
      data: { level: 'banana' },
    });
    expect(badThinking.status()).toBe(400);
    expect((await request.get(`/api/sessions/${session.id}/files?path=missing`)).status()).toBe(
      404,
    );

    await request.delete(`/api/sessions/${session.id}`);
  });

  test('command palette navigates tabs', async ({ page, request }) => {
    const created = await request.post('/api/sessions', { data: { cwd: '/tmp/grove-e2e' } });
    const { session } = await created.json();
    await page.goto(`/s/${session.id}`);
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 20_000 });

    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await page.getByLabel('Command filter').fill('hub');
    await page.getByRole('button', { name: 'Go to Hub' }).click();
    await expect(page.locator('section[aria-label="hub panel"]').first()).toBeVisible();

    await request.delete(`/api/sessions/${session.id}`);
  });

  test('theme toggle cycles and persists across reload', async ({ page }) => {
    // Default is light and `system` resolves against the OS, so emulate a dark
    // OS to make the cycle deterministic: light → system(dark) → dark.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const root = page.locator('html');
    const toggle = page.getByRole('button', { name: /^Theme: / }).first();
    await expect(toggle).toBeVisible();

    const isDark = async () => ((await root.getAttribute('class')) ?? '').includes('dark');
    const mode = async () =>
      ((await toggle.getAttribute('aria-label')) ?? '').replace(
        /^Theme: | \(click to change\)$/g,
        '',
      );

    expect(await isDark()).toBe(false);

    await toggle.click();
    await expect.poll(mode).toBe('system');
    expect(await isDark()).toBe(true);

    await toggle.click();
    await expect.poll(mode).toBe('dark');
    expect(await isDark()).toBe(true);

    // The stored choice — not just the current class — must survive a reload.
    await page.reload();
    await expect.poll(mode).toBe('dark');
    expect(await isDark()).toBe(true);
    expect(await page.evaluate(() => window.localStorage.getItem('grove-theme'))).toBe('dark');
  });
});
