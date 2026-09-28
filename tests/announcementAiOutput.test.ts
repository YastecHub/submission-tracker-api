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
    warnings: [],
    splitSuggestions: [],
  };
}

test('validates and normalizes grounded assistant organization output', () => {
  const result = normalizeAiOrganization(validSuggestion(), source);
  assert.equal(result.category.value, 'academic');
  assert.equal(result.sections.length, 1);
  assert.match(result.sections[0].id, /^[a-zA-Z0-9_-]+$/);
  assert.equal(result.warnings.at(-1)?.code, 'human_review_required');
});

test('rejects factual values that do not occur in the source', () => {
  const suggestion = validSuggestion();
  suggestion.sections[0].body = suggestion.sections[0].body.replace('10am', '11am');
  assert.throws(
    () => normalizeAiOrganization(suggestion, source),
    (error: unknown) => error instanceof InvalidAiOrganizationError && error.code === 'section_1_body_not_extractive',
  );
});

test('rejects invented prose even when its evidence quote is real', () => {
  const suggestion = validSuggestion();
  suggestion.summary.value = 'CSC 401 test has been cancelled.';
  assert.throws(
    () => normalizeAiOrganization(suggestion, source),
    (error: unknown) => error instanceof InvalidAiOrganizationError && error.code === 'summary_not_extractive',
  );
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

test('rejects source evidence that is not present in the source', () => {
  const suggestion = validSuggestion();
  suggestion.title.sourceQuotes = ['This quote was invented'];
  assert.throws(
    () => normalizeAiOrganization(suggestion, source),
    (error: unknown) => error instanceof InvalidAiOrganizationError && error.code.includes('not_found'),
  );
});
