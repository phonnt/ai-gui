export interface TurnTool {
  name: string;
  /** Result summary from tool-end; absent while the tool still runs. */
  result?: string;
}

/**
 * Live tool calls of the current turn, rendered with the ⏺/⎿ grammar.
 * Completed tools with a result become a real <details> disclosure;
 * the running tool (or a result-less one) is a plain status line.
 */
export function TurnTools({ tools }: { tools: TurnTool[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 px-3 py-1" aria-live="polite">
      {tools.map((tool, i) => {
        const running = tool.result === undefined;
        const key = `${i}:${tool.name}`;
        if (running) {
          return (
            <div key={key} className="flex min-w-0 items-baseline gap-2 font-mono text-[13px]">
              <span aria-hidden className="shrink-0 text-warning">
                ⏺
              </span>
              <span className="min-w-0 break-words text-foreground">
                {tool.name}
                <span className="ml-2 text-muted-foreground">running…</span>
              </span>
            </div>
          );
        }
        return (
          <details
            key={key}
            className="group font-mono text-[13px] leading-[1.55] [&_summary::-webkit-details-marker]:hidden"
          >
            <summary className="cursor-pointer list-none rounded-none outline-none focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring/60">
              <span className="flex min-w-0 items-baseline gap-2">
                <span aria-hidden className="shrink-0 text-success">
                  ⏺
                </span>
                <span className="min-w-0 break-words text-foreground">{tool.name}</span>
              </span>
              {tool.result && (
                <span className="flex min-w-0 items-baseline gap-2 text-muted-foreground">
                  <span aria-hidden className="invisible shrink-0">
                    ⏺
                  </span>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span aria-hidden className="shrink-0">
                      ⎿
                    </span>
                    <span className="min-w-0 break-words">
                      {tool.result.length > 160 ? `${tool.result.slice(0, 160)}…` : tool.result}
                      <span className="ml-2 group-open:hidden">(expand)</span>
                    </span>
                  </span>
                </span>
              )}
            </summary>
            {tool.result && tool.result.length > 160 && (
              <div className="mt-1 whitespace-pre-wrap break-words pl-8 text-muted-foreground">
                {tool.result}
              </div>
            )}
          </details>
        );
      })}
    </div>
  );
}
