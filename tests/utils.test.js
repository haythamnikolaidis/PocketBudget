import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toCents, toDollars, parseAmountInput, isValidUser, isValidPocketId,
  nextPocketId, nextTransactionId, ok, fail, money, normaliseAmountText, balanceAfterLimitChange,
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
  const r = fail('INSUFFICIENT_FUNDS', 'Insufficient funds in Groceries. Remaining: R340.50',
                 { pocketId: 'P01', remaining: 340.5 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'INSUFFICIENT_FUNDS');
  assert.match(r.message, /Remaining/);
  assert.equal(r.context.remaining, 340.5);
});

test('money() formats cents as R1,234.56', () => {
  assert.equal(money(6520), 'R65.20');
  assert.equal(money(10), 'R0.10');
  assert.equal(money(123456), 'R1,234.56');
  assert.equal(money(0), 'R0.00');
});


/* -------------------------------------------------------------- rand input -- */

test('amounts accept a leading R and space thousands (South African formats)', () => {
  assert.equal(parseAmountInput('R12.50'), 1250);
  assert.equal(parseAmountInput('r 12.50'), 1250);
  assert.equal(parseAmountInput('R1 234.56'), 123456);
  assert.equal(parseAmountInput('1\u00a0234,56'), 123456);   // no-break space + decimal comma
});

test('a decimal comma is a decimal, not a thousands separator (R12,50 is twelve rand fifty)', () => {
  assert.equal(parseAmountInput('12,50'), 1250, 'was 125000 when commas were just deleted');
  assert.equal(parseAmountInput('0,5'), 50);
  assert.equal(parseAmountInput('1234,56'), 123456);
  assert.equal(toCents('12,50'), 1250);
});

test('a comma before exactly three digits is still a thousands separator', () => {
  assert.equal(parseAmountInput('1,234'), 123400);
  assert.equal(parseAmountInput('1,234.56'), 123456);
  assert.equal(parseAmountInput('12,345'), 1234500);
});

test('ambiguous or malformed amounts are still rejected', () => {
  assert.throws(() => parseAmountInput('1R2'), /Not a number/);
  assert.throws(() => parseAmountInput('1.234,56'), /decimal places/, 'European format is not guessed at');
  assert.throws(() => parseAmountInput('R'), /Not a number/);
  assert.equal(normaliseAmountText('R 1 000,5'), '1000.5');
});

test('money() and the too-large message use rand, never dollars', () => {
  assert.equal(money(123456), 'R1,234.56');
  assert.equal(money(-500), '-R5.00');
  assert.throws(() => parseAmountInput('1000000.01'), /max R1,000,000/);
});


test('balanceAfterLimitChange: the balance moves with the limit, within 0..newLimit', () => {
  assert.equal(balanceAfterLimitChange(500, 800, 1000), 700);
  assert.equal(balanceAfterLimitChange(500, 800, 600), 300);
  assert.equal(balanceAfterLimitChange(100, 800, 600), 0, 'floors at zero');
  assert.equal(balanceAfterLimitChange(0, 800, 1000), 200, 'a depleted pocket gets the extra');
  assert.equal(balanceAfterLimitChange(800, 800, 1000), 1000, 'an untouched pocket tracks its limit');
  assert.equal(balanceAfterLimitChange(0.1, 0.3, 0.6), 0.4, 'no float drift');
});

test('JS number syntax is not an amount: 1e3, 0x10, 0b1, Infinity and +5 are all rejected', () => {
  for (const bad of ['1e3', '1E3', '0x10', '0b101', '0o7', 'Infinity', '+5', '5e-1', '1_000', '--5', '5-', '1.2.3', '.', '']) {
    assert.throws(() => parseAmountInput(bad), /Not a number/, bad);
    assert.throws(() => toCents(bad), /Not a number/, bad);
  }
});

test('ordinary amounts are unaffected by the stricter parsing', () => {
  assert.equal(parseAmountInput('12'), 1200);
  assert.equal(parseAmountInput('12.'), 1200);
  assert.equal(parseAmountInput('.5'), 50);
  assert.equal(parseAmountInput('0.07'), 7);
  assert.equal(parseAmountInput(65.2), 6520);
  assert.throws(() => parseAmountInput('-5'), /positive/, 'a negative still gets its own message');
});
