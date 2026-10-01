// backend/02_Auth.gs.js
// CANONICAL SOURCE.
//
// Shared-secret household token. Deliberately not Google OAuth in v1 — see
// PRODUCT_BRIEF.md §5 decision 1. The upgrade path to verified Google ID tokens
// is documented in IMPLEMENTATION_PLAN.md §9.

/** Script Properties key holding the household token. */
export const TOKEN_PROPERTY = 'API_TOKEN';

/** Read the configured token, or '' when unset. */
export function getApiToken() {
  const v = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY);
  return v == null ? '' : String(v);
}

/** Persist the household token. Run this once from `setup()` (Task 26). */
export function setApiToken(token) {
  PropertiesService.getScriptProperties().setProperty(TOKEN_PROPERTY, String(token));
}

/**
 * Constant-time-ish comparison of a presented token against the stored one.
 * Fails closed: an unconfigured token rejects every request.
 */
export function verifyToken(presented) {
  const expected = getApiToken();
  if (!expected) return false;
  if (typeof presented !== 'string' || presented.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return diff === 0;
}
