import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';

type CheckStatus = 'matched' | 'mismatch' | 'unreadable' | 'unavailable';

interface ExtractedAmount {
  found: boolean;
  amount: number | null;
  currency: string | null;
  confidence: number;
  reason: string;
}

function toDecimalAmount(value: number | null): Prisma.Decimal | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return new Prisma.Decimal(value.toFixed(2));
}

function amountsMatch(actual: Prisma.Decimal, expected: Prisma.Decimal): boolean {
  return actual.mul(100).round().equals(expected.mul(100).round());
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

function parseOcrAmount(text: string): { amount: Prisma.Decimal; confidence: number; note: string } | null {
  const normalized = text.replace(/\s+/g, ' ');
  const patterns = [
    /(?:amount|total|paid|debit|transferred|sent|ngn|₦|n)\s*[:\-]?\s*₦?\s*([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)/gi,
    /₦\s*([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)/gi,
    /\bNGN\s*([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)/gi,
  ];

  const candidates: number[] = [];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const parsed = Number(match[1].replace(/[,\s]/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) candidates.push(parsed);
    }
  }

  if (candidates.length === 0) return null;

  const amount = Math.max(...candidates);
  return {
    amount: new Prisma.Decimal(amount.toFixed(2)),
    confidence: candidates.length > 1 ? 0.55 : 0.65,
    note: 'Fallback OCR extracted a likely receipt amount.',
  };
}

async function extractWithFallbackOcr(receiptUrl: string): Promise<{
  amount: Prisma.Decimal;
  confidence: number;
  note: string;
} | null> {
  const { createWorker } = (await import('tesseract.js')) as typeof import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const result = await worker.recognize(receiptUrl);
    return parseOcrAmount(result.data.text);
  } finally {
    await worker.terminate();
  }
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
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    if (!apiKey) {
      groqNote = 'Groq AI amount check skipped because GROQ_API_KEY is not configured.';
    } else {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.GROQ_RECEIPT_MODEL ?? 'meta-llama/llama-4-scout-17b-16e-instruct',
          temperature: 0,
          max_completion_tokens: 160,
          response_format: { type: 'json_object' },
          messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Return only valid JSON matching this shape: ' +
                  '{"found": boolean, "amount": number|null, "currency": string|null, "confidence": number, "reason": string}. ' +
                  'Extract the final amount paid from this payment receipt. ' +
                  'Use NGN/Naira when currency is visible. ' +
                  'If several amounts appear, choose the final debited/transferred amount. ' +
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

  let extractedAmount = extraction?.found ? toDecimalAmount(extraction.amount) : null;
  let confidence = extraction?.confidence ?? null;
  let note = extraction?.reason ?? groqNote;

  if (!extractedAmount) {
    try {
      const fallback = await extractWithFallbackOcr(args.receiptUrl);
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
    const status: CheckStatus = amountsMatch(extractedAmount, args.expectedAmount) ? 'matched' : 'mismatch';
    await markReceipt(args.receiptId, status, {
      extractedAmount,
      confidence,
      note:
        status === 'matched'
          ? 'Extracted receipt amount matches the expected payment amount.'
          : `Extracted ${extractedAmount.toString()} but expected ${args.expectedAmount.toString()}.`,
    });
    return;
  }

  await markReceipt(args.receiptId, apiKey ? 'unreadable' : 'unavailable', {
    note: note || 'No readable amount was found on the receipt.',
  });
}
