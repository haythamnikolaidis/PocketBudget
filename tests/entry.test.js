// tests/entry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest } from '../backend/07_Entry.gs.js';

test('GET request: action and params come from the query string', () => {
  const r = parseRequest({ parameter: { action: 'getState', token: 't' } }, 'GET');
  assert.equal(r.action, 'getState');
  assert.equal(r.params.token, 't');
});

test('POST request: a text/plain JSON body is parsed into action + params', () => {
  const r = parseRequest({
    parameter: {},
    postData: { contents: JSON.stringify({ action: 'createTransaction', token: 't', amount: 5 }) },
  }, 'POST');
  assert.equal(r.action, 'createTransaction');
  assert.equal(r.params.amount, 5);
});

test('POST request: an empty body defaults to getState', () => {
  const r = parseRequest({ parameter: {}, postData: { contents: '' } }, 'POST');
  assert.equal(r.action, 'getState');
});

test('POST request: malformed JSON is reported, not thrown', () => {
  const r = parseRequest({ parameter: {}, postData: { contents: '{not json' } }, 'POST');
  assert.equal(r.action, null);
  assert.equal(r.parseError, true);
});

test('parseRequest never throws on a missing event object', () => {
  assert.doesNotThrow(() => parseRequest({}, 'GET'));
});
