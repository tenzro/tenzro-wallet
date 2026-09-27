'use client';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Logo,
} from '@tenzro/ui';
import * as React from 'react';
import {
  POPUP_ERRORS,
  POPUP_PROTOCOL,
  type PopupRequest,
  type PopupResponse,
  type PopupSendTransaction,
  isPopupRequest,
} from 'tenzro-wallet';

import { addConnection, isConnected, removeConnection } from '@/lib/tenzro/connections';
import { TNZO_DECIMALS, formatBaseUnits, shortAddress } from '@/lib/tenzro/format';
import { useWallet } from '@/lib/tenzro/hooks';
import { sendTnzo } from '@/lib/tenzro/wallet';

interface Pending {
  readonly request: PopupRequest;
  readonly origin: string;
}

function isSend(p: unknown): p is PopupSendTransaction {
  const v = p as Partial<PopupSendTransaction> | null;
  return !!v && typeof v.to === 'string' && typeof v.value === 'string' && /^\d+$/.test(v.value);
}

export default function ApprovePage() {
  const { wallet, signIn, loading, error: walletError } = useWallet();
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [noOpener, setNoOpener] = React.useState(false);

  const respond = React.useCallback(
    (body: Omit<PopupResponse, 'protocol' | 'type' | 'id'>) => {
      if (!pending || !window.opener) return;
      const msg: PopupResponse = {
        protocol: POPUP_PROTOCOL,
        type: 'response',
        id: pending.request.id,
        ...body,
      };
      // Only the site that asked receives the answer.
      (window.opener as Window).postMessage(msg, pending.origin);
      setPending(null);
    },
    [pending],
  );

  React.useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) {
      setNoOpener(true);
      return;
    }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== opener || !isPopupRequest(e.data)) return;
      setPending((cur) => cur ?? { request: e.data as PopupRequest, origin: e.origin });
    };
    window.addEventListener('message', onMessage);
    // The ready signal carries nothing, so it may go to whichever page opened us.
    opener.postMessage({ protocol: POPUP_PROTOCOL, type: 'ready' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Disconnecting needs no approval, only the wallet that holds the connection.
  React.useEffect(() => {
    if (pending?.request.method === 'tenzro_disconnect' && wallet) {
      removeConnection(pending.origin, wallet.account);
      respond({ result: null });
      window.close();
    }
  }, [pending, wallet, respond]);

  async function approve() {
    if (!pending || !wallet) return;
    setBusy(true);
    setError(null);
    try {
      const { method, params } = pending.request;
      if (method === 'tenzro_connect') {
        addConnection(pending.origin, wallet.account);
        respond({ result: { account: wallet.account, did: wallet.did } });
      } else if (method === 'tenzro_sendTransaction') {
        if (!isSend(params)) throw new Error('The site sent an invalid transaction.');
        const { userOpHash } = await sendTnzo(wallet, params.to, BigInt(params.value));
        respond({ result: { userOpHash } });
      }
      window.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function decline() {
    respond({ error: { code: POPUP_ERRORS.rejected, message: 'The request was declined.' } });
    window.close();
  }

  const connected = pending && wallet ? isConnected(pending.origin, wallet.account) : false;
  const needsConnection = pending?.request.method === 'tenzro_sendTransaction' && !connected;

  React.useEffect(() => {
    if (needsConnection && pending) {
      respond({
        error: {
          code: POPUP_ERRORS.unauthorized,
          message: 'Connect this site to the wallet first.',
        },
      });
    }
  }, [needsConnection, pending, respond]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
      <Logo />
      {noOpener ? (
        <p className="text-sm text-foreground-muted">
          This page answers requests from sites that use Tenzro Wallet. Open it from such a site.
        </p>
      ) : !pending ? (
        <p className="text-sm text-foreground-muted">Waiting for the site's request…</p>
      ) : !wallet ? (
        <Card variant="raised">
          <CardHeader>
            <CardTitle>Sign in to continue</CardTitle>
            <CardDescription>
              <span className="font-mono">{pending.origin}</span> wants to use your Tenzro wallet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={() => signIn().catch(() => {})} disabled={loading}>
              Sign in with your passkey
            </Button>
            {walletError && <p className="text-sm text-danger">{walletError.message}</p>}
          </CardContent>
        </Card>
      ) : pending.request.method === 'tenzro_disconnect' ? null : (
        <Card variant="raised">
          <CardHeader>
            <CardTitle>
              {pending.request.method === 'tenzro_connect'
                ? 'Connect to this site?'
                : 'Approve this payment?'}
            </CardTitle>
            <CardDescription>
              <span className="font-mono">{pending.origin}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {pending.request.method === 'tenzro_connect' ? (
              <p className="text-foreground-muted">
                The site will see your address{' '}
                <span className="font-mono">{shortAddress(wallet.account)}</span> and your identity,
                and may ask you to approve payments. It cannot move funds without your approval.
              </p>
            ) : isSend(pending.request.params) ? (
              <div className="space-y-1">
                <p className="font-mono text-xl tabular">
                  {formatBaseUnits(pending.request.params.value, TNZO_DECIMALS)} TNZO
                </p>
                <p className="text-foreground-muted">
                  to <span className="font-mono">{pending.request.params.to}</span>
                </p>
              </div>
            ) : (
              <p className="text-danger">The site sent an invalid transaction.</p>
            )}
            <div className="flex gap-2">
              <Button onClick={approve} disabled={busy}>
                {busy ? 'Approve with your passkey…' : 'Approve'}
              </Button>
              <Button variant="outline" onClick={decline} disabled={busy}>
                Decline
              </Button>
            </div>
            {error && <p className="text-danger">{error}</p>}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
