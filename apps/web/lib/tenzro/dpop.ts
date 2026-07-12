/**
 * DPoP (RFC 9449) proof minting for Tenzro testnet writes.
 *
 * The Tenzro RPC's DPoP V1 implementation requires `alg=EdDSA`
 * (Ed25519) — it rejects ES256 with "V1 only supports alg=EdDSA".
 * That's a narrower profile than RFC 9449 normally allows but it's
 * what the live testnet enforces, verified against rpc.tenzro.xyz.
 *
 *   1. Generate an Ed25519 keypair *before* onboarding.
 *   2. Send the public JWK in the onboarding *params* as `dpop_jwk` so
 *      the server pins `cnf.jkt` to its RFC 7638 thumbprint. The
 *      onboarding RPC ignores the proof header for binding — the JWK
 *      must be in the body. (See `wallet.ts::createWallet`.)
 *   3. Sign every subsequent authed call with a new proof using the
 *      same key (the private key never leaves WebCrypto). The proof's
 *      `htu` must match the server's internal bind URL — see
 *      `TENZRO_DPOP_HTU` in `./config`.
 *
 * The keypair is stored in IndexedDB as a non-extractable CryptoKey so
 * it survives reloads but cannot be exfiltrated. We persist the public
 * JWK separately for fast access (no async `exportKey` on every proof).
 *
 * Browser support note: Ed25519 in WebCrypto is widely shipped (Chrome
 * 137+, Edge 137+, Firefox 130+, Safari 17+). For older browsers we
 * surface the unsupported error directly rather than silently falling
 * back to an algorithm the server will reject.
 */

const DB_NAME = 'tenzro-wallet';
const STORE = 'dpop-key';
const KEY_ID = 'session';

interface StoredKey {
  readonly privateKey: CryptoKey;
  readonly publicJwk: JsonWebKey;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let cached: StoredKey | undefined;

/**
 * Get the existing DPoP key or generate a new one. Idempotent — call
 * freely from any code path that's about to need an authed RPC.
 */
export async function getOrCreateDpopKey(): Promise<StoredKey> {
  if (cached) return cached;
  const db = await openDb();
  const existing = await idbGet<StoredKey>(db, KEY_ID);
  if (existing) {
    cached = existing;
    return existing;
  }
  const pair = (await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    false, // non-extractable private key
    ['sign'],
  )) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  // Strip key_ops/ext/alg so the JWK is the canonical {kty, crv, x}
  // — RFC 7638 thumbprint stability + matches what the server hashes.
  if (!publicJwk.kty || !publicJwk.crv || !publicJwk.x) {
    throw new Error('WebCrypto returned an incomplete OKP JWK');
  }
  const cleanJwk: JsonWebKey = {
    kty: publicJwk.kty,
    crv: publicJwk.crv,
    x: publicJwk.x,
  };
  const stored: StoredKey = { privateKey: pair.privateKey, publicJwk: cleanJwk };
  await idbPut(db, KEY_ID, stored);
  cached = stored;
  return stored;
}

/**
 * Wipe the stored keypair. Use when a user resets / signs out — the
 * server-side JWT is bound to this key, so a new key forces a fresh
 * onboarding.
 */
export async function clearDpopKey(): Promise<void> {
  const db = await openDb();
  await idbDelete(db, KEY_ID);
  cached = undefined;
}

/**
 * Mint a JWS-compact DPoP proof for one HTTP request.
 *
 * @param htu Target URL (no query string per RFC 9449 §4.2)
 * @param htm HTTP method (uppercase)
 * @param accessToken Optional JWT — if present, the proof binds to its
 *   SHA-256 (`ath` claim) so a stolen proof can't be replayed against
 *   a different token.
 */
export async function mintDpopProof(
  htu: string,
  htm: string,
  accessToken?: string,
): Promise<string> {
  const { privateKey, publicJwk } = await getOrCreateDpopKey();
  const header = {
    typ: 'dpop+jwt',
    alg: 'EdDSA',
    jwk: publicJwk,
  };
  const payload: Record<string, unknown> = {
    htu,
    htm: htm.toUpperCase(),
    iat: Math.floor(Date.now() / 1000),
    jti: cryptoRandomId(),
  };
  if (accessToken) {
    payload.ath = await sha256Base64Url(accessToken);
  }
  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigBytes = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  const sigB64 = base64UrlEncode(new Uint8Array(sigBytes));
  return `${signingInput}.${sigB64}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(digest));
}

function cryptoRandomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
