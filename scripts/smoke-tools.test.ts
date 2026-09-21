import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runToolProbe } from './smoke-tools';

let server: ReturnType<typeof Bun.serve>;
let fail: string | undefined;
let edited = false;
let noopEdit = false;
let lspMode: 'ok' | 'no-server' | 'bad-400' = 'ok';

beforeEach(() => {
  fail = undefined;
  edited = false;
  noopEdit = false;
  lspMode = 'ok';
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
          file: {
            path: 'x',
            tag: 'a1b2',
            text: edited && !noopEdit ? 'hello edited\n' : 'hello windows\n',
            truncated: false,
          },
        });
      if (url.pathname.endsWith('/edit') && req.method === 'POST') {
        edited = true;
        return Response.json({ tag: 'c3d4', applied: true });
      }
      if (url.pathname.endsWith('/glob'))
        return Response.json({ paths: ['grove-smoke-tools.tmp.txt'], truncated: false });
      if (url.pathname.endsWith('/lsp')) {
        if (lspMode === 'no-server') {
          return Response.json(
            { error: 'No language server configured for this session' },
            { status: 400 },
          );
        }
        if (lspMode === 'bad-400') return Response.json({ error: 'bad request' }, { status: 400 });
        return Response.json({ result: {} });
      }
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
    expect(out.results.map((r) => r.tool)).toEqual([
      'session',
      'write',
      'read',
      'edit',
      'glob',
      'lsp',
      'bash',
    ]);
    expect(out.results.every((r) => r.ok)).toBe(true);
  });

  test('reports not ok when a route fails', async () => {
    fail = 'bash';
    const out = await runToolProbe(`http://127.0.0.1:${server.port}`);
    expect(out.ok).toBe(false);
    expect(out.results.find((r) => r.tool === 'bash')?.ok).toBe(false);
    expect(out.results.find((r) => r.tool === 'write')?.ok).toBe(true);
  });

  test('accepts "no language server" as an environment fact', async () => {
    lspMode = 'no-server';
    const out = await runToolProbe(`http://127.0.0.1:${server.port}`);
    const lsp = out.results.find((r) => r.tool === 'lsp');
    expect(lsp?.ok).toBe(true);
    expect(lsp?.detail).toBe('no language server configured');
    expect(out.ok).toBe(true);
  });

  test('still fails on any other 400', async () => {
    lspMode = 'bad-400';
    const out = await runToolProbe(`http://127.0.0.1:${server.port}`);
    expect(out.results.find((r) => r.tool === 'lsp')?.ok).toBe(false);
    expect(out.ok).toBe(false);
  });

  test('detects an edit that reported success but changed nothing', async () => {
    noopEdit = true;
    const out = await runToolProbe(`http://127.0.0.1:${server.port}`);
    const edit = out.results.find((r) => r.tool === 'edit');
    expect(out.ok).toBe(false);
    expect(edit?.ok).toBe(false);
    expect(edit?.detail).toBe('content unchanged after edit');
  });
});
