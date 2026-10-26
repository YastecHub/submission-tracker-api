import { Prisma } from '@prisma/client';
import { spawn } from 'child_process';
import { join } from 'path';
import prisma from '../lib/prisma';
import { judgeAmount, pickBestAmount } from './receiptAmountRules';

type CheckStatus = 'matched' | 'mismatch' | 'unreadable' | 'unavailable';

interface ExtractedAmount {
  found: boolean;
  /** Amount sent to the recipient, without bank charges. */
  amount: number | null;
  /** Bank/transfer charges, if shown separately. */
  fee?: number | null;
  /** Total taken from the account (amount + charges), if shown. */
  total_debited?: number | null;
  currency: string | null;
  confidence: number;
  reason: string;
}

/** Groq shut these models down (Llama 4 Scout on 17 July 2026), so an old setting falls back to the default. */
const RETIRED_MODELS = new Set([
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
]);
const DEFAULT_RECEIPT_MODEL = 'qwen/qwen3.8-27b';

function receiptModel(): string {
  const configured = process.env.GROQ_RECEIPT_MODEL?.trim();
  return configured && !RETIRED_MODELS.has(configured) ? configured : DEFAULT_RECEIPT_MODEL;
}

function toDecimalAmount(value: number | null): Prisma.Decimal | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return new Prisma.Decimal(value.toFixed(2));
}

function parseGroqContent(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const response = data as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return response.choices?.[0]?.message?.content ?? null;
}

function parseJsonObject(raw: string): ExtractedAmount | null {
  try {
    return JSON.parse(raw) as ExtractedAmount;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as ExtractedAmount;
    } catch {
      return null;
    }
  }
}

function parseOcrAmount(text: string, expected: Prisma.Decimal): { amount: Prisma.Decimal; confidence: number; note: string } | null {
  const normalized = text.replace(/\s+/g, ' ');
  const patterns = [
    /(?:amount|total|paid|debit|transferred|sent|ngn|₦|n)\s*[:\-]?\s*₦?\s*([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)/gi,
    /₦\s*([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)/gi,
    /\bNGN\s*([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)/gi,
  ];

  const candidates: Prisma.Decimal[] = [];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const parsed = Number(match[1].replace(/[,\s]/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) candidates.push(new Prisma.Decimal(parsed.toFixed(2)));
    }
  }

  const amount = pickBestAmount(candidates, expected);
  if (!amount) return null;
  return {
    amount,
    confidence: candidates.length > 1 ? 0.55 : 0.65,
    note: 'Fallback OCR extracted a likely receipt amount.',
  };
}

async function extractWithFallbackOcr(receiptUrl: string, expected: Prisma.Decimal): Promise<{
  amount: Prisma.Decimal;
  confidence: number;
  note: string;
} | null> {
  const workerPath = join(__dirname, 'receiptOcrWorker.js');

  const text = await new Promise<string | null>((resolve) => {
    const child = spawn(process.execPath, [workerPath, receiptUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(null);
    }, 30_000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        finish(null);
        return;
      }

      try {
        const lines = stdout.trim().split(/\r?\n/);
        const result = JSON.parse(lines[lines.length - 1]) as {
          ok?: boolean;
          text?: string;
        };
        finish(result.ok && typeof result.text === 'string' ? result.text : null);
      } catch {
        finish(null);
      }
    });
  });

  return text ? parseOcrAmount(text, expected) : null;
}

async function markReceipt(
  receiptId: string,
  status: CheckStatus,
  data: {
    extractedAmount?: Prisma.Decimal | null;
    confidence?: number | null;
    note: string;
  }
): Promise<void> {
  await prisma.paymentReceipt.update({
    where: { id: receiptId },
    data: {
      amountCheckStatus: status,
      extractedAmount: data.extractedAmount ?? null,
      amountCheckConfidence: data.confidence ?? null,
      amountCheckNote: data.note,
      amountCheckedAt: new Date(),
    },
  });
}

