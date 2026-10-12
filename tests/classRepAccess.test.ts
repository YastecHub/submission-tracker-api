import assert from 'node:assert/strict';
import test from 'node:test';
import { canCreateClassRepAccount, CLASS_ROLES, isClassRep } from '../src/modules/auth/domain/classRepAccess';

test('every class role has class rep access', () => {
  assert.deepEqual(CLASS_ROLES, ['cr', 'acr', 'fin_sec', 'dev']);
  for (const role of CLASS_ROLES) assert.equal(isClassRep(role), true);
  assert.equal(isClassRep('student'), false);
  assert.equal(isClassRep(undefined), false);
});

test('only developers can create class rep accounts', () => {
  assert.equal(canCreateClassRepAccount('cr'), false);
  assert.equal(canCreateClassRepAccount('acr'), false);
  assert.equal(canCreateClassRepAccount('fin_sec'), false);
  assert.equal(canCreateClassRepAccount('dev'), true);
});
