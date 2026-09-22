import { describe, expect, test } from 'bun:test';
import { respondJson } from './respond.js';

const gzipReq = { headers: { 'accept-encoding': 'gzip, deflate' } };
const plainReq = { headers: {} };

describe('respondJson', () => {
  test('leaves a small body alone', async () => {
    const res = respondJson({ ok: true }, plainReq);

    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });

  test('gzips a big body for a client that accepts it', async () => {
    const models = Array.from({ length: 4_000 }, (_, i) => ({ id: `model-${i}`, provider: 'x' }));

    const res = respondJson({ models }, gzipReq);

    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('vary')).toContain('accept-encoding');
    // The body really is the compressed wire form: its byte count is below the
    // plain text, which is what the client's decompressor consumes.
    const raw = JSON.stringify({ models });
    const wire = await res.arrayBuffer();
    expect(wire.byteLength).toBeLessThan(Buffer.byteLength(raw));
  });

  test('a matching etag answers 304 with no body', async () => {
    const res = respondJson({ models: [] }, { headers: { 'if-none-match': '"abc"' } }, '"abc"');

    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
  });

  test('a stale etag answers the body and the new etag', async () => {
    const res = respondJson({ models: [] }, { headers: { 'if-none-match': '"old"' } }, '"abc"');

    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe('"abc"');
  });
});
