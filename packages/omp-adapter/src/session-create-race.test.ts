import { expect, test } from 'bun:test';
import { SdkAdapter } from './sdk.js';

/**
 * Defect #12 (`docs/tui-parity-status.md` §10): parallel `POST /api/sessions`
 * returned `500 Agent "Main" was replaced during session initialization.` The
 * SDK registers every top-level session under one shared registry entry
 * (`Main`) and invalidation happens between `register` and `attachSession`, so
 * concurrent initialisations replace each other. `sdk/helpers.ts#runExclusive`
 * serialises that whole window; this test is the guard for that queue.
 */
test('parallel session creation never reports a replaced agent', async () => {
  const adapter = new SdkAdapter(process.cwd());
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => adapter.createSession({ cwd: process.cwd() })),
  );
  const failures = results.filter((r) => r.status === 'rejected').map((r) => String(r.reason));
  console.log('failures:', failures);
  expect(failures).toEqual([]);
  await adapter.dispose();
}, 120_000);
