/**
 * Device-provisioning UI — drives `walletNew()` / `walletRecover()`.
 *
 * Scope: a framework-free mount-point that an embedder can drop into a
 * page (extension popup, web app, dev panel) and walk the user through
 * the M5 enrol-or-recover decision and its sub-paths. The kernel
 * orchestrators do the heavy lifting; this module is only responsible for
 * (1) presenting the choice, (2) wiring the WebAuthn `create()` /
 * `get()` calls behind a port the orchestrators expect, and (3) showing
 * progress + error states with clear language.
 *
 * It is intentionally not a React/Vue/Svelte component. Three reasons:
 *
 *   1. The wallet ships in a browser-extension popup and a web-app
 *      embed; pinning a framework here forces both consumers to use it.
 *   2. The M5 flow is small enough (5 UI states: choose → enrol/recover
 *      params → in-progress → success → error) that a hand-rolled state
 *      machine is clearer than framework lifecycle.
 *   3. The orchestrators (`walletNew`, `walletRecover`) already encode
 *      the cancel-on-failure rollback rules, so the UI doesn't need a
 *      reactive store to keep server + screen in sync — it just renders
 *      whatever stage the orchestrator is in.
 *
 * Embedders that want React can wrap this with a thin component that
 * forwards `mount(container)` into a `useEffect`.
 */

import {
  type PasskeyEnroller,
  type ProvisioningPort,
  type RecoveryPort,
  type RecoveryProof,
  type WalletNewResult,
  type WalletRecoverResult,
  asTdipDid,
  walletNew,
  walletRecover,
} from '@tenzro/wallet-kernel';

/**
 * Full set of dependencies the onboarding flow needs. Embedders construct
 * these once at app startup (see `apps/wallet/src/main.ts` for the
 * canonical wiring) and pass the bundle in.
 */
export interface OnboardingDeps {
  readonly provisioning: ProvisioningPort;
  readonly recovery: RecoveryPort;
  readonly enroller: PasskeyEnroller;
}

export interface OnboardingResult {
  readonly mode: 'new' | 'recover';
  readonly result: WalletNewResult | WalletRecoverResult;
}

/**
 * UI state machine. Five terminal-or-transitional states; the renderer
 * pattern-matches and updates the DOM.
 */
type UiState =
  | { readonly kind: 'choose' }
  | { readonly kind: 'recover-params' }
  | { readonly kind: 'in-progress'; readonly label: string }
  | { readonly kind: 'success'; readonly result: OnboardingResult }
  | { readonly kind: 'error'; readonly message: string };

export interface OnboardingMount {
  readonly dispose: () => void;
  readonly result: Promise<OnboardingResult>;
}

/**
 * Mount the onboarding flow into `container`. Returns a `dispose()` and a
 * promise that resolves on success / rejects on user cancel. Subsequent
 * mounts replace the previous DOM.
 */
export function mountOnboarding(args: {
  readonly container: HTMLElement;
  readonly deps: OnboardingDeps;
  readonly userDisplayName?: string;
}): OnboardingMount {
  const { container, deps } = args;
  let resolveResult!: (r: OnboardingResult) => void;
  let rejectResult!: (e: unknown) => void;
  const result = new Promise<OnboardingResult>((res, rej) => {
    resolveResult = res;
    rejectResult = rej;
  });

  let state: UiState = { kind: 'choose' };
  let disposed = false;

  function render(): void {
    if (disposed) return;
    container.innerHTML = '';
    container.appendChild(renderState(state, dispatch));
  }

  function dispatch(action: Action): void {
    if (disposed) return;
    handleAction(action, deps, args.userDisplayName ?? 'Tenzro Wallet')
      .then((next) => {
        state = next;
        render();
        if (next.kind === 'success') resolveResult(next.result);
      })
      .catch((err) => {
        state = { kind: 'error', message: errorMessage(err) };
        render();
      });
  }

  render();

  return {
    result,
    dispose: () => {
      disposed = true;
      container.innerHTML = '';
      rejectResult(new Error('onboarding mount disposed'));
    },
  };
}

