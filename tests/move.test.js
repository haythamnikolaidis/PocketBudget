import test from 'node:test';
import assert from 'node:assert/strict';
import { activePockets, moveProblem, movePreview, quickAmounts } from '../app/js/move.js';

const state = {
  pockets: [
    { id: 'P1', name: 'Groceries', balance: 150 },
    { id: 'P2', name: 'Fun', balance: 0.1 },
    { id: 'P3', name: 'Old', balance: 50, status: 'Archived' },
  ],
};

test('activePockets drops archived pockets and keeps order', () => {
  assert.deepEqual(activePockets(state).map((p) => p.id), ['P1', 'P2']);
  assert.deepEqual(activePockets(null), []);
});

test('moveProblem: same or missing pocket', () => {
  assert.equal(moveProblem(state, 'P1', 'P1', '10'), 'Choose two different pockets.');
  assert.equal(moveProblem(state, 'P1', '', '10'), 'Choose two different pockets.');
  assert.equal(moveProblem(state, 'P1', 'P3', '10'), 'Choose two different pockets.');
});

test('moveProblem: amount must be greater than zero', () => {
  for (const text of ['', '0', 'abc', '-5']) {
    assert.equal(moveProblem(state, 'P1', 'P2', text), 'Enter an amount greater than zero.');
  }
});

test('moveProblem: not more than the source holds', () => {
  assert.equal(moveProblem(state, 'P1', 'P2', '150.01'), 'Only R150.00 left in Groceries.');
  assert.equal(moveProblem(state, 'P1', 'P2', '150'), null);
});

test('movePreview works in cents', () => {
  const s = { pockets: [{ id: 'A', name: 'A', balance: 0.1 }, { id: 'B', name: 'B', balance: 0.2 }] };
  const p = movePreview(s, 'A', 'B', '0.10');
  assert.deepEqual(p, {
    from: { name: 'A', before: 0.1, after: 0 },
    to: { name: 'B', before: 0.2, after: 0.3 },
  });
  assert.equal(movePreview(s, 'A', 'B', '0'), null);
  assert.equal(movePreview(s, 'A', 'A', '1'), null);
});

test('quickAmounts', () => {
  assert.deepEqual(quickAmounts(150), [100, { all: 150 }]);
  assert.deepEqual(quickAmounts(0), []);
  assert.deepEqual(quickAmounts(500), [100, 200, 300, { all: 500 }]);
});
