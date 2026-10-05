# Tenzro Wallet

**The wallet for people and the agents that act for them on Tenzro Network.**

Tenzro Wallet is the official wallet for [Tenzro Network](https://tenzro.com), which runs its native VM, EVM contracts, SVM programs and a Canton/DAML view over one ledger. This wallet is how a person holds TNZO and their identity, and decides what their agents may do.

## What it is

A wallet is the person's devices plus their account on the Tenzro ledger. Tenzro websites and RPC providers only carry messages: the wallet keeps working if any of them disappears, holds no secret, and stores only public data (DID, account address, which passkey this device uses).

- **Passkeys only.** The passkey (Touch ID, Face ID, Windows Hello, a phone over QR, a security key) signs every approval itself. There is no seed phrase and no exportable key. The relying party is `tenzro.com`.
- **Linked devices are redundancy.** Any linked device opens the account; guardians (their own passkeys) approve a recovery onto a new device, with a waiting period the owner can cancel.
- **Agents act under Terms the owner approved.** An agent's Terms (limits, operations, networks, counterparties, step-up rules) live in consensus, signed by the passkey the identity was created with. The wallet shows each agent's Terms, spend and bond, changes its limits, revokes it, and approves the actions its Terms hold for the owner.

## Flows (Network 1)

| Flow | Where | Node methods |
|---|---|---|
| Create a wallet | `/onboarding`, popup `tenzro_connect` | `tenzro_createCustodyChallenge`, `tenzro_enrollPasskey` |
| Sign in | any page, popup | `tenzro_resolveIdentity`, `tenzro_getAccountRecord` |
| Link a device (QR or this device) | Settings, popup `tenzro_linkDevice` | `tenzro_addPasskey` (new passkey signs its own addition) |
| Remove a device | Settings | `tenzro_removePasskey` |
| Guardians and recovery | Settings, `/guardian`, `/recover` | `tenzro_addGuardian`, `tenzro_initiateRecovery`, `tenzro_submitRecoverySignature`, `tenzro_finalizeRecovery`, `tenzro_cancelRecovery` |
| Send TNZO | `/send`, popup `tenzro_sendTransaction` | `eth_sendUserOperation` (ERC-7579 `execute(bytes32,bytes)`) |
| Receive, balances | `/dashboard` | `tenzro_getTokenBalance`, `eth_getBalance` |
| History | `/activity` | `tenzro_getTransactionHistory` |
| Further wallets under one identity | popup `tenzro_addWallet` | `tenzro_enrollPasskey` (salt > 0) |
| Settlement plan (x402 `plan`) | popup `tenzro_signSettlementPlan` | signed `SettlementPlan` open, submitted by the site |
| Publisher split and payouts | `/publisher` | `tenzro_getPayeeSplit`, `tenzro_previewSplit`, `tenzro_listPayments` |
| Create an agent | popup `tenzro_approveAgentTerms` (`delegate_agent`) | the site calls `tenzro_onboardDelegatedAgent` with the approval |
| Agent Terms, spend, bond | `/agents` | `tenzro_getAgentTerms`, `tenzro_getAgentBond` |
| Change an agent's limits | `/agents`, popup `tenzro_approveAgentTerms` (`update_agent_terms`) | `tenzro_updateAgentTerms` |
| Approve a held agent action (step-up) | `/agents` (paste), popup `tenzro_approveAgentAction` | the agent resends `tenzro_agentAct` with `step_up` |
| Revoke an agent or machine | `/agents` | `tenzro_revokeIdentity` with the passkey approval |
| Machines under the identity | `/agents` | `tenzro_resolveIdentity` |

Not in the wallet: paying an x402 or MPP challenge from the wallet's own account (`tenzro_payX402` / `tenzro_payMpp` with a signed credential) and bridging to other chains. Agent and machine approvals are signed by the passkey the identity was created with; a linked device's passkey cannot root an agent, so the wallet asks for that passkey (on this device or over QR).

### Popup API for sites and agents

A site opens `https://wallet.tenzro.com/approve` (`createPopupProvider` in `tenzro-wallet`) and sends one request at a time:

| Method | Params | Result |
|---|---|---|
| `tenzro_connect` | `{ challenge? }` | `{ account, did, proof? }` |
| `tenzro_sendTransaction` | `{ to, value }` | `{ userOpHash }` |
| `tenzro_addWallet` | `{ salt }` | `{ account, did, salt }` |
| `tenzro_linkDevice` | `{ label? }` | `{ credentialsTotal }` |
| `tenzro_signSettlementPlan` | `{ plan }` | `{ signedTx }` |
| `tenzro_approveAgentTerms` | `{ operation, terms, rotate_tokens?, challenge }` | `{ authorization }` |
| `tenzro_approveAgentAction` | `{ action, step_up }` | `{ step_up }` |
| `tenzro_disconnect` | none | `null` |

The wallet signs only what it can check: Terms are compared with what the node completed, and a held action's digest and custody challenge are recomputed from the action shown.

## What's in this repo

- **`packages/wallet-kernel/`** (`tenzro-wallet` on npm): passkey custody, ERC-4337 user operations, agent Terms and step-up checks, the popup protocol, surfaces for native, EVM, SVM and Canton.
- **`packages/ui/`** (`@tenzro/ui`): the design system.
- **`apps/web/`**: the hosted wallet at `wallet.tenzro.com` (Next.js, static export).
- **`apps/extension/`**, **`apps/wallet/`**: browser extension and host scaffold.

Design notes: [`docs/DESIGN.md`](./docs/DESIGN.md).

## Layout

```
packages/
  wallet-kernel/src/
    custody/passkey/   # PasskeyCustody: create, sign in, link, recover, guardians,
                       #   custody challenges, agent Terms and step-up approvals, user ops
    dapp/              # popup protocol, EIP-6963
    ports/agent/       # Terms target, agent payments, bonds, escrow, fee estimates
    ports/canton/      # Canton ledger API, content verification
    surfaces/          # tenzro-native, evm-on-tenzro, svm-on-tenzro, canton
    identity/ balance/ consent/ router/ crypto/ types/
  ui/
apps/
  web/                 # wallet.tenzro.com
  extension/
  wallet/
```

## Build

```bash
pnpm install
pnpm turbo run build typecheck test
pnpm lint
```

Toolchain: pnpm 10.33.2, Node 22 or later, TypeScript 5.7.3, Vitest 4.1.5, Turborepo 2.3.3, Biome 1.9.4.

The wallet depends on **`tenzro-sdk` 0.8.0** exactly (the SDK on node main: payments signed against a node challenge, `getAgentTerms`, chain bond records, step-ups that follow the Terms root). Until 0.8.0 is on npm, `pnpm install` cannot resolve it; once it is, run `pnpm install` once and commit the refreshed `pnpm-lock.yaml`.

The hosted wallet is a static export: `TENZRO_STATIC_EXPORT=1 pnpm --filter @tenzro/web build` writes `apps/web/out`. The static host must send the headers `next.config.ts` lists.

## Architectural rules

These are load-bearing and described in detail in `docs/DESIGN.md §3` and `§4`:

1. **Ports + adapters.** Surfaces and the kernel only depend on port interfaces. The only files allowed to import `tenzro-sdk` are adapters under `src/ports/*/adapters/`. SDK shape changes break exactly one file.
2. **Four surfaces, one identity.** TDIP `did:tenzro:` is the root; native, EVM and SVM are views of one balance on Tenzro.
3. **Cross-VM moves on Tenzro are pointer ops, not bridges.** Native, EVM and SVM are views of one balance; moving between them never leaves Tenzro.
4. **Custody is passkeys only.** No seed phrases. The user's WebAuthn P-256 passkey signs every approval itself; the wallet derives, wraps and stores no key and keeps only public data (DID, account address, which credential). Passkeys that sync through one provider count as one root.
5. **Decimals are not interchangeable.** Native + EVM = 18 decimals; SVM = 9 decimals; Canton CC = `Numeric 10`. The router surfaces dust-truncation warnings; surfaces enforce per-view precision.
6. **Browser-clean kernel.** No `node:` imports, no `process.env` reads in `src/` outside `integration/`. Use Web Crypto, `fetch`, `TextEncoder`.

## Documentation

| Document | Purpose |
|----------|---------|
| [`docs/DESIGN.md`](docs/DESIGN.md) | Authoritative design: ports + adapters, kernel architecture, four VM surfaces, milestones |

## Contributing

Before merging:

```bash
pnpm turbo run build typecheck test && pnpm lint
```

Tests are co-located with source (`*.test.ts` next to `*.ts`); integration smokes live under `src/integration/`. Keep adapters narrow — if the SDK shape changes, exactly one file should break.

## License

Apache-2.0. See [LICENSE](./LICENSE).
