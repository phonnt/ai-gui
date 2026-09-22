import { OperationNotSupportedError, type SessionTools } from '@grove/agent-runtime';
import { ensureTheme } from '@oh-my-pi/pi-coding-agent';
import { BUILTIN_TOOLS } from '@oh-my-pi/pi-coding-agent/tools';

/**
 * SDK-direct SessionTools: every method executes a real `BUILTIN_TOOLS`
 * factory outside any agent turn.
 *
 * Tool → factory mapping (all from `BUILTIN_TOOLS.<name>(toolSession)`):
 * - readFile/listDir → `read` (ReadTool). listDir resolves + type-checks the
 *   directory through the read tool, then structures entries via node:fs
 *   (the read tool renders listings as text, which carries no sizes).
 * - writeFile → `write` (WriteTool).
 * - editFile → `edit` (EditTool, hashline mode pinned by settings).
 * - runBash → `bash` (BashTool; `timeoutMs` converted to SDK seconds).
 * - runCell/resetKernel → `eval` (EvalTool; reset via `reset: true`).
 * - getTodos/applyTodoOp → `todo` (TodoTool over in-memory session phases).
 * - listArtifacts/readArtifact → no tool exists: resolved from the session
 *   journal's artifact directory with the SDK naming rule (`<id>.<tool>.log`,
 *   `<id>.` prefix match). Needs a registered session file.
 * - lsp* → `lsp` (LspTool; `timeoutMs` converted to SDK seconds). The tool
 *   renders formatted text, so diagnostics/definition/symbols/status are
 *   parsed back into structures (see `parse*` below); hover passes through.
 * - debug* → `debug` (DebugTool over the process-wide DAP singleton; the
 *   tool serializes requests, so no per-session locking here). Structured
 *   state (threads/frames/scopes/variables/sessions/snapshots) comes from
 *   result `details`; `remove_breakpoint` needs file+line or function, so
 *   breakpoint targets are tracked per web session (see `breakpointRegs`).
 *
 * Settings keys consumed (see `session-tool-settings.ts`): `bash.enabled`,
 * `todo.enabled`, `eval.js`, `eval.py`, `lsp.enabled`, `debug.enabled`,
 * `tools.xdev`, `edit.mode`.
 */

import {
  type BuiltTools,
  ensureEntry,
  runTool,
  type SessionEntry,
  setToolTableFactory,
} from './tools/core';
import {
  debugAttachImpl,
  debugBreakpointImpl,
  debugContinueImpl,
  debugEvaluateImpl,
  debugLaunchImpl,
  debugOutputImpl,
  debugPauseImpl,
  debugRemoveBreakpointImpl,
  debugRequestImpl,
  debugScopesImpl,
  debugSessionsImpl,
  debugStackImpl,
  debugStepImpl,
  debugTerminateImpl,
  debugThreadsImpl,
  debugVariablesImpl,
} from './tools/debug';
import {
  editFileImpl,
  globFilesImpl,
  grepFilesImpl,
  listDirImpl,
  readFileImpl,
  writeFileImpl,
} from './tools/files';
import {
  lspDefinitionImpl,
  lspDiagnosticsImpl,
  lspHoverImpl,
  lspRequestImpl,
  lspStatusImpl,
  lspSymbolsImpl,
} from './tools/lsp';
import { browserActionImpl, computerActionImpl } from './tools/prelude';
import {
  cancelJobImpl,
  listJobsImpl,
  resetKernelImpl,
  runBashImpl,
  runCellImpl,
} from './tools/shell';
import { applyTodoOpImpl, getTodosImpl, listArtifactsImpl, readArtifactImpl } from './tools/todos';

export * from './tools/core';
export * from './tools/debug';
export * from './tools/files';
export * from './tools/lsp';
export * from './tools/prelude';
export * from './tools/shell';
export * from './tools/todos';

export async function buildBuiltTools(
  entry: SessionEntry,
  _sessionId: string,
): Promise<BuiltTools> {
  if (entry.built) return entry.built;
  entry.building ??= (async () => {
    // LSP/debug formatters read the process-global SDK theme; init once.
    await ensureTheme().catch(() => {});
    const session = entry.handle.session;
    const [read, write, edit, bash, evalTool, todo, lsp, debug, glob, grep, securityScan] =
      await Promise.all([
        BUILTIN_TOOLS.read(session),
        BUILTIN_TOOLS.write(session),
        BUILTIN_TOOLS.edit(session),
        BUILTIN_TOOLS.bash(session),
        BUILTIN_TOOLS.eval(session),
        BUILTIN_TOOLS.todo(session),
        BUILTIN_TOOLS.lsp(session),
        BUILTIN_TOOLS.debug(session),
        BUILTIN_TOOLS.glob(session),
        BUILTIN_TOOLS.grep(session),
        BUILTIN_TOOLS.security_scan(session),
      ]);
    const missing = [
      ['read', read],
      ['write', write],
      ['edit', edit],
      ['bash', bash],
      ['eval', evalTool],
      ['todo', todo],
      ['lsp', lsp],
      ['debug', debug],
      ['glob', glob],
      ['grep', grep],
      ['security_scan', securityScan],
    ]
      .filter(([, tool]) => !tool)
      .map(([name]) => name);
    if (
      missing.length > 0 ||
      !read ||
      !write ||
      !edit ||
      !bash ||
      !evalTool ||
      !todo ||
      !lsp ||
      !debug ||
      !glob ||
      !grep ||
      !securityScan
    ) {
      throw new OperationNotSupportedError(`session tools unavailable: ${missing.join(',')}`);
    }
    return {
      read,
      write,
      edit,
      bash,
      eval: evalTool,
      todo,
      lsp,
      debug,
      glob,
      grep,
      security: securityScan,
    };
  })();
  try {
    entry.built = await entry.building;
    return entry.built;
  } finally {
    entry.building = null;
  }
}

