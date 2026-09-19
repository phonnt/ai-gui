import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runToolProbe } from './smoke-tools';

let server: Bun.Server;
let fail: string | undefined;

beforeEach(() => {
  fail = undefined;
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const tool = url.pathname.endsWith('/files')
        ? req.method === 'GET'
          ? 'read'
          : 'write'
        : url.pathname.endsWith('/bash')
          ? 'bash'
          : url.pathname.endsWith('/edit')
            ? 'edit'
            : 'session';
      if (fail === tool) return new Response('forced', { status: 500 });
      if (url.pathname === '/api/health') return Response.json({ ok: true });
      if (url.pathname === '/api/sessions' && req.method === 'POST')
        return Response.json({ session: { id: 's1' } });
      if (url.pathname.endsWith('/files') && req.method === 'POST')
        return Response.json({ bytes: 14, tag: 'a1b2' });
      if (url.pathname.endsWith('/files') && req.method === 'GET')
        return Response.json({
          file: { path: 'x', tag: 'a1b2', text: 'hello windows\n', truncated: false },
        });
      if (url.pathname.endsWith('/edit') && req.method === 'POST')
        return Response.json({ tag: 'c3d4', applied: true });
      if (url.pathname.endsWith('/bash') && req.method === 'POST')
        return Response.json({ output: 'ok\n', exitCode: 0, timedOut: false, truncated: false });
      return Response.json({ error: 'nope' }, { status: 404 });
    },
  });
});

afterEach(() => {
  server.stop(true);
});

describe('runToolProbe', () => {
  test('reports ok when every tool route answers', async () => {
    const out = await runToolProbe(`http://127.0.0.1:${server.port}`);
    expect(out.ok).toBe(true);
    expect(out.results.map((r) => r.tool)).toEqual(['session', 'write', 'read', 'edit', 'bash']);
    expect(out.results.every((r) => r.ok)).toBe(true);
  });

  test('reports not ok when a route fails', async () => {
    fail = 'bash';
    const out = await runToolProbe(`http://127.0.0.1:${server.port}`);
    expect(out.ok).toBe(false);
    expect(out.results.find((r) => r.tool === 'bash')?.ok).toBe(false);
    expect(out.results.find((r) => r.tool === 'write')?.ok).toBe(true);
  });
});
