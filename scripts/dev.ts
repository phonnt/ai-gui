#!/usr/bin/env bun
// Runs apps/web (vite) + apps/server (bun) concurrently with prefixed logs.
// Usage: bun run dev
import { spawn } from 'node:child_process';

const targets = [
  { name: 'web', args: ['--filter', '@ai-gui/web', 'dev'] },
  { name: 'server', args: ['--filter', '@ai-gui/server', 'dev'] },
];

const children = targets.map(({ name, args }) => {
  const child = spawn('bun', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const pump = (stream: NodeJS.ReadableStream) => {
    let buf = '';
    stream.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) console.log(`[${name}] ${line}`);
    });
  };
  pump(child.stdout);
  pump(child.stderr);
  child.on('exit', (code) => {
    console.error(`[${name}] exited with code ${code}`);
    process.exit(code ?? 1);
  });
  return child;
});

const shutdown = () => {
  for (const child of children) child.kill('SIGINT');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
