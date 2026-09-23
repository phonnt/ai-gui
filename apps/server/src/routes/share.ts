import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentRuntime } from '@grove/agent-runtime';
import { HttpError } from './errors.js';

/**
 * The export is one document that grows with the session (42 MB measured on a
 * long one). Inlining it costs the server a second copy in memory and the
 * browser a third, so the default above this size is the streaming route.
 */
const INLINE_EXPORT_LIMIT_BYTES = 8 * 1024 * 1024;

/** GET /api/sessions/:id/export[?theme=user] → { html }, capped by size. */
export async function exportRoute(
  runtime: AgentRuntime,
  sessionId: string,
  userThemes?: boolean,
): Promise<{ html: string }> {
  return exportRouteCapped(runtime, sessionId, INLINE_EXPORT_LIMIT_BYTES, userThemes);
}

/** The same answer, with the cap injectable so the limit is testable. */
export async function exportRouteCapped(
  runtime: AgentRuntime,
  sessionId: string,
  maxBytes: number,
  userThemes?: boolean,
): Promise<{ html: string }> {
  const html = await runtime.exportHtml(sessionId, userThemes);
  const bytes = Buffer.byteLength(html);
  if (bytes > maxBytes) {
    throw new HttpError(
      413,
      `export is ${bytes} bytes, over the ${maxBytes}-byte inline limit — use ?as=file`,
    );
  }
  return { html };
}

/**
 * GET /api/sessions/:id/export?as=file → the html itself, streamed from disk and
 * deleted once the response has been written.
 */
export async function exportFileRoute(
  runtime: AgentRuntime,
  sessionId: string,
  userThemes?: boolean,
): Promise<Response> {
  const { path } = await runtime.exportHtmlFile(sessionId, userThemes);
  const dir = dirname(path);
  // A cancel reaches both handlers below, and two concurrent recursive deletes
  // of the same dir raced on the macOS runner (EFAULT out of `rm`) — so the
  // cleanup runs once and every caller awaits that same promise.
  let cleaned: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    cleaned ??= rm(dir, { recursive: true, force: true });
    return cleaned;
  };
  // `pipeThrough` only fires `flush` on a completed read, and Bun calls neither
  // `flush` nor a transformer cancel when the client aborts — so the stream is
  // owned here, where both paths can clean up. A cancelled 42 MB download is
  // exactly the case a user produces.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        const reader = Bun.file(path).stream().getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          await cleanup();
          controller.close();
        } catch (err) {
          await cleanup();
          controller.error(err);
        }
      })();
    },
    cancel: () => cleanup(),
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': `attachment; filename="${sessionId}.html"`,
    },
  });
}

/** GET /api/sessions/:id/dump → { text }. */
export async function dumpRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ text: string }> {
  const text = await runtime.dumpSession(sessionId);
  return { text };
}
/** POST /api/sessions/:id/share → { url, gistUrl, truncated }. */
export async function shareRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ url: string; gistUrl: string | null; truncated: boolean }> {
  return runtime.shareSession(sessionId);
}
