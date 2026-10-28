import { Prisma } from '@prisma/client';

/**
 * Editing a payment while students are paying. Every detail can change; each receipt keeps
 * the price it was submitted against (PaymentReceipt.expectedAmount), so students who paid
 * the old price stay paid and the ledger credits what they actually paid.
 */
export interface EditablePaymentEvent {
  title: string;
  description: string | null;
  amount: Prisma.Decimal;
  bankName: string;
  accountName: string;
  accountNumber: string;
  deadline: Date;
  hasTickets: boolean;
}

export type PaymentEventUpdate = Partial<EditablePaymentEvent>;

export interface PaymentEventChanges {
  updates: PaymentEventUpdate;
  /** Plain sentences for the students' notification (price and account changes only). */
  announce: string[];
}

const LIMITS = { title: 150, accountNumber: 50, accountName: 100, bankName: 100 } as const;

export function naira(amount: Prisma.Decimal): string {
  return `₦${Number(amount.toFixed(2)).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

/** Parses "6500" or "6500.50"; null if it isn't a positive amount. */
export function parseAmount(raw: unknown): Prisma.Decimal | null {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim().replace(/,/g, '') : '';
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const amount = new Prisma.Decimal(text);
  return amount.gt(0) ? amount : null;
}

function text(value: unknown, field: keyof typeof LIMITS, label: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new Error(`${label} is required.`);
  if (trimmed.length > LIMITS[field]) throw new Error(`${label} is too long (${LIMITS[field]} characters max).`);
  return trimmed;
}

/** Works out what changed. Throws an Error with a readable message for invalid input. */
export function paymentEventChanges(current: EditablePaymentEvent, input: Record<string, unknown>, now: Date = new Date()): PaymentEventChanges {
  const updates: PaymentEventUpdate = {};
  const announce: string[] = [];

  if (input.title !== undefined) {
    const title = text(input.title, 'title', 'Title');
    if (title !== current.title) updates.title = title;
  }
  if (input.description !== undefined) {
    const description = typeof input.description === 'string' && input.description.trim() ? input.description.trim() : null;
    if (description !== current.description) updates.description = description;
  }
  if (input.amount !== undefined) {
    const amount = parseAmount(input.amount);
    if (!amount) throw new Error('Amount must be a positive number, e.g. 6500.');
    if (!amount.equals(current.amount)) {
      updates.amount = amount;
      announce.push(`The price is now ${naira(amount)} (was ${naira(current.amount)}). If you already paid, you don't need to do anything.`);
    }
  }
  const account: Array<[keyof typeof LIMITS & keyof EditablePaymentEvent, string]> = [['bankName', 'Bank'], ['accountName', 'Account name'], ['accountNumber', 'Account number']];
  let accountChanged = false;
  for (const [field, label] of account) {
    if (input[field] === undefined) continue;
    const value = text(input[field], field, label);
    if (value !== current[field]) {
      updates[field] = value;
      accountChanged = true;
    }
  }
  if (accountChanged) {
    const bank = updates.bankName ?? current.bankName;
    const number = updates.accountNumber ?? current.accountNumber;
    const name = updates.accountName ?? current.accountName;
    announce.push(`Pay to the new account: ${bank} ${number} (${name}).`);
  }
  if (input.deadline !== undefined) {
    const deadline = new Date(String(input.deadline));
    if (Number.isNaN(deadline.getTime())) throw new Error('The deadline is not a valid date.');
    if (deadline.getTime() !== current.deadline.getTime()) {
      if (deadline <= now) throw new Error('The deadline must be in the future.');
      updates.deadline = deadline;
    }
  }
  if (input.hasTickets !== undefined && !!input.hasTickets !== current.hasTickets) updates.hasTickets = !!input.hasTickets;

  return { updates, announce };
}