export function createSessionTools(): SessionTools {
  // core asks for the tool table through this hook so it never imports the impls
  setToolTableFactory(buildBuiltTools);
  return {
    readFile: (input) => readFileImpl(input.sessionId, input.path, input.range),
    listDir: (input) => listDirImpl(input.sessionId, input.path),
    globFiles: (input) => globFilesImpl(input.sessionId, input.pattern, input.limit),
    grepFiles: (input) =>
      grepFilesImpl(input.sessionId, input.pattern, input.path, input.caseSensitive, input.skip),
    browserAction: (input) => browserActionImpl(input.sessionId, input.params),
    computerAction: (input) => computerActionImpl(input.sessionId, input.params),
    securityScan: async (input) => {
      const entry = await ensureEntry(input.sessionId);
      const tools = await buildBuiltTools(entry, input.sessionId);
      return runTool(tools.security, entry, input.params, 'security_scan', {
        throwOnError: false,
      });
    },
    listJobs: (input) => listJobsImpl(input.sessionId),
    cancelJob: (input) => cancelJobImpl(input.sessionId, input.id),
    writeFile: (input) => writeFileImpl(input.sessionId, input.path, input.content),
    editFile: (input) => editFileImpl(input.sessionId, input.path, input.tag, input.input),
    runBash: (input) =>
      runBashImpl(
        input.sessionId,
        input.command,
        input.cwd,
        input.timeoutMs,
        input.env,
        input.pty,
        input.async,
      ),
    runCell: (input) =>
      runCellImpl(
        input.sessionId,
        input.language,
        input.code,
        input.title,
        input.timeoutMs,
        input.reset,
      ),
    resetKernel: (input) => resetKernelImpl(input.sessionId, input.language),
    getTodos: (input) => getTodosImpl(input.sessionId),
    applyTodoOp: (input) => applyTodoOpImpl(input.sessionId, input.op, input.payload),
    listArtifacts: (input) => listArtifactsImpl(input.sessionId),
    readArtifact: (input) => readArtifactImpl(input.sessionId, input.id, input.range),
    lspDiagnostics: (input) => lspDiagnosticsImpl(input.sessionId, input.file, input.timeoutMs),
    lspDefinition: (input) =>
      lspDefinitionImpl(input.sessionId, input.file, input.line, input.symbol),
    lspHover: (input) => lspHoverImpl(input.sessionId, input.file, input.line, input.symbol),
    lspSymbols: (input) => lspSymbolsImpl(input.sessionId, input.file, input.query),
    lspStatus: (input) => lspStatusImpl(input.sessionId),
    lspRequest: (input) => lspRequestImpl(input.sessionId, input.params),
    debugRequest: (input) => debugRequestImpl(input.sessionId, input.params),
    debugLaunch: (input) =>
      debugLaunchImpl(input.sessionId, input.program, input.args, input.cwd, input.adapter),
    debugAttach: (input) =>
      debugAttachImpl(input.sessionId, {
        ...(input.pid !== undefined ? { pid: input.pid } : {}),
        ...(input.port !== undefined ? { port: input.port } : {}),
        ...(input.host !== undefined ? { host: input.host } : {}),
        ...(input.adapter !== undefined ? { adapter: input.adapter } : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      }),
    debugBreakpoint: (input) =>
      debugBreakpointImpl(input.sessionId, {
        ...(input.file !== undefined ? { file: input.file } : {}),
        ...(input.line !== undefined ? { line: input.line } : {}),
        ...(input.fn !== undefined ? { fn: input.fn } : {}),
        ...(input.condition !== undefined ? { condition: input.condition } : {}),
      }),
    debugRemoveBreakpoint: (input) => debugRemoveBreakpointImpl(input.sessionId, input.id),
    debugContinue: (input) => debugContinueImpl(input.sessionId),
    debugStep: (input) => debugStepImpl(input.sessionId, input.kind),
    debugPause: (input) => debugPauseImpl(input.sessionId),
    debugEvaluate: (input) => debugEvaluateImpl(input.sessionId, input.expression, input.frameId),
    debugThreads: (input) => debugThreadsImpl(input.sessionId),
    debugStack: (input) => debugStackImpl(input.sessionId, input.levels),
    debugScopes: (input) => debugScopesImpl(input.sessionId, input.frameId),
    debugVariables: (input) => debugVariablesImpl(input.sessionId, input.ref),
    debugOutput: (input) => debugOutputImpl(input.sessionId),
    debugTerminate: (input) => debugTerminateImpl(input.sessionId),
    debugSessions: (input) => debugSessionsImpl(input.sessionId),
  };
}
