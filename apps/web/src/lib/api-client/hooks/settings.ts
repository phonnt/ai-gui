import type {
  InstalledMarketplacePluginDto,
  MarketplaceInstallDto,
  MarketplaceInstallResponseDto,
  MarketplacePluginEnabledDto,
  MarketplacePluginTargetDto,
  McpToolEntryDto,
  MemoryBackendDto,
  MemoryOpDto,
  MemoryOpResultDto,
  MemoryStateDto,
  ModelRoleEntryDto,
} from '@grove/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type {
  McpActionResult,
  ProviderLoginAttempt,
  SettingResetResult,
  SettingValue,
} from '../rest';
import {
  addSshHost,
  applyTheme,
  cancelProviderLogin,
  getMemory,
  getProviderLogin,
  getSetting,
  installMarketplacePlugin,
  listCommands,
  listExtensions,
  listInstalledMarketplacePlugins,
  listMarketplacePlugins,
  listMcpServers,
  listMcpTools,
  listModelRoles,
  listModels,
  listPlugins,
  listPluginUpdates,
  listProviders,
  listSettings,
  listSshHosts,
  listThemes,
  logoutProvider,
  putSetting,
  reconnectMcpServer,
  reloadMcpServer,
  removeSshHost,
  resetSetting,
  runMemoryOp,
  setMarketplacePluginEnabled,
  setMemoryBackend,
  setModelRole,
  startProviderLogin,
  submitProviderLoginInput,
  testMcpServer,
  uninstallMarketplacePlugin,
  upgradeMarketplacePlugin,
} from '../rest';
import { unwrap } from './core';
export function useSettings() {
  return useQuery({
    queryKey: ['settings', 'entries'],
    queryFn: () => unwrap(listSettings()),
  });
}

export function useSetting(key: string | undefined) {
  return useQuery({
    queryKey: ['settings', 'entry', key],
    queryFn: () => unwrap(getSetting(key as string)),
    enabled: typeof key === 'string' && key.length > 0,
  });
}

export function usePutSetting() {
  const qc = useQueryClient();
  return useMutation<SettingValue, Error, { key: string; value: unknown }>({
    mutationFn: (vars) => unwrap(putSetting(vars.key, vars.value)),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['settings', 'entries'] });
      void qc.invalidateQueries({ queryKey: ['settings', 'entry', data.key] });
    },
  });
}

export function useResetSetting() {
  const qc = useQueryClient();
  return useMutation<SettingResetResult, Error, string>({
    mutationFn: (key) => unwrap(resetSetting(key)),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['settings', 'entries'] });
      void qc.invalidateQueries({ queryKey: ['settings', 'entry', data.key] });
    },
  });
}

export function useThemes() {
  return useQuery({
    queryKey: ['settings', 'themes'],
    queryFn: () => unwrap(listThemes()),
  });
}

export function useApplyTheme() {
  const qc = useQueryClient();
  return useMutation<{ current: string }, Error, { name: string; slot: 'dark' | 'light' }>({
    mutationFn: ({ name, slot }) => unwrap(applyTheme(name, slot)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'themes'] });
      void qc.invalidateQueries({ queryKey: ['themes'] });
    },
  });
}

/** Model roles (`@role` routing) with their current assignments. */

export function useModelRoles() {
  return useQuery<ModelRoleEntryDto[]>({
    queryKey: ['model-roles'],
    queryFn: () => unwrap(listModelRoles()),
  });
}

export function useSetModelRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ role, model }: { role: string; model: string }) =>
      unwrap(setModelRole(role, model)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['model-roles'] });
    },
  });
}

export function useModels() {
  return useQuery({
    queryKey: ['settings', 'models'],
    queryFn: () => unwrap(listModels()),
  });
}

export function useProviders() {
  return useQuery({
    queryKey: ['settings', 'providers'],
    queryFn: () => unwrap(listProviders()),
  });
}

export function useProviderLogout() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (providerId) => unwrap(logoutProvider(providerId)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'providers'] });
      void qc.invalidateQueries({ queryKey: ['settings', 'models'] });
    },
  });
}

/**
 * One provider sign-in, driven from the browser: start it, follow the attempt
 * while it is live, answer the prompts it asks for. The flow runs in the
 * gateway; this hook only relays status, so a closed dialog cancels rather than
 * leaving the provider waiting forever.
 */
