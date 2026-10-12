import assert from 'node:assert/strict';
import test from 'node:test';
import { SubmissionService } from '../src/modules/submissions/application/submissionService';
import { PaymentReceiptService } from '../src/modules/paymentReceipts/application/paymentReceiptService';

type Role = 'cr' | 'acr' | 'fin_sec' | 'dev';
const rep = (role: Role) => ({ id: `${role}-id`, email: `${role}@example.test`, name: role.toUpperCase(), role });
const ROLES: Role[] = ['cr', 'acr', 'fin_sec', 'dev'];

test('CR, ACR, Fin Sec and Dev can confirm submissions on events someone else created', async () => {
  for (const role of ROLES) {
    const confirmed: string[] = [];
    const service = new SubmissionService({
      findByIdWithEvent: async () => ({ id: 'sub-1', isConfirmed: false, event: { createdBy: 'another-rep' } }),
      confirm: async (id: string, by: string) => { confirmed.push(by); return { id, isConfirmed: true }; },
    } as never);
    await service.confirm('sub-1', rep(role));
    const scan = await service.scanConfirm('sub-1', rep(role));
    assert.equal(scan.alreadyConfirmed, false);
    assert.deepEqual(confirmed, [role.toUpperCase(), role.toUpperCase()]);
  }
});

test('CR, ACR, Fin Sec and Dev can review receipts on payment events someone else created', async () => {
  for (const role of ROLES) {
    const calls: string[] = [];
    const receipt = { id: 'r-1', ticketQrCode: 'qr', event: { createdBy: 'another-rep', hasTickets: false } };
    const service = new PaymentReceiptService({
      findWithEventAndTransaction: async () => receipt,
      confirm: async () => { calls.push('confirm'); return receipt; },
      reject: async () => { calls.push('reject'); return receipt; },
    } as never);
    await service.confirm('r-1', {}, rep(role));
    await service.reject('r-1', {}, rep(role));
    assert.deepEqual(calls, ['confirm', 'reject']);
  }
});

test('a token without a class role is still refused', async () => {
  const service = new SubmissionService({
    findByIdWithEvent: async () => ({ id: 'sub-1', isConfirmed: false, event: { createdBy: 'x' } }),
  } as never);
  await assert.rejects(service.confirm('sub-1', { ...rep('cr'), role: 'student' as never }), /not allowed/);
});
