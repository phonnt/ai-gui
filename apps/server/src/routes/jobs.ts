import type { BackgroundJob, SessionTools } from '@grove/agent-runtime';

/** GET /api/sessions/:id/jobs → { jobs }. */
export async function listJobsRoute(
  tools: SessionTools,
  sessionId: string,
): Promise<{ jobs: BackgroundJob[] }> {
  return { jobs: await tools.listJobs({ sessionId }) };
}

/** POST /api/sessions/:id/jobs/:jobId/cancel → { cancelled }. */
export async function cancelJobRoute(
  tools: SessionTools,
  sessionId: string,
  jobId: string,
): Promise<{ cancelled: boolean }> {
  return tools.cancelJob({ sessionId, id: decodeURIComponent(jobId) });
}
