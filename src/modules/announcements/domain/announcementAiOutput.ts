import {
  AnnouncementCategory,
  AnnouncementPriority,
} from '@prisma/client';
import { normalizeAnnouncementDocument } from './announcementContent';

const CATEGORIES: AnnouncementCategory[] = ['general', 'academic', 'practical', 'finance', 'event', 'opportunity', 'emergency'];
const PRIORITIES: AnnouncementPriority[] = ['normal', 'important', 'urgent'];
const WARNING_CODES = ['missing_detail', 'ambiguous_detail', 'conflicting_detail', 'verify_wording', 'possible_multiple_announcements'] as const;
const SAFE_SECTION_HEADINGS = new Set([
  'announcement',
  'contact',
  'course details',
  'date and time',
  'details',
  'event details',
  'important details',
  'instructions',
  'next steps',
  'opportunity details',
  'payment details',
  'practical details',
  'requirements',
  'submission details',
  'test details',
  'update',
  'venue',
  'what you need to know',
]);

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

function sourceQuote(value: unknown, rawSource: string, code: string): string {
  const quote = textValue(value, 2_000, code);
  if (!normalizeComparable(rawSource).includes(normalizeComparable(quote))) {
    throw new InvalidAiOrganizationError(`${code}_not_found`);
  }
  return quote;
}

function sourceQuotes(value: unknown, rawSource: string, code: string, maxQuotes = 5): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxQuotes) throw new InvalidAiOrganizationError(code);
  return value.map((quote, index) => sourceQuote(quote, rawSource, `${code}_${index + 1}`));
}

function suggestedText(value: unknown, rawSource: string, max: number, code: string): AiSuggestedText {
  const candidate = objectValue(value, code);
  const text = textValue(candidate.value, max, `${code}_value`);
  if (!normalizeComparable(rawSource).includes(normalizeComparable(text))) {
    throw new InvalidAiOrganizationError(`${code}_not_extractive`);
  }
  return { value: text, sourceQuotes: sourceQuotes(candidate.sourceQuotes, rawSource, `${code}_source_quotes`, 5) };
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], code: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new InvalidAiOrganizationError(code);
  return value as T;
}

function optionalSourceQuote(value: unknown, rawSource: string, code: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return sourceQuote(value, rawSource, code);
}

function stripListMarkers(value: string): string {
  return value
    .replace(/(^|\n)\s*(?:[-*•–—]|\d+[.)]|\([0-9a-zA-Z]+\)|[a-zA-Z][.)])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function assertExtractiveSection(
  heading: string | null,
  body: string,
  quotes: string[],
  rawSource: string,
  code: string,
): void {
  const normalizedRawSource = normalizeComparable(rawSource);
  const normalizedRawSourceNoMarkers = normalizeComparable(stripListMarkers(rawSource));

  if (heading) {
    const normalizedHeading = normalizeComparable(heading);
    const headingIsGrounded = normalizedRawSource.includes(normalizedHeading)
      || normalizedRawSourceNoMarkers.includes(normalizedHeading)
      || SAFE_SECTION_HEADINGS.has(normalizedHeading);
    if (!headingIsGrounded) throw new InvalidAiOrganizationError(`${code}_heading_not_grounded`);
  }

  // 1. Direct match of body in rawSource (with original formatting/markers preserved)
  if (normalizedRawSource.includes(normalizeComparable(body))) {
    return;
  }

  const normalizedBody = normalizeComparable(stripListMarkers(body));
  const normalizedQuotes = normalizeComparable(stripListMarkers(quotes.join('\n')));

  // 2. Direct match of body with quotes
  if (normalizedBody === normalizedQuotes) {
    return;
  }

  // 3. Body with heading matches quotes (when model quotes the heading along with the body)
  if (heading) {
    const withHeading = normalizeComparable(stripListMarkers(`${heading} ${body}`));
    if (withHeading === normalizedQuotes) {
      return;
    }
  }

  // 4. Body without list markers is present in rawSource
  if (normalizedRawSourceNoMarkers.includes(normalizedBody) || normalizedRawSource.includes(normalizedBody)) {
    return;
  }

  // 5. Concatenated quotes match body or body with heading
  const quotesConcatenated = normalizeComparable(quotes.map((q) => stripListMarkers(q)).join(' '));
  if (normalizedBody === quotesConcatenated) {
    return;
  }
  if (heading) {
    const withHeading = normalizeComparable(stripListMarkers(`${heading} ${body}`));
    if (withHeading === quotesConcatenated) {
      return;
    }
  }

  // 6. Check paragraph-by-paragraph: each non-empty paragraph must be extractive from rawSource
  const paragraphs = body
    .split(/\n+/)
    .map((p) => normalizeComparable(stripListMarkers(p)))
    .filter((p) => p.length > 0);

  if (
    paragraphs.length > 0 &&
    paragraphs.every((p) => normalizedRawSourceNoMarkers.includes(p) || normalizedRawSource.includes(p))
  ) {
    return;
  }

  throw new InvalidAiOrganizationError(`${code}_body_not_extractive`);
}