/* ──────────────────────────── state machine ──────────────────────────── */

type Action =
  | { readonly type: 'choose-new' }
  | { readonly type: 'choose-recover' }
  | {
      readonly type: 'submit-recover';
      readonly did: string;
      readonly proof: RecoveryProof;
    }
  | { readonly type: 'reset' };

async function handleAction(
  action: Action,
  deps: OnboardingDeps,
  userDisplayName: string,
): Promise<UiState> {
  // userDisplayName isn't yet plumbed into the orchestrator (the kernel
  // currently sources it from `provisioning.start`); reserved for the
  // next iteration when the WebAuthn `create()` call wants a UX label.
  void userDisplayName;
  switch (action.type) {
    case 'choose-new': {
      const ran = await walletNew({
        provisioning: deps.provisioning,
        enroller: deps.enroller,
        kind: 'human',
      });
      return {
        kind: 'success',
        result: { mode: 'new', result: ran },
      };
    }
    case 'choose-recover':
      return { kind: 'recover-params' };
    case 'submit-recover': {
      const ran = await walletRecover({
        did: asTdipDid(action.did),
        recovery: deps.recovery,
        enroller: deps.enroller,
        proof: action.proof,
      });
      return {
        kind: 'success',
        result: { mode: 'recover', result: ran },
      };
    }
    case 'reset':
      return { kind: 'choose' };
  }
}

/* ──────────────────────────── renderer ──────────────────────────── */

function renderState(state: UiState, dispatch: (a: Action) => void): HTMLElement {
  const root = el('div', { class: 'tenzro-onboarding' });

  switch (state.kind) {
    case 'choose': {
      root.append(
        h2('Set up your Tenzro Wallet'),
        p('Pick how you want to start. Both paths are passkey-bound; ' + 'no seed phrases.'),
        button('Create new wallet', () => dispatch({ type: 'choose-new' })),
        button('Recover existing wallet', () => dispatch({ type: 'choose-recover' })),
      );
      break;
    }
    case 'recover-params': {
      root.append(
        h2('Recover your wallet'),
        p(
          'Pick a recovery proof. The node-side recovery flow accepts ' +
            'email-OTP, social-delegate signatures, or a Tenzro ID KYC token.',
        ),
        button('Email OTP', () => {
          const did = prompt('Wallet DID (did:tenzro:…)')?.trim() ?? '';
          const otp = prompt('OTP')?.trim() ?? '';
          dispatch({
            type: 'submit-recover',
            did,
            proof: { kind: 'email-otp', otp },
          });
        }),
        button('Tenzro ID KYC', () => {
          const did = prompt('Wallet DID (did:tenzro:…)')?.trim() ?? '';
          const proofToken = prompt('KYC proof token')?.trim() ?? '';
          dispatch({
            type: 'submit-recover',
            did,
            proof: { kind: 'tenzro-id-kyc', proofToken },
          });
        }),
        button('Cancel', () => dispatch({ type: 'reset' })),
      );
      break;
    }
    case 'in-progress': {
      root.append(h2('Working…'), p(state.label));
      break;
    }
    case 'success': {
      root.append(
        h2('Wallet ready'),
        p(`Mode: ${state.result.mode}`),
        p(`DID: ${state.result.result.identity.did}`),
      );
      break;
    }
    case 'error': {
      root.append(
        h2('Something went wrong'),
        p(state.message),
        button('Try again', () => dispatch({ type: 'reset' })),
      );
      break;
    }
  }
  return root;
}

/* ──────────────────────────── DOM helpers ──────────────────────────── */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function h2(text: string): HTMLHeadingElement {
  return el('h2', {}, text);
}
function p(text: string): HTMLParagraphElement {
  return el('p', {}, text);
}
function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button' }, text);
  b.addEventListener('click', onClick);
  return b;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
