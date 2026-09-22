import type { SessionInfo } from '@grove/core';
import {
  type AbortResponseDto,
  AbortResponseSchema,
  type ApprovalDecisionResponseDto,
  ApprovalDecisionResponseSchema,
  type BranchResponseDto,
  BranchResponseSchema,
  type ConflictEntryDto,
  ConflictsResponseSchema,
  type CreateSessionDto,
  type CreateSessionResponseDto,
  CreateSessionResponseSchema,
  type DropResponseDto,
  DropResponseSchema,
  type DumpResponseDto,
  DumpResponseSchema,
  type EphemeralAskResponseDto,
  EphemeralAskResponseSchema,
  type ForeignSessionDto,
  ForeignSessionImportResponseSchema,
  ForeignSessionsResponseSchema,
  type GoalActionDto,
  type GoalResponseDto,
  GoalResponseSchema,
  type GoalStateDto,
  type GuidedGoalResponseDto,
  GuidedGoalResponseSchema,
  type HealthDto,
  HealthSchema,
  type LoopStateDto,
  LoopStateSchema,
  type MessagesQueryDto,
  type MessagesResponseDto,
  MessagesResponseSchema,
  type ModeActionDto,
  type ModelRefDto,
  type ModesResponseDto,
  ModesResponseSchema,
  type OkDto,
  OkSchema,
  type PlanDecisionDto,
  type PlanDecisionResponseDto,
  PlanDecisionResponseSchema,
  type PlanDraftResponseDto,
  PlanDraftResponseSchema,
  type PromptDto,
  type PromptResponseDto,
  PromptResponseSchema,
  type ResolveConflictsDto,
  type ResolveConflictsResponseDto,
  ResolveConflictsResponseSchema,
  type RetryResponseDto,
  RetryResponseSchema,
  SessionListResponseSchema,
  type SessionModelStateDto,
  SessionModelStateSchema,
  type SessionModesDto,
  type SessionSkillDto,
  SessionSkillsResponseSchema,
  type SessionStatsDto,
  SessionStatsSchema,
  type SessionWorkspaceDto,
  SessionWorkspaceSchema,
  SetModelResponseSchema,
  SetThinkingResponseSchema,
  type ShareResponseDto,
  ShareResponseSchema,
  type SkillContentResponseDto,
  SkillContentResponseSchema,
  type TreeResponseDto,
  TreeResponseSchema,
  type WorkspaceDirChangeResponseDto,
  WorkspaceDirChangeResponseSchema,
  type WorktreeMoveResponseDto,
  WorktreeMoveResponseSchema,
} from '@grove/protocol';

import { call, type Result, sessionPath, unwrapEnvelope, withBody, withJson } from './core';

