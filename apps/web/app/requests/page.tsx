'use client';

import { Button } from '@tenzro/ui';
import { useEffect, useState } from 'react';
import { KeystoreClient, type KeystoreUpdate } from 'tenzro-sdk';

import { Effects } from '@/components/effects';
import { CodeBox, Field, Mono, Notice, Section, useAction } from '@/components/ui';
import { useWallet } from '@/components/wallet-context';
import { sameAccount, signerOf } from '@/lib/account';
import { toHex } from '@/lib/bytes';
import {
  type ChangeRequest,
  approvalsNeeded,
  approveRecovery,
  approveUpdate,
  coApprove,
  completesWith,
  decodeRequest,
  describe,
  encodeRequest,
  fingerprint,
  networkSender,
  relay,
  sendChange,
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
            className="w-full rounded-sm border border-border-default bg-surface-2 p-3 font-mono text-xs"
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

  // Whether this device's approval completes the request, so that it is sent from
  // this account right after. Only then is there an effect to check, and nodes can
  // only simulate the change once it carries that approval: approve, check, send.
  const [completes, setCompletes] = useState<boolean | null>(null);
  const [approved, setApproved] = useState<KeystoreUpdate | null>(null);
  const account = wallet?.account;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-derive when the request or account changes
  useEffect(() => {
    if (!net || !wallet || req.kind !== 'approve') return;
    let live = true;
    (async () => {
      const view = await new KeystoreClient(net.rpc).getKeystore(
        wallet.account,
        wallet.anchor ?? undefined,
      );
      const needed = approvalsNeeded(req.update.op, view, Date.now());
      return completesWith(req.update, toHex(signerOf(wallet).p256PublicKey()), needed);
    })()
      .then((c) => live && setCompletes(c))
      .catch(() => live && setCompletes(true));
    return () => {
      live = false;
    };
  }, [req, net, account]);

  if (!wallet || !net || balance === null) return <Notice>Sign in to act on requests.</Notice>;
  const ownAccount = sameAccount(req.update.account, wallet.account);
  const finalApproval = req.kind === 'approve' && ownAccount && balance > 0n && completes !== false;
  const fromOwn = req.kind === 'send' || finalApproval;
  const simulate = req.kind === 'send' ? req.update : approved;

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
      {finalApproval && !approved ? (
        <Notice>
          {completes === null
            ? 'Reading the account.'
            : 'Your approval completes this change. Approve with your passkey first; two nodes then work out what it does, and nothing is sent until you press Send.'}
        </Notice>
      ) : null}
      {fromOwn && simulate && !(req.kind === 'send' && ownAccount) ? (
        <Effects
          net={net}
          tx={{ kind: 'KeystoreUpdate', fields: { update: simulate } }}
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
      {result ? null : approved ? (
        <Button
          pending={pending}
          disabled={pending || !effectsOk}
          onClick={() =>
            run(async () => {
              const sent = await sendChange(
                net.rpc,
                networkSender(net.rpc),
                wallet,
                signerOf(wallet),
                approved,
                balance,
              );
              setResult({ sent });
              await refresh();
            })
          }
        >
          Send the approved change
        </Button>
      ) : (
        <Button
          pending={pending}
          disabled={
            pending ||
            (req.kind === 'approve' && !ownAccount) ||
            (req.kind === 'send' && (ownAccount || balance === 0n)) ||
            (req.kind === 'send' && !effectsOk) ||
            (req.kind === 'approve' && ownAccount && completes === null)
          }
          onClick={() =>
            run(async () => {
              const signer = signerOf(wallet);
              const sender = networkSender(net.rpc);
              if (finalApproval) {
                setApproved(await approveUpdate(net.rpc, req.update, signer));
                return;
              }
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
