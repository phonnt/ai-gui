import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HubReviveResult, SpawnInput } from '../rest';
import {
  cancelHubJobs,
  getHubInbox,
  getHubTranscript,
  killHubAgent,
  listHubAgents,
  listHubJobs,
  reviveHubAgent,
  sendHubMessage,
  spawnHubAgent,
  steerHubAgent,
} from '../rest';
import { unwrap } from './core';
export function invalidateHubAgents(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['hub', 'agents'] });
}

/** Roster of manageable agents. Polls by default; pass 0/false to disable. */
export function useHubAgents(refetchInterval: number | false = 5000) {
  return useQuery({
    queryKey: ['hub', 'agents'],
    queryFn: () => unwrap(listHubAgents()),
    refetchInterval,
  });
}

/** Steer uses the same prompt path as a session prompt. */
export function useSteerHubAgent() {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, { id: string; text: string }>({
    mutationFn: (vars) => unwrap(steerHubAgent(vars.id, vars.text)),
    onSuccess: () => invalidateHubAgents(qc),
  });
}

export function useReviveHubAgent() {
  const qc = useQueryClient();
  return useMutation<HubReviveResult, Error, string>({
    mutationFn: (id) => unwrap(reviveHubAgent(id)),
    onSuccess: () => invalidateHubAgents(qc),
  });
}

export function useKillHubAgent() {
  const qc = useQueryClient();
  return useMutation<{ killed: boolean }, Error, string>({
    mutationFn: (id) => unwrap(killHubAgent(id)),
    onSuccess: () => invalidateHubAgents(qc),
  });
}

/** Async jobs. Auto-refreshes every 5s by default. */
/** Read-only transcript rows for one agent (loaded on demand). */
export function useHubTranscript(id: string | undefined) {
  return useQuery({
    queryKey: ['hub', 'transcript', id],
    enabled: Boolean(id),
    queryFn: () => unwrap(getHubTranscript(id as string)),
  });
}

/** Mailbox of one agent; poll only while the panel is open. */
export function useHubInbox(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['hub', 'inbox', id],
    enabled: Boolean(id) && enabled,
    queryFn: () => unwrap(getHubInbox(id as string, true)),
  });
}

export function useSendHubMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { from: string; to: string; text: string }) =>
      unwrap(sendHubMessage(input)),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['hub', 'inbox', variables.to] });
      void qc.invalidateQueries({ queryKey: ['hub', 'agents'] });
    },
  });
}

export function useHubJobs(refetchInterval: number | false = 5000) {
  return useQuery({
    queryKey: ['hub', 'jobs'],
    queryFn: () => unwrap(listHubJobs()),
    refetchInterval,
  });
}

export function useCancelHubJobs() {
  const qc = useQueryClient();
  return useMutation<{ cancelled: string[] }, Error, { ids?: string[] }>({
    mutationFn: (vars) => unwrap(cancelHubJobs(vars.ids)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hub', 'jobs'] });
    },
  });
}

export function useSpawnHubAgent() {
  const qc = useQueryClient();
  return useMutation<{ agentId: string }, Error, SpawnInput>({
    mutationFn: (input) => unwrap(spawnHubAgent(input)),
    onSuccess: () => {
      invalidateHubAgents(qc);
      void qc.invalidateQueries({ queryKey: ['hub', 'jobs'] });
    },
  });
}
// ---------------------------------------------------------------------------
// P4 Settings plane: settings / themes / models / providers / mcp / skills /
// memory. Mirrors the contract paths in ./rest (local runtime guards until
// @grove/protocol gains P4 schemas — read-only here, do not edit protocol).
// ---------------------------------------------------------------------------
