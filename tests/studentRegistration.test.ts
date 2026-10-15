import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { StudentAuthService } from '../src/modules/studentAuth/application/studentAuthService';
import type { StudentAccountRepository } from '../src/modules/studentAuth/infrastructure/studentAccountRepository';

process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret';

function setup() {
  const roster = [
    { matricNumber: '251106026', fullName: 'Yasir Oyebo', email: null as string | null },
    { matricNumber: 'JUPEB-ABC123', fullName: 'Jupeb One', email: 'jupeb1@example.com' },
    { matricNumber: '251106049', fullName: 'Daniel Adegbite', email: 'daniel@example.com' },
  ];
  const accounts: any[] = [];
  const otps = new Map<string, any>();
  const sent: Array<{ email: string; code: string }> = [];
  const repo = {
    findByMatric: async (m: string) => accounts.find((a) => a.matricNumber === m) ?? null,
    findByEmail: async (e: string) => accounts.find((a) => a.email === e) ?? null,
    findRosterRecord: async (m: string) => roster.find((r) => r.matricNumber === m) ?? null,
    findRosterByEmail: async (e: string) => roster.find((r) => r.email === e) ?? null,
    findRegistrationOtp: async (m: string) => otps.get(m) ?? null,
    saveRegistrationOtp: async (d: any) => { otps.set(d.matricNumber, { ...d, attempts: 0, lastSentAt: new Date(0) }); },
    deleteRegistrationOtp: async (m: string) => { otps.delete(m); },
    incrementOtpAttempts: async (m: string) => { otps.get(m).attempts += 1; },
    createVerifiedAccount: async (d: any) => { const a = { id: `s${accounts.length + 1}`, createdAt: new Date(), suspendedAt: null, ...d }; accounts.push(a); otps.delete(d.matricNumber); return a; },
  } as unknown as StudentAccountRepository;
  const service = new StudentAuthService(repo, {
    sendRegistrationOtp: async (_n, email, code) => { sent.push({ email, code }); },
    sendPasswordResetOtp: async () => {},
  });
  return { service, accounts, sent };
}

test('a JUPEB student registers with only the seeded email', async () => {
  const { service, sent, accounts } = setup();
  await service.requestRegistrationOtp({ email: 'JUPEB1@example.com' });
  assert.equal(sent[0].email, 'jupeb1@example.com');
  const result = await service.completeRegistration({ email: 'jupeb1@example.com', code: sent[0].code, password: 'long-password' });
  assert.equal(result.student.matricNumber, 'JUPEB-ABC123');
  assert.equal(accounts[0].fullName, 'Jupeb One');
});

test('an email that is not seeded cannot register without a matric number', async () => {
  const { service } = setup();
  await assert.rejects(service.requestRegistrationOtp({ email: 'random@example.com' }), /not on the class list/);
});

test('a matric number with a seeded email only accepts that email', async () => {
  const { service } = setup();
  await assert.rejects(service.requestRegistrationOtp({ matricNumber: '251106049', email: 'someone.else@example.com' }), /da\*+@example\.com/);
});

test('matric numbers without a seeded email still accept any email', async () => {
  const { service, sent } = setup();
  await service.requestRegistrationOtp({ matricNumber: '251106026', email: 'yasir@example.com' });
  assert.equal(sent.length, 1);
});

test('sign in with the matric number or the email; suspended accounts are refused', async () => {
  const { service, accounts } = setup();
  accounts.push({ id: 's1', matricNumber: 'JUPEB-ABC123', email: 'jupeb1@example.com', fullName: 'Jupeb One', passwordHash: bcrypt.hashSync('long-password', 4), suspendedAt: null });
  assert.equal((await service.login({ identifier: 'jupeb1@example.com', password: 'long-password' })).student.id, 's1');
  assert.equal((await service.login({ matricNumber: 'jupeb-abc123', password: 'long-password' })).student.id, 's1');
  accounts[0].suspendedAt = new Date();
  await assert.rejects(service.login({ identifier: 'jupeb1@example.com', password: 'long-password' }), /suspended/);
});
