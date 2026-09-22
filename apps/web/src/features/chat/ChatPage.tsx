import { Badge, Button, Panel, Skeleton, StatusDot } from '@grove/ui';
import {
  Crosshair,
  GitBranch,
  MessageSquarePlus,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import { lazy } from 'react';
import { useParams } from 'react-router-dom';
import { CommandPalette } from '../palette/CommandPalette';
import { GoalStrip } from '../sessions/GoalStrip';
import { LoopStrip } from '../sessions/LoopStrip';
import { ModesPanel, modesActive } from '../sessions/ModesPanel';
import { OpsBar } from '../sessions/OpsBar';
import { PlanReview, planPreview } from '../sessions/PlanReview';
import { TreePanel } from '../tree/TreePanel';
import { Composer } from './Composer';
import { SessionFooter } from './SessionFooter';
import { ToolPane } from './ToolPane';
import { ToolRail } from './ToolRail';
import { Transcript } from './Transcript';
import { TOOL_TABS, type ToolTab } from './tool-tabs';
import { useChatSession } from './use-chat-session';

// Heavy panes (xterm, CodeMirror, debug views) split into lazy chunks so the
// initial bundle stays lean; each suspends behind a skeleton while loading.
const _DebugPanel = lazy(() =>
  import('../debug/DebugPanel').then((m) => ({ default: m.DebugPanel })),
);
const _EditorPane = lazy(() =>
  import('../editor/EditorPane').then((m) => ({ default: m.EditorPane })),
);
const _NotebookPane = lazy(() =>
  import('../notebook/NotebookPane').then((m) => ({ default: m.NotebookPane })),
);
const _TerminalPane = lazy(() =>
  import('../terminal/TerminalPane').then((m) => ({ default: m.TerminalPane })),
);

export function ChatPage() {
  const { id } = useParams();
  const sessionId = id ?? '';
  const {
    abort,
    agentError,
    approval,
    approvalOp,
    branchFromMessage,
    btw,
    btwOp,
    commandsQuery,
    composerDraft,
    createSession,
    decide,
    goalOpen,
    goalQuery,
    handleOpenFile,
    handleSend,
    liveText,
    liveThinking,
    messages,
    messagesQuery,
    modesOpen,
    modesQuery,
    navigate,
    openFile,
    paletteOpen,
    paletteSessionActions,
    panelWidth,
    planDraftQuery,
    planOp,
    planProposal,
    planReview,
    prompt,
    retryOp,
    sendPrompt,
    sessionCwd,
    sessionTitle,
    setActiveSessionId,
    setAgentError,
    setBtw,
    setComposerDraft,
    setGoalOpen,
    setModesOpen,
    setPaletteOpen,
    setPanelWidth,
    setPlanProposal,
    setPlanReview,
    setToolTab,
    setTreeOpen,
    streamStatus,
    streaming,
    toolTab,
    treeOpen,
    turnStartedAt,
    turnTools,
    waiting,
  } = useChatSession(sessionId);
  return (
    <div className="relative flex h-full min-w-0 flex-1 gap-2">
      <Panel className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <OpsBar
          sessionId={sessionId}
          meta={
            <>
              <span className="max-w-56 truncate text-small font-strong" title={sessionTitle}>
                {sessionTitle}
              </span>
              <span className="font-mono text-small text-muted-foreground" title={sessionId}>
                {sessionId.slice(0, 8)}
              </span>
              {sessionCwd && (
                <span
                  className="max-w-64 truncate font-mono text-small text-muted-foreground"
                  title={`Workspace: ${sessionCwd}`}
                >
                  {sessionCwd}
                </span>
              )}
              <Button
                variant="ghost"
                onClick={() => setTreeOpen((v) => !v)}
                aria-label="Toggle tree panel"
              >
                <GitBranch />
                Tree
              </Button>
              <Button
                variant="ghost"
                onClick={() => setGoalOpen((v) => !v)}
                aria-label="Goal mode"
                title={
                  goalQuery.data?.goal ? `Goal: ${goalQuery.data.goal.objective}` : 'Goal mode'
                }
              >
                <Crosshair />
                Goal
                {goalQuery.data?.goal && goalQuery.data.enabled && (
                  <StatusDot tone="success" size="sm" />
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setModesOpen(true)}
                aria-label="Agent modes"
                title="Plan, vibe, advisor, fast, queue modes"
              >
                <SlidersHorizontal />
                Modes
                {modesActive(modesQuery.data) && <StatusDot tone="success" size="sm" />}
              </Button>
              {streamStatus !== 'open' && streamStatus !== 'idle' && (
                <Badge variant="secondary">
                  {streamStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
                </Badge>
              )}
            </>
          }
        />

        {messagesQuery.isPending && (
          <div className="flex flex-1 flex-col gap-2 p-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-2/3" />
          </div>
        )}

        {messagesQuery.isError && messages.length === 0 && !liveText && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
            {/session not found/i.test(
              messagesQuery.error instanceof Error ? messagesQuery.error.message : '',
            ) ? (
              <>
                <p className="text-body text-muted-foreground">
                  This session no longer exists (deleted or never saved).
                </p>
                <Button variant="outline" onClick={() => navigate('/')}>
                  Back to sessions
                </Button>
              </>
            ) : (
              <>
                <p className="text-body text-destructive">Failed to load messages.</p>
                <Button variant="outline" onClick={() => messagesQuery.refetch()}>
                  Retry
                </Button>
              </>
            )}
          </div>
        )}
        {messagesQuery.isError && messages.length > 0 && (
          <p className="px-3 py-1 text-small text-muted-foreground">Reconnecting transcript…</p>
        )}

        {messagesQuery.data && messages.length === 0 && !liveText && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
            <MessageSquarePlus className="size-6 text-muted-foreground" />
            <p className="text-body text-muted-foreground">
              No messages yet — send the first prompt below.
            </p>
          </div>
        )}

        {(messages.length > 0 || liveText || liveThinking) && (
          <Transcript
            messages={messages}
            liveText={liveText}
            liveThinking={liveThinking}
            waiting={waiting && !liveText}
            turnTools={turnTools}
            turnStartedAt={turnStartedAt}
            onBranchFrom={branchFromMessage}
          />
        )}

        {(agentError || prompt.isError) && (
          <div className="flex items-center gap-2 px-3 py-1">
            <p className="min-w-0 flex-1 truncate text-small text-destructive">
              {agentError ?? 'Failed to send prompt.'}
            </p>
            <Button
              variant="outline"
              onClick={() =>
                retryOp.mutate(undefined, {
                  onSuccess: (data) => {
                    if (!data.retried) setAgentError('Nothing to retry.');
                    else setAgentError(null);
                  },
                  onError: (e) => setAgentError(e.message),
                })
              }
              disabled={retryOp.isPending}
              title="Re-run the last failed turn"
            >
              <RotateCcw className="size-3.5" />
              Retry
            </Button>
          </div>
        )}

        {btw && (
          <div role="status" aria-label="Side answer" className="mx-3 mb-1 rounded-md panel p-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="flex-1 text-small font-strong text-muted-foreground">
                /btw · {btw.question}
              </span>
              {btwOp.isPending && <span className="text-meta">thinking…</span>}
              <Button variant="ghost" onClick={() => setBtw(null)}>
                Dismiss
              </Button>
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-meta leading-relaxed">
              {btw.reply}
            </pre>
          </div>
        )}

        {planReview && (
          <PlanReview
            plan={planReview}
            content={planPreview(planDraftQuery.data)}
            pending={planOp.isPending}
            onDecide={(action) =>
              planOp.mutate(action, {
                onSuccess: () => setPlanReview(null),
                onError: (e) => setAgentError(e.message),
              })
            }
            onDismiss={() => setPlanReview(null)}
          />
        )}

        {planProposal && (
          <PlanReview
            plan={planProposal}
            content={planPreview(planDraftQuery.data)}
            pending={planOp.isPending}
            onDecide={(action) =>
              planOp.mutate(action, {
                onSuccess: () => setPlanProposal(null),
                onError: (e) => setAgentError(e.message),
              })
            }
            onDismiss={() => setPlanProposal(null)}
          />
        )}

        {approval && (
          <div
            role="alert"
            aria-label="Tool approval"
            className="mx-3 mb-1 rounded-md border border-warning bg-card p-2"
          >
            <p className="mb-1 text-small font-strong text-warning-strong">Tool approval needed</p>
            <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-small text-foreground">
              {approval.prompt}
            </pre>
            <div className="flex gap-1">
              <Button onClick={() => decide(true)} disabled={approvalOp.isPending}>
                Approve
              </Button>
              <Button
                variant="outline"
                onClick={() => decide(false)}
                disabled={approvalOp.isPending}
              >
                Deny
              </Button>
            </div>
          </div>
        )}

        <LoopStrip sessionId={sessionId} />

        <GoalStrip
          sessionId={sessionId}
          open={goalOpen}
          onClose={() => setGoalOpen(false)}
          onGoalSet={(text) => {
            if (!streaming && !waiting) sendPrompt(text);
          }}
        />
        <Composer
          sessionId={sessionId}
          streaming={streaming || waiting}
          sending={prompt.isPending}
          commands={commandsQuery.data ?? []}
          onSend={handleSend}
          onAbort={() => abort.mutate()}
          onManageProviders={() => setToolTab('providers')}
          draft={composerDraft}
          onDraftConsumed={() => setComposerDraft(null)}
        />
        <SessionFooter sessionId={sessionId} />
      </Panel>
      {toolTab !== 'chat' && (
        <ToolPane
          toolTab={toolTab}
          sessionId={sessionId}
          panelWidth={panelWidth}
          onPanelWidth={setPanelWidth}
          openFile={openFile}
          onOpenFile={handleOpenFile}
          onClose={() => setToolTab('chat')}
        />
      )}
      {treeOpen && (
        <TreePanel
          sessionId={sessionId}
          onBranched={(id, draft) => {
            setActiveSessionId(id);
            if (draft) setComposerDraft(draft);
            navigate(`/s/${id}`);
          }}
        />
      )}
      <ModesPanel sessionId={sessionId} open={modesOpen} onClose={() => setModesOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onTab={(tab) => {
          if ((TOOL_TABS as { id: string }[]).some((t) => t.id === tab)) {
            setToolTab(tab as ToolTab);
          }
        }}
        onHome={() => navigate('/')}
        onNewSession={() => {
          createSession.mutate(
            {},
            {
              onSuccess: (session) => navigate(`/s/${session.id}`),
            },
          );
        }}
        sessionActions={paletteSessionActions}
      />
      <ToolRail toolTab={toolTab} onSelect={setToolTab} />
    </div>
  );
}
