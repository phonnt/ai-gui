import { Badge, Button, Input, Skeleton } from '@ai-gui/ui';
import { Download, FileBox, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useArtifactContent, useArtifacts } from '../../lib/api-client/hooks';

interface ArtifactBrowserProps {
  sessionId: string;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size}b`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

export function ArtifactBrowser({ sessionId }: ArtifactBrowserProps) {
  const artifactsQuery = useArtifacts(sessionId);
  const [selectedId, setSelectedId] = useState('');
  const [range, setRange] = useState('');
  const [committedRange, setCommittedRange] = useState<string | undefined>(undefined);
  const contentQuery = useArtifactContent(sessionId, selectedId, committedRange);

  const selected = artifactsQuery.data?.find((a) => a.id === selectedId);

  const handleDownload = () => {
    if (!contentQuery.data) return;
    const blob = new Blob([contentQuery.data.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = selected?.path.split('/').pop() ?? `${selectedId}.txt`;
    // Safari ignores clicks on detached nodes.
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-2 text-[11px] text-[hsl(var(--muted-foreground))]">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
        <p>
          Artifacts resolve through the session file on the server. If the server holds no session
          file for this session, reads fail with a typed error instead of content.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {artifactsQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {artifactsQuery.isError && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-[hsl(var(--border))] p-3 text-center">
            <p className="text-xs text-[hsl(var(--destructive))]">
              {artifactsQuery.error instanceof Error
                ? artifactsQuery.error.message
                : 'Artifacts failed.'}
            </p>
            <Button size="sm" variant="outline" onClick={() => artifactsQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {artifactsQuery.data && artifactsQuery.data.length === 0 && (
          <p className="p-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
            No artifacts for this session yet.
          </p>
        )}
        {artifactsQuery.data?.map((artifact) => (
          <button
            key={artifact.id}
            type="button"
            onClick={() => {
              setSelectedId(artifact.id);
              setCommittedRange(undefined);
              setRange('');
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[hsl(var(--muted))] ${
              artifact.id === selectedId ? 'bg-[hsl(var(--muted))]' : ''
            }`}
          >
            <FileBox className="size-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
            <span className="min-w-0 flex-1 truncate font-mono">{artifact.path}</span>
            <Badge variant="outline">{artifact.kind}</Badge>
            <span className="shrink-0 text-[11px] text-[hsl(var(--muted-foreground))]">
              {formatBytes(artifact.size)}
            </span>
          </button>
        ))}
      </div>

      {selectedId && (
        <div className="flex min-h-0 flex-col border-t border-[hsl(var(--border))]">
          <div className="flex items-center gap-2 p-3 pb-2">
            <Input
              value={range}
              onChange={(e) => setRange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setCommittedRange(range.trim() || undefined);
              }}
              placeholder="range (optional)"
              aria-label="Artifact range"
              className="font-mono"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCommittedRange(range.trim() || undefined)}
            >
              Page
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDownload}
              disabled={!contentQuery.data}
              aria-label="Download artifact"
            >
              <Download />
            </Button>
          </div>
          <div className="min-h-0 max-h-64 overflow-y-auto px-3 pb-3">
            {contentQuery.isPending && <Skeleton className="h-24 w-full" />}
            {contentQuery.isError && (
              <div className="flex flex-col items-start gap-2">
                <p className="text-xs text-[hsl(var(--destructive))]">
                  {contentQuery.error instanceof Error
                    ? contentQuery.error.message
                    : 'Read failed.'}
                </p>
                <Button size="sm" variant="outline" onClick={() => contentQuery.refetch()}>
                  Retry
                </Button>
              </div>
            )}
            {contentQuery.data && (
              <>
                {contentQuery.data.truncated && (
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                    <TriangleAlert className="size-3.5 shrink-0" />
                    Truncated — page with a range above.
                  </p>
                )}
                <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                  {contentQuery.data.content}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
