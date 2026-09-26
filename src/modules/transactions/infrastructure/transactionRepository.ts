import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';

export type TransactionWithRelations = Prisma.TransactionGetPayload<{
  include: {
    recorder: { select: { name: true; role: true } };
    receipt: { include: { event: { select: { id: true; slug: true; title: true } } } };
  };
}>;

export class TransactionRepository {
  findPage(where: Prisma.TransactionWhereInput, skip: number, take: number) {
    return prisma.transaction.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
      include: { recorder: { select: { name: true, role: true } }, receipt: { include: { event: { select: { id: true, slug: true, title: true } } } } },
    });
  }

  aggregateCredits(where: Prisma.TransactionWhereInput) {
    return prisma.transaction.aggregate({ _sum: { amount: true }, where: { ...where, type: 'credit' } });
  }

  aggregateDebits(where: Prisma.TransactionWhereInput) {
    return prisma.transaction.aggregate({ _sum: { amount: true }, where: { ...where, type: 'debit' } });
  }

  count(where: Prisma.TransactionWhereInput) {
    return prisma.transaction.count({ where });
  }

  findSubmissionNameByMatric(matricNumber: string) {
    return prisma.submission.findFirst({ where: { matricNumber }, select: { fullName: true }, orderBy: { submittedAt: 'desc' } });
  }

  findReceiptNameByMatric(matricNumber: string) {
    return prisma.paymentReceipt.findFirst({ where: { matricNumber }, select: { fullName: true }, orderBy: { submittedAt: 'desc' } });
  }

  create(data: Prisma.TransactionUncheckedCreateInput) {
    return prisma.transaction.create({
      data,
      include: { recorder: { select: { name: true, role: true } }, receipt: { include: { event: { select: { id: true, slug: true, title: true } } } } },
    });
  }

  findById(id: string) {
    return prisma.transaction.findUnique({ where: { id } });
  }

  update(id: string, data: Prisma.TransactionUpdateInput) {
    return prisma.transaction.update({
      where: { id },
      data,
      include: { recorder: { select: { name: true, role: true } }, receipt: { include: { event: { select: { id: true, slug: true, title: true } } } } },
    });
  }

  softDelete(id: string) {
    return prisma.transaction.update({ where: { id }, data: { isDeleted: true } });
  }
}

export const transactionRepository = new TransactionRepository();
