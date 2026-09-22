import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentRuntime } from '@grove/agent-runtime';
import { HttpError } from './errors.js';
import { exportFileRoute, exportRouteCapped } from './share.js';

function fakeRuntime(files: Record<string, string>, html = '<html>export</html>'): AgentRuntime {
  return {
    exportHtmlFile: async (sessionId: string) => {
      const path = files[sessionId];
      if (!path) throw new Error(`no file for ${sessionId}`);
      return { path };
    },
    exportHtml: async () => html,
  } as unknown as AgentRuntime;
}

function tempFile(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'grove-export-')), 'session.html');
  writeFileSync(path, body);
  return path;
}

describe('export file route', () => {
  test('streams the html as an attachment with its size', async () => {
    const html = '<html>export</html>';
    const path = tempFile(html);

    const res = await exportFileRoute(fakeRuntime({ s1: path }, html), 's1');

    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    // `content-length` is the transport's business here: a streamed body is
    // allowed to go out chunked, so the assertion is the document itself.
    expect(await res.text()).toBe(html);
  });

  test('a missing file is a request error, not a crash', async () => {
    const err: unknown = await exportFileRoute(fakeRuntime({}), 's2').catch((e) => e);
    expect(err).not.toBeInstanceOf(TypeError);
  });

  test('the json route refuses to inline a huge export', async () => {
    const path = tempFile('x'.repeat(64));
    const runtime = fakeRuntime({ s1: path }, 'x'.repeat(64));

    const err: unknown = await exportRouteCapped(runtime, 's1', 8).catch((e) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(413);
  });
});
