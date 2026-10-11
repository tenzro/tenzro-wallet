'use client';

import { Button, Input } from '@tenzro/ui';
import { useCallback, useEffect, useState } from 'react';
import { KeystoreClient, type KeystoreView } from 'tenzro-sdk';

import { CodeBox, Field, Mono, Notice, Section, useAction } from '@/components/ui';
import { useWallet } from '@/components/wallet-context';
import { isAccount } from '@/lib/bytes';
import { SPONSOR_URL, WALLET_NAME, rpId } from '@/lib/config';
import { deviceLabel } from '@/lib/device';
import {
  type ChangeRequest,
  approveRecovery,
  decodeRequest,
  encodeRequest,
  networkSender,
  openChange,
  recoveryRequest,
} from '@/lib/keystore';
import { type Passkey, PasskeySigner, createPasskey, keystoreCredential } from '@/lib/passkey';
import { claimOp, matchesCommitment, readKit, revealOp } from '@/lib/recovery-code';
import { type Waits, duration, readWaits, remaining } from '@/lib/waits';

/** What this device remembers while a recovery runs, which can take days. Public data only. */
interface Recovering {
  readonly account: string;
  readonly passkey: Passkey;
  readonly claimedAtMs?: number;
}

const KEY = 'recovering';

function loadRecovering(): Recovering | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Recovering) : null;
  } catch {
    return null;
  }
}

function saveRecovering(r: Recovering | null): void {
  try {
    if (r) localStorage.setItem(KEY, JSON.stringify(r));
    else localStorage.removeItem(KEY);
  } catch {
    // The person can start again; nothing on chain depends on this.
  }
}

