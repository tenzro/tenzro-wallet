/** Byte encodings the wallet moves between WebAuthn, the SDK and the screen. */

export function toHex(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) throw new Error('not hex');
  return Uint8Array.from(clean.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** A 20- or 32-byte account as the ledger's 32-byte slot, `0x` hex. */
export function ledgerSlot(account: string): string {
  const hex = account.replace(/^0x/, '').toLowerCase();
  if (hex.length === 40) return `0x${hex}${'00'.repeat(12)}`;
  if (hex.length === 64) return `0x${hex}`;
  throw new Error('an account is 20 or 32 bytes of hex');
}

/** Whether `text` is a 20- or 32-byte hex account. */
export function isAccount(text: string): boolean {
  return /^(0x)?([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(text.trim());
}

/** An amount in TNZO (decimal text) as base units, 18 decimals. */
export function parseTnzo(text: string): bigint {
  const t = text.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) throw new Error('enter an amount like 1.5');
  const [whole = '0', frac = ''] = t.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(frac.padEnd(18, '0') || '0');
}

/** Base units as the network's JSON carries them: a number while exact, else decimal text. */
export function weiJson(wei: bigint): number | string {
  return wei <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(wei) : wei.toString();
}
