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
});