export default function Recover() {
  const { net, setWallet } = useWallet();
  const [rec, setRec] = useState<Recovering | null>(null);
  const [view, setView] = useState<KeystoreView | null>(null);
  const [waits, setWaits] = useState<Waits | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [accountText, setAccountText] = useState('');
  const start = useAction();

  useEffect(() => setRec(loadRecovering()), []);
  useEffect(() => {
    if (net)
      readWaits(net.rpc)
        .then(setWaits)
        .catch(() => setWaits(null));
  }, [net]);

  const reload = useCallback(async () => {
    setNow(Date.now());
    if (!net || !rec) return;
    setView(await new KeystoreClient(net.rpc).getKeystore(rec.account));
  }, [net, rec]);
  useEffect(() => {
    reload().catch(() => undefined);
    const t = setInterval(() => reload().catch(() => undefined), 15_000);
    return () => clearInterval(t);
  }, [reload]);

  const update = (r: Recovering | null) => {
    saveRecovering(r);
    setRec(r);
  };

  if (!rec) {
    return (
      <Section
        title="Recover your account"
        description="This device makes a new passkey. Your guardians, your hardware key or your recovery code then add it to your account."
      >
        <Field label="Your account" hint="From a payment you received, or the code kit you saved.">
          <Input
            value={accountText}
            onChange={(e) => setAccountText(e.target.value)}
            placeholder="0x..."
          />
        </Field>
        {start.error ? <Notice tone="danger">{start.error}</Notice> : null}
        <Button
          pending={start.pending}
          disabled={!net || !isAccount(accountText)}
          onClick={() =>
            start.run(async () => {
              if (!net) return;
              const account = accountText.trim();
              const v = await new KeystoreClient(net.rpc).getKeystore(account);
              if (!v.on_chain || !v.keystore) {
                throw new Error('That account has no recovery set up on the network.');
              }
              const created = await createPasskey({
                rpId: rpId(),
                rpName: WALLET_NAME,
                userName: WALLET_NAME,
                label: deviceLabel(),
              });
              const { registrationAuthenticatorData: _, ...passkey } = created;
              update({ account, passkey });
            })
          }
        >
          Create a passkey on this device
        </Button>
      </Section>
    );
  }

  const record = view?.keystore ?? null;
  const linked = record?.credentials.some(
    (c) => c.credential_id.replace(/^0x/, '') === rec.passkey.credentialId,
  );
  const pending = record?.pending_recovery ?? null;
  const pendingIsMine =
    pending?.credential.credential_id.replace(/^0x/, '') === rec.passkey.credentialId;

  return (
    <>
      <Section title="Recovering">
        <p className="text-xs text-foreground-muted">
          Account <Mono>{rec.account}</Mono>
        </p>
        {linked ? (
          <>
            <Notice tone="success">
              This device’s passkey is on the account. Recovery is complete.
            </Notice>
            <Button
              onClick={() => {
                if (!record) return;
                setWallet({
                  account: rec.account,
                  did: record.owner_did,
                  passkey: rec.passkey,
                  anchor: null,
                });
                update(null);
                window.location.href = '/';
              }}
            >
              Open my wallet
            </Button>
          </>
        ) : pending && pendingIsMine ? (
          <Finish rec={rec} readyAtMs={pending.ready_at_ms} now={now} onSent={reload} />
        ) : pending ? (
          <Notice tone="warning">
            Another recovery is in progress on this account. It completes{' '}
            {remaining(pending.ready_at_ms, now)} unless a passkey of the account cancels it.
          </Notice>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => update(null)}>
          Start over
        </Button>
      </Section>
      {!linked && !pending && record ? (
        <>
          {record.recovery_signers.length > 0 ? (
            <WithSigners rec={rec} view={view as KeystoreView} waits={waits} />
          ) : null}
          {record.recovery_code ? (
            <WithCode
              rec={rec}
              commitment={record.recovery_code.commitment}
              waits={waits}
              now={now}
              onClaimed={(at) => update({ ...rec, claimedAtMs: at })}
            />
          ) : null}
          {record.recovery_signers.length === 0 && !record.recovery_code ? (
            <Notice tone="danger">
              This account has no guardians, hardware key or recovery code. It cannot be recovered
              without one of its passkeys.
            </Notice>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/** Sends a complete change with the sponsor, or hands it on for anyone to send. */
function Deliver({ req, onSent }: { req: ChangeRequest; onSent(): void }) {
  const { net } = useWallet();
  const { pending, error, run } = useAction();
  const [sent, setSent] = useState<string | null>(null);
  if (sent) {
    return (
      <Notice tone="success">
        Sent. <Mono>{sent}</Mono>
      </Notice>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm">
        Your account cannot pay for this itself. Ask a guardian or anyone with a wallet to paste
        this code under Requests and send it.
      </p>
      <CodeBox code={encodeRequest(req)} />
      {SPONSOR_URL && net ? (
        <Button
          variant="secondary"
          pending={pending}
          onClick={() =>
            run(async () => {
              setSent(await networkSender(net.rpc).sponsored(req.update));
              onSent();
            })
          }
        >
          Have this wallet’s sponsor send it
        </Button>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}

function WithSigners({
  rec,
  view,
  waits,
}: { rec: Recovering; view: KeystoreView; waits: Waits | null }) {
  const { net } = useWallet();
  const [req, setReq] = useState<ChangeRequest | null>(null);
  const { pending, error, run } = useAction();
  const record = view.keystore;
  if (!net || !record) return null;
  const keys = record.recovery_signers.filter((s) => s.role === 'recovery_key' && s.rp_id);

  return (
    <Section
      title="With guardians or a hardware key"
      description={`${record.recovery_threshold} of ${record.recovery_signers.length} must approve. The recovery then waits ${duration(waits?.recoveryKey ?? null)} with a hardware key alone, ${duration(waits?.recoveryOther ?? null)} otherwise.`}
    >
      {req ? null : (
        <Button
          pending={pending}
          onClick={() =>
            run(async () => {
              setReq(
                await recoveryRequest(
                  net.rpc,
                  rec.account,
                  keystoreCredential(rec.passkey),
                  new PasskeySigner(rec.passkey),
                ),
              );
            })
          }
        >
          Prepare the recovery
        </Button>
      )}
      {req && req.kind === 'recovery' ? (
        <>
          <p className="text-sm">
            Approvals: {req.update.approvals.length} of {record.recovery_threshold}. Send this code
            to your guardians; each approves it under Requests and sends it back.
          </p>
          <CodeBox code={encodeRequest(req)} />
          {keys.map((k) => (
            <Button
              key={k.public_key}
              variant="secondary"
              pending={pending}
              onClick={() =>
                run(async () => {
                  const signer = new PasskeySigner({
                    rpId: k.rp_id,
                    credentialId: '',
                    publicKey: k.public_key.replace(/^0x/, ''),
                    aaguid: k.aaguid,
                    backupEligible: k.backup_eligible,
                    backupState: k.backup_state,
                    label: k.label,
                  });
                  setReq(await approveRecovery(net.rpc, req, signer));
                })
              }
            >
              Approve with {k.label || 'my hardware key'}
            </Button>
          ))}
          <PasteBack onRequest={setReq} />
        </>
      ) : null}
      {req && req.kind === 'send' ? <Deliver req={req} onSent={() => undefined} /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Section>
  );
}

function PasteBack({ onRequest }: { onRequest(req: ChangeRequest): void }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Field label="A code a guardian sent back">
      <div className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="tzk1..." />
        <Button
          variant="secondary"
          disabled={!text.trim()}
          onClick={() => {
            try {
              onRequest(decodeRequest(text));
              setText('');
              setProblem(null);
            } catch (e) {
              setProblem((e as Error).message);
            }
          }}
        >
          Use
        </Button>
      </div>
      {problem ? <span className="text-xs text-danger">{problem}</span> : null}
    </Field>
  );
}

function WithCode({
  rec,
  commitment,
  waits,
  now,
  onClaimed,
}: {
  rec: Recovering;
  commitment: string;
  waits: Waits | null;
  now: number;
  onClaimed(atMs: number): void;
}) {
  const { net } = useWallet();
  const [text, setText] = useState('');
  const [req, setReq] = useState<ChangeRequest | null>(null);
  const { pending, error, run } = useAction();
  if (!net) return null;
  const revealAt =
    rec.claimedAtMs !== undefined ? rec.claimedAtMs + (waits?.codeRevealDelay ?? 0) : null;

  const code = async () => {
    const { code: c } = readKit(text);
    if (!(await matchesCommitment(rec.account, c, commitment))) {
      throw new Error('This is not the code this account set.');
    }
    return c;
  };

  return (
    <Section
      title="With your recovery code"
      description={`Two steps, so nobody who sees the code can use it first: a claim, then the code itself once the claim has waited ${duration(waits?.codeRevealDelay ?? null)}. The recovery then waits ${duration(waits?.codeWait ?? null)}, and any of your passkeys can cancel it.`}
    >
      <Field label="Recovery code or code kit">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-border-default bg-surface-2 p-3 font-mono text-xs"
        />
      </Field>
      {req ? (
        <Deliver
          req={req}
          onSent={() => {
            if (rec.claimedAtMs === undefined) onClaimed(Date.now());
          }}
        />
      ) : rec.claimedAtMs === undefined ? (
        <Button
          pending={pending}
          disabled={!text.trim()}
          onClick={() =>
            run(async () => {
              const op = await claimOp(rec.account, await code(), keystoreCredential(rec.passkey));
              setReq(await openChange(net.rpc, rec.account, op));
            })
          }
        >
          Step 1: claim
        </Button>
      ) : (
        <>
          <p className="text-sm">
            Claimed. The code can be revealed{' '}
            {revealAt === null ? 'after the wait' : remaining(revealAt, now)}.
          </p>
          <Button
            pending={pending}
            disabled={!text.trim() || (revealAt !== null && revealAt > now)}
            onClick={() =>
              run(async () => {
                const op = revealOp(await code(), keystoreCredential(rec.passkey));
                setReq(await openChange(net.rpc, rec.account, op, new PasskeySigner(rec.passkey)));
              })
            }
          >
            Step 2: reveal the code
          </Button>
        </>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Section>
  );
}

function Finish({
  rec,
  readyAtMs,
  now,
  onSent,
}: {
  rec: Recovering;
  readyAtMs: number;
  now: number;
  onSent(): void;
}) {
  const { net } = useWallet();
  const [req, setReq] = useState<ChangeRequest | null>(null);
  const { pending, error, run } = useAction();
  if (readyAtMs > now) {
    return (
      <Notice tone="warning">
        The recovery is waiting. It can complete {remaining(readyAtMs, now)}. Any passkey still on
        the account can cancel it until then.
      </Notice>
    );
  }
  if (req) return <Deliver req={req} onSent={onSent} />;
  return (
    <>
      <Button
        pending={pending}
        onClick={() =>
          run(async () => {
            if (!net) return;
            setReq(await openChange(net.rpc, rec.account, 'finish_recovery'));
          })
        }
      >
        Complete the recovery
      </Button>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </>
  );
}
