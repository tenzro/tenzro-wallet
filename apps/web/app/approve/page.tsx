'use client';

import { Button } from '@tenzro/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TypedTransaction } from 'tenzro-sdk';

import { Effects } from '@/components/effects';
import { Mono, Notice, Section, useAction } from '@/components/ui';
import { useWallet } from '@/components/wallet-context';
import { signerOf } from '@/lib/account';
import {
  POPUP_PROTOCOL,
  type PopupError,
  type PopupRequest,
  USER_REJECTED,
  readRequest,
  readTransaction,
  response,
} from '@/lib/popup';
import { sendFromAccount } from '@/lib/send';

interface Pending {
  readonly request: PopupRequest;
  readonly origin: string;
  readonly tx: TypedTransaction | null;
  readonly problem: string | null;
}

/** The popup a site opens to connect to the wallet or ask it to send a transaction. */
export default function Approve() {
  const { wallet, net } = useWallet();
  const [pending, setPending] = useState<Pending | null>(null);
  const [effectsOk, setEffectsOk] = useState(false);
  const action = useAction();
  const opener = useRef<Window | null>(null);

  const answer = useCallback(
    (body: { result: unknown } | { error: PopupError }) => {
      if (!pending || !opener.current) return;
      opener.current.postMessage(response(pending.request.id, body), pending.origin);
      setPending(null);
      setEffectsOk(false);
    },
    [pending],
  );

  useEffect(() => {
    opener.current = window.opener as Window | null;
    if (!opener.current) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== opener.current) return;
      const read = readRequest(event.data);
      if (!read) return;
      if ('error' in read) {
        opener.current?.postMessage(response(read.id, { error: read.error }), event.origin);
        return;
      }
      if (read.request.method === 'tenzro_disconnect') {
        opener.current?.postMessage(response(read.request.id, { result: null }), event.origin);
        return;
      }
      let tx: TypedTransaction | null = null;
      let problem: string | null = null;
      if (read.request.method === 'tenzro_sendTransaction') {
        try {
          tx = readTransaction(read.request.params);
        } catch (e) {
          problem = (e as Error).message;
        }
      }
      setPending({ request: read.request, origin: event.origin, tx, problem });
    };
    window.addEventListener('message', onMessage);
    opener.current.postMessage({ protocol: POPUP_PROTOCOL, type: 'ready' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!opener.current && typeof window !== 'undefined' && !window.opener) {
    return <Notice>This page opens from a site that asks for your wallet.</Notice>;
  }
  if (!pending) return <Notice>Waiting for the site.</Notice>;
  if (!wallet || !net) {
    return (
      <Notice tone="warning">
        Open this wallet in a tab and sign in or create your account first, then try again from{' '}
        {pending.origin}.
      </Notice>
    );
  }

  const { request, origin } = pending;

  return (
    <Section
      title={request.method === 'tenzro_connect' ? 'Connect' : 'Approve a transaction'}
      description={
        <>
          Requested by <Mono>{origin}</Mono>
        </>
      }
    >
      {request.method === 'tenzro_connect' ? (
        <p className="text-sm">
          The site will see your account <Mono>{wallet.account}</Mono> and identity. It cannot move
          anything without asking you here.
        </p>
      ) : pending.problem ? (
        <Notice tone="danger">{pending.problem}</Notice>
      ) : pending.tx ? (
        <Effects net={net} tx={pending.tx} from={wallet.account} onReady={setEffectsOk} />
      ) : null}
      {action.error ? <Notice tone="danger">{action.error}</Notice> : null}
      <div className="flex gap-2">
        <Button
          pending={action.pending}
          disabled={request.method === 'tenzro_sendTransaction' && (!pending.tx || !effectsOk)}
          onClick={() =>
            action.run(async () => {
              if (request.method === 'tenzro_connect') {
                answer({ result: { account: wallet.account, did: wallet.did } });
              } else if (pending.tx) {
                const hash = await sendFromAccount(
                  net.rpc,
                  signerOf(wallet),
                  wallet.account,
                  pending.tx,
                );
                answer({ result: { tx_hash: hash } });
              }
            })
          }
        >
          {request.method === 'tenzro_connect' ? 'Connect' : 'Approve with passkey'}
        </Button>
        <Button variant="ghost" onClick={() => answer({ error: USER_REJECTED })}>
          Decline
        </Button>
      </div>
    </Section>
  );
}
