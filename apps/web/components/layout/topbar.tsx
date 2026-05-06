/**
 * Topbar — search (cmd-k entry point), network status, identity card.
 */

'use client';

import { Badge, IdentityCard } from '@tenzro/ui';
import { Bell, Globe, Search } from 'lucide-react';
import * as React from 'react';

import { SELF_DID, SELF_LABEL } from '@/lib/mock-data';

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 px-6 lg:px-8 py-3 border-b border-border-subtle bg-background/70 backdrop-blur-xl">
      {/* Search */}
      <div className="flex-1 max-w-xl">
        <button
          type="button"
          className="group flex items-center gap-2 w-full rounded-lg border border-border-subtle bg-surface-1 px-3 py-1.5 text-sm text-foreground-muted hover:border-border-default hover:text-foreground transition-colors"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search address, tx, or agent…</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-md border border-border-subtle bg-surface-2 px-1.5 py-0.5 text-[10px] font-mono text-foreground-subtle">
            ⌘ K
          </kbd>
        </button>
      </div>

      {/* Network status */}
      <Badge variant="success" size="sm" dot className="hidden sm:inline-flex">
        <Globe className="size-3" /> rpc.tenzro.network
      </Badge>

      {/* Notifications */}
      <button
        type="button"
        className="relative inline-flex items-center justify-center size-9 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer"
      >
        <Bell className="size-4" />
        <span className="absolute top-2 right-2 size-1.5 rounded-full bg-brand animate-pulse-glow" />
      </button>

      {/* Identity */}
      <IdentityCard did={SELF_DID} label={SELF_LABEL} compact onSwitch={() => {}} />
    </header>
  );
}
