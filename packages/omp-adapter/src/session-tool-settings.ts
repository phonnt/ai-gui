/**
 * Settings overrides for SDK-direct out-of-turn tool sessions.
 *
 * Pure (no SDK import) so the exact key set stays unit-testable. Every key
 * below is a real `Settings` schema path — verified against the SDK
 * `settings-schema.ts` — consumed by `createTools`/tool gating or at execute
 * time:
 *
 * - `bash.enabled` / `todo.enabled` / `debug.enabled`: gate the
 *   bash/todo/debug factories (`debug.enabled` defaults true in the SDK;
 *   pinned true here so out-of-turn sessions never lose the debug tool to
 *   user config).
 * - `eval.js` / `eval.py`: per-backend allowance read by `resolveEvalBackends`.
 * - `lsp.enabled`: true keeps the lsp tool in; paired with `enableLsp: true`
 *   on the ToolSession so edit/write get LSP writethrough.
 * - `tools.xdev`: false keeps every tool top-level (no xd:// mounting), so
 *   direct `BUILTIN_TOOLS` construction matches what the model would see.
 * - `edit.mode`: pinned to `hashline` so `editFile` hashline input always
 *   parses, independent of user config.
 */
export function sessionToolSettingOverrides(): Record<string, boolean | string> {
  return {
    'bash.enabled': true,
    'todo.enabled': true,
    'eval.js': true,
    'eval.py': true,
    'lsp.enabled': true,
    'debug.enabled': true,
    'tools.xdev': false,
    'edit.mode': 'hashline',
  };
}
