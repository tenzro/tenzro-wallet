'use client';

import { Button, EmptyState } from '@tenzro/ui';
import { KeyRound } from 'lucide-react';
import Link from 'next/link';

/** Shown in place of account data when no wallet is open on this device. */
export function SignedOut({ what }: { what: string }) {
  return (
    <EmptyState
      icon={KeyRound}
      title="Open your wallet"
      description={`Sign in with your passkey to see ${what}. Nothing is stored on a server: your wallet is your passkey and its record on the Tenzro ledger.`}
    >
      <Button asChild>
        <Link href="/onboarding">Sign in or create a wallet</Link>
      </Button>
    </EmptyState>
  );
}
