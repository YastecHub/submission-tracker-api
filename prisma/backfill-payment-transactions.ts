import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Only transactions/receipts tied to this event will be kept/backfilled.
// Any receipt-linked transactions for OTHER events will be deleted (rollback of the earlier over-eager backfill run).
const TARGET_EVENT_ID = '7d4b6050-9681-4917-989c-82ae015b755e'; // Picnic & Class dues

async function main(): Promise<void> {
  const targetEvent = await prisma.paymentEvent.findUnique({ where: { id: TARGET_EVENT_ID } });
  if (!targetEvent) {
    console.error(`Target payment event ${TARGET_EVENT_ID} not found. Aborting.`);
    process.exit(1);
  }
  console.log(`Target event: "${targetEvent.title}" (${TARGET_EVENT_ID})\n`);

  // 1. Rollback: delete receipt-linked transactions whose receipt belongs to any OTHER event.
  const badTx = await prisma.transaction.findMany({
    where: {
      receiptId: { not: null },
      receipt: { eventId: { not: TARGET_EVENT_ID } },
    },
    include: { receipt: { include: { event: true } } },
  });

  if (badTx.length > 0) {
    console.log(`Rolling back ${badTx.length} wrongly-created ledger entries:`);
    for (const t of badTx) {
      console.log(`  - ${t.receipt!.matricNumber.padEnd(12)} ${t.receipt!.event.title} — ₦${t.amount}`);
    }
    await prisma.transaction.deleteMany({
      where: { id: { in: badTx.map((t) => t.id) } },
    });
    console.log(`Deleted ${badTx.length} rows.\n`);
  } else {
    console.log('No wrong entries to roll back.\n');
  }

  // 2. Backfill: create missing transactions for confirmed receipts in the target event only.
  const orphans = await prisma.paymentReceipt.findMany({
    where: {
      eventId: TARGET_EVENT_ID,
      status: 'confirmed',
      transaction: { is: null },
    },
    include: { event: true },
    orderBy: { confirmedAt: 'asc' },
  });

  if (orphans.length === 0) {
    console.log('No orphaned confirmed receipts for target event. Done.');
    return;
  }

  console.log(`Found ${orphans.length} confirmed receipt(s) in target event without a ledger entry.\n`);

  const users = await prisma.user.findMany({ select: { id: true, name: true, role: true } });
  const byName = new Map(users.map((u) => [u.name, u.id]));
  const fallback = users.find((u) => u.role === 'dev') ?? users[0];
  if (!fallback) {
    console.error('No users exist in the database. Aborting.');
    process.exit(1);
  }

  let created = 0;
  for (const receipt of orphans) {
    const recordedBy = (receipt.confirmedBy && byName.get(receipt.confirmedBy)) || fallback.id;
    await prisma.transaction.create({
      data: {
        type: 'credit',
        amount: receipt.event.amount,
        description: `Payment: ${receipt.event.title} — ${receipt.matricNumber}`,
        category: 'Dues',
        occurredAt: receipt.confirmedAt ?? receipt.submittedAt,
        recordedBy,
        receiptId: receipt.id,
      },
    });
    created += 1;
    console.log(`  ✓ ${receipt.matricNumber.padEnd(12)} ${receipt.event.title} — ₦${receipt.event.amount}`);
  }

  console.log(`\nDone. Created ${created} ledger entries for "${targetEvent.title}".`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
