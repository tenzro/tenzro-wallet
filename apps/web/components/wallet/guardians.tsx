'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input } from '@tenzro/ui';
import { ShieldCheck, UserPlus } from 'lucide-react';
import * as React from 'react';
import {
  type CredentialRef,
  type GuardianCard,
  type GuardianMember,
  type QuorumMember,
  cardQuorumMember,
  checkGuardianQuorum,
  decodeGuardianCard,
} from 'tenzro-wallet/custody';

import { custody } from '@/lib/tenzro/wallet';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const ROLE_TEXT: Record<string, string> = {
  recovery_key: 'Security key',
  device: 'Device or person',
  email_verifier: 'Email',
};

function memberQuorum(m: GuardianMember): QuorumMember {
  return { id: m.p256_pubkey_hex, backupEligible: m.backup_eligible, aaguid: m.aaguid };
}

/**
 * The account's guardians, and adding one from the card its holder sends.
 * Before anything is signed, the quorum is previewed under the network's
 * rule: approvals count by independent provider, so the threshold cannot
 * exceed the number of providers the guardians span.
 */
export function GuardiansPanel({
  account,
  approver,
}: {
  readonly account: string;
  readonly approver: CredentialRef;
}) {
  const qc = useQueryClient();
  const guardians = useQuery({
    queryKey: ['tenzro', 'guardians', account],
    queryFn: () => custody().listGuardians(account),
  });
  const [cardText, setCardText] = React.useState('');
  const [threshold, setThreshold] = React.useState<number | null>(null);

  const card = React.useMemo((): { card?: GuardianCard; error?: string } => {
    if (!cardText.trim()) return {};
    try {
      return { card: decodeGuardianCard(cardText) };
    } catch (e) {
      return { error: errorText(e) };
    }
  }, [cardText]);

  const members = guardians.data?.members ?? [];
  const duplicate =
    !!card.card &&
    members.some(
      (m) => m.p256_pubkey_hex.replace(/^0x/, '').toLowerCase() === card.card!.p256.replace(/^0x/, '').toLowerCase(),
    );
  const after = card.card && !duplicate ? [...members.map(memberQuorum), cardQuorumMember(card.card)] : null;
  const wanted = threshold ?? Math.max(guardians.data?.threshold ?? 0, Math.min(2, after?.length ?? 0));
  const preview = after ? checkGuardianQuorum(after, wanted) : null;

  const add = useMutation({
    mutationFn: () =>
      custody().addGuardian({ account, card: card.card!, threshold: wanted, approver }),
    onSuccess: () => {
      setCardText('');
      setThreshold(null);
      void qc.invalidateQueries({ queryKey: ['tenzro', 'guardians', account] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">Guardians</p>
        {guardians.data && guardians.data.members.length > 0 && (
          <Badge variant="outline">
            {guardians.data.threshold} of {guardians.data.independent_roots} providers
          </Badge>
        )}
      </div>
      <p className="text-foreground-muted">
        Guardians are passkeys held by you or people you trust. If every device is lost, enough of
        them approve adding a new passkey. Passkeys that sync through one provider count once.
      </p>

      {guardians.isError && <p className="text-danger">{errorText(guardians.error)}</p>}
      {members.length > 0 && (
        <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
          {members.map((m) => (
            <li key={m.index} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-foreground-subtle" />
                {m.label || `Guardian ${m.index + 1}`}
              </span>
              <span className="text-xs text-foreground-subtle">
                {ROLE_TEXT[m.role] ?? m.role} · {m.backup_eligible ? 'synced' : 'device-bound'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 rounded-xl border border-border-subtle p-3">
        <p className="font-medium">Add a guardian</p>
        <p className="text-xs text-foreground-subtle">
          The guardian opens <span className="font-mono">/guardian</span> on their own device, makes
          a guardian passkey and sends you its card. Paste it here.
        </p>
        <Input
          value={cardText}
          onChange={(e) => setCardText(e.target.value)}
          placeholder="Guardian card"
          aria-label="Guardian card"
          spellCheck={false}
        />
        {card.error && <p className="text-danger">{card.error}</p>}
        {duplicate && <p className="text-danger">That passkey is already a guardian.</p>}
        {card.card && !duplicate && preview && (
          <div className="space-y-2">
            <p>
              {card.card.label || 'Unnamed guardian'} ·{' '}
              {ROLE_TEXT[card.card.role] ?? card.card.role} ·{' '}
              {cardQuorumMember(card.card).backupEligible ? 'synced passkey' : 'device-bound passkey'}
            </p>
            <label className="flex items-center gap-2">
              <span>Approvals needed</span>
              <Input
                type="number"
                min={1}
                max={after?.length ?? 1}
                value={wanted}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-20"
                aria-label="Approvals needed"
              />
              <span className="text-foreground-subtle">
                of {preview.roots} independent provider{preview.roots === 1 ? '' : 's'}
              </span>
            </label>
            {preview.reason && (
              <p className={preview.ok ? 'text-warning' : 'text-danger'}>{preview.reason}</p>
            )}
            <Button
              variant="primary"
              size="sm"
              leftIcon={<UserPlus className="size-4" />}
              pending={add.isPending}
              disabled={!preview.ok || add.isPending}
              onClick={() => add.mutate()}
            >
              Approve and add
            </Button>
          </div>
        )}
        {add.isSuccess && <p className="text-success">Guardian added.</p>}
        {add.error && <p className="text-danger">{errorText(add.error)}</p>}
      </div>
    </div>
  );
}
