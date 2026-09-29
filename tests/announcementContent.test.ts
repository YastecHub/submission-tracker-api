import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAnnouncementDocument } from '../src/modules/announcements/domain/announcementContent';
import { canEditAnnouncement, canPublishAnnouncement } from '../src/modules/announcements/domain/announcementPolicy';

test('normalizes structured announcement sections', () => {
  const document = normalizeAnnouncementDocument({
    version: 1,
    sections: [{ id: 'intro', heading: '  Welcome  ', body: '  Read this carefully.  ' }],
  });
  assert.deepEqual(document, {
    version: 1,
    sections: [{ id: 'intro', heading: 'Welcome', body: 'Read this carefully.' }],
  });
});

test('rejects empty announcement content', () => {
  assert.throws(
    () => normalizeAnnouncementDocument({ version: 1, sections: [{ heading: '', body: '   ' }] }),
    /needs content/,
  );
});

test('enforces that all exco roles can publish announcements across categories', () => {
  // All exco roles (dev, cr, acr, fin_sec) have equal rights to publish any category
  assert.equal(canPublishAnnouncement('dev', 'finance'), true);
  assert.equal(canPublishAnnouncement('cr', 'finance'), true);
  assert.equal(canPublishAnnouncement('acr', 'finance'), true);
  assert.equal(canPublishAnnouncement('fin_sec', 'finance'), true);
  assert.equal(canPublishAnnouncement('cr', 'academic'), true);
  assert.equal(canPublishAnnouncement('fin_sec', 'general'), true);
  assert.equal(canPublishAnnouncement('student' as any, 'general'), false);
});

test('allows all exco roles to edit active announcements regardless of category or creator', () => {
  const user = { id: 'assistant-cr', role: 'acr' as const };
  const finSecUser = { id: 'fin-sec', role: 'fin_sec' as const };

  // All exco roles can edit active announcements (draft or published)
  assert.equal(canEditAnnouncement(user, { createdBy: user.id, category: 'general', status: 'draft' }), true);
  assert.equal(canEditAnnouncement(user, { createdBy: user.id, category: 'finance', status: 'published' }), true);
  assert.equal(canEditAnnouncement(finSecUser, { createdBy: 'other-user', category: 'general', status: 'draft' }), true);
  assert.equal(canEditAnnouncement(finSecUser, { createdBy: 'other-user', category: 'academic', status: 'published' }), true);

  // Archived is always non-editable
  assert.equal(canEditAnnouncement({ id: 'developer', role: 'dev' }, { createdBy: user.id, category: 'general', status: 'archived' }), false);
  assert.equal(canEditAnnouncement(finSecUser, { createdBy: user.id, category: 'finance', status: 'archived' }), false);
});
