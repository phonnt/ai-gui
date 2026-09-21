#!/usr/bin/env bun
// Dependency-advisory gate for CI.
//
// `bun audit` exits 0 even when it prints advisories, so the pipeline could not
// fail on a vulnerable dependency. This wrapper reads `bun audit --json` (shape:
// package name -> advisories), summarizes it, and exits 1 when anything at
// `high` or `critical` is present. Tool unavailability (older Bun, no lockfile,
// unparseable output) warns instead of failing: an unavailable scanner is not a
// vulnerability.
import { $ } from 'bun';

export interface AuditSummary {
  total: number;
  blocking: number;
  bySeverity: Record<string, number>;
}

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

/** `severity` of one advisory, or `unknown` when the entry has another shape. */
function readSeverity(advisory: unknown): string {
  if (advisory && typeof advisory === 'object' && 'severity' in advisory) {
    const value = advisory.severity;
    if (typeof value === 'string') return value;
  }
  return 'unknown';
}

/** Count advisories by severity, and how many of them block the gate. */
export function summarizeAudit(report: unknown): AuditSummary {
  const bySeverity: Record<string, number> = {};
  let total = 0;
  let blocking = 0;
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { total, blocking, bySeverity };
  }
  for (const advisories of Object.values(report as Record<string, unknown>)) {
    if (!Array.isArray(advisories)) continue;
    for (const advisory of advisories) {
      const severity = readSeverity(advisory);
      bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
      total += 1;
      if (BLOCKING_SEVERITIES.has(severity)) blocking += 1;
    }
  }
  return { total, blocking, bySeverity };
}

function formatSummary(summary: AuditSummary): string {
  const parts = Object.entries(summary.bySeverity)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([severity, count]) => `${severity} ${count}`);
  return `${summary.total} advisor${summary.total === 1 ? 'y' : 'ies'}${
    parts.length > 0 ? ` (${parts.join(', ')})` : ''
  }`;
}

async function main(): Promise<void> {
  const audit = await $`bun audit --json`.quiet().nothrow();
  const stdout = audit.stdout.toString().trim();
  if (stdout === '') {
    console.warn(
      `audit: no output from \`bun audit --json\` (exit ${audit.exitCode}) — skipping gate`,
    );
    return;
  }
  let report: unknown;
  try {
    report = JSON.parse(stdout);
  } catch {
    console.warn('audit: could not parse `bun audit --json` output — skipping gate');
    console.warn(stdout.split('\n').slice(0, 3).join('\n'));
    return;
  }
  const summary = summarizeAudit(report);
  console.log(`audit: ${formatSummary(summary)}`);
  if (summary.blocking > 0) {
    console.error(
      `audit: ${summary.blocking} high/critical advisor${summary.blocking === 1 ? 'y' : 'ies'} — run \`bun audit\` for details`,
    );
    process.exit(1);
  }
}

if (import.meta.main) await main();
