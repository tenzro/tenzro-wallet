'use client';

import { Button, Card, EmptyState, formatRelativeTime } from '@tenzro/ui';
import { Cable } from 'lucide-react';
import * as React from 'react';

import { SignedOut } from '@/components/wallet/signed-out';
import { type Connection, listConnections, removeConnection } from '@/lib/tenzro/connections';
import { useWallet } from '@/lib/tenzro/hooks';

export default function ConnectPage() {
  const { wallet } = useWallet();
  const [list, setList] = React.useState<Connection[]>([]);

  React.useEffect(() => {
    if (!wallet) return;
    const refresh = () => setList(listConnections(wallet.account));
    refresh();
    window.addEventListener('tenzro:connections', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('tenzro:connections', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [wallet]);

  if (!wallet) return <SignedOut what="the sites connected to your wallet" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl tracking-tight">Connected sites</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Sites you approved to see your address and ask for signatures. Kept on this device only.
        </p>
      </div>
      {list.length === 0 ? (
        <EmptyState
          icon={Cable}
          title="No connected sites"
          description="When a site asks to connect and you approve it, it appears here. You can disconnect it at any time."
        />
      ) : (
        <div className="space-y-2">
          {list.map((c) => (
            <Card key={c.origin} variant="raised" className="flex items-center justify-between p-4">
              <div>
                <p className="font-mono text-sm">{c.origin}</p>
                <p className="text-xs text-foreground-subtle">
                  Connected {formatRelativeTime(new Date(c.connectedAt))}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => removeConnection(c.origin, wallet.account)}
              >
                Disconnect
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
