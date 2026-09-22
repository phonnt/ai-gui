import type {
  HubAgent,
  HubJob,
  HubReviveResult,
  P2aArtifactContent,
  P2aArtifactRef,
  P2aBashResult,
  P2aCellLanguage,
  P2aCellResult,
  P2aDirEntry,
  P2aEditResult,
  P2aFileContent,
  P2aTodoPhase,
  P2aWriteResult,
  P2bDebugStackFrame,
  P2bDebugThread,
  P2bLspDiagnostic,
  P2bLspLocation,
  P2bLspStatus,
  P2bLspSymbol,
  SpawnInput,
} from '../rest';

export type { P2aTruncation } from '../rest';

export async function unwrap<T>(
  promise: Promise<{ ok: true; data: T } | { ok: false; error: string }>,
): Promise<T> {
  const res = await promise;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export type {
  HubAgent,
  HubJob,
  HubReviveResult,
  P2aArtifactContent,
  P2aArtifactRef,
  P2aBashResult,
  P2aCellLanguage,
  P2aCellResult,
  P2aDirEntry,
  P2aEditResult,
  P2aFileContent,
  P2aTodoPhase,
  P2aWriteResult,
  P2bDebugStackFrame,
  P2bDebugThread,
  P2bLspDiagnostic,
  P2bLspLocation,
  P2bLspStatus,
  P2bLspSymbol,
  SpawnInput,
};

// ---------------------------------------------------------------------------
// P3 Agent Hub: roster / steer / revive / kill + jobs + spawn.
// ---------------------------------------------------------------------------

export type {
  McpActionResult,
  McpServerInfo,
  MemoryState,
  ModelInfo,
  ProviderAuth,
  ProviderInfo,
  SettingResetResult,
  SettingsEntry,
  SettingValue,
  SkillContent,
  ThemeInfo,
  ThemesState,
} from '../rest';
