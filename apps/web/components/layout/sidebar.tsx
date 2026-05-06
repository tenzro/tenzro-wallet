/**
 * Sidebar — vertical nav for the dashboard. Three sections:
 *   - core wallet (dashboard, send, activity)
 *   - agentic stack (agents, dApp connect)
 *   - institutional (canton)
 *
 * Active state uses a layoutId-driven Motion underline so the active
 * indicator slides between items.
 */

'use client';

import { Activity, Bot, Building2, Cable, Compass, Send, Settings, Wallet } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Logo, cn } from '@tenzro/ui';

const groups = [
  {
    label: 'Wallet',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: Wallet },
      { href: '/send', label: 'Send', icon: Send },
      { href: '/activity', label: 'Activity', icon: Activity },
    ],
  },
  {
    label: 'Agentic',
    items: [
      { href: '/agents', label: 'Agents', icon: Bot },
      { href: '/connect', label: 'Connections', icon: Cable },
    ],
  },
  {
    label: 'Institutional',
    items: [{ href: '/canton', label: 'Canton', icon: Building2 }],
  },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-border-subtle bg-background/40 backdrop-blur-xl px-3 py-5 sticky top-0 h-dvh">
      <Link href="/" className="px-2 mb-6">
        <Logo size={28} withWordmark />
      </Link>
      <nav className="flex flex-col gap-6 flex-1">
        {groups.map((group) => (
          <div key={group.label}>
            <h3 className="px-2 mb-2 text-[10px] uppercase tracking-widest text-foreground-subtle font-semibold">
              {group.label}
            </h3>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const isActive = pathname?.startsWith(item.href) ?? false;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'text-foreground'
                        : 'text-foreground-muted hover:text-foreground hover:bg-surface-2',
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute inset-0 rounded-lg bg-surface-2 border border-border-subtle"
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                      />
                    )}
                    <Icon className="size-4 relative z-10" />
                    <span className="relative z-10">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <Link
        href="/settings"
        className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-surface-2 transition-colors"
      >
        <Settings className="size-4" />
        Settings
      </Link>
      <div className="mt-3 px-2.5 py-2 text-[11px] text-foreground-disabled flex items-center gap-1.5">
        <Compass className="size-3" />
        Testnet · v0.1.0
      </div>
    </aside>
  );
}
