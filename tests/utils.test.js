import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toCents, toDollars, parseAmountInput, isValidUser, isValidPocketId,
  nextPocketId, nextTransactionId, ok, fail, money,
} from '../backend/01_Utils.gs.js';
import { USERS } from '../backend/00_Config.gs.js';

test('toCents / toDollars round-trip without float drift', () => {
  assert.equal(toCents(65.2), 6520);
  assert.equal(toCents('65.20'), 6520);
  assert.equal(toCents('$1,234.56'), 123456);
  assert.equal(toDollars(6520), 65.2);
  assert.equal(toDollars(10), 0.1);      // the 0.1 + 0.2 trap
  assert.equal(toDollars(toCents('0.07')), 0.07);
});

test('toCents rejects non-numbers', () => {
  assert.throws(() => toCents('abc'), /Not a number/);
  assert.throws(() => toCents(''), /Not a number/);
  assert.throws(() => toCents(null), /Not a number/);
});

test('parseAmountInput accepts clean positive amounts', () => {
  assert.equal(parseAmountInput(65.2), 6520);
  assert.equal(parseAmountInput('12.34'), 1234);
  assert.equal(parseAmountInput('0.01'), 1);
});

test('parseAmountInput rejects negatives, junk and >2dp', () => {
  assert.throws(() => parseAmountInput(-5), /positive/);
  assert.throws(() => parseAmountInput('12.345'), /cents/);
  assert.throws(() => parseAmountInput('12.3456'), /cents/);
  assert.throws(() => parseAmountInput('abc'), /Not a number/);
});

test('parseAmountInput rejects absurd amounts', () => {
  assert.throws(() => parseAmountInput(1_000_001), /too large/);
  assert.equal(parseAmountInput(1_000_000), 100_000_000);
});

test('isValidUser accepts only configured users', () => {
  for (const u of USERS) assert.equal(isValidUser(u), true, u);
  assert.equal(isValidUser('Alexandra'), false);
  assert.equal(isValidUser(''), false);
  assert.equal(isValidUser(null), false);
});

test('isValidPocketId requires the P## shape', () => {
  assert.equal(isValidPocketId('P01'), true);
  assert.equal(isValidPocketId('P99'), true);
  assert.equal(isValidPocketId('p01'), false);
  assert.equal(isValidPocketId('P1'), false);
  assert.equal(isValidPocketId('X01'), false);
});

test('nextPocketId continues the sequence', () => {
  assert.equal(nextPocketId(['P01', 'P02']), 'P03');
  assert.equal(nextPocketId([]), 'P01');
  assert.equal(nextPocketId(['P01', 'P09']), 'P10');
});

test('nextTransactionId continues the sequence', () => {
  assert.equal(nextTransactionId(['T1001', 'T1002']), 'T1003');
  assert.equal(nextTransactionId([]), 'T1001');
  assert.equal(nextTransactionId(['T9999']), 'T10000');
});

test('nextTransactionId ignores malformed ids rather than crashing', () => {
  // 'header' and '' are not ids at all; the sequence still starts at T1001.
  assert.equal(nextTransactionId(['header', '', null]), 'T1001');
  assert.equal(nextTransactionId(['T1001', 'T1002', 'oops']), 'T1003');
});

test('ok() wraps a payload and stamps the version', () => {
  const r = ok({ pockets: [] });
  assert.equal(r.ok, true);
  assert.equal(r.version, '1.0.0');
  assert.deepEqual(r.pockets, []);
});

test('fail() never leaks the code into message, and carries context', () => {
  const r = fail('INSUFFICIENT_FUNDS', 'Insufficient funds in Groceries. Remaining: $340.50',
                 { pocketId: 'P01', remaining: 340.5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
  assert.match(r.message, /Remaining/);
  assert.equal(r.context.remaining, 340.5);
});

test('money() formats cents as $1,234.56', () => {
  assert.equal(money(6520), '$65.20');
  assert.equal(money(10), '$0.10');
  assert.equal(money(123456), '$1,234.56');
  assert.equal(money(0), '$0.00');
});
