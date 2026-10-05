/**
 * Onboarding UI: create a wallet from a passkey, or sign in with one.
 *
 * A framework-free mount-point an embedder can drop into a page (extension
 * popup, web app, dev panel). The kernel's `PasskeyCustody` does the work;
 * this module presents the choice, shows progress and errors, and nudges the
 * user to link a second device, because a wallet with one passkey is one
 * lost device away from being unrecoverable.
 */

import { type PasskeyAccount, type PasskeyCustody, PasskeyError } from 'tenzro-wallet';

export interface OnboardingResult {
  readonly mode: 'created' | 'signed-in';
  readonly account: PasskeyAccount;
}

type UiState =
  | { readonly kind: 'choose' }
  | { readonly kind: 'in-progress'; readonly label: string }
  | { readonly kind: 'success'; readonly result: OnboardingResult }
  | { readonly kind: 'error'; readonly message: string };

export interface OnboardingMount {
  readonly dispose: () => void;
  readonly result: Promise<OnboardingResult>;
}

type Action =
  | { readonly type: 'create'; readonly name: string }
  | { readonly type: 'sign-in' }
  | { readonly type: 'reset' };

export function mountOnboarding(args: {
  readonly container: HTMLElement;
  readonly custody: PasskeyCustody;
}): OnboardingMount {
  const { container, custody } = args;
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
    if (action.type === 'reset') {
      state = { kind: 'choose' };
      render();
      return;
    }
    state = {
      kind: 'in-progress',
      label:
        action.type === 'create'
          ? 'Follow your device prompt to create a passkey.'
          : 'Choose a passkey on this device or on your phone.',
    };
    render();
    run(action, custody)
      .then((r) => {
        state = { kind: 'success', result: r };
        render();
        resolveResult(r);
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

async function run(action: Action, custody: PasskeyCustody): Promise<OnboardingResult> {
  if (action.type === 'create') {
    return { mode: 'created', account: await custody.createWallet({ displayName: action.name }) };
  }
  return { mode: 'signed-in', account: await custody.signIn() };
}

function renderState(state: UiState, dispatch: (a: Action) => void): HTMLElement {
  const root = el('div', { class: 'tenzro-onboarding' });
  switch (state.kind) {
    case 'choose': {
      const name = el('input', {
        type: 'text',
        placeholder: 'Your name',
        autocomplete: 'username webauthn',
      });
      root.append(
        h2('Set up your Tenzro wallet'),
        p('Your wallet is secured by a passkey on your device. There is nothing to write down.'),
        name,
        button('Create wallet', () =>
          dispatch({ type: 'create', name: name.value.trim() || 'Tenzro wallet' }),
        ),
        button('Sign in with a passkey', () => dispatch({ type: 'sign-in' })),
      );
      break;
    }
    case 'in-progress':
      root.append(h2('Waiting for your passkey'), p(state.label));
      break;
    case 'success':
      root.append(
        h2(state.result.mode === 'created' ? 'Wallet ready' : 'Signed in'),
        p(`Identity: ${state.result.account.did}`),
        p(`Account: ${state.result.account.account}`),
        p('Next: link a second device so you can recover if you lose this one.'),
      );
      break;
    case 'error':
      root.append(
        h2('Something went wrong'),
        p(state.message),
        button('Try again', () => dispatch({ type: 'reset' })),
      );
      break;
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
  if (err instanceof PasskeyError || err instanceof Error) return err.message;
  return String(err);
}
