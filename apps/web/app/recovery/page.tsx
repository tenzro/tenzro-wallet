'use client';

import { Badge, Button, Input } from '@tenzro/ui';
import { useEffect, useMemo, useState } from 'react';
import type { KeystoreOp, RecoverySigner } from 'tenzro-sdk';

import { ChangePanel } from '@/components/change-panel';
import { CodeBox, Field, Notice, Section, download, useAction } from '@/components/ui';
import { useWallet } from '@/components/wallet-context';
import { WALLET_NAME, rpId } from '@/lib/config';
import { decodeSigner, encodeSigner, setRecoveryOp } from '@/lib/keystore';
import { createPasskey } from '@/lib/passkey';
import { TURN_OFF_RECOVERY_CODE, codeKit, newRecoveryCode } from '@/lib/recovery-code';
import { type Waits, duration, readWaits } from '@/lib/waits';

export default function Recovery() {
  const { net } = useWallet();
  const [waits, setWaits] = useState<Waits | null>(null);
  useEffect(() => {
    if (net)
      readWaits(net.rpc)
        .then(setWaits)
        .catch(() => setWaits(null));
  }, [net]);
  return (
    <>
      <Signers waits={waits} />
      <RecoveryCode waits={waits} />
      <GuardianCard />
    </>
  );
}

const ROLE: Record<RecoverySigner['role'], string> = {
  device: 'Guardian',
  recovery_key: 'Hardware key',
  email_verifier: 'Email verifier',
};

