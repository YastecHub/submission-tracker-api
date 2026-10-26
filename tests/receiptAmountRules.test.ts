import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { chargeAllowance, judgeAmount, pickBestAmount } from '../src/utils/receiptAmountRules';

const N = (value: number) => new Prisma.Decimal(value);

test('exact amount matches', () => {
  assert.equal(judgeAmount(N(2000), N(2000)).status, 'matched');
});

test('small bank charges on top are accepted (₦2,000 due, receipt shows ₦2,060)', () => {
  const verdict = judgeAmount(N(2060), N(2000));
  assert.equal(verdict.status, 'matched');
  assert.match(verdict.note, /₦2,060/);
  assert.match(verdict.note, /₦60/);
  assert.equal(judgeAmount(N(2010), N(2000)).status, 'matched');
  assert.equal(judgeAmount(N(10_100), N(10_000)).status, 'matched');
});

test('charges shown separately are taken off', () => {
  const verdict = judgeAmount(N(5075), N(5000), N(75));
  assert.equal(verdict.status, 'matched');
  assert.match(verdict.note, /₦75 bank charges/);
});

test('less than the amount due is flagged', () => {
  const verdict = judgeAmount(N(1500), N(2000));
  assert.equal(verdict.status, 'mismatch');
  assert.match(verdict.note, /₦500 less/);
  assert.equal(judgeAmount(N(1999), N(2000)).status, 'mismatch');
});

test('far more than the amount due is flagged (probably a balance)', () => {
  const verdict = judgeAmount(N(25_000), N(2000));
  assert.equal(verdict.status, 'mismatch');
  assert.match(verdict.note, /balance/);
});

test('allowance is ₦100 plus 1%, and can be configured', () => {
  assert.equal(chargeAllowance(N(2000)).toString(), '120');
  process.env.PAYMENT_CHARGE_ALLOWANCE = '50';
  assert.equal(chargeAllowance(N(2000)).toString(), '70');
  delete process.env.PAYMENT_CHARGE_ALLOWANCE;
});

test('OCR fallback picks the payment, not the biggest number (the balance)', () => {
  assert.equal(pickBestAmount([N(48_350), N(2060), N(60)], N(2000))?.toString(), '2060');
  assert.equal(pickBestAmount([N(48_350), N(2000), N(2060)], N(2000))?.toString(), '2000');
  assert.equal(pickBestAmount([N(48_350), N(1500)], N(2000))?.toString(), '1500');
  assert.equal(pickBestAmount([], N(2000)), null);
});
