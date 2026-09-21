import { Badge, Button, Input, Skeleton } from '@grove/ui';
import { AtSign, Check, X } from 'lucide-react';
import { useState } from 'react';
import { useModelRoles, useSetModelRole } from '../../lib/api-client/hooks';

/**
 * Model role table (`@default`, `@smol`, `@vision`, …). Roles route models for
 * features (subagents, commits, planning), so a role left unassigned falls back
 * through the resolver's chain — shown here as `auto`.
 */
export function ModelRolesPane() {
  const rolesQuery = useModelRoles();
  const setRole = useSetModelRole();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const startEdit = (role: string, current: string | null) => {
    setEditing(role);
    setDraft(current ?? '');
    setError(null);
  };

  const save = () => {
    if (!editing) return;
    const role = editing;
    setEditing(null);
    setRole.mutate(
      { role, model: draft.trim() },
      { onError: (err) => setError(err instanceof Error ? err.message : 'Save failed.') },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 hairline-b px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <AtSign className="size-4" />
          Model roles
        </h2>
        <Button size="sm" variant="outline" onClick={() => rolesQuery.refetch()}>
          Refresh
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {rolesQuery.isPending && <Skeleton className="h-24 w-full" />}
        {rolesQuery.isError && (
          <p className="text-xs text-destructive">Failed to load model roles.</p>
        )}
        {rolesQuery.data && (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1">Role</th>
                <th className="px-2 py-1">Name</th>
                <th className="px-2 py-1">Model</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {rolesQuery.data.map((role) => (
                <tr key={role.role} className="hairline-t">
                  <td className="px-2 py-1.5 font-mono text-xs">@{role.role}</td>
                  <td className="px-2 py-1.5 text-xs">{role.name}</td>
                  <td className="px-2 py-1.5">
                    {editing === role.role ? (
                      <Input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="provider/model (empty clears)"
                        aria-label={`Model for role ${role.role}`}
                        className="h-7 text-xs"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') save();
                          else if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : role.model ? (
                      <span className="font-mono text-xs">{role.model}</span>
                    ) : (
                      <Badge variant="secondary" title="Resolved through the fallback chain">
                        auto
                      </Badge>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {editing === role.role ? (
                      <span className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={save}
                          aria-label={`Save role ${role.role}`}
                          disabled={setRole.isPending}
                        >
                          <Check className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(null)}
                          aria-label={`Cancel role ${role.role}`}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEdit(role.role, role.model)}
                        aria-label={`Edit role ${role.role}`}
                      >
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(error || setRole.isError) && (
          <p className="pt-2 text-xs text-destructive">{error ?? 'Failed to update the role.'}</p>
        )}
      </div>
    </div>
  );
}
