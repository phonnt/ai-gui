/**
 * JSON responses for the big catalogue payloads.
 *
 * `/api/models` is ~500 KB of JSON and was going out uncompressed — the largest
 * single response the UI fetches on mount. Anything past the threshold is gzipped
 * for clients that accept it, and a caller-supplied etag turns the second read
 * into a 304.
 */
const GZIP_THRESHOLD_BYTES = 32 * 1024;

/** A `Request`, or the plain object a route test hands in. */
export interface RequestLike {
  headers: Headers | Record<string, string | undefined>;
}

function header(request: RequestLike, name: string): string {
  const { headers } = request;
  if (headers instanceof Headers) return headers.get(name) ?? '';
  const direct = headers[name];
  if (direct !== undefined) return direct;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && value !== undefined) return value;
  }
  return '';
}

export function respondJson(body: unknown, request: RequestLike, etag?: string): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json;charset=utf-8' };
  if (etag) {
    headers.etag = etag;
    if (header(request, 'if-none-match') === etag) {
      return new Response(null, { status: 304, headers });
    }
  }

  const text = JSON.stringify(body) ?? 'null';
  const acceptsGzip = header(request, 'accept-encoding').includes('gzip');
  if (acceptsGzip && Buffer.byteLength(text) > GZIP_THRESHOLD_BYTES) {
    headers['content-encoding'] = 'gzip';
    headers.vary = 'accept-encoding';
    return new Response(Bun.gzipSync(text), { headers });
  }
  return new Response(text, { headers });
}
