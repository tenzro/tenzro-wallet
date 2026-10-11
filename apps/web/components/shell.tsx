'use client';

import { Button, Logo, cn } from '@tenzro/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { signerOf } from '@/lib/account';
import { WALLET_NAME } from '@/lib/config';
import { change, networkSender, roots } from '@/lib/keystore';
import { remaining } from '@/lib/waits';

import { Notice, useAction } from './ui';
import { useWallet } from './wallet-context';

const NAV = [
  { href: '/', label: 'Account' },
  { href: '/send', label: 'Send' },
  { href: '/devices', label: 'Devices' },
  { href: '/recovery', label: 'Recovery' },
  { href: '/agents', label: 'Agents' },
  { href: '/requests', label: 'Requests' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { wallet } = useWallet();
  const bare = path === '/approve';
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-16">
      <header className="flex items-center justify-between py-5">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={22} />
          <span className="text-base font-medium tracking-tight">{WALLET_NAME}</span>
        </Link>
      </header>
      {wallet && !bare ? (
        <nav className="-mx-1 mb-6 flex gap-1 overflow-x-auto" aria-label="Wallet">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm',
                path === n.href
                  ? 'bg-surface-2 text-foreground'
                  : 'text-foreground-muted hover:text-foreground',
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      ) : null}
      {wallet && !bare ? <Banners /> : null}
      <main className="space-y-6">{children}</main>
    </div>
  );
}

/** What every device shows: a recovery in progress, and a missing second root. */
function Banners() {
  const { wallet, net, view, balance, now, refresh } = useWallet();
  const { pending, error, run } = useAction();
  if (!wallet || !net || !view || balance === null) return null;
  const p = view.keystore?.pending_recovery;
  const r = roots(view);

  const act = (op: 'cancel_recovery' | 'finish_recovery') =>
    run(async () => {
      await change(net.rpc, networkSender(net.rpc), wallet, signerOf(wallet), op, balance);
      await refresh();
    });

  return (
    <div className="mb-6 space-y-3">
      {p ? (
        <Notice tone="danger">
          <div className="space-y-2">
            <p className="font-medium">A recovery of this account is in progress.</p>
            <p>
              It would add the passkey "{p.credential.label}" ({p.credential.rp_id}) and can
              complete {remaining(p.ready_at_ms, now)}. If you did not start it, cancel it now.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="danger"
                pending={pending}
                onClick={() => act('cancel_recovery')}
              >
                Cancel recovery
              </Button>
              {p.ready_at_ms <= now ? (
                <Button
                  size="sm"
                  variant="secondary"
                  pending={pending}
                  onClick={() => act('finish_recovery')}
                >
                  Complete it
                </Button>
              ) : null}
            </div>
            {error ? <p>{error}</p> : null}
          </div>
        </Notice>
      ) : null}
      {r.needsSecond ? (
        <Notice tone={balance > 0n ? 'warning' : 'info'}>
          Add a second, independent passkey before this account holds more.{' '}
          {r.maySpend ? '' : 'Spending needs two independent passkeys. '}
          <Link href="/devices" className="underline underline-offset-2">
            Link a device
          </Link>
        </Notice>
      ) : null}
    </div>
  );
}
