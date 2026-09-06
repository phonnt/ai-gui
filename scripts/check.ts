#!/usr/bin/env bun
// CI gate: typecheck + lint + test. Usage: bun run check
import { spawnSync } from 'node:child_process';

const steps: string[][] = [
  ['bun', 'run', 'typecheck'],
  ['bun', 'run', 'lint'],
  ['bun', 'test', './packages', './apps'],
];

for (const [cmd, ...args] of steps) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`FAILED: ${cmd} ${args.join(' ')}`);
    process.exit(res.status ?? 1);
  }
}
console.log('check: all green');
