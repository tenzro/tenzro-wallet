# @tenzro/wallet-app

Scaffolded host that wires the three host-side pieces the wallet kernel can't ship itself:

| Piece | File | Status |
|---|---|---|
| FROST WASM binding (`FrostBackend` seam) | `src/host/frost-wasm.ts` | Stub. Swap `loadStubFrostWasm()` for `await loadFrostWasm()` once the wasm-bindgen artifacts are bundled. |
| Device-provisioning UI (drives `walletNew()` / `walletRecover()`) | `src/ui/onboarding.ts` | Framework-free DOM mount-point. |
| `window.tenzro` dispatch (EIP-1193 provider + EIP-6963 announcement) | `src/dispatch/window-tenzro.ts` | Routes the always-cheap reads through the kernel; signing methods scaffolded with typed -32601 errors. |

`src/main.ts` documents the load order and exposes the wiring as one entry function.

## What's authoritative vs scaffolded

The reference browser extension at `apps/tenzro-extension/` is the **production** dispatch surface — it runs in MV3, owns DPoP-bound JWT minting, opens user-confirmation popups, and manages CAIP-25 sessions. This wallet app is for **standalone web embeds** (hosted wallet, dev panel, integration tests) where you can't assume the extension is installed.

If you only need a dApp page that consumes a Tenzro provider, you don't need this package at all — install `tenzro-sdk` and call `TenzroClient.fromInjected()`. See [the SDK README](../../packages/wallet-kernel/node_modules/tenzro-sdk/README.md) for the consume side.

## Wire-up

```typescript
import { startWalletApp, defaultPasskeyAuthenticator } from '@tenzro/wallet-app';
import {
  FrostHttpAdapter,
  MlDsaHttpAdapter,
  ShareEnvelopeHttpAdapter,
} from 'tenzro-wallet';

const baseUrl = 'https://rpc.tenzro.network';

// Embedder builds the HTTP adapters against the live /wallet/* endpoints.
const provisioning = /* HTTP adapter targeting /wallet/new/* */;
const recovery     = /* HTTP adapter targeting /wallet/recover/* */;
const enroller     = /* WebAuthn create() wrapper — supplies rpId, origin */;

const app = await startWalletApp({
  provisioning,
  recovery,
  enroller,
  onboardingContainer: document.getElementById('mount')!,
  providerAnnouncement: {
    uuid: crypto.randomUUID(),
    icon: 'data:image/svg+xml;base64,...',
  },
});

// Show onboarding, then construct the kernel from the result, then install.
await app.mountOnboarding();
const kernel = /* construct WalletKernel from the onboarding result */;
const { dispose } = app.installProvider(kernel);
```

## Reference docs

- SDK `fromInjected()` flow: `sdk/tenzro-ts-sdk/README.md`
- Reference extension: `apps/tenzro-extension/README.md`
- Kernel architecture: `docs/DESIGN.md`
