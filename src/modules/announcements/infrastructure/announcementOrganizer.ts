import logger from '../../../lib/logger';

export const BULLETIN_AI_PROMPT_VERSION = 'bulletin-organizer-v2';

export interface AnnouncementOrganizer {
  readonly provider: string;
  readonly model: string;
  organize(rawSource: string): Promise<unknown>;
}

export class AnnouncementOrganizerError extends Error {
  constructor(public readonly code: string) {
    super('The announcement assistant could not complete this request');
    this.name = 'AnnouncementOrganizerError';
  }
}

function responseContent(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = data.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

function jsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new AnnouncementOrganizerError('invalid_json');
    try {
      return JSON.parse(match[0]);
    } catch {
      throw new AnnouncementOrganizerError('invalid_json');
    }
  }
}

const SYSTEM_PROMPT = `You are the NEXIUM Announcement Assistant.
Your task is to take unorganized, raw, or rough notes from class executives and organize them into a clean, well-structured announcement draft.

Guidelines:
1. Reason about the material and structure it logically:
   - Provide a clear, descriptive title.
   - Provide a concise summary (1-2 sentences) of what students must know.
   - Categorize accurately: general, academic, practical, finance, event, opportunity, or emergency.
   - Set priority appropriately: normal, important, or urgent.
   - Create well-organized sections with helpful headings (e.g., "Schedule & Venue", "Requirements", "Important Deadlines", "Instructions") and clear, readable bodies.
2. Factuality: Strictly preserve all real facts from the source (dates, times, venues, amounts, names, deadlines). Do NOT invent facts or change numbers.
3. Warnings: If important details seem missing or ambiguous, include a warning code:
   - missing_detail, ambiguous_detail, conflicting_detail, verify_wording, possible_multiple_announcements
4. If there are clearly multiple distinct announcements mixed together, suggest splits.
5. Provide sourceQuotes for title, summary, and sections quoting relevant phrases from the source text.

You must respond with ONLY a valid raw JSON object conforming to this schema:
{
  "title": {"value": "string", "sourceQuotes": ["string"]},
  "summary": {"value": "string", "sourceQuotes": ["string"]},
  "category": {"value": "general|academic|practical|finance|event|opportunity|emergency"},
  "priority": {"value": "normal|important|urgent"},
  "sections": [{"heading": "string|null", "body": "string", "sourceQuotes": ["string"]}],
  "warnings": [{"code": "missing_detail|ambiguous_detail|conflicting_detail|verify_wording|possible_multiple_announcements", "sourceQuote": "string|null"}],
  "splitSuggestions": [{"title": "string", "sourceQuote": "string"}]
}`;

export class OpenAiCompatibleAnnouncementOrganizer implements AnnouncementOrganizer {
  constructor(
    public readonly provider: string,
    public readonly model: string,
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async organize(rawSource: string): Promise<unknown> {
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const requestBody: Record<string, unknown> = {
          model: this.model,
          temperature: 0.1,
          max_completion_tokens: 3000,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Organize this source material into an announcement draft:\n\n${rawSource}`,
            },
          ],
        };

        // For reasoning models on Groq (like openai/gpt-oss-20b), low reasoning effort gives near-instant completion
        if (this.model.includes('gpt-oss') || this.model.includes('openai/')) {
          requestBody.reasoning_effort = 'low';
        }

        const response = await fetch(this.endpoint, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        // Rate-limited: wait and retry
        if (response.status === 429 && attempt < maxAttempts) {
          const retryAfter = parseFloat(response.headers.get('retry-after') || '') || 0;
          const waitMs = Math.max(retryAfter * 1000, attempt * 2_000);
          logger.warn(`[bulletin assistant] rate-limited (attempt ${attempt}/${maxAttempts}), retrying in ${Math.round(waitMs / 1000)}s…`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        if (response.status === 429) {
          throw new AnnouncementOrganizerError('rate_limited');
        }

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          logger.error(`[bulletin assistant] upstream error ${response.status}: ${errorBody}`);
          throw new AnnouncementOrganizerError(`provider_${response.status}`);
        }

        const content = responseContent(await response.json());
        if (!content) throw new AnnouncementOrganizerError('empty_response');
        return jsonObject(content);
      } catch (error) {
        if (error instanceof AnnouncementOrganizerError) throw error;
        if (error instanceof Error && error.name === 'AbortError') throw new AnnouncementOrganizerError('timeout');
        if (attempt < maxAttempts) continue;
        throw new AnnouncementOrganizerError('provider_unavailable');
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new AnnouncementOrganizerError('provider_unavailable');
  }
}

/**
 * Tries a primary organizer, then falls back to a secondary on any error.
 */
export class FallbackAnnouncementOrganizer implements AnnouncementOrganizer {
  readonly provider: string;
  readonly model: string;

  constructor(
    private readonly primary: AnnouncementOrganizer,
    private readonly fallback: AnnouncementOrganizer,
  ) {
    this.provider = primary.provider;
    this.model = primary.model;
  }

  async organize(rawSource: string): Promise<unknown> {
    try {
      return await this.primary.organize(rawSource);
    } catch (error) {
      logger.warn(
        `[bulletin assistant] primary (${this.primary.provider}/${this.primary.model}) failed, falling back to ${this.fallback.provider}/${this.fallback.model}:`,
        { error: error instanceof Error ? error.message : error },
      );
      (this as { provider: string; model: string }).provider = this.fallback.provider;
      (this as { provider: string; model: string }).model = this.fallback.model;
      return this.fallback.organize(rawSource);
    }
  }
}

export function configuredAnnouncementOrganizer(): AnnouncementOrganizer {
  const apiKey = process.env.BULLETIN_AI_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new AnnouncementOrganizerError('not_configured');

  const configuredTimeout = Number(process.env.BULLETIN_AI_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(60_000, Math.max(5_000, configuredTimeout))
    : 15_000;

  const primary = new OpenAiCompatibleAnnouncementOrganizer(
    process.env.BULLETIN_AI_PROVIDER?.trim() || 'groq',
    process.env.BULLETIN_AI_MODEL?.trim() || process.env.GROQ_BULLETIN_MODEL?.trim() || 'openai/gpt-oss-20b',
    process.env.BULLETIN_AI_ENDPOINT?.trim() || 'https://api.groq.com/openai/v1/chat/completions',
    apiKey,
    timeoutMs,
  );

  // If a Gemini key is configured, use it as fallback
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    const fallback = new OpenAiCompatibleAnnouncementOrganizer(
      process.env.BULLETIN_AI_FALLBACK_PROVIDER?.trim() || 'gemini',
      process.env.BULLETIN_AI_FALLBACK_MODEL?.trim() || 'gemini-3.8-flash',
      process.env.BULLETIN_AI_FALLBACK_ENDPOINT?.trim() || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      geminiKey,
      timeoutMs,
    );
    return new FallbackAnnouncementOrganizer(primary, fallback);
  }

  return primary;
}
