/**
 * AgentMandateCard — the agentic-stack consent surface.
 *
 * Maps to AP2 mandate kinds (Intent / Cart / Payment) + ACP cart
 * receipts and ERC-8004 agent identity. Restrained chrome: agent
 * accent only on the AGENT chip and the avatar ring; everything else
 * stays mono. Policy facts (cap / window / recipient class / verifier)
 * sit in a tight grid so users see exactly what they're consenting to.
 */

'use client';

import { Bot, Check, Clock, ExternalLink, ShieldCheck, X } from 'lucide-react';
import { motion } from 'motion/react';
import type * as React from 'react';
import { Avatar } from '../components/avatar';
import { Badge } from '../components/badge';
import { Button } from '../components/button';
import { cn } from '../utils/cn';
import { formatRelativeTime } from '../utils/format';
import type { ChainId } from './chain';
import { ChainBadge } from './chain-badge';

export type MandateKind = 'intent' | 'cart' | 'payment' | 'session-key';

export interface AgentMandateCardProps {
  kind: MandateKind;
  agentName: string;
  agentDid: string;
  agentVerifier?: string | undefined;
  summary: string;
  cap?: { amount: string; currency: string; window?: string } | undefined;
  recipientClass?: string | undefined;
  expiresAt?: Date | number | undefined;
  chain: ChainId;
  state: 'pending' | 'active' | 'revoked' | 'expired';
  reputation?: { score: number; reviews: number } | undefined;
  attestationId?: string | undefined;
  onApprove?: (() => void) | undefined;
  onReject?: (() => void) | undefined;
  onRevoke?: (() => void) | undefined;
  className?: string | undefined;
}

const kindLabel: Record<MandateKind, string> = {
  intent: 'AP2 Intent Mandate',
  cart: 'AP2 Cart Mandate',
  payment: 'AP2 Payment Mandate',
  'session-key': 'ERC-7702 Session Key',
};

export function AgentMandateCard({
  kind,
  agentName,
  agentDid,
  agentVerifier,
  summary,
  cap,
  recipientClass,
  expiresAt,
  chain,
  state,
  reputation,
  attestationId,
  onApprove,
  onReject,
  onRevoke,
  className,
}: AgentMandateCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      className={cn(
        'rounded-2xl bg-surface-1 border border-border-subtle p-5',
        state === 'pending' && 'border-border-default',
        state === 'revoked' && 'opacity-60',
        state === 'expired' && 'opacity-60',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <Avatar seed={agentDid} size="lg" initials={agentName.slice(0, 2)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-semibold text-foreground tracking-tight">{agentName}</h3>
            <Badge variant="agent" size="xs">
              <Bot className="size-2.5" />
              Agent
            </Badge>
            <ChainBadge chain={chain} size="xs" />
            {state === 'active' && (
              <Badge variant="success" size="xs" dot>
                Active
              </Badge>
            )}
            {state === 'revoked' && (
              <Badge variant="danger" size="xs">
                Revoked
              </Badge>
            )}
            {state === 'expired' && (
              <Badge variant="default" size="xs">
                Expired
              </Badge>
            )}
          </div>
          <p className="text-xs text-foreground-subtle font-mono mt-1 truncate">{agentDid}</p>
          <span className="text-[10px] uppercase tracking-wider text-agent font-medium mt-1 block">
            {kindLabel[kind]}
          </span>
        </div>
      </div>

      <p className="text-sm text-foreground leading-relaxed mb-4">{summary}</p>

      {/* Policy facts */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {cap && (
          <Fact label="Spend cap">
            <span className="tabular text-foreground font-medium">
              {cap.amount} {cap.currency}
            </span>
            {cap.window && <span className="text-foreground-subtle"> / {cap.window}</span>}
          </Fact>
        )}
        {recipientClass && <Fact label="Recipients">{recipientClass}</Fact>}
        {expiresAt && (
          <Fact label="Expires">
            <Clock className="size-3 inline mr-1 text-foreground-muted" />
            {formatRelativeTime(expiresAt)}
          </Fact>
        )}
        {agentVerifier && (
          <Fact label="Verifier">
            <ShieldCheck className="size-3 inline mr-1 text-foreground-muted" />
            {agentVerifier}
          </Fact>
        )}
      </div>

      {/* Reputation + attestation */}
      {(reputation || attestationId) && (
        <div className="flex items-center gap-3 pb-4 mb-4 border-b border-border-subtle text-xs">
          {reputation && (
            <span className="text-foreground-muted">
              <span className="text-foreground font-medium">★ {reputation.score.toFixed(2)}</span>
              <span className="text-foreground-subtle">
                {' '}
                · {reputation.reviews} on-chain reviews
              </span>
            </span>
          )}
          {attestationId && (
            <button
              type="button"
              className="text-foreground-muted hover:text-foreground inline-flex items-center gap-1 transition-colors cursor-pointer"
            >
              TEE receipt
              <ExternalLink className="size-2.5" />
            </button>
          )}
        </div>
      )}

      {state === 'pending' && onApprove && onReject && (
        <div className="flex gap-2">
          <Button
            onClick={onReject}
            variant="secondary"
            size="md"
            leftIcon={<X className="size-4" />}
          >
            Reject
          </Button>
          <Button
            onClick={onApprove}
            variant="primary"
            size="md"
            width="full"
            leftIcon={<Check className="size-4" />}
          >
            Approve
          </Button>
        </div>
      )}
      {state === 'active' && onRevoke && (
        <Button onClick={onRevoke} variant="secondary" size="sm">
          Revoke
        </Button>
      )}
    </motion.div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-surface-2 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-foreground-subtle">{label}</span>
      <span className="text-xs text-foreground">{children}</span>
    </div>
  );
}
