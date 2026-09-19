/** Minimal readable shape so tests can pass an in-memory stream. */
interface Readable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
}

const SHUTDOWN_OP = '{"op":"shutdown"}';

/**
 * Cross-platform shutdown: the desktop shell writes `{"op":"shutdown"}` to the
 * sidecar stdin (or closes it) instead of SIGTERM, which Windows lacks. Fires
 * `onShutdown` once, on a shutdown line or on a silent EOF. A closed stream
 * that carried other input does not trigger shutdown.
 */
export function installShutdownListener(
  stream: Readable | undefined | null,
  onShutdown: () => void,
): void {
  if (!stream) return;
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    onShutdown();
  };
  let buffer = '';
  let sawData = false;
  stream.on('data', (chunk) => {
    const text = String(chunk);
    if (text.length > 0) sawData = true;
    buffer += text;
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line === SHUTDOWN_OP) fire();
      index = buffer.indexOf('\n');
    }
  });
  stream.on('end', () => {
    if (buffer.trim() === SHUTDOWN_OP || !sawData) fire();
  });
}
