'use client';

import { Badge, Button, IdentityCard } from '@tenzro/ui';
import { Globe } from 'lucide-react';
import Link from 'next/link';
import { devicesOnWallet } from 'tenzro-wallet/custody';

import { useBlockNumber, useDevices, useEndpoint, useWallet } from '@/lib/tenzro/hooks';

export function Topbar() {
  const { wallet } = useWallet();
  const block = useBlockNumber();
  const devices = useDevices(wallet);
  const host = useEndpoint() ?? 'Finding the network';

  return (
    <header className="sticky top-0 z-30 flex items-center justify-end gap-3 px-6 lg:px-8 py-3 border-b border-border-subtle bg-background/80 backdrop-blur">
      <Badge
        variant={block.error ? 'danger' : block.data ? 'success' : 'default'}
        size="sm"
        dot
        className="hidden sm:inline-flex"
        title={
          block.data ? `Block ${block.data}` : block.error ? 'Network unreachable' : 'Connecting'
        }
      >
        <Globe className="size-3" /> {host}
      </Badge>
      {wallet ? (
        <IdentityCard
          did={wallet.did}
          compact
          {...(wallet.displayName ? { label: wallet.displayName } : {})}
          {...(devices.data ? { devices: devicesOnWallet(devices.data).length } : {})}
        />
      ) : (
        <Button asChild size="sm">
          <Link href="/onboarding">Sign in</Link>
        </Button>
      )}
    </header>
  );
}
