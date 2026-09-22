import { Badge, Button, Input, Skeleton } from '@grove/ui';
import { FileText, Play, Plus, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { P2aCellLanguage } from '../../lib/api-client/hooks';
import { useResetKernel, useRunCell } from '../../lib/api-client/hooks';
import { cellImageSrc } from '../../lib/api-client/rest';

interface NotebookPaneProps {
  sessionId: string;
}

interface CellState {
  key: number;
  language: P2aCellLanguage;
  code: string;
  title: string;
  /** Per-cell timeout in ms as typed; empty means the kernel default. */
  timeoutMs: string;
  /** Reset the kernel before this cell runs. */
  resetKernel: boolean;
  output: string | null;
  images: string[];
  error: string | null;
  markdownPreview: boolean;
}

let nextCellKey = 1;

function newCell(language: P2aCellLanguage): CellState {
  return {
    key: nextCellKey++,
    language,
    code: language === 'py' ? 'print("hello")' : 'console.log("hello");',
    title: '',
    timeoutMs: '',
    resetKernel: false,
    output: null,
    images: [],
    error: null,
    markdownPreview: false,
  };
}

function CellView({
  sessionId,
  cell,
  onChange,
  onRemove,
}: {
  sessionId: string;
  cell: CellState;
  onChange: (next: CellState) => void;
  onRemove: () => void;
}) {
  const runCell = useRunCell(sessionId);

  const handleRun = () => {
    onChange({ ...cell, error: null });
    const timeout = cell.timeoutMs.trim() === '' ? undefined : Number(cell.timeoutMs);
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
      onChange({ ...cell, error: 'Timeout must be a positive number of ms.' });
      return;
    }
    runCell.mutate(
      {
        language: cell.language,
        code: cell.code,
        ...(cell.title.trim() === '' ? {} : { title: cell.title.trim() }),
        ...(timeout === undefined ? {} : { timeoutMs: timeout }),
        ...(cell.resetKernel ? { reset: true } : {}),
      },
      {
        onSuccess: (res) => {
          onChange({
            ...cell,
            output: res.output,
            images: (res.images ?? []).map(cellImageSrc),
            error: null,
          });
        },
        onError: (err) =>
          onChange({ ...cell, error: err instanceof Error ? err.message : 'Run failed.' }),
      },
    );
  };

  return (
    <div className="rounded-md bg-card hairline">
      <div className="flex items-center gap-2 hairline-b px-2 py-1.5">
        <Badge variant="outline">{cell.language}</Badge>
        <Input
          value={cell.title}
          onChange={(e) => onChange({ ...cell, title: e.target.value })}
          placeholder="title (optional)"
          aria-label="Cell title"
          className="h-7 text-small"
        />
        <Button
          variant="ghost"
          onClick={() => onChange({ ...cell, markdownPreview: !cell.markdownPreview })}
          aria-label="Toggle markdown preview"
          title="Preview output as markdown"
        >
          <FileText />
        </Button>
        <Input
          value={cell.timeoutMs}
          onChange={(e) => onChange({ ...cell, timeoutMs: e.target.value })}
          placeholder="timeout ms"
          aria-label="Cell timeout ms"
          inputMode="numeric"
          className="h-7 w-28 text-small"
        />
        <Button
          variant={cell.resetKernel ? 'default' : 'ghost'}
          onClick={() => onChange({ ...cell, resetKernel: !cell.resetKernel })}
          aria-pressed={cell.resetKernel}
          aria-label="Reset kernel before run"
          title="Reset the kernel before running this cell"
        >
          <RotateCcw />
        </Button>
        <Button onClick={handleRun} disabled={runCell.isPending || !cell.code.trim()}>
          <Play />
          {runCell.isPending ? '…' : 'Run'}
        </Button>
        <Button
          variant="ghost"
          onClick={onRemove}
          disabled={runCell.isPending}
          aria-label="Remove cell"
          title={runCell.isPending ? 'Cannot remove while running' : 'Remove cell'}
        >
          <X />
        </Button>
      </div>
      <textarea
        value={cell.code}
        onChange={(e) => onChange({ ...cell, code: e.target.value })}
        rows={4}
        spellCheck={false}
        aria-label={`${cell.language} cell code`}
        className="w-full bg-transparent p-2 font-mono text-small focus-visible:outline-none"
      />
      <div className="hairline-t p-2">
        {runCell.isPending && <Skeleton className="h-8 w-full" />}
        {cell.error && <p className="text-small text-destructive">{cell.error}</p>}
        {cell.output !== null && !runCell.isPending && (
          <>
            {cell.markdownPreview ? (
              <div className="prose prose-sm max-w-none text-body dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{cell.output}</ReactMarkdown>
              </div>
            ) : (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-small">
                {cell.output}
              </pre>
            )}
            {cell.images.map((src) => (
              <img key={src} src={src} alt="cell output" className="mt-2 max-w-full" />
            ))}
          </>
        )}
        {cell.output === null && !cell.error && !runCell.isPending && (
          <p className="text-small text-muted-foreground">Not run yet.</p>
        )}
      </div>
    </div>
  );
}

export function NotebookPane({ sessionId }: NotebookPaneProps) {
  const [cells, setCells] = useState<CellState[]>([newCell('py')]);
  const [draftLang, setDraftLang] = useState<P2aCellLanguage>('py');
  const resetPy = useResetKernel(sessionId);
  const resetJs = useResetKernel(sessionId);

  const patchCell = (key: number, next: CellState) =>
    setCells((prev) => prev.map((c) => (c.key === key ? next : c)));

  const resetFor = (language: P2aCellLanguage) => (language === 'py' ? resetPy : resetJs);

  const kernelBadge = (language: P2aCellLanguage) => {
    const m = resetFor(language);
    if (m.isPending) return <Badge variant="secondary">{language}: resetting…</Badge>;
    if (m.isError)
      return (
        <Badge variant="destructive">
          {language}: {m.error instanceof Error ? m.error.message : 'reset failed'}
        </Badge>
      );
    if (m.isSuccess) return <Badge>{language}: ready</Badge>;
    return (
      <Badge variant="outline">
        {language}: {cells.some((c) => c.language === language) ? 'idle' : 'unused'}
      </Badge>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 hairline-b p-3">
        {kernelBadge('py')}
        {kernelBadge('js')}
        <div className="ml-auto flex gap-1">
          <Button
            variant="ghost"
            onClick={() => resetFor('py').mutate('py')}
            disabled={resetPy.isPending}
          >
            <RotateCcw />
            py
          </Button>
          <Button
            variant="ghost"
            onClick={() => resetFor('js').mutate('js')}
            disabled={resetJs.isPending}
          >
            <RotateCcw />
            js
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto scroll-area p-3">
        {cells.length === 0 && (
          <p className="p-3 text-center text-small text-muted-foreground">
            No cells — add one below.
          </p>
        )}
        {cells.map((cell) => (
          <CellView
            key={cell.key}
            sessionId={sessionId}
            cell={cell}
            onChange={(next) => patchCell(cell.key, next)}
            onRemove={() => setCells((prev) => prev.filter((c) => c.key !== cell.key))}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 hairline-t p-3">
        <select
          value={draftLang}
          onChange={(e) => setDraftLang(e.target.value as P2aCellLanguage)}
          aria-label="New cell language"
          className="h-8 rounded-md bg-background hairline px-2 text-body"
        >
          <option value="py">py</option>
          <option value="js">js</option>
        </select>
        <Button variant="outline" onClick={() => setCells((prev) => [...prev, newCell(draftLang)])}>
          <Plus />
          Add cell
        </Button>
      </div>
    </div>
  );
}
