import {
  AnnouncementCategory,
  AnnouncementPriority,
} from '@prisma/client';
import { normalizeAnnouncementDocument } from './announcementContent';

const CATEGORIES: AnnouncementCategory[] = ['general', 'academic', 'practical', 'finance', 'event', 'opportunity', 'emergency'];
const PRIORITIES: AnnouncementPriority[] = ['normal', 'important', 'urgent'];
const WARNING_CODES = ['missing_detail', 'ambiguous_detail', 'conflicting_detail', 'verify_wording', 'possible_multiple_announcements'] as const;

const CATEGORY_REASONS: Record<AnnouncementCategory, string> = {
  general: 'The assistant classified this source as a general announcement.',
  academic: 'The assistant classified this source as an academic announcement.',
  practical: 'The assistant classified this source as a practical announcement.',
  finance: 'The assistant classified this source as a finance announcement.',
  event: 'The assistant classified this source as an event announcement.',
  opportunity: 'The assistant classified this source as an opportunity announcement.',
  emergency: 'The assistant classified this source as an emergency announcement.',
};

const PRIORITY_REASONS: Record<AnnouncementPriority, string> = {
  normal: 'The assistant suggested normal priority.',
  important: 'The assistant suggested important priority.',
  urgent: 'The assistant suggested urgent priority.',
};

const WARNING_MESSAGES: Record<typeof WARNING_CODES[number], string> = {
  missing_detail: 'Some details may be missing. Confirm the source before publishing.',
  ambiguous_detail: 'Some wording may have more than one meaning. Confirm it before publishing.',
  conflicting_detail: 'The source may contain conflicting details. Resolve them before publishing.',
  verify_wording: 'Some source wording needs careful human verification before publishing.',
  possible_multiple_announcements: 'The source may contain more than one announcement. Consider separating the topics.',
};

export type AiWarningCode = typeof WARNING_CODES[number] | 'human_review_required';

export interface AiSuggestedText {
  value: string;
  sourceQuotes: string[];
}

export interface AiSuggestedSection {
  id: string;
  heading: string | null;
  body: string;
  sourceQuotes: string[];
}

export interface AiOrganizationResult {
  title: AiSuggestedText;
  summary: AiSuggestedText;
  category: { value: AnnouncementCategory; reason: string };
  priority: { value: AnnouncementPriority; reason: string };
  sections: AiSuggestedSection[];
  warnings: Array<{ code: AiWarningCode; message: string; sourceQuote: string | null }>;
  splitSuggestions: Array<{ title: string; reason: string; sourceQuote: string }>;
}

export class InvalidAiOrganizationError extends Error {
  constructor(public readonly code: string) {
    super('The announcement assistant returned an invalid suggestion');
    this.name = 'InvalidAiOrganizationError';
  }
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidAiOrganizationError(code);
  return value as Record<string, unknown>;
}

function textValue(value: unknown, max: number, code: string): string {
  if (typeof value !== 'string') throw new InvalidAiOrganizationError(code);
  const text = value.trim();
  if (!text || text.length > max) throw new InvalidAiOrganizationError(code);
  return text;
}

function normalizeComparable(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeQuote(value: unknown, rawSource: string): string | null {
  if (typeof value !== 'string') return null;
  const quote = value.trim();
  if (!quote) return null;
  const normalizedRaw = normalizeComparable(rawSource);
  const normalizedQ = normalizeComparable(quote);
  if (normalizedRaw.includes(normalizedQ)) {
    return quote.slice(0, 2_000);
  }
  const words = normalizedQ.split(' ').filter((w) => w.length > 3);
  if (words.some((w) => normalizedRaw.includes(w))) {
    return quote.slice(0, 2_000);
  }
  return null;
}

function sourceQuotes(value: unknown, rawSource: string, maxQuotes = 5): string[] {
  const quotes: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const q = sanitizeQuote(item, rawSource);
      if (q && !quotes.includes(q)) {
        quotes.push(q);
        if (quotes.length >= maxQuotes) break;
      }
    }
  }
  if (quotes.length === 0) {
    const fallback = rawSource.trim().split(/\n+/)[0]?.slice(0, 200).trim() || rawSource.slice(0, 200).trim();
    quotes.push(fallback);
  }
  return quotes;
}

