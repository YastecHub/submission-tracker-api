import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncClassList } from '../src/modules/elections/infrastructure/classList';
import { emailOnlyId } from '../src/modules/elections/domain/voterList';

/** Just enough of PrismaClient for syncClassList, kept in memory. */
function fakeDb() {
  const state = {
    roster: [
      { matricNumber: '251106026', fullName: 'Yasir Oyebo', email: null as string | null },
      { matricNumber: '251106999', fullName: 'Not In File', email: 'taken@x.test' as string | null },
    ],
    accounts: [{ id: 'a1', matricNumber: '251106026', fullName: 'Yasir Oyebo' }],
    elections: [
      { id: 'open', status: 'open', closesAt: new Date(Date.now() + 3_600_000) },
      { id: 'closed', status: 'closed', closesAt: new Date(Date.now() - 3_600_000) },
    ],
    roll: [{ electionId: 'open', matricNumber: '251106026', fullName: 'Yasir Oyebo' }],
  };
  const inList = (where: any, key: string) => (row: any) => !where?.[key]?.in || where[key].in.includes(row[key]);
  const db: any = {
    studentRoster: {
      findMany: async ({ where }: any) => state.roster.filter(inList(where, where.email ? 'email' : 'matricNumber')),
      upsert: async ({ where, create, update }: any) => {
        const found = state.roster.find((row) => row.matricNumber === where.matricNumber);
        if (found) Object.assign(found, update); else state.roster.push({ ...create });
      },
    },
    studentAccount: {
      findMany: async ({ where }: any) => state.accounts.filter(inList(where, 'matricNumber')),
      update: async ({ where, data }: any) => Object.assign(state.accounts.find((row) => row.id === where.id)!, data),
    },
    election: {
      findMany: async ({ where }: any) => state.elections.filter((e) => where.status.in.includes(e.status) && e.closesAt > where.closesAt.gt),
    },
    electionVoterRoll: {
      createMany: async ({ data }: any) => {
        let count = 0;
        for (const row of data) if (!state.roll.some((r) => r.electionId === row.electionId && r.matricNumber === row.matricNumber)) { state.roll.push(row); count += 1; }
        return { count };
      },
      updateMany: async ({ where, data }: any) => {
        for (const row of state.roll) if (row.electionId === where.electionId && row.matricNumber === where.matricNumber) Object.assign(row, data);
      },
    },
    $transaction: async (fn: (tx: any) => Promise<void>) => fn(db),
  };
  return { db, state };
}

function file(contents: string) {
  const path = join(mkdtempSync(join(tmpdir(), 'class-list-')), 'class-list.csv');
  writeFileSync(path, contents);
  return path;
}

test('class list sync: seeds the student list, renames accounts, fills open voter lists only', async () => {
  const { db, state } = fakeDb();
  const csv = file('matricNumber,fullName,email\n251106026,"OYEBO, Yasir Oladimeji",\n251106001,"ADEGOKE, Adebusola Faith",\n,Jupeb Student,jupeb@x.test\n');
  const result = await syncClassList(db, csv);
  assert.deepEqual(result, { students: 3, rosterUpdated: 3, accountsRenamed: 1, votersAdded: 2 });
  assert.equal(state.accounts[0].fullName, 'OYEBO, Yasir Oladimeji');
  assert.equal(state.roster.find((row) => row.matricNumber === emailOnlyId('jupeb@x.test'))?.email, 'jupeb@x.test');
  assert.equal(state.roll.filter((row) => row.electionId === 'open').length, 3);
  assert.equal(state.roll.find((row) => row.matricNumber === '251106026')?.fullName, 'OYEBO, Yasir Oladimeji');
  assert.equal(state.roll.filter((row) => row.electionId === 'closed').length, 0);
  assert.ok(state.roster.some((row) => row.matricNumber === '251106999'), 'nothing is removed');

  const again = await syncClassList(db, csv);
  assert.deepEqual(again, { students: 3, rosterUpdated: 0, accountsRenamed: 0, votersAdded: 0 });
});

test('class list sync refuses an email that already belongs to another student', async () => {
  const { db } = fakeDb();
  await assert.rejects(syncClassList(db, file('matricNumber,fullName,email\n,Jupeb Student,taken@x.test\n')), /already belong/);
});
