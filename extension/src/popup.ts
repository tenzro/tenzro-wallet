import { createAccount } from '../../apps/web/lib/account';
import { rpId } from '../../apps/web/lib/config';
import { network } from '../../apps/web/lib/network';
import { RPC_URL, checkChain, loadStored, rpcCall, saveStored } from './shared';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function say(text: string) {
  $('message').textContent = text;
}

async function render() {
  const net = $('network');
  try {
    await checkChain();
    net.dataset.state = 'ok';
    net.textContent = `Connected to ${new URL(RPC_URL).host}`;
  } catch (e) {
    net.dataset.state = 'bad';
    net.textContent = e instanceof Error ? e.message : String(e);
  }
  const stored = await loadStored();
  $('account').hidden = !stored;
  $('signed-out').hidden = !!stored;
  if (stored) {
    $('address').textContent = stored.account;
    try {
      const hex = await rpcCall<string>('eth_getBalance', [stored.account, 'latest']);
      $('balance').textContent = `${Number(BigInt(hex) / 10n ** 14n) / 1e4} TNZO`;
    } catch {
      $('balance').textContent = 'unavailable';
    }
  }
}

$('open-wallet').addEventListener('click', () =>
  chrome.runtime.sendMessage({ type: 'open-wallet' }),
);

// The passkey is created and used here, with this extension's origin. The
// chain verifies a passkey's WebAuthn origin against its relying party (an
// https page on that domain), so an account made this way cannot be proven
// on the network yet; the wallet provider's page signs instead.
$('use-here').addEventListener('click', async () => {
  say('');
  try {
    const net = await network();
    const w = await createAccount(net.rpc, net.second, {
      rpId: rpId(),
      rpName: 'Tenzro Wallet (extension)',
      name: 'Extension',
      deviceLabel: 'Browser extension',
    });
    await saveStored({ account: w.account, did: w.did });
    await render();
  } catch (e) {
    say(e instanceof Error ? e.message : String(e));
  }
});

void render();