export async function checkReceiptAmountInBackground(args: {
  receiptId: string;
  receiptUrl: string;
  expectedAmount: Prisma.Decimal;
}): Promise<void> {
  const apiKey = process.env.GROQ_API_KEY;
  let extraction: ExtractedAmount | null = null;
  let groqNote = '';

  const controller = new AbortController();
  // Runs in the background after the student submits, so it can wait for a slower vision model.
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    if (!apiKey) {
      groqNote = 'Groq AI amount check skipped because GROQ_API_KEY is not configured.';
    } else {
      const model = receiptModel();
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_completion_tokens: 300,
          // Qwen models reason by default; a receipt amount doesn't need it, and JSON mode requires hidden reasoning.
          ...(model.startsWith('qwen/') ? { reasoning_effort: 'none', reasoning_format: 'hidden' } : {}),
          response_format: { type: 'json_object' },
          messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Return only valid JSON matching this shape: ' +
                  '{"found": boolean, "amount": number|null, "fee": number|null, "total_debited": number|null, "currency": string|null, "confidence": number, "reason": string}. ' +
                  'This is a Nigerian bank transfer or payment receipt. ' +
                  '"amount" is the amount sent to the recipient, WITHOUT bank charges, fees, VAT or stamp duty. ' +
                  '"fee" is the total of any charges/fees shown separately, else null. ' +
                  '"total_debited" is the total taken from the account if shown (amount plus charges), else null. ' +
                  'Never use an account balance, available balance or reference number as an amount. ' +
                  'Amounts are in Naira (NGN, ₦); write them as plain numbers without commas. ' +
                  'If no amount is readable, set found to false.',
              },
              {
                type: 'image_url',
                image_url: { url: args.receiptUrl },
              },
            ],
          },
          ],
        }),
      });

      if (!response.ok) {
        groqNote = `Groq AI amount check failed with HTTP ${response.status}.`;
      } else {
        const data = await response.json();
        const outputText = parseGroqContent(data);
        extraction = outputText ? parseJsonObject(outputText) : null;
        if (!extraction) groqNote = 'Groq AI did not return a readable JSON amount result.';
      }
    }
  } catch (err) {
    groqNote =
      err instanceof Error && err.name === 'AbortError'
        ? 'Groq AI amount check timed out.'
        : 'Groq AI amount check could not complete.';
  } finally {
    clearTimeout(timeout);
  }

  let extractedAmount = extraction?.found ? toDecimalAmount(extraction.amount) ?? toDecimalAmount(extraction.total_debited ?? null) : null;
  const fee = extraction?.found ? toDecimalAmount(extraction.fee ?? null) : null;
  const totalDebited = extraction?.found ? toDecimalAmount(extraction.total_debited ?? null) : null;
  let confidence = extraction?.confidence ?? null;
  let note = extraction?.reason ?? groqNote;

  if (!extractedAmount) {
    try {
      const fallback = await extractWithFallbackOcr(args.receiptUrl, args.expectedAmount);
      if (fallback) {
        extractedAmount = fallback.amount;
        confidence = fallback.confidence;
        note = groqNote ? `${groqNote} ${fallback.note}` : fallback.note;
      }
    } catch {
      if (!note) note = 'Fallback OCR could not complete.';
    }
  }

  if (extractedAmount) {
    let verdict = judgeAmount(extractedAmount, args.expectedAmount, fee);
    // The model may have read the amount with charges as "amount"; the total with charges can still match.
    if (verdict.status === 'mismatch' && totalDebited && !totalDebited.equals(extractedAmount)) {
      const withTotal = judgeAmount(totalDebited, args.expectedAmount, fee);
      if (withTotal.status === 'matched') {
        verdict = withTotal;
        extractedAmount = totalDebited;
      }
    }
    await markReceipt(args.receiptId, verdict.status, { extractedAmount, confidence, note: verdict.note });
    return;
  }

  await markReceipt(args.receiptId, apiKey ? 'unreadable' : 'unavailable', {
    note: note || 'No readable amount was found on the receipt.',
  });
}
