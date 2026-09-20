#!/usr/bin/env bun
// Cross-platform `typecheck`: runs tsc for each workspace that has a tsconfig.
// Replaces the shell `for` loop, which fails under PowerShell on Windows.
import { $, Glob } from 'bun';

const projects = [
  ...new Glob('apps/*/tsconfig.json').scanSync({ cwd: '.' }),
  ...new Glob('packages/*/tsconfig.json').scanSync({ cwd: '.' }),
].sort();

if (projects.length === 0) {
  console.error('no workspace tsconfig.json found');
  process.exit(1);
}

for (const project of projects) {
  console.log(`== ${project}`);
  await $`bunx tsc --noEmit -p ${project}`;
}
