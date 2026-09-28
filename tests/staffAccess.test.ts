import assert from 'node:assert/strict';
import test from 'node:test';
import { canCreateStaffAccount, STAFF_ROLES } from '../src/modules/auth/domain/staffAccess';

test('every exco role has staff read access', () => {
  assert.deepEqual(STAFF_ROLES, ['cr', 'acr', 'fin_sec', 'dev']);
});

test('only developers can create staff accounts', () => {
  assert.equal(canCreateStaffAccount('cr'), false);
  assert.equal(canCreateStaffAccount('acr'), false);
  assert.equal(canCreateStaffAccount('fin_sec'), false);
  assert.equal(canCreateStaffAccount('dev'), true);
});
