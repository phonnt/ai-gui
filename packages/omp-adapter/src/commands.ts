import { discoverSlashCommands } from '@oh-my-pi/pi-coding-agent';
import { BUILTIN_SLASH_COMMANDS_INTERNAL } from '@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry';

export interface CommandInfo {
  name: string;
  aliases?: string[];
  description: string;
  hint?: string;
  source: 'builtin' | 'file';
  /** No text handle: only executable via explicit web dispatch, never as prompt text. */
  localOnly?: boolean;
}
/**
 * Slash commands for autocomplete: text-capable built-ins (same filter as
 * ACP availability: must have a handle) plus discovered file commands for
 * the given cwd (project + user + plugins, first-wins per name).
 */
export async function listCommands(cwd?: string): Promise<CommandInfo[]> {
  const out: CommandInfo[] = [];
  const seen = new Set<string>();
  const push = (cmd: CommandInfo): void => {
    if (seen.has(cmd.name)) return;
    seen.add(cmd.name);
    for (const alias of cmd.aliases ?? []) seen.add(alias);
    out.push(cmd);
  };
  for (const cmd of BUILTIN_SLASH_COMMANDS_INTERNAL) {
    const localOnly = !cmd.handle;
    push({
      name: cmd.name,
      ...(cmd.aliases !== undefined ? { aliases: cmd.aliases } : {}),
      description: cmd.description,
      ...(typeof cmd.inlineHint === 'string' && cmd.inlineHint ? { hint: cmd.inlineHint } : {}),
      source: 'builtin',
      ...(localOnly ? { localOnly: true as const } : {}),
    });
  }
  if (cwd) {
    try {
      const files = await discoverSlashCommands({ cwd });
      for (const file of files) {
        push({ name: file.name, description: file.description, source: 'file' });
      }
    } catch {
      /* discovery is best-effort; built-ins still served */
    }
  }
  out.sort((a, b) => (a.name < b.name ? -1 : 1));
  return out;
}
