import { Button, Input, Logo } from '@tenzro/ui';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { CodeBox, Field, Notice } from '../../apps/web/components/ui';
import { parseTnzo } from '../../apps/web/lib/bytes';
import { CHAIN_ID, WALLET_NAME } from '../../apps/web/lib/config';
import { transfer } from '../../apps/web/lib/send';
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

/** Hands a request to the wallet page through the bridge tab; the passkey signs there. */
async function openBridge(request: { method: string; params?: unknown }) {
  await chrome.storage.session.set({ bridgeRequest: request });
  await chrome.tabs.create({ url: chrome.runtime.getURL('bridge.html') });
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
          <SignedOut disabled={!!chainError || checking} />
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

function SignedOut({ disabled }: { disabled: boolean }) {
  return (
    <section className="space-y-3">
      <h1 className="text-lg font-medium tracking-tight">Your account</h1>
      <p className="text-sm text-foreground-muted">
        Connect the account you made in your wallet. Your passkey signs on your wallet provider's
        page, never in the extension.
      </p>
      <Button
        width="full"
        disabled={disabled}
        onClick={() => openBridge({ method: 'tenzro_connect' })}
      >
        Connect wallet
      </Button>
      <Button width="full" variant="secondary" onClick={() => openWallet()}>
        Open wallet to create an account
      </Button>
    </section>
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
      <LastPayment />
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
  const ok = (() => {
    try {
      transfer(to.trim(), parseTnzo(amount));
      return true;
    } catch {
      return false;
    }
  })();
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
        Your wallet shows what the network says this does, and your passkey approves it there. The
        extension never signs.
      </Notice>
      <Button
        width="full"
        disabled={!ok}
        onClick={() =>
          openBridge({
            method: 'tenzro_sendTransaction',
            params: transfer(to.trim(), parseTnzo(amount)),
          })
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

/** The hash of the last payment the wallet page sent for this extension, kept for the session. */
function LastPayment() {
  const [hash, setHash] = useState('');
  useEffect(() => {
    chrome.storage.session.get('lastPayment').then((r) => setHash((r.lastPayment as string) ?? ''));
  }, []);
  return hash ? (
    <Notice tone="success">
      Last payment sent. <span className="break-all font-mono text-xs">{hash}</span>
    </Notice>
  ) : null;
}
