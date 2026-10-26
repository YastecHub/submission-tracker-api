import { Prisma } from '@prisma/client';

/**
 * How a receipt amount is judged against the amount due.
 *
 * Banks often add transfer charges (e.g. ₦2,000 due shows as ₦2,010 or ₦2,060 debited), so a
 * receipt slightly above the amount due still counts as paid. Anything below is flagged, and
 * anything far above is flagged too, because the number read is then probably an account
 * balance or a different payment.
 */
export interface AmountVerdict {
  status: 'matched' | 'mismatch';
  note: string;
}

type Decimal = Prisma.Decimal;

function naira(value: Decimal): string {
  return `₦${Number(value.toFixed(2)).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

/** Charges allowed on top of the amount due: ₦100 (PAYMENT_CHARGE_ALLOWANCE) plus 1% of the amount. */
export function chargeAllowance(expected: Decimal): Decimal {
  const configured = Number(process.env.PAYMENT_CHARGE_ALLOWANCE);
  const flat = Number.isFinite(configured) && configured >= 0 ? configured : 100;
  return new Prisma.Decimal(flat).add(expected.mul(0.01)).toDecimalPlaces(2);
}

export function judgeAmount(paid: Decimal, expected: Decimal, fee: Decimal | null = null): AmountVerdict {
  const difference = paid.sub(expected);
  if (difference.isZero()) {
    return { status: 'matched', note: `The receipt shows ${naira(paid)}, the exact amount due.` };
  }
  if (fee && fee.gt(0) && paid.sub(fee).equals(expected)) {
    return { status: 'matched', note: `The receipt shows ${naira(paid)}: ${naira(expected)} plus ${naira(fee)} bank charges.` };
  }
  if (difference.isNegative()) {
    return { status: 'mismatch', note: `The receipt shows ${naira(paid)}, which is ${naira(difference.abs())} less than the ${naira(expected)} due.` };
  }
  if (difference.lte(chargeAllowance(expected))) {
    return { status: 'matched', note: `The receipt shows ${naira(paid)}: ${naira(expected)} plus ${naira(difference)}, most likely bank or transfer charges.` };
  }
  return {
    status: 'mismatch',
    note: `The receipt shows ${naira(paid)}, ${naira(difference)} more than the ${naira(expected)} due. Please check it: it may be an account balance or a different payment.`,
  };
}

/**
 * Picks the amount to judge from several read off a receipt (the OCR fallback finds many
 * numbers). Prefers the exact amount, then the smallest amount within the charge allowance,
 * then the closest one. Never simply the largest, which is usually the account balance.
 */
export function pickBestAmount(candidates: Decimal[], expected: Decimal): Decimal | null {
  if (!candidates.length) return null;
  const exact = candidates.find((candidate) => candidate.equals(expected));
  if (exact) return exact;
  const allowance = chargeAllowance(expected);
  const withCharges = candidates
    .filter((candidate) => candidate.gt(expected) && candidate.sub(expected).lte(allowance))
    .sort((a, b) => a.comparedTo(b));
  if (withCharges.length) return withCharges[0];
  return [...candidates].sort((a, b) => a.sub(expected).abs().comparedTo(b.sub(expected).abs()))[0];
}
