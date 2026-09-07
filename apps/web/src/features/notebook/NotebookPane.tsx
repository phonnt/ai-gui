import { Badge, Button, Input, Skeleton } from '@ai-gui/ui';
import { FileText, Play, Plus, RotateCcw } from 'lucide-react';
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
}: {
  sessionId: string;
  cell: CellState;
  onChange: (next: CellState) => void;
}) {
  const runCell = useRunCell(sessionId);

  const handleRun = () => {
    onChange({ ...cell, error: null });
    runCell.mutate(
      {
        language: cell.language,
        code: cell.code,
        title: cell.title.trim() === '' ? undefined : cell.title.trim(),
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
    <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-2 py-1.5">
        <Badge variant="outline">{cell.language}</Badge>
        <Input
          value={cell.title}
          onChange={(e) => onChange({ ...cell, title: e.target.value })}
          placeholder="title (optional)"
          aria-label="Cell title"
          className="h-7 text-xs"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange({ ...cell, markdownPreview: !cell.markdownPreview })}
          aria-label="Toggle markdown preview"
          title="Preview output as markdown"
        >
          <FileText />
        </Button>
        <Button size="sm" onClick={handleRun} disabled={runCell.isPending || !cell.code.trim()}>
          <Play />
          {runCell.isPending ? '…' : 'Run'}
        </Button>
      </div>
      <textarea
        value={cell.code}
        onChange={(e) => onChange({ ...cell, code: e.target.value })}
        rows={4}
        spellCheck={false}
        aria-label={`${cell.language} cell code`}
        className="w-full bg-transparent p-2 font-mono text-xs focus-visible:outline-none"
      />
      <div className="border-t border-[hsl(var(--border))] p-2">
        {runCell.isPending && <Skeleton className="h-8 w-full" />}
        {cell.error && <p className="text-xs text-[hsl(var(--destructive))]">{cell.error}</p>}
        {cell.output !== null && !runCell.isPending && (
          <>
            {cell.markdownPreview ? (
              <div className="prose prose-sm max-w-none text-[13px] dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{cell.output}</ReactMarkdown>
              </div>
            ) : (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs">
                {cell.output}
              </pre>
            )}
            {cell.images.map((src) => (
              <img key={src.slice(0, 32)} src={src} alt="cell output" className="mt-2 max-w-full" />
            ))}
          </>
        )}
        {cell.output === null && !cell.error && !runCell.isPending && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Not run yet.</p>
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
      <div className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--border))] p-3">
        {kernelBadge('py')}
        {kernelBadge('js')}
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => resetFor('py').mutate('py')}
            disabled={resetPy.isPending}
          >
            <RotateCcw />
            py
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => resetFor('js').mutate('js')}
            disabled={resetJs.isPending}
          >
            <RotateCcw />
            js
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {cells.length === 0 && (
          <p className="p-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
            No cells — add one below.
          </p>
        )}
        {cells.map((cell) => (
          <div key={cell.key} className="flex flex-col gap-1">
            <CellView
              sessionId={sessionId}
              cell={cell}
              onChange={(next) => patchCell(cell.key, next)}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCells((prev) => prev.filter((c) => c.key !== cell.key))}
              className="self-end text-[hsl(var(--muted-foreground))]"
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-[hsl(var(--border))] p-3">
        <select
          value={draftLang}
          onChange={(e) => setDraftLang(e.target.value as P2aCellLanguage)}
          aria-label="New cell language"
          className="h-8 rounded-[4px] border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 text-[13px]"
        >
          <option value="py">py</option>
          <option value="js">js</option>
        </select>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCells((prev) => [...prev, newCell(draftLang)])}
        >
          <Plus />
          Add cell
        </Button>
      </div>
    </div>
  );
}
