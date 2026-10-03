// Fake Apps Script services so backend modules run unmodified under Node.

/** Minimal LockService: no-ops, but records whether the lock was requested. */
export function createLock() {
  return {
    _held: false,
    tryLock(ms) { this._held = true; return true; },
    releaseLock() { this._held = false; },
    hasLock() { return this._held; },
  };
}

/** Minimal PropertiesService backed by a plain object. */
export function createProps(init = {}) {
  const store = { ...init };
  return {
    _store: store,
    getProperty(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setProperty(k, v) { store[k] = String(v); },
    deleteProperty(k) { delete store[k]; },
    getProperties() { return { ...store }; },
  };
}

/**
 * A LockService-shaped object.
 * Accepts either a bare lock or an object that already has getScriptLock().
 */
export function createLockService(lock = createLock()) {
  if (lock && typeof lock.getScriptLock === 'function') return lock;
  return { getScriptLock: () => lock, getUserLock: () => lock };
}

/**
 * Install fake globals onto globalThis for one test.
 * Returns a restore() function.
 */
export function installGlobals({
  lockService = createLockService(),
  props = createProps(),
  ss = {},
} = {}) {
  const saved = {};
  const define = (key, value) => {
    saved[key] = globalThis[key];
    globalThis[key] = value;
  };

  // `lockService` must already be a LockService-shaped object, i.e. it has
  // getScriptLock(). If a bare lock is passed, wrap it.
  const ls = (lockService && typeof lockService.getScriptLock === 'function')
    ? lockService
    : createLockService(lockService);

  define('SpreadsheetApp', {
    getActiveSpreadsheet: () => ss,
    openById: () => ss,
    flush: () => {},
  });
  define('LockService', ls);
  define('PropertiesService', { getScriptProperties: () => props });
  define('Utilities', {
    formatDate: (d) => (d instanceof Date ? d.toISOString() : String(d)),
    getUuid: () => 'test-uuid-0000',
  });

  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  };
}