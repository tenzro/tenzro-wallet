/**
 * TenzroRpcPort — the kernel's view of the Tenzro Ledger JSON-RPC for a
 * passkey smart account.
 *
 * A person's account is an ERC-4337 smart account guarded by the WebAuthn
 * validator. The node never signs for it: the wallet builds a
 * UserOperation, the user's passkey signs the
 * operation hash on the device, and the node validates and executes it.
 *
 * Real builds inject `TenzroJsonRpcAdapter` (plain JSON-RPC over fetch);
 * tests inject in-memory fakes. Nothing under `src/surfaces/` or
 * `src/kernel.ts` talks to the network directly.
 *
 * Node methods (crates/tenzro-node/src/rpc.rs):
 *   eth_chainId, eth_gasPrice, eth_supportedEntryPoints,
 *   tenzro_getSmartAccount (nonce), eth_sendUserOperation,
 *   eth_getUserOperationReceipt.
 */

/** Receipt of an executed UserOperation (`eth_getUserOperationReceipt`). */
export interface UserOperationReceipt {
  readonly userOpHash: string;
  readonly success: boolean;
  readonly actualGasUsed?: string;
  readonly actualGasCost?: string;
}

/**
 * On-chain transaction state for plain transactions, used by read helpers
 * such as `TenzroSdkAdapter.getTransaction`.
 */
export interface TenzroTxStatus {
  readonly hash: string;
  readonly status: 'pending' | 'included' | 'finalized' | 'failed';
  readonly blockHeight?: number;
}

export interface TenzroRpcPort {
  /** `eth_chainId`. Read from the node; never assumed. */
  getChainId(): Promise<bigint>;

  /** The EntryPoint this node serves (`eth_supportedEntryPoints[0]`). */
  getEntryPoint(): Promise<string>;

  /** Smart-account nonce (`tenzro_getSmartAccount`), default key 0. */
  getAccountNonce(account: string): Promise<bigint>;

  /** Current gas price in wei (`eth_gasPrice`). */
  getGasPrice(): Promise<bigint>;

  /** Submit a signed UserOperation. Returns the userOpHash. */
  sendUserOperation(userOp: Readonly<Record<string, string>>, entryPoint: string): Promise<string>;

  /** `null` while the node has not seen the operation. */
  getUserOperationReceipt(userOpHash: string): Promise<UserOperationReceipt | null>;
}
