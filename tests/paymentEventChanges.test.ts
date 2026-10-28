import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { paymentEventChanges, parseAmount } from '../src/modules/paymentEvents/domain/paymentEventChanges';
import { PaymentEventService } from '../src/modules/paymentEvents/application/paymentEventService';

const now = new Date('2026-10-28T20:00:00Z');
const current = () => ({
  id: 'e1', slug: 'pch-manual', title: 'PCH manual', description: null as string | null, amount: new Prisma.Decimal(6000),
  bankName: 'Moniepoint', accountName: 'Yasir Oyebo', accountNumber: '8143721063',
  deadline: new Date('2026-10-29T07:00:00Z'), hasTickets: false, isDeleted: false, isClosed: false,
});

test('amounts: plain or with commas, positive, up to 2 decimals', () => {
  assert.equal(parseAmount('6,500')?.toString(), '6500');
  assert.equal(parseAmount('6500.50')?.toString(), '6500.5');
  assert.equal(parseAmount(7000)?.toString(), '7000');
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount('6.505'), null);
});

test('a price change is saved and announced, telling students who paid that they are fine', () => {
  const { updates, announce } = paymentEventChanges(current(), { amount: '6500' }, now);
  assert.equal(updates.amount?.toString(), '6500');
  assert.equal(announce.length, 1);
  assert.match(announce[0], /The price is now ₦6,500 \(was ₦6,000\)\. If you already paid, you don't need to do anything\./);
});

test('account changes are announced once with the full new details', () => {
  const { updates, announce } = paymentEventChanges(current(), { bankName: 'Opay', accountNumber: '9012345678' }, now);
  assert.deepEqual(updates, { bankName: 'Opay', accountNumber: '9012345678' });
  assert.deepEqual(announce, ['Pay to the new account: Opay 9012345678 (Yasir Oyebo).']);
});

test('title, description, deadline and tickets change quietly; unchanged values are not saved', () => {
  const { updates, announce } = paymentEventChanges(current(), {
    title: 'PCH manual (2nd batch)', description: 'Collect at the lab', deadline: '2026-10-30T07:00:00Z', hasTickets: true, amount: '6000', bankName: 'Moniepoint',
  }, now);
  assert.deepEqual(Object.keys(updates).sort(), ['deadline', 'description', 'hasTickets', 'title']);
  assert.deepEqual(announce, []);
});

test('invalid edits are refused with a clear reason', () => {
  assert.throws(() => paymentEventChanges(current(), { amount: 'abc' }, now), /Amount must be a positive number/);
  assert.throws(() => paymentEventChanges(current(), { title: '  ' }, now), /Title is required/);
  assert.throws(() => paymentEventChanges(current(), { deadline: '2026-10-01T00:00:00Z' }, now), /must be in the future/);
  assert.throws(() => paymentEventChanges(current(), { accountNumber: 'x'.repeat(51) }, now), /too long/);
});

test('the service saves the edit and notifies students only for price or account changes', async () => {
  const event = current();
  const saved: unknown[] = [];
  const pushes: Array<{ title: string; body: string; url: string }> = [];
  const repo = {
    findManageableById: async () => event,
    update: async (_id: string, data: Record<string, unknown>) => { saved.push(data); Object.assign(event, data); return event; },
    confirmedReceiptsWithoutTickets: async () => [],
  };
  const service = new PaymentEventService(repo as any, { broadcastToStudents: async (message: any) => { pushes.push(message); return 1; } });
  await service.update('e1', { description: 'Bring your ID' });
  assert.equal(pushes.length, 0);
  await service.update('e1', { amount: '6500' });
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].title, 'Payment update: PCH manual');
  assert.equal(pushes[0].url, '/payment/pch-manual');
  await assert.rejects(service.update('e1', { amount: '0' }), /positive number/);
  assert.equal(saved.length, 2);
});
