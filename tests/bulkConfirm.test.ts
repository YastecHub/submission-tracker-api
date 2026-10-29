import test from 'node:test';
import assert from 'node:assert/strict';
import { PaymentReceiptService } from '../src/modules/paymentReceipts/application/paymentReceiptService';
import { SubmissionService } from '../src/modules/submissions/application/submissionService';
import { selectedIds } from '../src/shared/http/selection';

const rep = { id: 'u1', name: 'Yasir (CR)', email: 'cr@x.test', role: 'cr' as const };
const student = { id: 'u2', name: 'Someone', email: 's@x.test', role: 'electoral_committee' as const };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('selection: at least one, at most 200, unique and well-formed ids', () => {
  assert.throws(() => selectedIds([]), /at least one/);
  assert.throws(() => selectedIds('abc'), /at least one/);
  assert.throws(() => selectedIds(Array.from({ length: 201 }, (_, n) => id(n))), /at most 200/);
  assert.throws(() => selectedIds(['not-an-id']), /invalid id/);
  assert.deepEqual(selectedIds([id(1), id(1).toUpperCase(), id(2)]), [id(1), id(2)]);
});

test('payment receipts: confirm selected confirms only pending ones, each with its ledger entry', async () => {
  const receipts = new Map([
    [id(1), { id: id(1), status: 'pending', matricNumber: '251106026', ticketQrCode: null, event: { hasTickets: false, title: 'PCH manual', slug: 'pch' } }],
    [id(2), { id: id(2), status: 'pending', matricNumber: '251106027', ticketQrCode: null, event: { hasTickets: false, title: 'PCH manual', slug: 'pch' } }],
    [id(3), { id: id(3), status: 'confirmed', matricNumber: '251106028', ticketQrCode: null, event: { hasTickets: false, title: 'PCH manual', slug: 'pch' } }],
  ]);
  const ledger: string[] = [];
  const repo = {
    findWithEventAndTransaction: async (receiptId: string) => receipts.get(receiptId) ?? null,
    confirm: async (receiptId: string, input: { confirmedBy: string }) => {
      const receipt = receipts.get(receiptId)!;
      receipt.status = 'confirmed';
      ledger.push(`${receiptId}:${input.confirmedBy}`);
      return receipt;
    },
  };
  const service = new PaymentReceiptService(repo as any);
  const result = await service.confirmSelected({ ids: [id(1), id(2), id(3), id(9)] }, rep);
  assert.deepEqual(result, { confirmed: 2, skipped: 2, failed: 0 });
  assert.deepEqual(ledger, [`${id(1)}:Yasir (CR)`, `${id(2)}:Yasir (CR)`]);
  await assert.rejects(service.confirmSelected({ ids: [id(1)] }, student), /not allowed/);
});

test('submissions: confirm selected confirms only the pending ones in the selection', async () => {
  let confirmedIds: string[] = [];
  const repo = {
    findPendingByIds: async (ids: string[]) => ids.filter((x) => x !== id(3)).map((x) => ({ id: x, matricNumber: '251106026', event: { courseCode: 'PCH 201', title: 'Lab report' } })),
    confirmMany: async (ids: string[], name: string) => { confirmedIds = ids; assert.equal(name, 'Yasir (CR)'); return { count: ids.length }; },
  };
  const service = new SubmissionService(repo as any);
  const result = await service.confirmSelected({ ids: [id(1), id(2), id(3)] }, rep);
  assert.deepEqual(result, { confirmed: 2, skipped: 1 });
  assert.deepEqual(confirmedIds, [id(1), id(2)]);
  await assert.rejects(service.confirmSelected({ ids: [] }, rep), /at least one/);
});
