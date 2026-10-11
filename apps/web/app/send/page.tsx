'use client';

import { Button, Input, formatAmount } from '@tenzro/ui';
import { useMemo, useState } from 'react';
import type { TypedTransaction } from 'tenzro-sdk';

import { Effects } from '@/components/effects';
import { Field, Mono, Notice, Section, useAction } from '@/components/ui';
import { useWallet } from '@/components/wallet-context';
import { signerOf } from '@/lib/account';
import { parseTnzo } from '@/lib/bytes';
import { roots } from '@/lib/keystore';
import { sendFromAccount, transfer } from '@/lib/send';

export default function Send() {
  const { wallet, net, view, balance, refresh } = useWallet();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState<TypedTransaction | null>(null);
  const [effectsOk, setEffectsOk] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const { pending, error, setError, run } = useAction();

  const draft = useMemo(() => {
    try {
      return { tx: transfer(to.trim(), parseTnzo(amount)), problem: null };
    } catch (e) {
      return { tx: null, problem: to && amount ? (e as Error).message : null };
    }
  }, [to, amount]);

  if (!wallet || !net) return <Notice>Sign in first.</Notice>;
  const r = view ? roots(view) : null;

  if (sent) {
    return (
      <Section title="Sent">
        <Notice tone="success">
          The transfer is on its way. <Mono>{sent}</Mono>
        </Notice>
        <Button
          variant="secondary"
          onClick={() => {
            setSent(null);
            setReview(null);
            setTo('');
            setAmount('');
          }}
        >
          Send another
        </Button>
      </Section>
    );
  }

  return (
    <Section
      title="Send TNZO"
      description={balance === null ? undefined : `Available: ${formatAmount(balance)} TNZO`}
    >
      {r && !r.maySpend ? (
        <Notice tone="warning">
          Spending needs two independent passkeys on this account. Link a second device first.
        </Notice>
      ) : null}
      <Field label="To">
        <Input
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setReview(null);
          }}
          placeholder="0x..."
          spellCheck={false}
        />
      </Field>
      <Field label="Amount" hint="TNZO">
        <Input
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setReview(null);
          }}
          inputMode="decimal"
          placeholder="0.0"
        />
      </Field>
      {draft.problem ? <Notice tone="warning">{draft.problem}</Notice> : null}
      {review ? (
        <>
          <Effects net={net} tx={review} from={wallet.account} onReady={setEffectsOk} />
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <div className="flex gap-2">
            <Button
              pending={pending}
              disabled={!effectsOk || pending}
              onClick={() =>
                run(async () => {
                  setSent(await sendFromAccount(net.rpc, signerOf(wallet), wallet.account, review));
                  await refresh();
                })
              }
            >
              Approve with passkey
            </Button>
            <Button variant="ghost" onClick={() => setReview(null)}>
              Change
            </Button>
          </div>
        </>
      ) : (
        <Button
          disabled={!draft.tx || (r !== null && !r.maySpend)}
          onClick={() => {
            setError(null);
            setReview(draft.tx);
          }}
        >
          Review
        </Button>
      )}
    </Section>
  );
}
