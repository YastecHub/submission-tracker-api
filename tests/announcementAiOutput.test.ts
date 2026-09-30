import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InvalidAiOrganizationError,
  normalizeAiOrganization,
} from '../src/modules/announcements/domain/announcementAiOutput';

const source = 'CSC 401 test is on Friday 2 October at 10am in Lab 3. Bring your ID card.';

function validSuggestion() {
  return {
    title: { value: 'CSC 401 test', sourceQuotes: ['CSC 401 test is on Friday 2 October'] },
    summary: { value: 'CSC 401 test is on Friday 2 October at 10am in Lab 3.', sourceQuotes: ['CSC 401 test is on Friday 2 October at 10am in Lab 3.'] },
    category: { value: 'academic', reason: 'This is a class test.' },
    priority: { value: 'important', reason: 'Students need to prepare for a dated test.' },
    sections: [{
      heading: 'Test details',
      body: 'CSC 401 test is on Friday 2 October at 10am in Lab 3.\n\n- Bring your ID card.',
      sourceQuotes: [source],
    }],
    warnings: [] as Array<{ code: string; message: string; sourceQuote: string | null }>,
    splitSuggestions: [] as Array<{ title: string; reason: string; sourceQuote: string }>,
  };
}

test('validates and normalizes grounded assistant organization output', () => {
  const result = normalizeAiOrganization(validSuggestion(), source);
  assert.equal(result.category.value, 'academic');
  assert.equal(result.sections.length, 1);
  assert.match(result.sections[0].id, /^[a-zA-Z0-9_-]+$/);
  assert.equal(result.warnings[result.warnings.length - 1]?.code, 'human_review_required');
});

test('allows reasoned, restructured prose, titles, and section bodies from raw notes', () => {
  const suggestion = validSuggestion();
  suggestion.title.value = 'CSC 401 Test Schedule & Instructions';
  suggestion.summary.value = 'Students are advised that the CSC 401 test will take place on Friday, Oct 2 at 10:00 AM in Lab 3.';
  suggestion.sections[0].heading = 'Schedule & Requirements';
  suggestion.sections[0].body = 'Please be seated in Lab 3 before 10am with your valid student ID card.';

  const result = normalizeAiOrganization(suggestion, source);
  assert.equal(result.title.value, 'CSC 401 Test Schedule & Instructions');
  assert.equal(result.summary.value, 'Students are advised that the CSC 401 test will take place on Friday, Oct 2 at 10:00 AM in Lab 3.');
  assert.equal(result.sections[0].heading, 'Schedule & Requirements');
  assert.equal(result.sections[0].body, 'Please be seated in Lab 3 before 10am with your valid student ID card.');
});

test('uses deterministic warning and classification language instead of model prose', () => {
  const suggestion = validSuggestion();
  suggestion.category.reason = 'Invented category explanation';
  suggestion.priority.reason = 'Invented priority explanation';
  suggestion.warnings = [{ code: 'verify_wording', message: 'Invented warning', sourceQuote: null }];
  const result = normalizeAiOrganization(suggestion, source);
  assert.equal(result.category.reason, 'The assistant classified this source as an academic announcement.');
  assert.equal(result.priority.reason, 'The assistant suggested important priority.');
  assert.equal(result.warnings[0].message, 'Some source wording needs careful human verification before publishing.');
});

test('gracefully handles missing or non-matching quotes by providing source excerpts', () => {
  const suggestion = validSuggestion();
  suggestion.title.sourceQuotes = ['Some paraphrase not exactly matching'];
  const result = normalizeAiOrganization(suggestion, source);
  assert.ok(result.title.sourceQuotes.length >= 1);
});

test('rejects empty titles or invalid root objects', () => {
  assert.throws(
    () => normalizeAiOrganization(null, source),
    (error: unknown) => error instanceof InvalidAiOrganizationError && error.code === 'root',
  );

  const suggestion = validSuggestion();
  suggestion.title.value = '   ';
  assert.throws(
    () => normalizeAiOrganization(suggestion, source),
    (error: unknown) => error instanceof InvalidAiOrganizationError && error.code === 'title_value',
  );
});
