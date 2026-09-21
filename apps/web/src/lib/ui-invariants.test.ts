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
    for (const name of ['Panel', 'PaneHeader', 'SectionLabel']) {
      expect(chrome).toContain(`export function ${name}`);
    }
    const state = readFileSync(resolve(UI_SRC, 'components/state.tsx'), 'utf8');
    for (const name of ['ErrorState', 'EmptyState', 'StatusDot']) {
      expect(state).toContain(`export function ${name}`);
    }
  });

  test('no feature re-declares the error box or the section label recipe', () => {
    const offenders = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /items-center gap-2 rounded-md.*p-3 text-center|text-xs font-semibold uppercase tracking-wide/.test(
            line,
          )
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
    const chatPage = readFileSync(resolve(WEB_SRC, 'features/chat/ChatPage.tsx'), 'utf8');
    expect(chatPage).toContain('h-10');
    const sidebar = readFileSync(resolve(WEB_SRC, 'features/sessions/SessionSidebar.tsx'), 'utf8');
    expect(sidebar).toContain('h-7');
    expect(sidebar).toContain('rounded-md');
  });
});
