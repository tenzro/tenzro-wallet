'use client';

import { Button } from '@tenzro/ui';
import { useEffect, useState } from 'react';

import { Effects } from '@/components/effects';
import { CodeBox, Field, Mono, Notice, Section, useAction } from '@/components/ui';
import { useWallet } from '@/components/wallet-context';
import { sameAccount, signerOf } from '@/lib/account';
import {
  type ChangeRequest,
  approveRecovery,
  coApprove,
  decodeRequest,
  describe,
  encodeRequest,
  fingerprint,
  networkSender,
  relay,
} from '@/lib/keystore';

/**
 * Every change that needs another passkey, a guardian, or another account to
 * send it arrives here as a request code.
 */
export default function Requests() {
  const [text, setText] = useState('');
  const [req, setReq] = useState<ChangeRequest | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <>
      <Section
        title="Requests"
        description="Paste a request code from one of your devices, or from someone who asked you to help them recover."
      >
        <Field label="Request code">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setReq(null);
              setProblem(null);
            }}
            rows={4}
            className="w-full rounded-xl border border-border-default bg-surface-2 p-3 font-mono text-xs"
            placeholder="tzk1..."
          />
        </Field>
        {problem ? <Notice tone="danger">{problem}</Notice> : null}
        <Button
          variant="secondary"
          disabled={!text.trim()}
          onClick={() => {
            try {
              setReq(decodeRequest(text));
            } catch (e) {
              setProblem((e as Error).message);
            }
          }}
        >
          Read request
        </Button>
      </Section>
      {req ? <Review req={req} key={JSON.stringify(req)} /> : null}
    </>
  );
}

function Review({ req }: { req: ChangeRequest }) {
  const { wallet, net, balance, refresh } = useWallet();
  const [print, setPrint] = useState('');
  const [effectsOk, setEffectsOk] = useState(false);
  const [result, setResult] = useState<{ sent?: string; code?: string; note?: string } | null>(
    null,
  );
  const { pending, error, run } = useAction();

  useEffect(() => {
    fingerprint(req.update).then(setPrint);
  }, [req]);

  if (!wallet || !net || balance === null) return <Notice>Sign in to act on requests.</Notice>;
  const ownAccount = sameAccount(req.update.account, wallet.account);
  const fromOwn = req.kind === 'send' || (req.kind === 'approve' && ownAccount && balance > 0n);

  return (
    <Section title="What it asks">
      <p className="text-sm">{describe(req.update.op)}</p>
      <ul className="space-y-1 text-xs text-foreground-muted">
        <li>
          Account <Mono>{req.update.account}</Mono>
        </li>
        <li>
          Approvals so far: {req.update.approvals.length}
          {req.update.possession ? ', with the new passkey’s proof' : ''}
        </li>
        <li>
          Fingerprint <Mono>{print}</Mono> (the other screen shows the same)
        </li>
      </ul>
      {req.kind === 'approve' && !ownAccount ? (
        <Notice tone="danger">This request is for another account. Nothing to do here.</Notice>
      ) : null}
      {req.kind === 'send' && ownAccount ? (
        <Notice tone="warning">
          This is your own account’s change; another account has to send it.
        </Notice>
      ) : null}
      {fromOwn &&
      !(req.kind === 'send' && ownAccount) &&
      !(req.kind === 'approve' && !ownAccount) ? (
        <Effects
          net={net}
          tx={{ kind: 'KeystoreUpdate', fields: { update: req.update } }}
          from={wallet.account}
          onReady={setEffectsOk}
        />
      ) : null}
      {req.kind === 'send' && !ownAccount ? (
        <Notice>
          Your account pays the fee to send it. You authorize nothing on their account by doing so.
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {result?.sent ? (
        <Notice tone="success">
          Sent. <Mono>{result.sent}</Mono>
        </Notice>
      ) : null}
      {result?.code ? (
        <>
          <Notice tone="warning">{result.note}</Notice>
          <CodeBox code={result.code} />
        </>
      ) : null}
      {result ? null : (
        <Button
          pending={pending}
          disabled={
            pending ||
            (req.kind === 'approve' && !ownAccount) ||
            (req.kind === 'send' && (ownAccount || balance === 0n)) ||
            (fromOwn && !effectsOk)
          }
          onClick={() =>
            run(async () => {
              const signer = signerOf(wallet);
              const sender = networkSender(net.rpc);
              if (req.kind === 'approve') {
                const o = await coApprove(net.rpc, sender, wallet, signer, req, balance);
                setResult(
                  'sent' in o
                    ? { sent: o.sent }
                    : {
                        code: o.request,
                        note: 'Approved. One more passkey must approve: take this code to it.',
                      },
                );
              } else if (req.kind === 'recovery') {
                const next = await approveRecovery(net.rpc, req, signer);
                setResult({
                  code: encodeRequest(next),
                  note:
                    next.kind === 'send'
                      ? 'Approved, and enough have. Give this code back to the person; any account can send it.'
                      : 'Approved. More guardians must approve: pass this code on.',
                });
              } else {
                setResult({ sent: await relay(sender, req, signer, wallet.account) });
              }
              await refresh();
            })
          }
        >
          {req.kind === 'send' ? 'Send it from my account' : 'Approve with passkey'}
        </Button>
      )}
    </Section>
  );
}
