# @tenzro/wallet-app

Framework-free host that wires the wallet kernel into a page:

| Piece | File |
|---|---|
| Onboarding: create a wallet from a passkey, or sign in with one | `src/ui/onboarding.ts` |
| `window.tenzro` provider (EIP-1193) and EIP-6963 announcement | `src/dispatch/window-tenzro.ts` |
| Load order and wiring | `src/main.ts` |

Custody is non-custodial and passkey-based: the passkey stays in the device's authenticator, is the
only signing key, and nothing secret is stored. The chain id is always read from the
node (`eth_chainId`).

## Wire-up

```typescript
import { startWalletApp } from '@tenzro/wallet-app';

const app = await startWalletApp({
  rpcUrl: 'https://rpc.tenzro.xyz', // default
  rpId: 'tenzro.com', // WebAuthn relying party id; must match the node's
  onboardingContainer: document.getElementById('mount')!,
  providerAnnouncement: { uuid: crypto.randomUUID(), icon: 'data:image/svg+xml;base64,...' },
});

await app.mountOnboarding();
// Build a WalletKernel for the account (tenzroNativeSurface + passkeySigningDriver), then:
const { dispose } = app.installProvider(kernel);
```

After onboarding, prompt the user to link a second device (`app.custody.linkDevice`). A wallet with a single
passkey can receive but should not send until a second device or a guardian is added.

dApps that only consume a Tenzro provider do not need this package: install `tenzro-sdk` and call
`TenzroClient.fromInjected()`.
