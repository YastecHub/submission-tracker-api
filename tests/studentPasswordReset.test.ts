import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { StudentAuthService, type StudentAuthMailer } from '../src/modules/studentAuth/application/studentAuthService';
import { isSessionCurrent } from '../src/modules/studentAuth/application/studentSessions';
import type { StudentAccountRepository } from '../src/modules/studentAuth/infrastructure/studentAccountRepository';

process.env.JWT_SECRET ??= 'test-secret';

interface Account { id: string; matricNumber: string; email: string; fullName: string; passwordHash: string; passwordChangedAt: Date | null }
interface Reset { studentId: string; codeHash: string; attempts: number; expiresAt: Date; lastSentAt: Date }

function setup(options: { failMail?: boolean } = {}) {
  const accounts: Account[] = [{
    id: 'stu-1', matricNumber: '251106026', email: 'yasir@example.com', fullName: 'Oyebo Yasir', passwordHash: bcrypt.hashSync('old-password', 4), passwordChangedAt: null,
  }];
  const resets = new Map<string, Reset>();
  const sent: Array<{ email: string; code: string }> = [];
  const repo = {
    findByMatric: async (matricNumber: string) => accounts.find((a) => a.matricNumber === matricNumber) ?? null,
    findByEmail: async (email: string) => accounts.find((a) => a.email === email) ?? null,
    findPasswordReset: async (studentId: string) => resets.get(studentId) ?? null,
    savePasswordReset: async (data: { studentId: string; codeHash: string; expiresAt: Date }) => {
      resets.set(data.studentId, { ...data, attempts: 0, lastSentAt: new Date() });
    },
    incrementPasswordResetAttempts: async (studentId: string) => { const r = resets.get(studentId); if (r) r.attempts += 1; },
    deletePasswordReset: async (studentId: string) => { resets.delete(studentId); },
    resetPassword: async (studentId: string, passwordHash: string, passwordChangedAt: Date) => {
      const account = accounts.find((a) => a.id === studentId)!;
      Object.assign(account, { passwordHash, passwordChangedAt });
      resets.delete(studentId);
      return account;
    },
  } as unknown as StudentAccountRepository;
  const mailer: StudentAuthMailer = {
    sendRegistrationOtp: async () => {},
    sendPasswordResetOtp: async (_name, email, code) => {
      if (options.failMail) throw new Error('mail down');
      sent.push({ email, code });
    },
  };
  return { service: new StudentAuthService(repo, mailer), accounts, resets, sent };
}

test('a reset code goes to the email on the account, found by matric number or email', async () => {
  const { service, sent } = setup();
  const reply = await service.requestPasswordReset({ identifier: ' 251106026 ' });
  assert.match(reply.message, /If an account matches/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, 'yasir@example.com');
  assert.match(sent[0].code, /^\d{6}$/);

  const other = setup();
  await other.service.requestPasswordReset({ identifier: 'YASIR@example.com' });
  assert.equal(other.sent.length, 1);
});

test('unknown accounts get the same answer and no email', async () => {
  const { service, sent } = setup();
  const known = await service.requestPasswordReset({ identifier: '251106026' });
  const unknown = await service.requestPasswordReset({ identifier: '999999999' });
  assert.deepEqual(unknown, known);
  assert.equal(sent.length, 1);
});

test('a second request inside the cooldown does not send another code', async () => {
  const { service, sent } = setup();
  await service.requestPasswordReset({ identifier: '251106026' });
  await service.requestPasswordReset({ identifier: '251106026' });
  assert.equal(sent.length, 1);
});

test('the right code sets the new password, signs in, and burns the code', async () => {
  const { service, sent, accounts, resets } = setup();
  await service.requestPasswordReset({ identifier: '251106026' });
  const result = await service.completePasswordReset({ identifier: '251106026', code: sent[0].code, password: 'brand-new-pass' });
  assert.equal(result.student.matricNumber, '251106026');
  assert.ok(jwt.verify(result.token, process.env.JWT_SECRET!));
  assert.ok(await bcrypt.compare('brand-new-pass', accounts[0].passwordHash));
  assert.ok(accounts[0].passwordChangedAt);
  assert.equal(resets.size, 0);
  await assert.rejects(service.login({ matricNumber: '251106026', password: 'old-password' }), /Invalid matric number or password/);
  await service.login({ matricNumber: '251106026', password: 'brand-new-pass' });
  await assert.rejects(
    service.completePasswordReset({ identifier: '251106026', code: sent[0].code, password: 'another-pass' }),
    /invalid or expired/,
  );
});

test('wrong codes count, and the code dies after five misses', async () => {
  const { service, sent, resets } = setup();
  await service.requestPasswordReset({ identifier: '251106026' });
  const wrong = sent[0].code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(service.completePasswordReset({ identifier: '251106026', code: wrong, password: 'brand-new-pass' }), /invalid or expired/);
  }
  await assert.rejects(service.completePasswordReset({ identifier: '251106026', code: sent[0].code, password: 'brand-new-pass' }), /invalid or expired/);
  assert.equal(resets.size, 0);
});

test('expired codes and short passwords are refused', async () => {
  const { service, sent, resets } = setup();
  await service.requestPasswordReset({ identifier: '251106026' });
  await assert.rejects(service.completePasswordReset({ identifier: '251106026', code: sent[0].code, password: 'short' }), /between 8 and 128/);
  resets.get('stu-1')!.expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(service.completePasswordReset({ identifier: '251106026', code: sent[0].code, password: 'brand-new-pass' }), /invalid or expired/);
});

test('a failed email removes the code and reports it', async () => {
  const { service, resets } = setup({ failMail: true });
  await assert.rejects(service.requestPasswordReset({ identifier: '251106026' }), /could not send the reset email/);
  assert.equal(resets.size, 0);
});

test('sessions issued before a password change are rejected', () => {
  const changedAt = Date.parse('2026-10-12T10:00:00.500Z');
  const state = { exists: true, passwordChangedAt: changedAt };
  assert.equal(isSessionCurrent(state, changedAt / 1000 - 60), false);
  assert.equal(isSessionCurrent(state, Math.floor(changedAt / 1000)), true);
  assert.equal(isSessionCurrent({ exists: true, passwordChangedAt: null }, 1), true);
  assert.equal(isSessionCurrent({ exists: false, passwordChangedAt: null }, 1), false);
});