export function normalizeAiOrganization(value: unknown, rawSource: string): AiOrganizationResult {
  const candidate = objectValue(value, 'root');
  const title = suggestedText(candidate.title, rawSource, 180, 'title');
  const summary = suggestedText(candidate.summary, rawSource, 500, 'summary');

  const categoryInput = objectValue(candidate.category, 'category');
  const categoryValue = enumValue(categoryInput.value, CATEGORIES, 'category_value');
  const category = {
    value: categoryValue,
    reason: CATEGORY_REASONS[categoryValue],
  };

  const priorityInput = objectValue(candidate.priority, 'priority');
  const priorityValue = enumValue(priorityInput.value, PRIORITIES, 'priority_value');
  const priority = {
    value: priorityValue,
    reason: PRIORITY_REASONS[priorityValue],
  };

  if (!Array.isArray(candidate.sections) || candidate.sections.length < 1 || candidate.sections.length > 20) {
    throw new InvalidAiOrganizationError('sections');
  }

  const sectionInputs = candidate.sections.map((section, index) => {
    const item = objectValue(section, `section_${index + 1}`);
    const heading = item.heading === null || item.heading === undefined || item.heading === ''
      ? null
      : textValue(item.heading, 120, `section_${index + 1}_heading`);
    const result = {
      heading,
      body: textValue(item.body, 10_000, `section_${index + 1}_body`),
      sourceQuotes: sourceQuotes(item.sourceQuotes, rawSource, `section_${index + 1}_source_quotes`, 50),
    };
    assertExtractiveSection(result.heading, result.body, result.sourceQuotes, rawSource, `section_${index + 1}`);
    return result;
  });

  const document = normalizeAnnouncementDocument({
    version: 1,
    sections: sectionInputs.map((section) => ({ heading: section.heading, body: section.body })),
  });
  const sections = document.sections.map((section, index) => ({ ...section, sourceQuotes: sectionInputs[index].sourceQuotes }));

  const warningInputs = candidate.warnings === undefined ? [] : candidate.warnings;
  if (!Array.isArray(warningInputs) || warningInputs.length > 12) throw new InvalidAiOrganizationError('warnings');
  const warnings: AiOrganizationResult['warnings'] = warningInputs.map((warning, index) => {
    const item = objectValue(warning, `warning_${index + 1}`);
    return {
      code: enumValue(item.code, WARNING_CODES, `warning_${index + 1}_code`),
      message: WARNING_MESSAGES[enumValue(item.code, WARNING_CODES, `warning_${index + 1}_code`)],
      sourceQuote: optionalSourceQuote(item.sourceQuote, rawSource, `warning_${index + 1}_source_quote`),
    };
  });
  warnings.push({
    code: 'human_review_required',
    message: 'Compare every suggested name, date, amount and instruction with the source before accepting it.',
    sourceQuote: null,
  });

  const splitInputs = candidate.splitSuggestions === undefined ? [] : candidate.splitSuggestions;
  if (!Array.isArray(splitInputs) || splitInputs.length > 5) throw new InvalidAiOrganizationError('split_suggestions');
  const splitSuggestions = splitInputs.map((suggestion, index) => {
    const item = objectValue(suggestion, `split_${index + 1}`);
    const title = textValue(item.title, 180, `split_${index + 1}_title`);
    if (!normalizeComparable(rawSource).includes(normalizeComparable(title))) {
      throw new InvalidAiOrganizationError(`split_${index + 1}_title_not_extractive`);
    }
    return {
      title,
      reason: 'The assistant identified this as a possible separate topic in the source.',
      sourceQuote: sourceQuote(item.sourceQuote, rawSource, `split_${index + 1}_source_quote`),
    };
  });

  return { title, summary, category, priority, sections, warnings, splitSuggestions };
}
