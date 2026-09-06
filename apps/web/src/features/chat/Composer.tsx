import { Button } from '@ai-gui/ui';
import { SendHorizontal, Square } from 'lucide-react';
import { useState } from 'react';

interface ComposerProps {
  streaming: boolean;
  sending: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
}

export function Composer({ streaming, sending, onSend, onAbort }: ComposerProps) {
  const [text, setText] = useState('');

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setText('');
    onSend(trimmed);
  };

  return (
    <div className="border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="Type a prompt… (Enter to send, Shift+Enter for newline)"
            className="flex-1 resize-none rounded-[4px] border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 py-1.5 text-[13px] placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
          />
          {streaming ? (
            <Button variant="destructive" onClick={onAbort} title="Abort current turn">
              <Square />
              Abort
            </Button>
          ) : (
            <Button onClick={submit} disabled={!text.trim() || sending} title="Send prompt">
              <SendHorizontal />
              Send
            </Button>
          )}
        </div>
        {streaming && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Streaming in progress — Abort stops the current turn.
          </p>
        )}
      </div>
    </div>
  );
}