export function useProviderLogin(providerId: string | null) {
  const qc = useQueryClient();
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const startedFor = useRef<string | null>(null);
  const liveAttempt = useRef<string | null>(null);
  const queryKey = ['provider-login', attemptId];

  const start = useMutation<ProviderLoginAttempt, Error, string>({
    mutationFn: (id) => unwrap(startProviderLogin(id)),
    onSuccess: (attempt) => {
      liveAttempt.current = attempt.attemptId;
      setAttemptId(attempt.attemptId);
    },
  });

  const attempt = useQuery({
    queryKey,
    queryFn: () => unwrap(getProviderLogin(attemptId as string)),
    enabled: attemptId !== null,
    // Poll only while the provider can still make progress; a terminal attempt
    // is what the dialog reports, so stop asking.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'running' || status === 'needs-input' ? 1500 : false;
    },
  });

  const applyAttempt = (next: ProviderLoginAttempt): void => {
    qc.setQueryData(queryKey, next);
    if (next.status === 'complete') {
      void qc.invalidateQueries({ queryKey: ['settings', 'providers'] });
      void qc.invalidateQueries({ queryKey: ['settings', 'models'] });
    }
  };

  const submit = useMutation<ProviderLoginAttempt, Error, string>({
    mutationFn: (value) => unwrap(submitProviderLoginInput(attemptId as string, value)),
    onSuccess: applyAttempt,
  });

  const cancel = useMutation<ProviderLoginAttempt, Error, void>({
    mutationFn: () => unwrap(cancelProviderLogin(attemptId as string)),
    onSuccess: applyAttempt,
  });

  useEffect(() => {
    if (!providerId || startedFor.current === providerId) return;
    startedFor.current = providerId;
    start.mutate(providerId);
    // `start` is a fresh object every render; the ref is what keeps this to one
    // call per provider (StrictMode runs effects twice in dev).
  }, [providerId, start]);

  useEffect(() => {
    // Closing the dialog must not leave a provider flow parked on its prompt.
    return () => {
      const id = liveAttempt.current;
      if (id) void cancelProviderLogin(id);
    };
  }, []);

  return { attempt, start, submit, cancel };
}

export function useMcpServers() {
  return useQuery({
    queryKey: ['settings', 'mcp'],
    queryFn: () => unwrap(listMcpServers()),
  });
}

export function useMcpAction(action: 'test' | 'reconnect' | 'reload') {
  const qc = useQueryClient();
  return useMutation<McpActionResult, Error, string>({
    mutationFn: (name) =>
      unwrap(
        action === 'test'
          ? testMcpServer(name)
          : action === 'reconnect'
            ? reconnectMcpServer(name)
            : reloadMcpServer(name),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'mcp'] });
    },
  });
}

export function useTestMcpServer() {
  return useMcpAction('test');
}

export function useReconnectMcpServer() {
  return useMcpAction('reconnect');
}

export function useReloadMcpServer() {
  return useMcpAction('reload');
}

/** Sessions available to import from another coding agent (TUI `/resume @codex`). */

export function usePlugins() {
  return useQuery({
    queryKey: ['plugins'],
    queryFn: () => unwrap(listPlugins()),
    staleTime: 30_000,
  });
}

/** Loaded extension packages. */

export function useExtensions() {
  return useQuery({
    queryKey: ['extensions'],
    queryFn: () => unwrap(listExtensions()),
    staleTime: 30_000,
  });
}

/** Plugins the configured marketplaces offer; `marketplace` narrows the list. */

export function useMarketplacePlugins(marketplace?: string) {
  return useQuery({
    queryKey: ['marketplace', 'plugins', marketplace ?? '*'],
    queryFn: () => unwrap(listMarketplacePlugins(marketplace)),
    staleTime: 30_000,
  });
}

/** Marketplace plugins installed in this project and under the user's home. */

export function useInstalledMarketplacePlugins() {
  return useQuery({
    queryKey: ['marketplace', 'installed'],
    queryFn: () => unwrap(listInstalledMarketplacePlugins()),
    staleTime: 30_000,
  });
}

/** Installed plugins whose catalog declares a newer version. */

export function usePluginUpdates() {
  return useQuery({
    queryKey: ['marketplace', 'updates'],
    queryFn: () => unwrap(listPluginUpdates()),
    staleTime: 30_000,
  });
}

