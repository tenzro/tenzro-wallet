import { Button, Input, Logo } from '@tenzro/ui';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { CodeBox, Field, Notice, useAction } from '../../apps/web/components/ui';
import { createAccount } from '../../apps/web/lib/account';
import { CHAIN_ID, WALLET_NAME, rpId } from '../../apps/web/lib/config';
import { network } from '../../apps/web/lib/network';
import { WALLET_ORIGIN, checkChain, loadStored, rpcCall, saveStored } from './shared';
import type { StoredWallet } from './shared';

type View = 'home' | 'receive' | 'send';

function formatTnzo(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''} TNZO`;
}

function Header({ onBack }: { onBack?: () => void }) {
  return (
    <header className="flex items-center justify-between px-4 py-3">
      <span className="flex items-center gap-2">
        <Logo size={20} />
        <span className="text-sm font-medium tracking-tight">{WALLET_NAME}</span>
      </span>
      {onBack ? (
        <Button size="sm" variant="ghost" onClick={onBack}>
          Back
        </Button>
      ) : null}
    </header>
  );
}

function openWallet(path = '') {
  void chrome.tabs.create({ url: `${WALLET_ORIGIN}${path}` });
}

function Popup() {
  const [stored, setStored] = useState<StoredWallet | null | undefined>(undefined);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [view, setView] = useState<View>('home');
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      await checkChain();
      setChainError(null);
    } catch (e) {
      setChainError(e instanceof Error ? e.message : String(e));
    }
    const s = await loadStored();
    setStored(s);
    if (s) {
      try {
        setBalance(BigInt(await rpcCall<string>('eth_getBalance', [s.account, 'latest'])));
      } catch {
        setBalance(null);
      }
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (stored === undefined) {
    return (
      <>
        <Header />
        <output className="block px-4 text-sm text-foreground-muted">Loading...</output>
      </>
    );
  }

  return (
    <>
      <Header onBack={view === 'home' ? undefined : () => setView('home')} />
      <main className="space-y-4 px-4 pb-4">
        {chainError ? (
          <Notice tone="danger">
            {chainError} Nothing can be sent until a node answers for chain {CHAIN_ID}.
          </Notice>
        ) : null}
        {!stored ? (
          <SignedOut onCreated={refresh} disabled={!!chainError || checking} />
        ) : view === 'receive' ? (
          <Receive account={stored.account} />
        ) : view === 'send' ? (
          <Send />
        ) : (
          <Account stored={stored} balance={balance} onView={setView} />
        )}
      </main>
    </>
  );
}

function SignedOut({ onCreated, disabled }: { onCreated: () => void; disabled: boolean }) {
  const [name, setName] = useState('');
  const create = useAction();
  return (
    <>
      <section className="space-y-2">
        <h1 className="text-lg font-medium tracking-tight">Your account</h1>
        <p className="text-sm text-foreground-muted">
          Open your wallet to create an account or sign in. A passkey approves every payment on your
          wallet provider's page.
        </p>
        <Button width="full" onClick={() => openWallet()}>
          Open wallet
        </Button>
      </section>
      <section className="space-y-3 border-t border-border-default pt-4">
        <h2 className="text-sm font-medium">Create an account here</h2>
        <Field label="Your name" hint="Shown on the passkey prompt.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" />
        </Field>
        {create.error ? <Notice tone="danger">{create.error}</Notice> : null}
        <Button
          width="full"
          variant="secondary"
          pending={create.pending}
          disabled={disabled || !name.trim()}
          onClick={() =>
            create.run(async () => {
              const net = await network();
              const w = await createAccount(net.rpc, net.second, {
                rpId: rpId(),
                rpName: WALLET_NAME,
                name: name.trim(),
                deviceLabel: 'Browser extension',
              });
              await saveStored({ account: w.account, did: w.did });
              onCreated();
            })
          }
        >
          Create with a passkey
        </Button>
      </section>
    </>
  );
}

function Account({
  stored,
  balance,
  onView,
}: {
  stored: StoredWallet;
  balance: bigint | null;
  onView: (v: View) => void;
}) {
  return (
    <>
      <section className="space-y-1">
        <p className="text-xs text-foreground-muted">Balance</p>
        <p className="text-3xl font-medium tracking-tight tabular-nums">
          {balance === null ? '...' : formatTnzo(balance)}
        </p>
      </section>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => onView('send')}>Send</Button>
        <Button variant="secondary" onClick={() => onView('receive')}>
          Receive
        </Button>
      </div>
      <p className="break-all font-mono text-xs text-foreground-muted">{stored.account}</p>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          await saveStored(null);
          location.reload();
        }}
      >
        Sign out of the extension
      </Button>
    </>
  );
}

function Receive({ account }: { account: string }) {
  return (
    <section className="space-y-3">
      <h1 className="text-lg font-medium tracking-tight">Receive</h1>
      <p className="text-sm text-foreground-muted">
        Payments to this account reach every device linked to it.
      </p>
      <CodeBox code={account} />
    </section>
  );
}

function Send() {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const ok = /^0x[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$/.test(to.trim()) && Number(amount) > 0;
  return (
    <section className="space-y-3">
      <h1 className="text-lg font-medium tracking-tight">Send TNZO</h1>
      <Field label="To">
        <Input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="0x..."
          spellCheck={false}
        />
      </Field>
      <Field label="Amount" hint="TNZO">
        <Input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="0.0"
        />
      </Field>
      <Notice>
        Your wallet shows what the network says this does, and your passkey approves it there.
      </Notice>
      <Button
        width="full"
        disabled={!ok}
        onClick={() =>
          openWallet(
            `/send#to=${encodeURIComponent(to.trim())}&amount=${encodeURIComponent(amount.trim())}`,
          )
        }
      >
        Review in wallet
      </Button>
    </section>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
