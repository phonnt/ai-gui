import { Button, EmptyState, IconButton, Input, Skeleton } from '@grove/ui';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useAddSshHost, useRemoveSshHost, useSshHosts } from '../../lib/api-client/hooks';

/**
 * Hosts for the `ssh://` read path. The TUI manages them behind `/ssh`; here the
 * same list lives in the explorer, because that is where a reader would look for
 * a remote file. Scopes mirror `getSSHConfigPath`: `user` (agent dir) and
 * `project` (the session cwd).
 */
export function SshHostsSection({ sessionId }: { sessionId: string }) {
  const [scope, setScope] = useState<'user' | 'project'>('user');
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const hosts = useSshHosts(sessionId, scope);
  const add = useAddSshHost(sessionId);
  const remove = useRemoveSshHost(sessionId);

  const submit = () => {
    const trimmedName = name.trim();
    const trimmedHost = host.trim();
    if (!trimmedName || !trimmedHost) return;
    add.mutate(
      { scope, name: trimmedName, host: trimmedHost },
      {
        onSuccess: () => {
          setName('');
          setHost('');
        },
      },
    );
  };

  const error = add.error ?? remove.error;

  return (
    <section className="px-2 pb-2">
      <div className="flex items-center justify-between gap-2 py-1">
        <span className="section-label">SSH hosts</span>
        <div className="flex items-center gap-1">
          {(['user', 'project'] as const).map((value) => (
            <Button
              key={value}
              variant={scope === value ? 'default' : 'ghost'}
              onClick={() => setScope(value)}
              aria-pressed={scope === value}
            >
              {value}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1 pb-1.5">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="name"
          aria-label="SSH host name"
          className="w-24"
        />
        <Input
          value={host}
          onChange={(event) => setHost(event.target.value)}
          placeholder="host"
          aria-label="SSH host address"
          className="min-w-0 flex-1"
        />
        <Button disabled={add.isPending || !name.trim() || !host.trim()} onClick={submit}>
          Add
        </Button>
      </div>

      {hosts.isPending && <Skeleton className="h-8 w-full" />}
      {hosts.data?.hosts.length === 0 && (
        <EmptyState message={`No hosts in the ${scope} scope yet.`} />
      )}
      <ul className="flex flex-col gap-0.5">
        {(hosts.data?.hosts ?? []).map((entry) => (
          <li key={entry} className="flex items-center gap-2 rounded-md panel-plain px-2 py-1">
            <span className="min-w-0 flex-1 truncate font-mono text-small">{entry}</span>
            <IconButton
              label={`Remove ${entry}`}
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ scope, name: entry })}
            >
              <X />
            </IconButton>
          </li>
        ))}
      </ul>

      {error && <p className="px-1 pt-1 text-small text-destructive">{error.message}</p>}
    </section>
  );
}
