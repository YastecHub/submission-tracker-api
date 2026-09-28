import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AnnouncementService } from '../src/modules/announcements/application/announcementService';

const user = { id: 'staff-1', email: 'staff@example.com', name: 'Staff', role: 'cr' as const };
const source = 'CSC 401 test is on Friday 2 October at 10am in Lab 3.';
const runId = 'f14491d0-98db-4c45-93b3-cfb63904a941';
const section = { id: 'suggested-section', heading: 'Test details', body: source };
const suggestion = {
  title: { value: 'CSC 401 test', sourceQuotes: ['CSC 401 test'] },
  summary: { value: source, sourceQuotes: [source] },
  category: { value: 'academic', reason: 'Classification' },
  priority: { value: 'important', reason: 'Priority' },
  sections: [{ ...section, sourceQuotes: [source] }],
  warnings: [],
  splitSuggestions: [],
};

function input(title = suggestion.title.value) {
  return {
    title,
    summary: suggestion.summary.value,
    content: { version: 1, sections: [section] },
    rawSource: source,
    category: suggestion.category.value,
    priority: suggestion.priority.value,
    sourceType: 'official_class',
    contributorName: '',
    contributorCredit: '',
    isPinned: false,
    paymentEventId: '',
    expectedVersion: 1,
    aiReview: {
      runId,
      acceptedFields: ['title', 'summary', 'category', 'priority', 'sections'],
      acceptedSectionIds: [section.id],
    },
  };
}

function setup() {
  let updateParams: Record<string, unknown> | null = null;
  const repository = {
    findForAction: async () => ({ id: 'announcement-1', createdBy: user.id, category: 'academic', status: 'draft', version: 1 }),
    findPaymentOption: async () => null,
    updateWithVersion: async (params: Record<string, unknown>) => {
      updateParams = params;
      return { id: 'announcement-1', status: 'draft', version: 2 };
    },
  };
  const runs = {
    findOwnedCompleted: async () => ({
      id: runId,
      sourceHash: createHash('sha256').update(source).digest('hex'),
      announcementId: 'announcement-1',
      result: suggestion,
    }),
  };
  const service = new AnnouncementService(repository as never, runs as never);
  return { service, getUpdateParams: () => updateParams };
}

test('passes validated selective acceptance into the atomic announcement update', async () => {
  const { service, getUpdateParams } = setup();
  await service.update('announcement-1', input(), user);
  const params = getUpdateParams() as {
    origin: string;
    aiAcceptance: { runId: string; requestedBy: string; acceptedFields: { fields: string[]; sectionIds: string[] } };
  };
  assert.equal(params.origin, 'ai_assisted');
  assert.equal(params.aiAcceptance.runId, runId);
  assert.equal(params.aiAcceptance.requestedBy, user.id);
  assert.deepEqual(params.aiAcceptance.acceptedFields.fields, ['title', 'summary', 'category', 'priority', 'sections']);
  assert.deepEqual(params.aiAcceptance.acceptedFields.sectionIds, [section.id]);
});

test('rejects an accepted assistant field that was edited before saving', async () => {
  const { service, getUpdateParams } = setup();
  await assert.rejects(
    service.update('announcement-1', input('Edited title'), user),
    /accepted assistant suggestion was changed/i,
  );
  assert.equal(getUpdateParams(), null);
});

test('rejects a review if its source changed after organization', async () => {
  const { service, getUpdateParams } = setup();
  const changed = input();
  changed.rawSource = `${source} Bring your ID card.`;
  await assert.rejects(service.update('announcement-1', changed, user), /source material changed/i);
  assert.equal(getUpdateParams(), null);
});