function Signers({ waits }: { waits: Waits | null }) {
  const { view } = useWallet();
  const onChain = view?.keystore?.recovery_signers ?? [];
  const [draft, setDraft] = useState<RecoverySigner[] | null>(null);
  const [threshold, setThreshold] = useState(1);
  const [card, setCard] = useState('');
  const [saving, setSaving] = useState(false);
  const add = useAction();
  const list = draft ?? onChain;

  const op = useMemo((): { op: KeystoreOp | null; problem: string | null } => {
    if (!draft) return { op: null, problem: null };
    try {
      return { op: setRecoveryOp(draft, draft.length ? threshold : 0), problem: null };
    } catch (e) {
      return { op: null, problem: (e as Error).message };
    }
  }, [draft, threshold]);

  const edit = (next: RecoverySigner[]) => {
    setDraft(next);
    setThreshold((t) => Math.min(Math.max(1, t), Math.max(1, next.length)));
    setSaving(false);
  };

  return (
    <Section
      title="Guardians and hardware keys"
      description={
        <>
          People you trust, and hardware keys you keep, can together add a new passkey if you lose
          every device. A recovery waits before it completes: {duration(waits?.recoveryKey ?? null)}{' '}
          with a hardware key alone, {duration(waits?.recoveryOther ?? null)} otherwise. Any of your
          passkeys can cancel it meanwhile.
        </>
      }
    >
      <ul className="divide-y divide-border-subtle">
        {list.map((s, i) => (
          <li key={s.public_key} className="flex items-center justify-between py-2.5">
            <div className="space-y-1">
              <p className="text-sm font-medium">{s.label || ROLE[s.role]}</p>
              <Badge>{ROLE[s.role]}</Badge>
            </div>
            <Button size="sm" variant="ghost" onClick={() => edit(list.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </li>
        ))}
        {list.length === 0 ? (
          <li className="py-2.5 text-sm text-foreground-muted">
            None yet. Recovery by others is off.
          </li>
        ) : null}
      </ul>
      <Field
        label="Add a guardian"
        hint="Ask them to open Recovery in their wallet and share their guardian card."
      >
        <div className="flex gap-2">
          <Input value={card} onChange={(e) => setCard(e.target.value)} placeholder="tzg1..." />
          <Button
            variant="secondary"
            disabled={!card.trim()}
            onClick={() => {
              add.setError(null);
              try {
                const s = decodeSigner(card);
                edit([
                  ...list,
                  { ...s, role: s.role === 'email_verifier' ? 'email_verifier' : 'device' },
                ]);
                setCard('');
              } catch (e) {
                add.setError((e as Error).message);
              }
            }}
          >
            Add
          </Button>
        </div>
      </Field>
      <Button
        variant="secondary"
        pending={add.pending}
        onClick={() =>
          add.run(async () => {
            const key = await createPasskey({
              rpId: rpId(),
              rpName: WALLET_NAME,
              userName: `${WALLET_NAME} recovery key`,
              label: 'Hardware recovery key',
              securityKey: true,
            });
            edit([
              ...list,
              {
                rp_id: key.rpId,
                public_key: key.publicKey,
                aaguid: key.aaguid,
                backup_eligible: key.backupEligible,
                backup_state: key.backupState,
                role: 'recovery_key',
                label: key.label,
              },
            ]);
          })
        }
      >
        Add a hardware key
      </Button>
      {add.error ? <Notice tone="danger">{add.error}</Notice> : null}
      {draft ? (
        <>
          {draft.length > 0 ? (
            <Field label="Approvals needed to recover">
              <Input
                type="number"
                min={1}
                max={draft.length}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </Field>
          ) : null}
          {op.problem ? <Notice tone="warning">{op.problem}</Notice> : null}
          {op.op && saving ? (
            <ChangePanel op={op.op} label="Approve with passkey" onDone={() => setDraft(null)} />
          ) : (
            <Button disabled={!op.op} onClick={() => setSaving(true)}>
              Save recovery settings
            </Button>
          )}
        </>
      ) : null}
    </Section>
  );
}

function RecoveryCode({ waits }: { waits: Waits | null }) {
  const { wallet, view } = useWallet();
  const on = Boolean(view?.keystore?.recovery_code);
  const [setup, setSetup] = useState<{ code: string; op: KeystoreOp } | null>(null);
  const [saved, setSaved] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  if (!wallet) return null;

  const kit = setup
    ? codeKit({
        walletName: WALLET_NAME,
        origin: window.location.origin,
        account: wallet.account,
        code: setup.code,
        created: new Date(),
      })
    : '';

  return (
    <Section
      title="One-time recovery code"
      description={
        <>
          Optional, and off unless you turn it on. It is not a key and signs nothing: it can only
          start a recovery, which waits {duration(waits?.codeWait ?? null)} and which any of your
          passkeys can cancel. The network keeps only a commitment to it.
        </>
      }
    >
      <p className="text-sm">Status: {on ? 'On' : 'Off'}</p>
      {setup ? (
        <>
          <Notice tone="warning">
            Save the code kit now. It is shown once and is not stored anywhere else.
          </Notice>
          <CodeBox code={setup.code} />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                download('recovery-code.txt', kit);
                setSaved(true);
              }}
            >
              Download code kit
            </Button>
          </div>
          {saved ? (
            <ChangePanel op={setup.op} label={on ? 'Replace the code' : 'Turn on the code'} />
          ) : null}
        </>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={async () => setSetup(await newRecoveryCode(wallet.account))}
          >
            {on ? 'Replace the code' : 'Turn on'}
          </Button>
          {on ? (
            <Button variant="ghost" onClick={() => setTurningOff(true)}>
              Turn off
            </Button>
          ) : null}
        </div>
      )}
      {turningOff ? <ChangePanel op={TURN_OFF_RECOVERY_CODE} label="Turn off the code" /> : null}
    </Section>
  );
}

/** This device's passkey as a guardian of someone else's account. */
function GuardianCard() {
  const { wallet } = useWallet();
  const [name, setName] = useState('');
  const [card, setCard] = useState<string | null>(null);
  if (!wallet) return null;
  const p = wallet.passkey;
  return (
    <Section
      title="Be someone’s guardian"
      description="Share your guardian card with them. When they need to recover, they send you a request code; approve it under Requests."
    >
      <Field label="Your name, as they will see it">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {card ? (
        <CodeBox code={card} />
      ) : (
        <Button
          variant="secondary"
          disabled={!name.trim()}
          onClick={() =>
            setCard(
              encodeSigner({
                rp_id: p.rpId,
                public_key: p.publicKey,
                aaguid: p.aaguid,
                backup_eligible: p.backupEligible,
                backup_state: p.backupState,
                role: 'device',
                label: name.trim(),
              }),
            )
          }
        >
          Show my guardian card
        </Button>
      )}
    </Section>
  );
}
