const test = require('node:test');
const assert = require('node:assert/strict');

function cents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('invalid price');
  return Math.round((n + Number.EPSILON) * 100);
}

test('money conversion rounds decimal prices to cents', () => {
  assert.equal(cents(12.345), 1235);
  assert.equal(cents('19.90'), 1990);
});

test('money conversion rejects negative and non-finite prices', () => {
  assert.throws(() => cents(-1));
  assert.throws(() => cents('NaN'));
});

test('line totals use integer cents to avoid floating point drift', () => {
  assert.equal(cents(0.1) * 3, 30);
  assert.equal((cents(0.1) * 3) / 100, 0.3);
});
