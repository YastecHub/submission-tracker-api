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

test('enforces category-specific publication authority', () => {
  // dev, cr, acr can publish any category
  assert.equal(canPublishAnnouncement('dev', 'finance'), true);
  assert.equal(canPublishAnnouncement('cr', 'finance'), true);
  assert.equal(canPublishAnnouncement('acr', 'finance'), true);
  assert.equal(canPublishAnnouncement('cr', 'academic'), true);
  // fin_sec can only publish finance
  assert.equal(canPublishAnnouncement('fin_sec', 'finance'), true);
  assert.equal(canPublishAnnouncement('fin_sec', 'general'), false);
});

test('allows contributors to edit their own drafts but not published posts unless they can manage the category', () => {
  const user = { id: 'assistant-cr', role: 'acr' as const };
  // ACR can edit own drafts
  assert.equal(canEditAnnouncement(user, { createdBy: user.id, category: 'general', status: 'draft' }), true);
  // ACR can edit published posts in any category (including finance) because they can manage any
  assert.equal(canEditAnnouncement(user, { createdBy: user.id, category: 'finance', status: 'published' }), true);
  assert.equal(canEditAnnouncement(user, { createdBy: user.id, category: 'general', status: 'published' }), true);
  // Archived is always false
  assert.equal(canEditAnnouncement({ id: 'developer', role: 'dev' }, { createdBy: user.id, category: 'general', status: 'archived' }), false);
  // Creator of a draft can edit it
  assert.equal(canEditAnnouncement(user, { createdBy: user.id, category: 'finance', status: 'draft' }), true);
  // But cannot edit others' drafts if they can't manage the category
  const finSecUser = { id: 'fin-sec', role: 'fin_sec' as const };
  assert.equal(canEditAnnouncement(finSecUser, { createdBy: 'other-user', category: 'general', status: 'draft' }), false);
});
