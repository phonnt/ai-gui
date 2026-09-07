import { describe, expect, test } from 'bun:test';
import { OperationNotSupportedError, ToolExecutionError } from '@ai-gui/agent-runtime';
import {
  buildDebugBreakpointParams,
  buildDebugRemoveBreakpointParams,
  debugSdkAction,
} from './tools';

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

describe('debugSdkAction', () => {
  test('maps every REST action to its SDK debug action', () => {
    expect(debugSdkAction('launch')).toBe('launch');
    expect(debugSdkAction('attach')).toBe('attach');
    expect(debugSdkAction('breakpoint')).toBe('set_breakpoint');
    expect(debugSdkAction('unbreak')).toBe('remove_breakpoint');
    expect(debugSdkAction('continue')).toBe('continue');
    expect(debugSdkAction('pause')).toBe('pause');
    expect(debugSdkAction('evaluate')).toBe('evaluate');
    expect(debugSdkAction('threads')).toBe('threads');
    expect(debugSdkAction('stack')).toBe('stack_trace');
    expect(debugSdkAction('scopes')).toBe('scopes');
    expect(debugSdkAction('variables')).toBe('variables');
    expect(debugSdkAction('output')).toBe('output');
    expect(debugSdkAction('terminate')).toBe('terminate');
    expect(debugSdkAction('sessions')).toBe('sessions');
  });

  test('maps step kinds to the matching step action', () => {
    expect(debugSdkAction('step', 'over')).toBe('step_over');
    expect(debugSdkAction('step', 'in')).toBe('step_in');
    expect(debugSdkAction('step', 'out')).toBe('step_out');
  });

  test('rejects unknown actions and step kinds', () => {
    expect(() => debugSdkAction('disassemble')).toThrow(OperationNotSupportedError);
    expect(() => debugSdkAction('step', 'sideways')).toThrow(OperationNotSupportedError);
  });
});
