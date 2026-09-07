import { describe, expect, test } from 'bun:test';
import {
  artifactsDirForSessionFile,
  findArtifactFilename,
  hasHashlineSection,
  parseArtifactFilename,
  sliceLinesByRange,
  splitHashlineHeader,
} from './tool-helpers';

describe('artifactsDirForSessionFile', () => {
  test('strips one .jsonl suffix, rejects everything else', () => {
    expect(artifactsDirForSessionFile('/s/abc.jsonl')).toBe('/s/abc');
    expect(artifactsDirForSessionFile('/s/abc.jsonl.jsonl')).toBe('/s/abc.jsonl');
    expect(artifactsDirForSessionFile('/s/abc.json')).toBe(null);
    expect(artifactsDirForSessionFile(null)).toBe(null);
    expect(artifactsDirForSessionFile(undefined)).toBe(null);
  });
});

describe('parseArtifactFilename', () => {
  test('recovers id and tool kind from SDK artifact names', () => {
    expect(parseArtifactFilename('3.bash.log')).toEqual({ id: '3', kind: 'bash' });
    expect(parseArtifactFilename('12.read.log')).toEqual({ id: '12', kind: 'read' });
  });

  test('rejects foreign files and non-numeric ids', () => {
    expect(parseArtifactFilename('draft.txt')).toBe(null);
    expect(parseArtifactFilename('x.bash.log')).toBe(null);
    expect(parseArtifactFilename('3.bash.tmp')).toBe(null);
  });
});

describe('findArtifactFilename', () => {
  test('matches the SDK prefix rule, rejects non-numeric ids', () => {
    const names = ['0.bash.log', '1.read.log', 'draft.txt'];
    expect(findArtifactFilename(names, '1')).toBe('1.read.log');
    expect(findArtifactFilename(names, '7')).toBe(null);
    expect(findArtifactFilename(names, '../0')).toBe(null);
    expect(findArtifactFilename(names, '')).toBe(null);
  });
});

describe('sliceLinesByRange', () => {
  const text = ['a', 'b', 'c', 'd', 'e'].join('\n');

  test('windows, tails, open ends, and single lines', () => {
    expect(sliceLinesByRange(text, '2-4')).toEqual({ content: 'b\nc\nd', truncated: true });
    expect(sliceLinesByRange(text, '1-5')).toEqual({ content: text, truncated: false });
    expect(sliceLinesByRange(text, '4-')).toEqual({ content: 'd\ne', truncated: true });
    expect(sliceLinesByRange(text, '-2')).toEqual({ content: 'd\ne', truncated: true });
    expect(sliceLinesByRange(text, '3')).toEqual({ content: 'c', truncated: true });
  });

  test('missing or unknown ranges keep full text', () => {
    expect(sliceLinesByRange(text, undefined)).toEqual({ content: text, truncated: false });
    expect(sliceLinesByRange(text, 'bogus')).toEqual({ content: text, truncated: false });
  });
});

describe('splitHashlineHeader', () => {
  test('splits [path#tag] headers, passes other text through', () => {
    expect(splitHashlineHeader('[src/foo.ts#a1b2]\n1:hi')).toEqual({ body: '1:hi', tag: 'a1b2' });
    expect(splitHashlineHeader('plain\ntext')).toEqual({ body: 'plain\ntext' });
    expect(splitHashlineHeader('[no-tag-here]\nbody')).toEqual({ body: '[no-tag-here]\nbody' });
  });
});

describe('hasHashlineSection', () => {
  test('detects sectioned edit input', () => {
    expect(hasHashlineSection('[src/foo.ts#a1b2]\nPUT 1:=1:')).toBe(true);
    expect(hasHashlineSection('PUT 1:=1:\n+hi')).toBe(false);
  });
});
