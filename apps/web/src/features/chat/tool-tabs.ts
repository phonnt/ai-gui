import {
  AtSign,
  Bot,
  Boxes,
  Braces,
  Brain,
  Briefcase,
  Bug,
  Files,
  Globe,
  ListTodo,
  MessageSquare,
  NotebookPen,
  Package,
  Palette,
  PencilLine,
  PlugZap,
  Settings,
  ShieldCheck,
  SquareTerminal,
  Wrench,
} from 'lucide-react';

/** Every tool surface addressable from the rail and the command palette. */
export type ToolTab =
  | 'chat'
  | 'explorer'
  | 'editor'
  | 'terminal'
  | 'notebook'
  | 'todos'
  | 'artifacts'
  | 'lsp'
  | 'debug'
  | 'hub'
  | 'jobs'
  | 'settings'
  | 'themes'
  | 'providers'
  | 'roles'
  | 'agents'
  | 'mcp'
  | 'tools'
  | 'security'
  | 'plugins'
  | 'knowledge'
  | 'browser';

export const TOOL_TABS: { id: ToolTab; label: string; icon: typeof Files }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'explorer', label: 'Explorer', icon: Files },
  { id: 'editor', label: 'Editor', icon: PencilLine },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
  { id: 'notebook', label: 'Notebook', icon: NotebookPen },
  { id: 'todos', label: 'Todos', icon: ListTodo },
  { id: 'artifacts', label: 'Artifacts', icon: Package },
  { id: 'lsp', label: 'LSP', icon: Braces },
  { id: 'debug', label: 'Debug', icon: Bug },
  { id: 'hub', label: 'Hub', icon: Bot },
  { id: 'jobs', label: 'Jobs', icon: Briefcase },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'themes', label: 'Themes', icon: Palette },
  { id: 'providers', label: 'Providers', icon: Boxes },
  { id: 'roles', label: 'Roles', icon: AtSign },
  { id: 'agents', label: 'Agent knobs', icon: Bot },
  { id: 'mcp', label: 'MCP', icon: PlugZap },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'plugins', label: 'Plugins', icon: Package },
  { id: 'knowledge', label: 'Knowledge', icon: Brain },
  { id: 'browser', label: 'Browser', icon: Globe },
];
