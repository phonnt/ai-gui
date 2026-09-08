import { useQuery } from '@tanstack/react-query';
import { getHealth } from '../../lib/api-client/rest';

async function fetchHealth(): Promise<{ ok: boolean; version: string; runtime: string } | null> {
  const res = await getHealth();
  if (!res.ok) return null;
  return { ok: res.data.ok, version: res.data.version, runtime: res.data.runtime };
}

/** Server liveness for the sidebar status card (polls, never throws). */
export function useServerHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
    retry: 1,
    staleTime: 10_000,
  });
}