export function queryString(query?: MessagesQueryDto): string {
  if (!query) return '';
  const params = new URLSearchParams();
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function getHealth(): Promise<Result<HealthDto>> {
  return call('/api/health', HealthSchema);
}

export async function listSessions(): Promise<Result<SessionInfo[]>> {
  const res = await call('/api/sessions', SessionListResponseSchema);
  if (!res.ok) return res;
  return { ok: true, data: res.data.sessions };
}

export async function createSession(input: CreateSessionDto): Promise<Result<SessionInfo>> {
  const res = await call('/api/sessions', CreateSessionResponseSchema, withBody(input));
  if (!res.ok) return res;
  return { ok: true, data: res.data.session };
}

export function getMessages(
  sessionId: string,
  query?: MessagesQueryDto,
): Promise<Result<MessagesResponseDto>> {
  return call(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages${queryString(query)}`,
    MessagesResponseSchema,
  );
}

export function promptSession(
  sessionId: string,
  input: PromptDto,
): Promise<Result<PromptResponseDto>> {
  return call(
    `/api/sessions/${encodeURIComponent(sessionId)}/prompt`,
    PromptResponseSchema,
    withBody(input),
  );
}

export function abortSession(sessionId: string): Promise<Result<AbortResponseDto>> {
  return call(
    `/api/sessions/${encodeURIComponent(sessionId)}/abort`,
    AbortResponseSchema,
    withBody({}),
  );
}

export function decideApproval(
  sessionId: string,
  approvalId: string,
  approved: boolean,
): Promise<Result<ApprovalDecisionResponseDto>> {
  return call(
    `/api/sessions/${encodeURIComponent(sessionId)}/approval/${encodeURIComponent(approvalId)}`,
    ApprovalDecisionResponseSchema,
    withBody({ approved }),
  );
}

export interface NavigateInput {
  sessionId: string;
  leafId: string;
}

export interface BranchInput {
  sessionId: string;
  parentId?: string;
}

export interface RenameInput {
  sessionId: string;
  title: string;
}

export async function unwrapSession(
  res: Result<CreateSessionResponseDto>,
): Promise<Result<SessionInfo>> {
  if (!res.ok) return res;
  return { ok: true, data: res.data.session };
}

export function forkSession(sessionId: string): Promise<Result<SessionInfo>> {
  return call(
    sessionPath(sessionId, '/fork'),
    CreateSessionResponseSchema,
    withJson('POST', {}),
  ).then(unwrapSession);
}

export function clearSession(sessionId: string): Promise<Result<OkDto>> {
  return call(sessionPath(sessionId, '/clear'), OkSchema, withJson('POST', {}));
}

export function freshSession(sessionId: string): Promise<Result<OkDto>> {
  return call(sessionPath(sessionId, '/fresh'), OkSchema, withJson('POST', {}));
}

export function compactSession(sessionId: string, instructions?: string): Promise<Result<OkDto>> {
  return call(
    sessionPath(sessionId, '/compact'),
    OkSchema,
    withJson('POST', instructions ? { instructions } : {}),
  );
}

export function retryTurn(sessionId: string): Promise<Result<RetryResponseDto>> {
  return call(sessionPath(sessionId, '/retry'), RetryResponseSchema, withJson('POST', {}));
}

export function dropSession(sessionId: string): Promise<Result<DropResponseDto>> {
  return call(sessionPath(sessionId), DropResponseSchema, withJson('DELETE'));
}

export function getTree(sessionId: string): Promise<Result<TreeResponseDto>> {
  return call(sessionPath(sessionId, '/tree'), TreeResponseSchema);
}

export function navigateTree(input: NavigateInput): Promise<Result<OkDto>> {
  return call(
    sessionPath(input.sessionId, '/tree/navigate'),
    OkSchema,
    withJson('POST', { leafId: input.leafId }),
  );
}

export function branchSession(input: BranchInput): Promise<Result<BranchResponseDto>> {
  return call(
    sessionPath(input.sessionId, '/branch'),
    BranchResponseSchema,
    withJson('POST', input.parentId === undefined ? {} : { parentId: input.parentId }),
  );
}

export function labelTreeEntry(
  sessionId: string,
  entryId: string,
  label: string,
): Promise<Result<OkDto>> {
  return call(
    sessionPath(sessionId, '/tree/label'),
    OkSchema,
    withJson('POST', { entryId, label }),
  );
}

export function dumpSession(sessionId: string): Promise<Result<DumpResponseDto>> {
  return call(sessionPath(sessionId, '/dump'), DumpResponseSchema);
}

export function shareSession(sessionId: string): Promise<Result<ShareResponseDto>> {
  return call(sessionPath(sessionId, '/share'), ShareResponseSchema, withJson('POST', {}));
}

export function moveSession(sessionId: string, cwd: string): Promise<Result<OkDto>> {
  return call(sessionPath(sessionId, '/move'), OkSchema, withJson('POST', { cwd }));
}

export function renameSession(input: RenameInput): Promise<Result<SessionInfo>> {
  return call(
    sessionPath(input.sessionId),
    CreateSessionResponseSchema,
    withJson('PATCH', { title: input.title }),
  ).then(unwrapSession);
}

export function getGoal(sessionId: string): Promise<Result<GoalStateDto>> {
  return unwrapEnvelope(
    call<GoalResponseDto>(sessionPath(sessionId, '/goal'), GoalResponseSchema),
    'goal',
  );
}

export function goalAction(
  sessionId: string,
  action: GoalActionDto,
): Promise<Result<GoalStateDto>> {
  return unwrapEnvelope(
    call<GoalResponseDto>(
      sessionPath(sessionId, '/goal'),
      GoalResponseSchema,
      withJson('POST', action),
    ),
    'goal',
  );
}

export function getModes(sessionId: string): Promise<Result<SessionModesDto>> {
  return unwrapEnvelope(
    call<ModesResponseDto>(sessionPath(sessionId, '/modes'), ModesResponseSchema),
    'modes',
  );
}

export function modeAction(
  sessionId: string,
  action: ModeActionDto,
): Promise<Result<SessionModesDto>> {
  return unwrapEnvelope(
    call<ModesResponseDto>(
      sessionPath(sessionId, '/modes'),
      ModesResponseSchema,
      withJson('POST', action),
    ),
    'modes',
  );
}
// P2a session tools (validated against protocol schemas).
// ---------------------------------------------------------------------------

export type SkillContent = SkillContentResponseDto;

export function listSessionSkills(sessionId: string): Promise<Result<SessionSkillDto[]>> {
  return unwrapEnvelope(
    call<{ skills: SessionSkillDto[] }>(
      sessionPath(sessionId, '/skills'),
      SessionSkillsResponseSchema,
    ),
    'skills',
  );
}

/** GET /api/skills/:name[?path=…] → {content}. */
/** GET /api/sessions/:id/skills/:name[?path] → { content }. */

export function readSessionSkill(
  sessionId: string,
  name: string,
  path?: string,
): Promise<Result<SkillContent>> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  return call(
    sessionPath(sessionId, `/skills/${encodeURIComponent(name)}${qs}`),
    SkillContentResponseSchema,
  );
}

/** GET /api/sessions/:id/memory → {backend,status}. */

export function getSessionModels(sessionId: string): Promise<Result<SessionModelStateDto>> {
  return call(sessionPath(sessionId, '/model'), SessionModelStateSchema);
}

export function listConflicts(sessionId: string): Promise<Result<ConflictEntryDto[]>> {
  return unwrapEnvelope(
    call<{ conflicts: ConflictEntryDto[] }>(
      sessionPath(sessionId, '/conflicts'),
      ConflictsResponseSchema,
    ),
    'conflicts',
  );
}

export function resolveConflicts(
  sessionId: string,
  input: ResolveConflictsDto,
): Promise<Result<ResolveConflictsResponseDto>> {
  return call(
    sessionPath(sessionId, '/conflicts/resolve'),
    ResolveConflictsResponseSchema,
    withBody(input),
  );
}

/** GET /api/sessions/:id/stats → cumulative tokens/cost/context. */

export function getSessionStats(sessionId: string): Promise<Result<SessionStatsDto>> {
  return call(sessionPath(sessionId, '/stats'), SessionStatsSchema);
}

/** GET /api/sessions/:id/loop → { loop }. */

export function getLoop(sessionId: string): Promise<Result<LoopStateDto>> {
  return call(sessionPath(sessionId, '/loop'), LoopStateSchema);
}

/** POST /api/sessions/:id/loop { prompt, limit? } → { loop }. */

export function startLoop(
  sessionId: string,
  prompt: string,
  limit?: string,
): Promise<Result<LoopStateDto>> {
  return call(
    sessionPath(sessionId, '/loop'),
    LoopStateSchema,
    withJson('POST', { prompt, ...(limit !== undefined && limit !== '' ? { limit } : {}) }),
  );
}

/** DELETE /api/sessions/:id/loop → { loop }. */

export function stopLoop(sessionId: string): Promise<Result<LoopStateDto>> {
  return call(sessionPath(sessionId, '/loop'), LoopStateSchema, { method: 'DELETE' });
}

/** POST /api/sessions/:id/loop/pause { paused } → { loop }. */

export function pauseLoop(sessionId: string, paused: boolean): Promise<Result<LoopStateDto>> {
  return call(sessionPath(sessionId, '/loop/pause'), LoopStateSchema, withJson('POST', { paused }));
}

/** POST /api/sessions/:id/browser { action, … } → prelude result (TUI `/browser`). */

export function listForeignSessions(
  source: 'claude' | 'codex',
): Promise<Result<ForeignSessionDto[]>> {
  return unwrapEnvelope(
    call<{ sessions: ForeignSessionDto[] }>(
      `/api/foreign-sessions?source=${source}`,
      ForeignSessionsResponseSchema,
    ),
    'sessions',
  );
}

/** POST /api/foreign-sessions/import { source, path } → { session }. */

export async function importForeignSession(input: {
  source: 'claude' | 'codex';
  path: string;
  fallbackCwd?: string;
}): Promise<Result<SessionInfo>> {
  return await unwrapSession(
    await call(
      '/api/foreign-sessions/import',
      ForeignSessionImportResponseSchema,
      withJson('POST', input),
    ),
  );
}

/** POST /api/sessions/:id/worktree { branch? } → { path, branch } (TUI `/wt`). */

export function moveToWorktree(
  sessionId: string,
  branch?: string,
): Promise<Result<WorktreeMoveResponseDto>> {
  return call(
    sessionPath(sessionId, '/worktree'),
    WorktreeMoveResponseSchema,
    withJson('POST', branch ? { branch } : {}),
  );
}

/** GET /api/plugins → { plugins } (TUI `/plugins list`). */

export function askEphemeral(
  sessionId: string,
  question: string,
): Promise<Result<EphemeralAskResponseDto>> {
  return call(
    sessionPath(sessionId, '/ask'),
    EphemeralAskResponseSchema,
    withJson('POST', { question }),
  );
}

/** POST /api/sessions/:id/guided-goal { initial? } → { started }. */

export function startGuidedGoal(
  sessionId: string,
  initial?: string,
): Promise<Result<GuidedGoalResponseDto>> {
  return call(
    sessionPath(sessionId, '/guided-goal'),
    GuidedGoalResponseSchema,
    withJson('POST', initial ? { initial } : {}),
  );
}

/** GET /api/sessions/:id/plan → latest plan draft (TUI `/plan-review`). */

export function getPlanDraft(sessionId: string): Promise<Result<PlanDraftResponseDto>> {
  return call(sessionPath(sessionId, '/plan'), PlanDraftResponseSchema);
}

/** POST /api/sessions/:id/plan { action } → { executed }. */

export function decidePlan(
  sessionId: string,
  action: PlanDecisionDto['action'],
): Promise<Result<PlanDecisionResponseDto>> {
  return call(
    sessionPath(sessionId, '/plan'),
    PlanDecisionResponseSchema,
    withJson('POST', { action }),
  );
}

/** GET /api/sessions/:id/workspace → { cwd, directories }. */

export function getWorkspace(sessionId: string): Promise<Result<SessionWorkspaceDto>> {
  return call(sessionPath(sessionId, '/workspace'), SessionWorkspaceSchema);
}

/** POST /api/sessions/:id/workspace/dirs { path } → { added, workspace }. */

export function addWorkspaceDir(
  sessionId: string,
  path: string,
): Promise<Result<WorkspaceDirChangeResponseDto>> {
  return call(
    sessionPath(sessionId, '/workspace/dirs'),
    WorkspaceDirChangeResponseSchema,
    withJson('POST', { path }),
  );
}

/** DELETE /api/sessions/:id/workspace/dirs?path → { removed, workspace }. */

export function removeWorkspaceDir(
  sessionId: string,
  path: string,
): Promise<Result<WorkspaceDirChangeResponseDto>> {
  return call(
    `${sessionPath(sessionId, '/workspace/dirs')}?path=${encodeURIComponent(path)}`,
    WorkspaceDirChangeResponseSchema,
    { method: 'DELETE' },
  );
}

/** POST /api/sessions/:id/model { provider, modelId } → { current }. */

export function setSessionModel(
  sessionId: string,
  provider: string,
  modelId: string,
): Promise<Result<ModelRefDto>> {
  return unwrapEnvelope(
    call(
      sessionPath(sessionId, '/model'),
      SetModelResponseSchema,
      withJson('POST', { provider, modelId }),
    ),
    'current',
  );
}

/** POST /api/sessions/:id/model { selector } → { current } (TUI `/switch`). */

export function switchModel(sessionId: string, selector: string): Promise<Result<ModelRefDto>> {
  return unwrapEnvelope(
    call<{ current: ModelRefDto }>(
      sessionPath(sessionId, '/model'),
      SetModelResponseSchema,
      withJson('POST', { selector }),
    ),
    'current',
  );
}

/** POST /api/sessions/:id/thinking { level } → { thinking }. */

export function setSessionThinking(sessionId: string, level: string): Promise<Result<string>> {
  return unwrapEnvelope(
    call(
      sessionPath(sessionId, '/thinking'),
      SetThinkingResponseSchema,
      withJson('POST', { level }),
    ),
    'thinking',
  );
}
