import { IconButton, ResizeSash, Skeleton } from '@grove/ui';
import { X } from 'lucide-react';
import { Suspense } from 'react';
import { ArtifactBrowser } from '../artifacts/ArtifactBrowser';
import { BrowserPane } from '../browser/BrowserPane';
import { DebugPanel } from '../debug/DebugPanel';
import { EditorPane } from '../editor/EditorPane';
import { ExplorerPane } from '../explorer/ExplorerPane';
import { AgentKnobsPane } from '../hub/AgentKnobsPane';
import { HubPanel } from '../hub/HubPanel';
import { JobsPanel } from '../hub/JobsPanel';
import { KnowledgePane } from '../knowledge/KnowledgePane';
import { LspPanel } from '../lsp/LspPanel';
import { McpPane } from '../mcp/McpPane';
import { ModelRolesPane } from '../model/ModelRolesPane';
import { NotebookPane } from '../notebook/NotebookPane';
import { ProvidersPane } from '../providers/ProvidersPane';
import { PluginsSection } from '../settings/PluginsSection';
import { SecurityPanel } from '../settings/SecurityPanel';
import { SettingsPane } from '../settings/SettingsPane';
import { ThemePicker } from '../settings/ThemePicker';
import { ToolsPanel } from '../settings/ToolsPanel';
import { TerminalPane } from '../terminal/TerminalPane';
import { TodoPanel } from '../todos/TodoPanel';
import { TOOL_TABS, type ToolTab } from './tool-tabs';

/**
 * The resizable right-hand pane. One tool per tab; the heavy editors are
 * mounted through the parent's lazy imports so a tab switch stays cheap.
 */
export function ToolPane({
  toolTab,
  sessionId,
  panelWidth,
  onPanelWidth,
  openFile,
  onOpenFile,
  onClose,
}: {
  toolTab: ToolTab;
  sessionId: string;
  panelWidth: number;
  onPanelWidth: (width: number) => void;
  openFile: { path: string; range?: string };
  onOpenFile: (path: string, range?: string) => void;
  onClose: () => void;
}) {
  return (
    <section
      aria-label={`${toolTab} panel`}
      style={{ width: panelWidth }}
      className="relative flex h-full min-h-0 shrink-0 flex-col rounded-md panel-inset"
    >
      <ResizeSash
        label="Resize panel"
        direction="left"
        value={panelWidth}
        min={320}
        max={900}
        defaultValue={540}
        storageKey="grove-panel-w"
        onChange={onPanelWidth}
        className="absolute inset-y-0 -left-[9px] z-10 w-2"
      />
      <div className="pane-header">
        <span className="section-label">
          {TOOL_TABS.find((t) => t.id === toolTab)?.label ?? toolTab}
        </span>
        <IconButton label="Close panel" variant="ghost" onClick={onClose} title="Close panel (Esc)">
          <X />
        </IconButton>
      </div>
      {toolTab === 'explorer' && <ExplorerPane sessionId={sessionId} onOpen={onOpenFile} />}
      {toolTab === 'editor' && (
        <Suspense fallback={<Skeleton className="m-3 h-24" />}>
          <EditorPane
            sessionId={sessionId}
            path={openFile.path}
            range={openFile.range}
            onPathChange={onOpenFile}
          />
        </Suspense>
      )}
      {toolTab === 'terminal' && (
        <Suspense fallback={<Skeleton className="m-3 h-24" />}>
          <TerminalPane sessionId={sessionId} />
        </Suspense>
      )}
      {toolTab === 'notebook' && (
        <Suspense fallback={<Skeleton className="m-3 h-24" />}>
          <NotebookPane sessionId={sessionId} />
        </Suspense>
      )}
      {toolTab === 'todos' && <TodoPanel sessionId={sessionId} />}
      {toolTab === 'artifacts' && <ArtifactBrowser sessionId={sessionId} />}
      {toolTab === 'lsp' && <LspPanel sessionId={sessionId} onOpen={onOpenFile} />}
      {toolTab === 'debug' && (
        <Suspense fallback={<Skeleton className="m-3 h-24" />}>
          <DebugPanel sessionId={sessionId} />
        </Suspense>
      )}
      {toolTab === 'hub' && <HubPanel sessionId={sessionId} />}
      {toolTab === 'jobs' && <JobsPanel />}
      {toolTab === 'settings' && <SettingsPane />}
      {toolTab === 'themes' && <ThemePicker />}
      {toolTab === 'providers' && <ProvidersPane />}
      {toolTab === 'roles' && <ModelRolesPane />}
      {toolTab === 'agents' && <AgentKnobsPane />}
      {toolTab === 'mcp' && <McpPane />}
      {toolTab === 'tools' && <ToolsPanel sessionId={sessionId} />}
      {toolTab === 'security' && <SecurityPanel sessionId={sessionId} />}
      {toolTab === 'plugins' && (
        <div className="h-full overflow-y-auto scroll-area p-3">
          <PluginsSection />
        </div>
      )}
      {toolTab === 'knowledge' && <KnowledgePane sessionId={sessionId} />}
      {toolTab === 'browser' && <BrowserPane sessionId={sessionId} />}
    </section>
  );
}
