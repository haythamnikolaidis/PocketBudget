// tests/auth.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyToken, getApiToken, setApiToken, TOKEN_PROPERTY } from '../backend/02_Auth.gs.js';
import { createProps } from './helpers/appsScriptGlobals.js';

test('getApiToken reads from script properties', () => {
  const props = createProps({ API_TOKEN: 'secret-token' });
  globalThis.PropertiesService = { getScriptProperties: () => props };
  assert.equal(getApiToken(), 'secret-token');
  delete globalThis.PropertiesService;
});

test('setApiToken round-trips', () => {
  const props = createProps({});
  globalThis.PropertiesService = { getScriptProperties: () => props };
  setApiToken('hunter2');
  assert.equal(props.getProperty(TOKEN_PROPERTY), 'hunter2');
  delete globalThis.PropertiesService;
});

test('verifyToken accepts the exact token', () => {
  const props = createProps({ API_TOKEN: 'secret-token' });
  globalThis.PropertiesService = { getScriptProperties: () => props };
  assert.equal(verifyToken('secret-token'), true);
  delete globalThis.PropertiesService;
});

test('verifyToken rejects wrong, empty and missing tokens', () => {
  const props = createProps({ API_TOKEN: 'secret-token' });
  globalThis.PropertiesService = { getScriptProperties: () => props };
  assert.equal(verifyToken('secret-tokenx'), false);
  assert.equal(verifyToken('secret-toke'), false);
  assert.equal(verifyToken(''), false);
  assert.equal(verifyToken(undefined), false);
  delete globalThis.PropertiesService;
});

test('verifyToken fails closed when no token is configured', () => {
  const props = createProps({});
  globalThis.PropertiesService = { getScriptProperties: () => props };
  assert.equal(verifyToken('anything'), false);
  delete globalThis.PropertiesService;
});

test('verifyToken rejects a token of different length without leaking', () => {
  const props = createProps({ API_TOKEN: 'abc' });
  globalThis.PropertiesService = { getScriptProperties: () => props };
  assert.equal(verifyToken('ab'), false);
  assert.equal(verifyToken('abcd'), false);
  assert.equal(verifyToken('abc'), true);
  delete globalThis.PropertiesService;
});

test('TOKEN_PROPERTY is API_TOKEN', () => {
  assert.equal(TOKEN_PROPERTY, 'API_TOKEN');
});
