import { describe, expect, test } from 'bun:test';
import { ToolExecutionError } from '@grove/agent-runtime';
import { buildDebugBreakpointParams, buildDebugRemoveBreakpointParams } from './tools';

describe('buildDebugBreakpointParams', () => {
  test('maps file+line to set_breakpoint params', () => {
    expect(buildDebugBreakpointParams({ file: 'src/main.ts', line: 42 })).toEqual({
      action: 'set_breakpoint',
      file: 'src/main.ts',
      line: 42,
    });
  });

  test('carries the condition through', () => {
    expect(
      buildDebugBreakpointParams({ file: 'src/main.ts', line: 7, condition: 'x > 1' }),
    ).toEqual({
      action: 'set_breakpoint',
      file: 'src/main.ts',
      line: 7,
      condition: 'x > 1',
    });
  });

  test('maps fn to a function breakpoint', () => {
    expect(buildDebugBreakpointParams({ fn: 'main', condition: 'y' })).toEqual({
      action: 'set_breakpoint',
      function: 'main',
      condition: 'y',
    });
  });

  test('rejects a target with neither file+line nor fn', () => {
    expect(() => buildDebugBreakpointParams({ file: 'src/main.ts' })).toThrow(ToolExecutionError);
    expect(() => buildDebugBreakpointParams({})).toThrow(ToolExecutionError);
  });
});

describe('buildDebugRemoveBreakpointParams', () => {
  test('maps a tracked file target to remove_breakpoint params', () => {
    expect(buildDebugRemoveBreakpointParams({ file: 'src/main.ts', line: 42 })).toEqual({
      action: 'remove_breakpoint',
      file: 'src/main.ts',
      line: 42,
    });
  });

  test('maps a tracked fn target to a function removal', () => {
    expect(buildDebugRemoveBreakpointParams({ fn: 'main' })).toEqual({
      action: 'remove_breakpoint',
      function: 'main',
    });
  });
});
