import { Button, Input } from '@ai-gui/ui';
import {
  Copy,
  Download,
  FileText,
  GitFork,
  Link2,
  Paintbrush,
  Pencil,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../app/store';
import {
  useClearSession,
  useDropSession,
  useDumpSession,
  useExportHtml,
  useForkSession,
  useFreshSession,
  useRenameSession,
  useShareSession,
} from '../../lib/api-client/hooks';

interface OpsBarProps {
  sessionId: string;
}

type ArmedOp = 'clear' | 'fresh' | 'drop' | null;

export function OpsBar({ sessionId }: OpsBarProps) {
  const navigate = useNavigate();
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);

  const fork = useForkSession(sessionId);
  const clear = useClearSession(sessionId);
  const fresh = useFreshSession(sessionId);
  const drop = useDropSession();
  const rename = useRenameSession(sessionId);
  const share = useShareSession(sessionId);
  const exportHtml = useExportHtml(sessionId);
  const dump = useDumpSession(sessionId);

  const [armed, setArmed] = useState<ArmedOp>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dumpOpen, setDumpOpen] = useState(false);

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof Error ? err.message : fallback);

  const confirmOrArm = (op: Exclude<ArmedOp, null>, run: () => void) => {
    if (armed !== op) {
      setArmed(op);
      return;
    }
    setArmed(null);
    setError(null);
    run();
  };

  const handleFork = () => {
    setError(null);
    fork.mutate(undefined, {
      onSuccess: (session) => {
        setActiveSessionId(session.id);
        void navigate(`/s/${session.id}`);
      },
      onError: (err) => fail(err, 'Fork failed'),
    });
  };

  const handleDrop = () => {
    drop.mutate(sessionId, {
      onSuccess: () => {
        setActiveSessionId(null);
        void navigate('/');
      },
      onError: (err) => fail(err, 'Delete failed'),
    });
  };

  const handleSaveTitle = () => {
    const next = title.trim();
    if (!next) {
      setError('Title cannot be empty.');
      return;
    }
    setError(null);
    rename.mutate(next, {
      onSuccess: () => setEditingTitle(false),
      onError: (err) => fail(err, 'Rename failed'),
    });
  };

  const handleShare = () => {
    setError(null);
    setCopied(false);
    share.mutate(undefined, {
      onSuccess: async (data) => {
        setSharedUrl(data.url);
        try {
          await navigator.clipboard.writeText(data.url);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      },
      onError: (err) => fail(err, 'Share failed'),
    });
  };

  const handleExport = () => {
    setError(null);
    exportHtml.mutate(undefined, {
      onSuccess: (data) => {
        const blob = new Blob([data.html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session-${sessionId}.html`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      },
      onError: (err) => fail(err, 'Export failed'),
    });
  };

  const handleDump = () => {
    if (dumpOpen) {
      setDumpOpen(false);
      return;
    }
    setError(null);
    dump.mutate(undefined, {
      onSuccess: () => setDumpOpen(true),
      onError: (err) => fail(err, 'Dump failed'),
    });
  };

  return (
    <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div className="flex flex-wrap items-center gap-1 px-3 py-1.5">
        <Button size="sm" variant="ghost" onClick={handleFork} disabled={fork.isPending}>
          <GitFork />
          Fork
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            confirmOrArm('clear', () =>
              clear.mutate(undefined, { onError: (err) => fail(err, 'Clear failed') }),
            )
          }
          disabled={clear.isPending}
        >
          <Paintbrush />
          {armed === 'clear' ? 'Confirm clear?' : 'Clear'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            confirmOrArm('fresh', () =>
              fresh.mutate(undefined, { onError: (err) => fail(err, 'Fresh failed') }),
            )
          }
          disabled={fresh.isPending}
        >
          <Sparkles />
          {armed === 'fresh' ? 'Confirm fresh?' : 'Fresh'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => confirmOrArm('drop', handleDrop)}
          disabled={drop.isPending}
        >
          <Trash2 />
          {armed === 'drop' ? 'Confirm delete?' : 'Delete'}
        </Button>
        {armed && (
          <Button size="sm" variant="ghost" onClick={() => setArmed(null)}>
            Cancel
          </Button>
        )}
        <div aria-hidden="true" className="mx-1 h-4 w-px bg-[hsl(var(--border))]" />
        {editingTitle ? (
          <span className="flex items-center gap-1">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="New title"
              aria-label="New session title"
              className="h-7 w-40"
            />
            <Button size="sm" onClick={handleSaveTitle} disabled={rename.isPending}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingTitle(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setTitle('');
              setEditingTitle(true);
            }}
          >
            <Pencil />
            Rename
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={handleShare} disabled={share.isPending}>
          <Link2 />
          Share
        </Button>
        <Button size="sm" variant="ghost" onClick={handleExport} disabled={exportHtml.isPending}>
          <Download />
          Export
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDump} disabled={dump.isPending}>
          <FileText />
          {dumpOpen ? 'Hide dump' : 'Dump'}
        </Button>
      </div>
      {error && <p className="px-3 pb-1.5 text-xs text-[hsl(var(--destructive))]">{error}</p>}
      {sharedUrl && (
        <p className="flex items-center gap-1 px-3 pb-1.5 text-xs text-[hsl(var(--muted-foreground))]">
          <Copy className="size-3" />
          <span className="truncate">{sharedUrl}</span>
          {copied && <span>(copied)</span>}
        </p>
      )}
      {dumpOpen && dump.data && (
        <pre className="mx-3 mb-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 text-xs">
          {dump.data.text}
        </pre>
      )}
    </div>
  );
}
