import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { Check, Copy } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import type { Components } from 'react-markdown';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('python', python);
hljs.registerLanguage('css', css);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('xml', xml);

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  html: 'xml',
  vue: 'xml',
};

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {
            /* clipboard unavailable: no-op */
          });
      }}
      className="shrink-0 rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

interface CodeProps {
  className?: string;
  children?: React.ReactNode;
  node?: unknown;
}

/** Fenced code with highlight.js (subset) + copy, themed via .hljs-* vars. */
export const CodeBlock = memo(function CodeBlock({ className, children }: CodeProps) {
  const raw = useMemo(() => String(children ?? '').replace(/\n$/, ''), [children]);
  const lang = useMemo(() => {
    const match = /language-([\w-]+)/.exec(className ?? '');
    const name = (match?.[1] ?? '').toLowerCase();
    return (ALIASES[name] ?? name) || undefined;
  }, [className]);
  const html = useMemo(() => {
    if (!lang || !hljs.getLanguage(lang)) return null;
    try {
      return hljs.highlight(raw, { language: lang }).value;
    } catch {
      return null;
    }
  }, [raw, lang]);

  return (
    <div className="group/code relative">
      <div className="absolute right-1 top-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/code:opacity-100">
        <CopyButton text={raw} label="Copy code block" />
      </div>
      <pre className="overflow-x-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] p-3 font-mono text-xs leading-relaxed">
        {html ? (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js escapes source and emits only span.hljs-* tags
          <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code className="font-mono">{raw}</code>
        )}
      </pre>
    </div>
  );
});

/** Inline `code` stays unhighlighted. */
export function InlineCode({ children }: { children?: React.ReactNode }) {
  return (
    <code className="rounded bg-[hsl(var(--muted))] px-1 py-0.5 font-mono text-[0.9em]">
      {children}
    </code>
  );
}

export const markdownComponents: Components = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) =>
    className ? (
      <CodeBlock className={className}>{children}</CodeBlock>
    ) : (
      <InlineCode>{children}</InlineCode>
    ),
};
