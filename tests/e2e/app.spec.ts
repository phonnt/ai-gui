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

  test('parallel session creation does not collide', async ({ request }) => {
    // Regression: the SDK registers every top-level session under one shared
    // registry entry, so concurrent creates used to fail with
    // `Agent "Main" was replaced during session initialization.` (5-7 of 8).
    const created = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request.post('/api/sessions', { data: { cwd: `/tmp/grove-e2e/parallel-${i}` } }),
      ),
    );
    for (const res of created) expect(res.ok()).toBe(true);
    const ids = await Promise.all(created.map(async (res) => (await res.json()).session.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) await request.delete(`/api/sessions/${id}`);
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
    // The browser prelude has no `capabilities` action; the computer prelude does.
    expect(
      (
        await request.post(`/api/sessions/${session.id}/browser`, {
          data: { action: 'capabilities' },
        })
      ).status(),
    ).toBe(400);

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
  test('kit controls keep their oc-2 metrics', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const metrics = await page.evaluate(() => {
      const px = (el: Element | null, prop: string) =>
        el ? getComputedStyle(el)[prop as never] : null;
      const btn = document.querySelector('[class*="h-7"]');
      const tag = document.querySelector('[class*="text-meta"]');
      return { buttonHeight: px(btn, 'height'), tagSize: px(tag, 'fontSize') };
    });
    expect(metrics.buttonHeight).toBe('28px');
    expect(metrics.tagSize).toBe('11px');
  });

  test('the settings shell stays inside its dialog frame', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();

    // Dialog is a column, the settings shell is a row: the row must be a single
    // child that fits, otherwise the panes stack and overflow the 85vh frame.
    const fit = await dialog.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const kids = [...el.children].map((child) => child.getBoundingClientRect());
      return {
        children: kids.length,
        overflowBottom: Math.round(Math.max(...kids.map((k) => k.bottom)) - box.bottom),
        overflowRight: Math.round(Math.max(...kids.map((k) => k.right)) - box.right),
        paneHeight: Math.round(kids[0]?.height ?? 0),
        frameHeight: Math.round(box.height),
      };
    });
    expect(fit.children).toBe(1);
    expect(fit.overflowBottom).toBeLessThanOrEqual(0);
    expect(fit.overflowRight).toBeLessThanOrEqual(0);
    expect(Math.abs(fit.paneHeight - fit.frameHeight)).toBeLessThanOrEqual(1);
  });

  test('the model picker shows the thinking level the session will use', async ({
    page,
    request,
  }) => {
    const created = await request.post('/api/sessions', { data: { cwd: '/tmp/grove-e2e' } });
    const { session } = await created.json();
    // No level has been set on this session, so `GET /models` reports `thinking:
    // null` — the picker used to print "default" even though the session will
    // actually run at the level `GET /thinking` reports.
    const effective = await (await request.get(`/api/sessions/${session.id}/thinking`)).json();
    expect(typeof effective.thinking).toBe('string');

    await page.goto(`/s/${session.id}`);
    await expect(
      page.getByRole('button', { name: new RegExp(`Thinking: ${effective.thinking}`) }),
    ).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`Thinking: ${effective.thinking}`) }).click();
    await expect(
      page.getByRole('button', { name: effective.thinking, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('the explorer manages ssh hosts end to end', async ({ page, request }) => {
    const created = await request.post('/api/sessions', { data: { cwd: '/tmp/grove-e2e' } });
    const { session } = await created.json();
    const name = `e2e-${Date.now().toString().slice(-6)}`;

    await page.goto(`/s/${session.id}`);
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    const section = page.locator('section', { hasText: 'SSH hosts' });
    await section.getByRole('button', { name: 'project', exact: true }).click();
    await section.getByLabel('SSH host name').fill(name);
    await section.getByLabel('SSH host address').fill('10.0.0.9');
    await section.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(section.getByText(name, { exact: true })).toBeVisible();

    // The host must exist server-side too, in the project scope config.
    const listed = await (
      await request.get(`/api/sessions/${session.id}/ssh?scope=project`)
    ).json();
    expect(listed.hosts).toContain(name);

    await section.getByRole('button', { name: `Remove ${name}` }).click();
    await expect(section.getByText(name, { exact: true })).toHaveCount(0);
  });

  test('the explorer reports the git branch of the session cwd', async ({ page, request }) => {
    // The repo itself is the cwd here: a real checkout, so the branch is real.
    const created = await request.post('/api/sessions', { data: { cwd: process.cwd() } });
    const { session } = await created.json();
    const { execFileSync } = await import('node:child_process');
    const expected = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: process.cwd(),
    })
      .toString()
      .trim();

    await page.goto(`/s/${session.id}`);
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    const section = page.locator('section', { hasText: 'Git' }).first();

    // The status route shells out twice through the tool path, and the first
    // tool call in a run pays its warm-up, so this needs more than the default.
    if (expected !== 'HEAD') {
      await expect(section.getByText(expected, { exact: true })).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(section.getByText('detached HEAD', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
    }

    // Clicking a changed file asks for its diff and renders it.
    const firstFile = section.locator('button[aria-pressed]').first();
    if (await firstFile.count()) {
      await firstFile.click();
      await expect(section.locator('pre')).toBeVisible({ timeout: 30_000 });
    }
  });

  test('export streams a document for a session that has a journal', async ({ request }) => {
    const listed = await (await request.get('/api/sessions')).json();
    const withJournal = (listed.sessions ?? []).find(
      (session: { messageCount?: number }) => (session.messageCount ?? 0) > 0,
    );
    // A fresh e2e agent dir has no journalled session; the route's own unit test
    // covers streaming in that case, so this asserts the real one when present.
    test.skip(!withJournal, 'no session with a journal in this agent dir');

    const res = await request.get(`/api/sessions/${withJournal.id}/export?as=file`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
    expect(res.headers()['content-disposition']).toContain('attachment');
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  test.describe('provider login', () => {
    test('the dialog drives the OAuth flow from the browser', async ({ page, request }) => {
      const created = await request.post('/api/sessions', { data: { cwd: '/tmp/grove-e2e' } });
      const { session } = await created.json();

      // A test must never start a real provider flow, and the button it clicks
      // depends on the machine's stored credentials: stub both.
      const attempt = {
        attemptId: 'a1',
        providerId: 'probe-oauth',
        status: 'running',
        auth: { url: 'https://probe.test/authorize?state=abc' },
      };
      const posted: unknown[] = [];
      // The attempt advances when the code is submitted; a status stub that
      // always answered needs-input would flip the dialog back mid-assert.
      let status: 'needs-input' | 'complete' = 'needs-input';
      await page.route('**/api/providers', (route) =>
        route.fulfill({
          json: { providers: [{ id: 'probe-oauth', available: false, auth: 'none', login: true }] },
        }),
      );
      await page.route('**/api/providers/probe-oauth/login', (route) =>
        route.fulfill({ json: { attempt } }),
      );
      await page.route('**/api/providers/logins/a1', (route) =>
        route.fulfill({
          json: {
            attempt:
              status === 'needs-input'
                ? { ...attempt, status, prompt: { message: 'Paste the code' } }
                : { ...attempt, status, identity: { email: 'probe@example.test' } },
          },
        }),
      );
      await page.route('**/api/providers/logins/a1/input', async (route) => {
        posted.push(route.request().postDataJSON());
        status = 'complete';
        await route.fulfill({
          json: {
            attempt: { ...attempt, status, identity: { email: 'probe@example.test' } },
          },
        });
      });

      await page.goto(`/s/${session.id}`);
      await page.getByRole('button', { name: 'Providers', exact: true }).first().click();
      await page.getByRole('button', { name: 'Login probe-oauth' }).click();

      await expect(page.getByText('https://probe.test/authorize?state=abc')).toBeVisible();
      await page.getByLabel('Authorization code').fill('code-1');
      await page.getByRole('button', { name: 'Submit code' }).click();

      await expect(page.getByText('probe@example.test')).toBeVisible();
      expect(posted).toEqual([{ value: 'code-1' }]);

      await request.delete(`/api/sessions/${session.id}`);
    });
  });

  test.describe('hairline recipes', () => {
    test('compile to 0.5px and carry the state colour', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const css = await page.evaluate(() => {
        const fromSheets = [...document.styleSheets]
          .flatMap((sheet) => {
            try {
              return [...sheet.cssRules].map((rule) => rule.cssText);
            } catch {
              return [];
            }
          })
          .join('\n');
        const fromTags = [...document.querySelectorAll('style')]
          .map((tag) => tag.textContent ?? '')
          .join('\n');
        return `${fromSheets}\n${fromTags}`;
      });

      const ruleFor = (cls: string, prop: string) =>
        new RegExp(`\\.${cls}\\s*\\{[^}]*${prop}:\\s*0?\\.5px`);
      for (const recipe of ['panel-plain', 'panel-plain-active']) {
        expect(`${recipe}:${ruleFor(recipe, 'border-width').test(css)}`).toBe(`${recipe}:true`);
      }
      expect(`hairline-r:${ruleFor('hairline-r', 'border-right-width').test(css)}`).toBe(
        'hairline-r:true',
      );

      // Same recipes on the live page: the state rows must not be the plain rule.
      const probe = await page.evaluate(() => {
        const host = document.createElement('div');
        document.body.append(host);
        const read = (cls: string) => {
          const el = document.createElement('div');
          el.className = cls;
          host.append(el);
          const style = getComputedStyle(el);
          return { color: style.borderTopColor, bg: style.backgroundColor };
        };
        return {
          plain: read('panel-plain'),
          active: read('panel-plain-active'),
          link: read('panel-link'),
          warning: read('panel-warning'),
        };
      });
      expect(probe.active.color).not.toBe(probe.plain.color);

      // A card on the home screen carries the plain recipe and swaps to the
      // strong rule on hover.
      const card = page.locator('a.panel, button.panel').first();
      const idle = await card.evaluate((el) => getComputedStyle(el).borderTopColor);
      await card.hover();
      await expect
        .poll(() => card.evaluate((el) => getComputedStyle(el).borderTopColor))
        .not.toBe(idle);
    });
  });
});
