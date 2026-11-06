# Chrome Web Store listing: preparation checklist

Nothing here has been submitted. Publishing is an owner action.

## Single purpose

"Show your Tenzro account balance and open your wallet provider's page to approve payments with your passkey." One narrow purpose, one wallet.

## Permissions and their justifications

| Permission | Why |
|---|---|
| `storage` | Remembers the public account address and DID on this device (chrome.storage.local). No keys, no secrets: the passkey stays in the authenticator. |
| Host `https://wallet.tenzro.com/*` | Opens the wallet provider's page, where the passkey signs. Also the relying-party domain a passkey may name. |
| Host `https://rpc.tenzro.com/*` | Reads the chain id and the account balance. |

No `tabs`, `scripting`, `webRequest`, `<all_urls>` or `identity` permission. No content script, no remote code: every script is in the package and the page CSP is `script-src 'self'`.

## Data use disclosure (dashboard "Privacy practices")

- Collects: the public account address and DID, held on the device. Sent only to the RPC host above to read a balance.
- Does not collect: authentication information, personally identifiable information, health, financial or payment information, location, web history, user activity, website content.
- Certify: not sold to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending.

## Privacy policy text (proposal)

> Tenzro Wallet (extension) stores your public account address and identity (DID) on your device. It sends your account address to the network node it is configured for (rpc.tenzro.com) to read your balance. It never sees, stores or sends your passkey: signing happens in your device's authenticator, on your wallet provider's page. It uses no analytics, no advertising and no third-party services, and it does not load code from the network. Remove the extension to delete everything it stores.

Host this at a stable https URL (for example https://tenzro.com/privacy) and enter it in the dashboard.

## Screenshots to take (1280x800 or 640x400)

1. Popup, signed out, connected.
2. Popup with an account and a balance.
3. The wallet provider's approval page open beside it.
4. Network error state (wrong chain id).

## Policy points checked (developer.chrome.com/docs/webstore/program-policies)

- Single purpose: narrow and easy to understand.
- Privacy policy required when user data is handled; disclosure must be prominent; Limited Use.
- MV3: no remotely hosted code; full functionality discernible from the submitted code.
- Least permissions.
- The policy has no wallet-specific rule; it bans cryptocurrency mining.

## Unproven

- That review accepts a wallet extension with this listing.
- That the extension id is stable and usable as an allowed origin (it is, once published, on Chrome; unverified here).
- Signing from the extension itself: Chrome lets an extension use RP ID `wallet.tenzro.com` with a matching host permission, but the chain verifier rejects the origin `chrome-extension://<id>` (see the README of this folder).
