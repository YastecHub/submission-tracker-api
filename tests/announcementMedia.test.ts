import assert from 'node:assert/strict';
import test from 'node:test';
import {
  announcementSectionIds,
  normalizeMediaUpdates,
  normalizeMediaUploadMetadata,
} from '../src/modules/announcements/domain/announcementMedia';

const sections = new Set(['intro', 'details']);

test('validates alt text, captions and section placement for every uploaded image', () => {
  const result = normalizeMediaUploadMetadata(JSON.stringify([
    { altText: 'Students working in the computer laboratory', caption: 'CSC 401 practical', sectionId: 'details' },
    { altText: 'Course timetable showing the test date', caption: '', sectionId: null },
  ]), 2, sections);
  assert.deepEqual(result, [
    { altText: 'Students working in the computer laboratory', caption: 'CSC 401 practical', sectionId: 'details' },
    { altText: 'Course timetable showing the test date', caption: null, sectionId: null },
  ]);
});

test('rejects uploads without useful alt text or with unknown sections', () => {
  assert.throws(
    () => normalizeMediaUploadMetadata([{ altText: ' ', sectionId: null }], 1, sections),
    /alt text is required/i,
  );
  assert.throws(
    () => normalizeMediaUploadMetadata([{ altText: 'Laboratory', sectionId: 'missing' }], 1, sections),
    /existing section/i,
  );
});

test('uses submitted array order and requires every existing image exactly once', () => {
  const result = normalizeMediaUpdates([
    { id: 'second', altText: 'Second image', sectionId: 'details' },
    { id: 'first', altText: 'First image', sectionId: null },
  ], ['first', 'second'], sections);
  assert.deepEqual(result.map(({ id, sortOrder }) => ({ id, sortOrder })), [
    { id: 'second', sortOrder: 0 },
    { id: 'first', sortOrder: 1 },
  ]);
  assert.throws(
    () => normalizeMediaUpdates([{ id: 'first', altText: 'First image' }], ['first', 'second'], sections),
    /every announcement image/i,
  );
});

test('extracts stable section identifiers from announcement content', () => {
  assert.deepEqual(
    [...announcementSectionIds({ version: 1, sections: [{ id: 'intro' }, { id: 'details' }] })],
    ['intro', 'details'],
  );
});
