import { describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import { installShutdownListener } from './shutdown';

function streamOf(text: string): Readable {
  return Readable.from([text]);
}

describe('installShutdownListener', () => {
  test('fires on shutdown op', async () => {
    let called = 0;
    installShutdownListener(streamOf('{"op":"shutdown"}\n'), () => {
      called += 1;
    });
    await Bun.sleep(20);
    expect(called).toBe(1);
  });

  test('fires on EOF', async () => {
    let called = 0;
    installShutdownListener(streamOf(''), () => {
      called += 1;
    });
    await Bun.sleep(20);
    expect(called).toBe(1);
  });

  test('ignores other input', async () => {
    let called = 0;
    installShutdownListener(streamOf('hello\n'), () => {
      called += 1;
    });
    await Bun.sleep(20);
    expect(called).toBe(0);
  });
});
