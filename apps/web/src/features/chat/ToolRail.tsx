import { IconButton } from '@grove/ui';
import { TOOL_TABS, type ToolTab } from './tool-tabs';

/** Icon rail that toggles the right-hand tool pane. */
export function ToolRail({
  toolTab,
  onSelect,
}: {
  toolTab: ToolTab;
  onSelect: (tab: ToolTab) => void;
}) {
  return (
    <nav
      aria-label="Session tools"
      className="flex h-full w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto scroll-area rounded-md panel py-2"
    >
      {TOOL_TABS.filter((tab) => tab.id !== 'chat').map((tab) => (
        <IconButton
          key={tab.id}
          label={tab.label}
          variant={toolTab === tab.id ? 'plain' : 'ghost'}
          onClick={() => onSelect(toolTab === tab.id ? 'chat' : tab.id)}
          aria-pressed={toolTab === tab.id}
          title={`${tab.label} (toggle)`}
          className="shrink-0"
        >
          <tab.icon />
        </IconButton>
      ))}
    </nav>
  );
}
