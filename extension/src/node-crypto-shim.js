// The SDK imports node:crypto for server-side helpers (DPoP, hashing). The
// extension runs in a browser and uses WebCrypto; these helpers are not
// reachable from it, and calling one fails loudly.
const unavailable = (name) => () => {
  throw new Error(`node:crypto ${name} is not available in the browser`);
};
export const createHash = unavailable('createHash');
export const createHmac = unavailable('createHmac');
export const createPublicKey = unavailable('createPublicKey');
export const createPrivateKey = unavailable('createPrivateKey');
export const randomBytes = unavailable('randomBytes');
export const sign = unavailable('sign');
export const verify = unavailable('verify');
export const generateKeyPairSync = unavailable('generateKeyPairSync');
export const webcrypto = globalThis.crypto;
export default {
  createHash,
  createHmac,
  createPublicKey,
  createPrivateKey,
  randomBytes,
  sign,
  verify,
  generateKeyPairSync,
  webcrypto,
};