function suggestedText(value: unknown, rawSource: string, max: number, code: string): AiSuggestedText {
  const candidate = objectValue(value, code);
  const text = textValue(candidate.value, max, `${code}_value`);
  return {
    value: text,
    sourceQuotes: sourceQuotes(candidate.sourceQuotes, rawSource, 5),
  };
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) return fallback;
  return value as T;
}

export function normalizeAiOrganization(value: unknown, rawSource: string): AiOrganizationResult {
  const candidate = objectValue(value, 'root');
  const title = suggestedText(candidate.title, rawSource, 180, 'title');
  const summary = suggestedText(candidate.summary, rawSource, 500, 'summary');

  const categoryInput = candidate.category && typeof candidate.category === 'object' && !Array.isArray(candidate.category)
    ? (candidate.category as Record<string, unknown>).value
    : 'general';
  const categoryValue = enumValue(categoryInput, CATEGORIES, 'general');
  const category = {
    value: categoryValue,
    reason: CATEGORY_REASONS[categoryValue],
  };

  const priorityInput = candidate.priority && typeof candidate.priority === 'object' && !Array.isArray(candidate.priority)
    ? (candidate.priority as Record<string, unknown>).value
    : 'normal';
  const priorityValue = enumValue(priorityInput, PRIORITIES, 'normal');
  const priority = {
    value: priorityValue,
    reason: PRIORITY_REASONS[priorityValue],
  };

  if (!Array.isArray(candidate.sections) || candidate.sections.length < 1) {
    throw new InvalidAiOrganizationError('sections');
  }

  const rawSections = candidate.sections.slice(0, 20);
  const sectionInputs = rawSections.map((section, index) => {
    const item = objectValue(section, `section_${index + 1}`);
    const heading = typeof item.heading === 'string' && item.heading.trim()
      ? item.heading.trim().slice(0, 120)
      : null;
    const body = textValue(item.body, 10_000, `section_${index + 1}_body`);
    const quotes = sourceQuotes(item.sourceQuotes, rawSource, 10);
    return { heading, body, sourceQuotes: quotes };
  });

  const document = normalizeAnnouncementDocument({
    version: 1,
    sections: sectionInputs.map((s) => ({ heading: s.heading, body: s.body })),
  });

  const sections = document.sections.map((section, index) => ({
    ...section,
    sourceQuotes: sectionInputs[index]?.sourceQuotes || [rawSource.slice(0, 200)],
  }));

  const warnings: AiOrganizationResult['warnings'] = [];
  if (Array.isArray(candidate.warnings)) {
    for (let i = 0; i < Math.min(candidate.warnings.length, 12); i++) {
      const item = candidate.warnings[i];
      if (item && typeof item === 'object') {
        const code = (item as Record<string, unknown>).code;
        if (typeof code === 'string' && (WARNING_CODES as readonly string[]).includes(code)) {
          const warningCode = code as typeof WARNING_CODES[number];
          const quote = sanitizeQuote((item as Record<string, unknown>).sourceQuote, rawSource);
          warnings.push({
            code: warningCode,
            message: WARNING_MESSAGES[warningCode],
            sourceQuote: quote,
          });
        }
      }
    }
  }
  warnings.push({
    code: 'human_review_required',
    message: 'Compare every suggested name, date, amount and instruction with the source before accepting it.',
    sourceQuote: null,
  });

  const splitSuggestions: AiOrganizationResult['splitSuggestions'] = [];
  if (Array.isArray(candidate.splitSuggestions)) {
    for (let i = 0; i < Math.min(candidate.splitSuggestions.length, 5); i++) {
      const item = candidate.splitSuggestions[i];
      if (item && typeof item === 'object') {
        const titleVal = (item as Record<string, unknown>).title;
        if (typeof titleVal === 'string' && titleVal.trim()) {
          const quote = sanitizeQuote((item as Record<string, unknown>).sourceQuote, rawSource)
            || rawSource.slice(0, 200);
          splitSuggestions.push({
            title: titleVal.trim().slice(0, 180),
            reason: 'The assistant identified this as a possible separate topic in the source.',
            sourceQuote: quote,
          });
        }
      }
    }
  }

  return { title, summary, category, priority, sections, warnings, splitSuggestions };
}
