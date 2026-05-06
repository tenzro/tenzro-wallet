/**
 * IdentityCard — the wallet's "self" representation: TDIP DID, the four
 * surface keys derived from it, and the current quorum status.
 *
 * On the dashboard this lives in the top-right and is the user's
 * primary handle — clicking it opens the account switcher.
 */

'use client';

import { Check, ChevronDown, Copy, Shield } from 'lucide-react';
import { motion } from 'motion/react';
import * as React from 'react';
import { Avatar } from '../components/avatar';
import { Badge } from '../components/badge';
import { cn } from '../utils/cn';
import { formatAddress } from '../utils/format';

export interface IdentityCardProps {
  did: string;
  label?: string;
  quorumStatus?: 'healthy' | 'pairing' | 'compromised';
  onCopy?: () => void;
  onSwitch?: () => void;
  compact?: boolean;
  className?: string;
}

export function IdentityCard({
  did,
  label,
  quorumStatus = 'healthy',
  onCopy,
  onSwitch,
  compact,
  className,
}: IdentityCardProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(did).catch(() => {});
    }
    setCopied(true);
    onCopy?.();
    setTimeout(() => setCopied(false), 1500);
  }, [did, onCopy]);

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface-1 p-2 pr-3',
        'hover:border-border-default transition-colors',
        compact ? 'gap-2 p-1.5 pr-2.5' : 'gap-3 p-2 pr-3',
        className,
      )}
    >
      <Avatar seed={did} size={compact ? 'sm' : 'md'} />
      <div className="flex flex-col min-w-0">
        {label && (
          <span className="text-xs text-foreground-subtle leading-none mb-0.5">{label}</span>
        )}
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-foreground tabular truncate">
            {formatAddress(did, 12, 6)}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center justify-center size-5 rounded-md hover:bg-surface-3 transition-colors text-foreground-muted hover:text-foreground cursor-pointer"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </button>
        </div>
      </div>
      {quorumStatus && (
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 380 }}
        >
          <Badge
            variant={
              quorumStatus === 'healthy'
                ? 'success'
                : quorumStatus === 'pairing'
                  ? 'warning'
                  : 'danger'
            }
            size="xs"
          >
            <Shield className="size-2.5" />
            {quorumStatus === 'healthy'
              ? '2/2'
              : quorumStatus === 'pairing'
                ? 'Pairing'
                : 'At risk'}
          </Badge>
        </motion.div>
      )}
      {onSwitch && (
        <button
          type="button"
          onClick={onSwitch}
          className="flex items-center justify-center size-6 rounded-md hover:bg-surface-3 text-foreground-muted hover:text-foreground transition-colors cursor-pointer"
        >
          <ChevronDown className="size-3.5" />
        </button>
      )}
    </div>
  );
}
