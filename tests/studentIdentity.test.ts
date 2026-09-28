import test from 'node:test';
import assert from 'node:assert/strict';
import { emailReflectsStudentName } from '../src/modules/studentAuth/domain/studentIdentity';

test('accepts an email local part containing two roster-name tokens', () => {
  assert.equal(emailReflectsStudentName('aishat.abiona@example.com', 'Abiona Aishat'), true);
  assert.equal(emailReflectsStudentName('danieladegbite49@example.com', 'Adegbite Daniel Dolapo'), true);
});

test('rejects unrelated and single-token addresses for multi-part names', () => {
  assert.equal(emailReflectsStudentName('someone.else@example.com', 'Abiona Aishat'), false);
  assert.equal(emailReflectsStudentName('aishat251@example.com', 'Abiona Aishat'), false);
});

test('normalizes punctuation, case, and accents before matching', () => {
  assert.equal(emailReflectsStudentName('JOSE.mARIA@example.com', 'José María'), true);
});
