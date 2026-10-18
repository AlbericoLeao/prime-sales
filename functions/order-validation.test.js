const test = require('node:test');
const assert = require('node:assert/strict');
const { toCents, positiveQuantity, lineTotalCents } = require('./order-domain');

test('server price conversion rounds to integer cents', () => {
  assert.equal(toCents(12.345), 1235);
  assert.equal(toCents('19.90'), 1990);
});

test('server price conversion rejects negative, non-finite and unsafe prices', () => {
  assert.throws(() => toCents(-1), RangeError);
  assert.throws(() => toCents('NaN'), RangeError);
  assert.throws(() => toCents(Number.MAX_VALUE), RangeError);
});

test('server quantities must be positive integers within the allowed limit', () => {
  assert.equal(positiveQuantity('3'), 3);
  assert.throws(() => positiveQuantity(0), RangeError);
  assert.throws(() => positiveQuantity(1.5), RangeError);
  assert.throws(() => positiveQuantity(100001), RangeError);
});

test('line totals use integer cents and avoid floating-point drift', () => {
  assert.equal(lineTotalCents(0.1, 3), 30);
  assert.equal(lineTotalCents(19.9, 4), 7960);
});
