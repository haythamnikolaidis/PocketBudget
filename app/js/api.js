// app/js/api.js
// The ONLY module that calls fetch().
//
// TRANSPORT (see IMPLEMENTATION_PLAN.md §0 and Google issue #554057761):
// Apps Script's /exec endpoint 302-redirects to script.googleusercontent.com.
// Sending Content-Type: application/json triggers a CORS preflight that Apps
// Script cannot answer (there is no doOptions), so the request fails with 405.
//
// Using `text/plain;charset=utf-8` keeps the request CORS-safelisted, so NO
// preflight is sent. The body is still JSON; we parse it ourselves.
//
// DO NOT change this header to application/json. Smoke test step 3 asserts that
// no OPTIONS request ever appears in the network tab — that assertion is the
// guard rail for this whole file.

export class ApiError extends Error {
  constructor(code, message, context = {}) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code || 'UNKNOWN';
    this.context = context;
  }
}

/**
 * CORS-safelisted content type. Not a typo, not legacy — see the header comment.
 */
const SAFE_HEADERS = { 'Content-Type': 'text/plain;charset=utf-8' };

/**
 * How long one request may take before it is abandoned. Apps Script cold starts
 * cost seconds and the server may wait up to 20s for its lock, so this is
 * generous — but a request must not hang forever, or the form never frees up.
 * A timeout does NOT mean the server did nothing; that is what createTransaction's
 * requestId is for.
 */
export const REQUEST_TIMEOUT_MS = 30000;

/**
 * Build a GET URL with query params.
 * GET is CORS-safelisted, so reads need no preflight and are unaffected by §0.
 */
function getUrl(endpoint, action, params = {}) {
  const url = new URL(endpoint);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/** Read a Response as JSON, converting a parse failure into an ApiError. */
async function parseJson(res) {
  try {
    return await res.json();
  } catch (_) {
    throw new ApiError('BAD_JSON', 'The server returned a non-JSON response.');
  }
}

/** Throw on a non-2xx status. */
function checkStatus(res) {
  if (!res.ok) {
    throw new ApiError('HTTP_' + res.status, 'Server returned HTTP ' + res.status);
  }
  return res;
}

/**
 * POST JSON using the text/plain workaround.
 *
 * `redirect: 'follow'` is the fetch default and is what handles Apps Script's
 * 302 to script.googleusercontent.com; it is stated explicitly so nobody
 * removes it.
 *
 * `fetchImpl` is threaded through rather than using the global `fetch`, so tests
 * can substitute a double. An earlier draft called the global directly, which
 * made the POST tests hit the real network.
 */
async function postJson(fetchImpl, endpoint, action, params = {}, signal) {
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: SAFE_HEADERS,
    redirect: 'follow',
    body: JSON.stringify({ action, ...params }),
    signal,
  });
  return parseJson(checkStatus(res));
}

/** Unwrap the { ok } envelope, converting a failure envelope into a thrown ApiError. */
function unwrap(json) {
  if (!json) throw new ApiError('EMPTY_RESPONSE', 'The server returned nothing.');
  if (json.ok) return json;
  throw new ApiError(json.error, json.message, json.context);
}

/**
 * Serialise non-ApiError failures into something the UI can show.
 * A bare `TypeError: Failed to fetch` is the classic Apps Script transport
 * failure and means nothing to a user, so it becomes a readable NETWORK error.
 */
function describe(err) {
  if (err instanceof ApiError) return err;
  if (err && err.name === 'AbortError') {
    return new ApiError('TIMEOUT', 'The server took too long to respond.');
  }
  if (err && err.name === 'TypeError') {
    return new ApiError('NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  return new ApiError('UNEXPECTED', (err && err.message) || String(err));
}

/**
 * The API client. One instance per app; pass `config` from config.js.
 */
export function makeApi(config, { fetchImpl = fetch } = {}) {
  const call = async (method, action, params = {}) => {
    // One timer covers the whole exchange, body included.
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS) : null;
    const signal = ctl ? ctl.signal : undefined;
    try {
      if (!config.isConfigured()) {
        throw new ApiError('NOT_CONFIGURED', 'Set up PocketBudget first.');
      }
      const token = config.getToken();
      const endpoint = config.getEndpoint();

      const json = method === 'GET'
        ? await fetchImpl(getUrl(endpoint, action, { ...params, token }),
                          { method: 'GET', redirect: 'follow', signal })
            .then(checkStatus)
            .then(parseJson)
        : await postJson(fetchImpl, endpoint, action, { ...params, token }, signal);

      return unwrap(json);
    } catch (err) {
      throw describe(err);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  };

  return {
    /** Liveness + version. The setup screen uses this to validate a config. */
    ping: () => call('GET', 'ping'),
    /** Everything the home screen needs, in one request. */
    getState: (month) => call('GET', 'getState', month ? { month } : {}),
    createPocket: (p) => call('POST', 'createPocket', p),
    updatePocket: (p) => call('POST', 'updatePocket', p),
    createTransaction: (t) => call('POST', 'createTransaction', t),
    deleteTransaction: (txnId) => call('POST', 'deleteTransaction', { txnId }),
  };
}