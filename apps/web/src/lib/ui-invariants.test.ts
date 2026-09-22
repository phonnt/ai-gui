import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB_SRC = resolve(import.meta.dir, '..');
const UI_SRC = resolve(import.meta.dir, '../../../../packages/ui/src');

function appSources(): string[] {
  return [
    ...new Bun.Glob('{features,app,lib}/**/*.tsx').scanSync({ cwd: WEB_SRC, onlyFiles: true }),
  ];
}

describe('shared chrome', () => {
  test('the dialog primitive owns the modal contract callers used to hand-roll', () => {
    const dialog = readFileSync(resolve(UI_SRC, 'components/dialog.tsx'), 'utf8');
    for (const fragment of [
      'role="dialog"',
      'aria-modal="true"',
      'aria-label={label}',
      'scrim',
      'shadow-overlay',
      'useEscapeToClose',
    ]) {
      expect(dialog).toContain(fragment);
    }
  });

  test('no feature hand-rolls a modal wrapper any more', () => {
    const offenders = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /role="(dialog|alertdialog)"/.test(line) ? [`${rel}:${i + 1}`] : [],
        ),
    );

    expect(offenders).toEqual([]);
  });

  test('no feature keeps its own copy of the escape-to-close hook', () => {
    expect(() => readFileSync(resolve(WEB_SRC, 'lib/use-escape-close.ts'), 'utf8')).toThrow();
  });

  test('the panel and state kit exists', () => {
    const chrome = readFileSync(resolve(UI_SRC, 'components/chrome.tsx'), 'utf8');
    expect(chrome).toContain('export function Panel');
    const state = readFileSync(resolve(UI_SRC, 'components/state.tsx'), 'utf8');
    for (const name of ['ErrorState', 'EmptyState', 'StatusDot']) {
      expect(state).toContain(`export function ${name}`);
    }
  });

  test('every type size and weight comes from the ramp', () => {
    const offenders = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /\btext-(xs|sm|base|lg|2xl|4xl)\b|text-\[1[0-9]px\]|text-\[0\.[0-9]+em\]|\bfont-(semibold|medium|bold)\b|tracking-(wide|widest|tight)/.test(
            line,
          ) && !/text-\[0\.9em\]/.test(line)
            ? [`${rel}:${i + 1}`]
            : [],
        ),
    );

    expect(offenders).toEqual([]);
  });

  test('textareas and the input follow the kit recipe', () => {
    // The composer's auto-growing textarea stays hand-written (no chrome, grows with content).
    const raw = appSources()
      .filter((rel) => rel !== 'features/chat/Composer.tsx')
      .flatMap((rel) =>
        readFileSync(resolve(WEB_SRC, rel), 'utf8')
          .split('\n')
          .flatMap((line, i) => (/\bresize-none\b/.test(line) ? [`${rel}:${i + 1}`] : [])),
      );
    expect(raw).toEqual([]);

    const input = readFileSync(resolve(UI_SRC, 'components/input.tsx'), 'utf8');
    expect(input).toContain('h-7');
    expect(input).toContain('text-body');
  });

  test('icon-only controls come from the kit', () => {
    // A <Button> whose whole body is one icon element is an icon button; those
    // belong to IconButton (kit). Buttons that mix an icon with text stay.
    const offenders = appSources().flatMap((rel) => {
      const text = readFileSync(resolve(WEB_SRC, rel), 'utf8');
      return [...text.matchAll(/<Button\b[\s\S]*?<\/Button>/g)]
        .filter((m) => /aria-label=/.test(m[0]))
        .filter((m) => {
          const body = m[0].slice(m[0].indexOf('>') + 1, m[0].lastIndexOf('</Button>')).trim();
          return /^<[A-Z][A-Za-z0-9]*(?:\s[^>]*?)?\/>$/.test(body);
        })
        .map((m) => `${rel}:${text.slice(0, m.index).split('\n').length}`);
    });

    expect(offenders).toEqual([]);
  });

  test('icon buttons keep their glyph', () => {
    // Self-closing <IconButton /> renders an empty square: the accessible name
    // exists but nothing is visible. The opening tag has to be scanned (props
    // span lines and contain braces), not matched line by line.
    const selfClosing = (text: string): number[] => {
      const hits: number[] = [];
      for (let i = text.indexOf('<IconButton'); i !== -1; i = text.indexOf('<IconButton', i + 1)) {
        let depth = 0;
        let j = i + '<IconButton'.length;
        for (; j < text.length; j++) {
          const ch = text[j];
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
          else if (ch === '>' && depth === 0) break;
        }
        if (text[j - 1] === '/') hits.push(text.slice(0, i).split('\n').length);
      }
      return hits;
    };

    const offenders = appSources().flatMap((rel) =>
      selfClosing(readFileSync(resolve(WEB_SRC, rel), 'utf8')).map((line) => `${rel}:${line}`),
    );
    expect(offenders).toEqual([]);
  });

  test('no one-pixel border recipes survive', () => {
    const offenders = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) => {
          const bad =
            /border border-(border|ring|input|link|warning)\b/.test(line) ||
            /border-[lrtb] border-border\b/.test(line) ||
            /'border-ring'\s*:/.test(line) || // conditional active form
            /hover:border-(border|border-strong)\b/.test(line);
          return bad ? [`${rel}:${i + 1}`] : [];
        }),
    );
    expect(offenders).toEqual([]);
  });

  test('panel and label recipes exist once', () => {
    const raw = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /rounded-md (bg-card )?hairline(?!-)/.test(line) ? [`${rel}:${i + 1}`] : [],
        ),
    );
    expect(raw).toEqual([]);

    const labelUses = appSources().reduce((n, rel) => {
      const text = readFileSync(resolve(WEB_SRC, rel), 'utf8');
      return n + (text.match(/\bsection-label\b/g)?.length ?? 0);
    }, 0);
    expect(labelUses).toBeGreaterThanOrEqual(25);
  });

  test('status dots and empty panes come from the kit', () => {
    const offenders = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /size-(1\.5|2|2\.5)[^"]*rounded-full|rounded-full[^"]*size-(1\.5|2|2\.5)[^"]*bg-(success|warning|destructive|muted-foreground|info)|text-center[^"]*text-muted-foreground/.test(
            line,
          ) && !/StatusDot/.test(line)
            ? [`${rel}:${i + 1}`]
            : [],
        ),
    );

    expect(offenders).toEqual([]);
  });

  test('every scroller carries the themed scrollbar', () => {
    const globals = readFileSync(resolve(WEB_SRC, 'styles/globals.css'), 'utf8');
    expect(globals).toContain('.scroll-area::-webkit-scrollbar-thumb');
    expect(globals).toContain('scrollbar-color');

    const offenders = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /\boverflow-y-auto\b/.test(line) && !/scroll-area/.test(line) ? [`${rel}:${i + 1}`] : [],
        ),
    );

    expect(offenders).toEqual([]);
  });

  test('top bars and session rows use the app heights', () => {
    const opsBar = readFileSync(resolve(WEB_SRC, 'features/sessions/OpsBar.tsx'), 'utf8');
    expect(opsBar).toContain('h-10');
    expect(opsBar).toContain('px-3');
    // pane headers carry the 40px height inside the `pane-header` utility now
    const toolPane = readFileSync(resolve(WEB_SRC, 'features/chat/ToolPane.tsx'), 'utf8');
    expect(toolPane).toContain('pane-header');
    const sidebar = readFileSync(resolve(WEB_SRC, 'features/sessions/SessionSidebar.tsx'), 'utf8');
    expect(sidebar).toContain('h-7');
    expect(sidebar).toContain('rounded-md');
  });

  test('the muted hairline follows the colour scheme', () => {
    const globals = readFileSync(resolve(WEB_SRC, 'styles/globals.css'), 'utf8');
    const vars = readFileSync(resolve(UI_SRC, 'styles/vars.css'), 'utf8');
    // a black-only muted edge disappears on the dark surface
    expect(globals).not.toContain('hsl(var(--overlay) / 0.08)');
    expect(globals).toContain('hsl(var(--border-muted))');
    const blocks = vars.match(/(:root|\.dark)\s*\{[^{}]*\}/g) ?? [];
    const muted = blocks.map((b) => b.match(/--border-muted:\s*([^;]+);/)?.[1]);
    expect(muted[0]).toBeTruthy();
    expect(muted[1]).toBeTruthy();
    expect(muted[0]).not.toBe(muted[1]);
  });

  test('no static utility carries a bogus opacity modifier', () => {
    const offenders = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) => (/\bhairline(-\w+)?\/\d/.test(line) ? [`${rel}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });

  test('the connect dialog keeps its instructions and login command', () => {
    const providers = readFileSync(
      resolve(WEB_SRC, 'features/providers/ProvidersPane.tsx'),
      'utf8',
    );
    expect(providers).toContain('OAuth sign-in opens in your browser');
    expect(providers).toContain('omp login {connectId}');
    // one scrim only: the wrapper div must not survive next to <Dialog>
    const scrims = providers
      .split('\n')
      .filter((l) => l.includes('className="absolute inset-0 scrim"'));
    expect(scrims).toEqual([]);
  });
});
