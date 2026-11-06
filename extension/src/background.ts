/**
 * The service worker. It holds nothing in memory: MV3 shuts it down when idle,
 * so everything it needs is read from chrome.storage on each event.
 */
import { WALLET_ORIGIN, saveStored } from './shared';

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === 'open-wallet') {
    chrome.tabs.create({ url: WALLET_ORIGIN }).then(() => reply({ ok: true }));
    return true;
  }
  if (message?.type === 'remember' && typeof message.account === 'string') {
    saveStored({ account: message.account, did: String(message.did ?? '') }).then(() =>
      reply({ ok: true }),
    );
    return true;
  }
  if (message?.type === 'forget') {
    saveStored(null).then(() => reply({ ok: true }));
    return true;
  }
  return false;
});
