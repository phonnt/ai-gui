#!/usr/bin/env bun
// CI gate: typecheck + lint + test. Usage: bun run check
import { spawnSync } from 'node:child_process';

const steps: string[][] = [
  ['bun', 'run', 'typecheck'],
  ['bun', 'run', 'lint'],
  ['bun', 'run', 'test'],
  // Boots the server and probes its routes: typecheck/lint/test never import
  // the server entry, so runtime-only breakage (a missing module, an unwired
  // route) used to pass the gate and fail at startup.
  ['bun', 'run', 'smoke:server'],
];

for (const step of steps) {
  const [cmd, ...args] = step;
  if (!cmd) continue;
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`FAILED: ${cmd} ${args.join(' ')}`);
    process.exit(res.status ?? 1);
  }
}
console.log('check: all green');
