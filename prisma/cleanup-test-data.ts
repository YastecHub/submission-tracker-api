import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_TRANSACTION_IDS = [
  'ee8aa4ed-8279-4910-b2af-90179ccaedab', // tEST — 251106024 ₦1,000
  'b5b3eccf-a745-43a5-bb0b-7a9eb2e27dc0', // tEST — 251106026 ₦1,000
];

const TEST_RECEIPT_IDS = [
  'c313b62a-a5d0-4820-90d3-9b186ed6c2e3', // receipt for 251106024
  '45f68572-d71f-4424-b353-51a88b16f9b1', // receipt for 251106026
];

async function main(): Promise<void> {
  // 1. Delete the test transactions (hard delete since they're test data)
  const txResult = await prisma.transaction.deleteMany({
    where: { id: { in: TEST_TRANSACTION_IDS } },
  });
  console.log(`Deleted ${txResult.count} test transactions.`);

  // 2. Delete the test receipts
  const rcResult = await prisma.paymentReceipt.deleteMany({
    where: { id: { in: TEST_RECEIPT_IDS } },
  });
  console.log(`Deleted ${rcResult.count} test receipts.`);

  // 3. Also delete the "tEST" payment event if it exists
  const testEvents = await prisma.paymentEvent.findMany({
    where: { title: { equals: 'tEST', mode: 'insensitive' } },
    select: { id: true, title: true },
  });

  if (testEvents.length > 0) {
    for (const evt of testEvents) {
      // Delete any remaining receipts + transactions for this event first
      const eventReceipts = await prisma.paymentReceipt.findMany({
        where: { eventId: evt.id },
        select: { id: true },
      });
      if (eventReceipts.length > 0) {
        await prisma.transaction.deleteMany({
          where: { receiptId: { in: eventReceipts.map((r) => r.id) } },
        });
        await prisma.paymentReceipt.deleteMany({
          where: { eventId: evt.id },
        });
      }
      await prisma.paymentEvent.delete({ where: { id: evt.id } });
      console.log(`Deleted test event: "${evt.title}" (${evt.id})`);
    }
  } else {
    console.log('No "tEST" payment event found.');
  }

  // Verify final balance
  const credits = await prisma.transaction.aggregate({
    _sum: { amount: true },
    where: { type: 'credit', isDeleted: false },
  });
  const debits = await prisma.transaction.aggregate({
    _sum: { amount: true },
    where: { type: 'debit', isDeleted: false },
  });
  const balance = (credits._sum.amount ?? 0).toString();
  const debitTotal = (debits._sum.amount ?? 0).toString();
  console.log(`\nNew balance: ₦${balance} (credits) - ₦${debitTotal} (debits) = ₦${Number(balance) - Number(debitTotal)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
