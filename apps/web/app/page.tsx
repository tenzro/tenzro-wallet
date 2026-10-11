'use client';

import { Button, Input, formatAmount } from '@tenzro/ui';
import Link from 'next/link';
import { useState } from 'react';

import { CodeBox, Field, Mono, Notice, Section, useAction } from '@/components/ui';
import { useWallet } from '@/components/wallet-context';
import { createAccount, signIn } from '@/lib/account';
import { WALLET_NAME, rpId } from '@/lib/config';
import { deviceLabel } from '@/lib/device';
import { roots } from '@/lib/keystore';

export default function Home() {
  const { ready, wallet } = useWallet();
  if (!ready) return null;
  return wallet ? <Account /> : <Welcome />;
}

function Welcome() {
  const { net, netError, setWallet } = useWallet();
  const [name, setName] = useState('');
  const create = useAction();
  const enter = useAction();

  return (
    <>
      <Section
        title="Create your account"
        description="One passkey on this device is all it takes. There is no seed phrase and nothing to write down."
      >
        <Field label="Your name" hint="Shown on the passkey prompt. It stays on your device.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" />
        </Field>
        {create.error ? <Notice tone="danger">{create.error}</Notice> : null}
        <Button
          width="full"
          pending={create.pending}
          disabled={!net || !name.trim()}
          onClick={() =>
            create.run(async () => {
              if (!net) return;
              const w = await createAccount(net.rpc, net.second, {
                rpId: rpId(),
                rpName: WALLET_NAME,
                name: name.trim(),
                deviceLabel: deviceLabel(),
              });
              setWallet(w);
            })
          }
        >
          Create with a passkey
        </Button>
      </Section>
      <Section title="Already have an account?">
        {enter.error ? <Notice tone="danger">{enter.error}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            pending={enter.pending}
            disabled={!net}
            onClick={() =>
              enter.run(async () => {
                if (!net) return;
                setWallet(await signIn(net.rpc, rpId()));
              })
            }
          >
            Sign in with a passkey
          </Button>
          <Button asChild variant="ghost">
            <Link href="/devices#join">Add this device to my account</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/recover">I lost my devices</Link>
          </Button>
        </div>
      </Section>
      {netError ? <Notice tone="danger">{netError}</Notice> : null}
    </>
  );
}

function Account() {
  const { wallet, view, balance, setWallet } = useWallet();
  if (!wallet) return null;
  const r = view ? roots(view) : null;
  const devices = view?.keystore?.credentials.length ?? 1;
  const guardians = view?.keystore?.recovery_signers.length ?? 0;
  return (
    <>
      <Section title="Balance">
        <p className="text-display-sm font-medium tabular">
          {balance === null ? '...' : `${formatAmount(balance)} TNZO`}
        </p>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/send">Send</Link>
          </Button>
        </div>
      </Section>
      <Section
        title="Receive"
        description="Payments to this account reach every device linked to it."
      >
        <CodeBox code={wallet.account} />
      </Section>
      <Section title="Protection">
        <ul className="space-y-2 text-sm">
          <li className="flex justify-between">
            <span>Devices</span>
            <span>{devices}</span>
          </li>
          <li className="flex justify-between">
            <span>Independent passkeys</span>
            <span>{r ? r.independent : '...'}</span>
          </li>
          <li className="flex justify-between">
            <span>Guardians and recovery keys</span>
            <span>{guardians}</span>
          </li>
          <li className="flex justify-between">
            <span>Recovery code</span>
            <span>{view?.keystore?.recovery_code ? 'On' : 'Off'}</span>
          </li>
        </ul>
        <p className="text-xs text-foreground-muted">
          Identity <Mono>{wallet.did}</Mono>
        </p>
      </Section>
      <Button variant="ghost" size="sm" onClick={() => setWallet(null)}>
        Sign out on this device
      </Button>
    </>
  );
}
