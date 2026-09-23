import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  ErrorState,
  Input,
} from '@grove/ui';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useProviderLogin } from '../../lib/api-client/hooks';
import { ProviderIcon } from '../model/ProviderIcon';

/**
 * Signs one provider in from the browser. The gateway runs the OAuth flow, so
 * this dialog only relays what the flow asks for: open this URL, then paste the
 * code it hands back. Closing it cancels the attempt instead of leaving the
 * provider parked on a prompt.
 */
export function ProviderLoginDialog({
  providerId,
  onClose,
}: {
  providerId: string;
  onClose: () => void;
}) {
  const { attempt, start, submit, cancel } = useProviderLogin(providerId);
  const [code, setCode] = useState('');
  const flow = attempt.data;
  const status = flow?.status;
  const live = status === 'running' || status === 'needs-input';

  const retry = (): void => {
    setCode('');
    start.mutate(providerId);
  };

  return (
    <Dialog open onClose={onClose} label={`Sign in to ${providerId}`}>
      <DialogHeader
        title={`Sign in to ${providerId}`}
        icon={<ProviderIcon provider={providerId} />}
        onClose={onClose}
      />
      <DialogBody className="flex flex-col gap-3">
        {start.isPending && <p className="text-body text-muted-foreground">Starting sign-in…</p>}

        {start.isError && (
          <ErrorState message={start.error.message} onRetry={retry} retryLabel="Try again" />
        )}

        {attempt.isError && (
          <ErrorState message={attempt.error.message} onRetry={() => void attempt.refetch()} />
        )}

        {flow?.auth && live && (
          <div className="flex flex-col gap-2">
            <p className="text-body text-muted-foreground">
              {flow.auth.instructions ??
                'Open the authorization page, approve access, then paste the code you are given.'}
            </p>
            <code className="rounded-sm bg-muted px-2 py-1 font-mono text-meta break-all">
              {flow.auth.url}
            </code>
            <div className="flex gap-2">
              <Button onClick={() => window.open(flow.auth?.url, '_blank', 'noopener,noreferrer')}>
                <ExternalLink className="size-4" />
                Open in browser
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(flow.auth?.url ?? '').catch(() => {
                    /* clipboard blocked: the URL is on screen to copy by hand */
                  });
                }}
              >
                Copy link
              </Button>
            </div>
          </div>
        )}

        {flow?.progress && live && (
          <p className="text-small text-muted-foreground">{flow.progress}</p>
        )}

        {status === 'needs-input' && flow?.prompt && (
          <form
            id="provider-login-code-form"
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim() !== '') submit.mutate(code.trim());
            }}
          >
            <label className="text-small text-foreground" htmlFor="provider-login-code">
              {flow.prompt.message}
            </label>
            <Input
              id="provider-login-code"
              aria-label="Authorization code"
              value={code}
              placeholder={flow.prompt.placeholder ?? ''}
              onChange={(event) => setCode(event.target.value)}
            />
            {submit.isError && (
              <p className="text-small text-destructive">{submit.error.message}</p>
            )}
          </form>
        )}

        {status === 'complete' && (
          <div className="flex flex-col gap-1">
            <p className="text-body text-foreground">
              {flow?.identity?.email ?? `Signed in to ${providerId}.`}
            </p>
            {flow?.identity?.orgName && (
              <p className="text-small text-muted-foreground">{flow.identity.orgName}</p>
            )}
            {flow?.progress && <p className="text-small text-muted-foreground">{flow.progress}</p>}
          </div>
        )}

        {status === 'failed' && <ErrorState message={flow?.error ?? 'Sign-in failed.'} />}

        {status === 'cancelled' && (
          <p className="text-body text-muted-foreground">Sign-in cancelled.</p>
        )}
      </DialogBody>
      <DialogFooter>
        {live && (
          <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            Cancel
          </Button>
        )}
        {status === 'needs-input' && (
          <Button
            type="submit"
            form="provider-login-code-form"
            disabled={submit.isPending || code.trim() === ''}
          >
            Submit code
          </Button>
        )}
        {status === 'failed' && (
          <Button variant="outline" onClick={retry}>
            Retry
          </Button>
        )}
        {status === 'complete' && <Button onClick={onClose}>Done</Button>}
        {(status === 'cancelled' || status === undefined) && (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
