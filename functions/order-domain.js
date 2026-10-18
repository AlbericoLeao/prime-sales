function toCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError('Preço deve ser um número finito e não negativo.');
  }
  const cents = Math.round((amount + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) throw new RangeError('Preço excede o limite seguro.');
  return cents;
}

function positiveQuantity(value) {
  const qty = Number(value);
  if (!Number.isSafeInteger(qty) || qty <= 0 || qty > 100000) {
    throw new RangeError('Quantidade deve ser um inteiro positivo até 100000.');
  }
  return qty;
}

function lineTotalCents(unitPrice, quantity) {
  const total = toCents(unitPrice) * positiveQuantity(quantity);
  if (!Number.isSafeInteger(total)) throw new RangeError('Subtotal excede o limite seguro.');
  return total;
}

module.exports = { toCents, positiveQuantity, lineTotalCents };
