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
  assert.equal(canPublishAnnouncement('cr', 'academic'), true);
  assert.equal(canPublishAnnouncement('cr', 'finance'), false);
  assert.equal(canPublishAnnouncement('fin_sec', 'finance'), true);
  assert.equal(canPublishAnnouncement('fin_sec', 'general'), false);
  assert.equal(canPublishAnnouncement('dev', 'emergency'), true);
});

test('allows contributors to edit their own drafts but not published posts', () => {
  const user = { id: 'assistant-cr', role: 'acr' as const };
  assert.equal(canEditAnnouncement(user, { createdBy: user.id, category: 'general', status: 'draft' }), true);
  assert.equal(canEditAnnouncement(user, { createdBy: user.id, category: 'general', status: 'published' }), false);
  assert.equal(canEditAnnouncement({ id: 'developer', role: 'dev' }, { createdBy: user.id, category: 'general', status: 'archived' }), false);
});
