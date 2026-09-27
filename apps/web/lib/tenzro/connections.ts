/**
 * Sites this wallet has approved, kept on this device only. The approval
 * popup records a site when the person connects it; the Connect page lists
 * them and forgets one on request. Nothing here is sent anywhere.
 */

const KEY = 'tenzro.wallet.connections.v1';

export interface Connection {
  readonly origin: string;
  readonly account: string;
  readonly connectedAt: number;
}

function read(): Connection[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Connection[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: Connection[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new Event('tenzro:connections'));
  } catch {
    // Storage can be unavailable (private mode); the connection lasts for this page.
  }
}

export function listConnections(account: string): Connection[] {
  return read().filter((c) => c.account === account);
}

export function isConnected(origin: string, account: string): boolean {
  return read().some((c) => c.origin === origin && c.account === account);
}

export function addConnection(origin: string, account: string): void {
  const list = read().filter((c) => !(c.origin === origin && c.account === account));
  list.push({ origin, account, connectedAt: Date.now() });
  write(list);
}

export function removeConnection(origin: string, account: string): void {
  write(read().filter((c) => !(c.origin === origin && c.account === account)));
}
