import assert from 'node:assert/strict';
import test from 'node:test';
import { announcementNotificationPayload } from '../src/modules/announcements/domain/announcementNotification';
import {
  normalizePushEndpoint,
  normalizeStudentPushSubscription,
} from '../src/modules/announcements/domain/studentPushSubscription';

test('creates a bounded notification pointing to the published student article', () => {
  const result = announcementNotificationPayload({
    id: 'announcement-id',
    slug: 'course-update',
    title: 'Course update',
    summary: 'A'.repeat(260),
    priority: 'important',
    version: 4,
  });
  assert.equal(result.url, '/student/news/course-update');
  assert.equal(result.tag, 'bulletin-announcement-id-4');
  assert.equal(result.body.length, 240);
  assert.match(result.body, /…$/);
});

test('validates and normalizes a browser push subscription', () => {
  const result = normalizeStudentPushSubscription({
    endpoint: 'https://push.example.test/subscription/123',
    expirationTime: null,
    keys: { p256dh: 'abc_DEF-123', auth: 'auth_KEY-456' },
  });
  assert.equal(result.endpoint, 'https://push.example.test/subscription/123');
  assert.equal(result.expirationTime, null);
});

test('rejects insecure endpoints and malformed keys', () => {
  assert.throws(() => normalizePushEndpoint('http://push.example.test/subscription'), /invalid/i);
  assert.throws(() => normalizeStudentPushSubscription({
    endpoint: 'https://push.example.test/subscription',
    keys: { p256dh: 'bad key', auth: 'valid_key' },
  }), /key is invalid/i);
});
