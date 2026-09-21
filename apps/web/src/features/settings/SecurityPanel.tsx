import { Button } from '@grove/ui';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useSecurityScan } from '../../lib/api-client/hooks';

/**
 * Security scan surface (TUI `/security`). The scan is the SDK's own tool, so
 * this exposes the practical repository flow — preflight, start, status — and
 * prints the tool's report verbatim rather than re-modelling findings.
 */
export function SecurityPanel({ sessionId }: { sessionId: string }) {
  const scan = useSecurityScan(sessionId);
  const [output, setOutput] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);

  const run = (params: Record<string, unknown>) => {
    setOutput(null);
    setAction(String(params.action));
    scan.mutate(params, {
      onSuccess: (data) => setOutput(data.text || '(no output)'),
      onError: (err) => setOutput(err.message),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 hairline-b p-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="flex-1 text-[13px] font-semibold">Security scan</h3>
          {action && <span className="font-mono text-[11px] text-muted-foreground">{action}</span>}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={scan.isPending}
            onClick={() => run({ action: 'preflight' })}
          >
            Preflight
          </Button>
          <Button
            size="sm"
            disabled={scan.isPending}
            onClick={() => run({ action: 'start', target_kind: 'repository' })}
          >
            Scan repository
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={scan.isPending}
            onClick={() => run({ action: 'status' })}
          >
            Status
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={scan.isPending}
            onClick={() => run({ action: 'cancel' })}
          >
            Cancel scan
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Runs the session's own `security_scan` tool; the report is shown as returned.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {scan.isPending && <p className="text-xs text-muted-foreground">Running {action}…</p>}
        {output && (
          <pre className="whitespace-pre-wrap rounded-md bg-background hairline p-2 font-mono text-[11px] leading-relaxed">
            {output}
          </pre>
        )}
        {!output && !scan.isPending && (
          <p className="text-xs text-muted-foreground">
            No scan output yet. Start with Preflight to check the scanner setup.
          </p>
        )}
      </div>
    </div>
  );
}
