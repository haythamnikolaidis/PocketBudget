// app/js/config.js
// Endpoint + household token. No build step; plain ES modules.

const K_ENDPOINT = 'pb.endpoint';
const K_TOKEN = 'pb.token';

const DEFAULT_STORAGE = {
  getItem: (k) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(k)),
  setItem: (k, v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); },
};

/** Validate and normalise a web-app URL. */
export function resolveEndpoint(raw) {
  const s = String(raw ?? '').trim();
  if (!s) throw new Error('Endpoint is empty.');
  let url;
  try {
    url = new URL(s);
  } catch (_) {
    throw new Error('Endpoint must be a valid https URL.');
  }
  if (url.protocol !== 'https:') throw new Error('Endpoint must be an https URL.');
  if (!/\/exec$/.test(url.pathname)) throw new Error('Endpoint must end with /exec.');
  return s;
}

/**
 * Configuration holder.
 * Pass a `store` (localStorage-like) to make it testable outside a browser.
 */
export function makeConfig({ store = DEFAULT_STORAGE } = {}) {
  let endpoint = store.getItem(K_ENDPOINT) || '';
  let token = store.getItem(K_TOKEN) || '';

  return {
    configure(rawEndpoint, rawToken) {
      endpoint = resolveEndpoint(rawEndpoint);
      token = String(rawToken ?? '').trim();
      if (!token) throw new Error('A household token is required.');
      store.setItem(K_ENDPOINT, endpoint);
      store.setItem(K_TOKEN, token);
      return this;
    },
    getEndpoint: () => endpoint,
    getToken: () => token,
    isConfigured: () => Boolean(endpoint && token),
    clear() {
      endpoint = ''; token = '';
      store.setItem(K_ENDPOINT, '');
      store.setItem(K_TOKEN, '');
    },
  };
}

export const config = makeConfig();