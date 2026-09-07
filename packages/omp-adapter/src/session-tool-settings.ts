/**
 * Settings overrides for SDK-direct out-of-turn tool sessions.
 *
 * Pure (no SDK import) so the exact key set stays unit-testable. Every key
 * below is a real `Settings` schema path — verified against the SDK
 * `settings-schema.ts` — consumed by `createTools`/tool gating or at execute
 * time:
 *
 * - `bash.enabled` / `todo.enabled`: gate the bash/todo factories.
 * - `eval.js` / `eval.py`: per-backend allowance read by `resolveEvalBackends`.
 * - `lsp.enabled`: false keeps the lsp tool out; paired with
 *   `enableLsp: false` on the ToolSession so edit/write skip LSP writethrough.
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
    'lsp.enabled': false,
    'tools.xdev': false,
    'edit.mode': 'hashline',
  };
}