export function useInstallMarketplacePlugin() {
  const qc = useQueryClient();
  return useMutation<MarketplaceInstallResponseDto, Error, MarketplaceInstallDto>({
    mutationFn: (input) => unwrap(installMarketplacePlugin(input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['plugins'] });
      void qc.invalidateQueries({ queryKey: ['marketplace'] });
    },
  });
}

export function useSetMarketplacePluginEnabled() {
  const qc = useQueryClient();
  return useMutation<
    InstalledMarketplacePluginDto[],
    Error,
    MarketplacePluginEnabledDto & { pluginId: string }
  >({
    mutationFn: ({ pluginId, ...input }) => unwrap(setMarketplacePluginEnabled(pluginId, input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['plugins'] });
      void qc.invalidateQueries({ queryKey: ['marketplace'] });
    },
  });
}

export function useUninstallMarketplacePlugin() {
  const qc = useQueryClient();
  return useMutation<
    InstalledMarketplacePluginDto[],
    Error,
    MarketplacePluginTargetDto & { pluginId: string }
  >({
    mutationFn: ({ pluginId, ...input }) => unwrap(uninstallMarketplacePlugin(pluginId, input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['plugins'] });
      void qc.invalidateQueries({ queryKey: ['marketplace'] });
    },
  });
}

export function useUpgradeMarketplacePlugin() {
  const qc = useQueryClient();
  return useMutation<
    MarketplaceInstallResponseDto,
    Error,
    MarketplacePluginTargetDto & { pluginId: string }
  >({
    mutationFn: ({ pluginId, ...input }) => unwrap(upgradeMarketplacePlugin(pluginId, input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['plugins'] });
      void qc.invalidateQueries({ queryKey: ['marketplace'] });
    },
  });
}

/** Ephemeral side question (TUI `/btw`): nothing lands in the transcript. */

export function useMcpTools(server?: string) {
  return useQuery<McpToolEntryDto[]>({
    queryKey: ['mcp', 'tools', server ?? '*'],
    queryFn: () => unwrap(listMcpTools(server)),
  });
}

export function useDiscoverMcpTools() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (server?: string) => unwrap(listMcpTools(server, true)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mcp'] });
    },
  });
}

/**
 * Background jobs of the session. Polls fast while something runs, then backs
 * off, so a long build's tail stays live without hammering the server.
 */

export function useMemory(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['session', sessionId, 'memory'],
    enabled: Boolean(sessionId),
    queryFn: () => unwrap(getMemory(sessionId as string)),
  });
}

/** `/memory <op>` — status/view/stats/diagnose/queue/clear/enqueue/search. */

export function useMemoryOp(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<
    MemoryOpResultDto,
    Error,
    { op: MemoryOpDto['op']; query?: string; limit?: number }
  >({
    mutationFn: (input) => unwrap(runMemoryOp(sessionId, input.op, input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['session', sessionId, 'memory'] });
    },
  });
}

/** Switch the live session's backend and re-initialise it in place. */

export function useSetMemoryBackend(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<MemoryStateDto, Error, MemoryBackendDto['backend']>({
    mutationFn: (backend) => unwrap(setMemoryBackend(sessionId, backend)),
    onSuccess: (state) => {
      qc.setQueryData(['session', sessionId, 'memory'], state);
    },
  });
}

export function useCommands(cwd?: string) {
  return useQuery({
    queryKey: ['settings', 'commands', cwd ?? ''],
    queryFn: () => unwrap(listCommands(cwd)),
    staleTime: 60_000,
  });
}

/** Conflict regions the read tool registered; refetched after each resolve. */

export function useSshHosts(sessionId: string | undefined, scope: 'user' | 'project') {
  return useQuery({
    queryKey: ['ssh-hosts', sessionId, scope],
    queryFn: () => unwrap(listSshHosts(sessionId as string, scope)),
    enabled: Boolean(sessionId),
  });
}

export function useAddSshHost(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      scope: 'user' | 'project';
      name: string;
      host: string;
      user?: string;
      port?: number;
    }) => unwrap(addSshHost(sessionId, input)),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ['ssh-hosts', sessionId, input.scope] });
    },
  });
}

export function useRemoveSshHost(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { scope: 'user' | 'project'; name: string }) =>
      unwrap(removeSshHost(sessionId, input.scope, input.name)),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ['ssh-hosts', sessionId, input.scope] });
    },
  });
}
