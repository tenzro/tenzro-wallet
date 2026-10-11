'use client';

import { Button } from '@tenzro/ui';
import { useEffect, useState } from 'react';
import { KeystoreClient, type KeystoreOp, type KeystoreUpdate } from 'tenzro-sdk';

import { signerOf } from '@/lib/account';
import { SPONSOR_URL } from '@/lib/config';
import {
  type ChangeOutcome,
  approvalsNeeded,
  change,
  describe,
  networkSender,
} from '@/lib/keystore';

import { Effects } from './effects';
import { CodeBox, Mono, Notice, useAction } from './ui';
import { useWallet } from './wallet-context';

/**
 * One keystore change: what it does, what the network says it does when the
 * account pays for it, and the passkey approval. When the account needs a
 * second passkey for it, the result is a request code for the other device.
 */
export function ChangePanel({
  op,
  label,
  onDone,
  extra,
}: {
  op: KeystoreOp;
  label: string;
  onDone?(outcome: ChangeOutcome): void;
  extra?: React.ReactNode;
}) {
  const { wallet, net, view, balance, now, refresh } = useWallet();
  const [update, setUpdate] = useState<KeystoreUpdate | null>(null);
  const [effectsOk, setEffectsOk] = useState(false);
  const [outcome, setOutcome] = useState<ChangeOutcome | null>(null);
  const { pending, error, run } = useAction();
  const opKey = JSON.stringify(op);

  // biome-ignore lint/correctness/useExhaustiveDependencies: prepared once per change
  useEffect(() => {
    if (!net || !wallet) return;
    new KeystoreClient(net.rpc)
      .prepare(wallet.account, op, wallet.anchor ?? undefined)
      .then(setUpdate)
      .catch(() => setUpdate(null));
  }, [opKey, net, wallet]);

  if (!wallet || !net || !view || balance === null) return <Notice>Reading the account.</Notice>;
  const funded = balance > 0n;
  const needed = approvalsNeeded(op, view, now);

  if (outcome) {
    return 'sent' in outcome ? (
      <Notice tone="success">
        Sent. <Mono>{outcome.sent}</Mono>
      </Notice>
    ) : (
      <div className="space-y-2">
        <Notice tone="warning">
          This device approved. A second passkey of the account must approve too: open this wallet
          on another of your devices, choose Requests, and paste this code.
        </Notice>
        <CodeBox code={outcome.request} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">{describe(op)}</p>
      {extra}
      {needed > 1 ? (
        <Notice>Two of your passkeys approve this: this device now, another one next.</Notice>
      ) : null}
      {funded && needed === 1 ? (
        update ? (
          <Effects
            net={net}
            tx={{ kind: 'KeystoreUpdate', fields: { update } }}
            from={wallet.account}
            onReady={setEffectsOk}
          />
        ) : (
          <Notice>Preparing the change.</Notice>
        )
      ) : needed === 1 ? (
        <Notice tone={SPONSOR_URL ? 'info' : 'warning'}>
          {SPONSOR_URL
            ? 'The account holds nothing yet, so this wallet’s sponsor pays the fee. It cannot change anything you do not approve.'
            : 'The account holds nothing yet and this wallet has no sponsor. Fund the account first.'}
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button
        pending={pending}
        disabled={
          pending ||
          (needed === 1 && (funded ? !effectsOk : !SPONSOR_URL)) ||
          (needed > 1 && !update)
        }
        onClick={() =>
          run(async () => {
            const o = await change(
              net.rpc,
              networkSender(net.rpc),
              wallet,
              signerOf(wallet),
              op,
              balance,
            );
            setOutcome(o);
            onDone?.(o);
            await refresh();
          })
        }
      >
        {label}
      </Button>
    </div>
  );
}
