import assert from 'node:assert/strict';
import test from 'node:test';
import { announcementNotificationPayload } from '../src/modules/announcements/domain/announcementNotification';
import {
  normalizePushEndpoint,
  normalizeStudentPushSubscription,
} from '../src/modules/announcements/domain/studentPushSubscription';
import {
  NotificationDeliveryWorker,
  retryAt,
} from '../src/modules/announcements/application/notificationDeliveryWorker';
import type { NotificationOutboxRepository } from '../src/modules/announcements/infrastructure/notificationOutboxRepository';

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

test('creates an update notification with [Updated] prefix and change note when specified', () => {
  const result = announcementNotificationPayload(
    {
      id: 'announcement-id-2',
      slug: 'exam-schedule',
      title: 'Exam Schedule',
      summary: 'Check the new room allocations for CSC 401.',
      priority: 'urgent',
      version: 5,
    },
    {
      isUpdate: true,
      changeNote: 'Venue moved to Hall B',
    },
  );
  assert.equal(result.title, '[Updated] Exam Schedule');
  assert.equal(result.tag, 'bulletin-announcement-id-2-5');
  assert.equal(result.priority, 'urgent');
  assert.match(result.body, /^Update: Venue moved to Hall B — /);
});

test('validates and normalizes a browser push subscription with base64url keys', () => {
  const result = normalizeStudentPushSubscription({
    endpoint: 'https://push.example.test/subscription/123',
    expirationTime: null,
    keys: { p256dh: 'abc_DEF-123', auth: 'auth_KEY-456' },
  });
  assert.equal(result.endpoint, 'https://push.example.test/subscription/123');
  assert.equal(result.expirationTime, null);
});

test('validates and accepts browser push subscriptions with standard base64 characters', () => {
  const result = normalizeStudentPushSubscription({
    endpoint: 'https://fcm.googleapis.com/fcm/send/sample-token',
    expirationTime: 1750000000000,
    keys: {
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtEvV6Uj2Kf+P/hZ8u1x==',
      auth: '5K3k/sA+8q2M==',
    },
  });
  assert.equal(result.endpoint, 'https://fcm.googleapis.com/fcm/send/sample-token');
  assert.equal(result.expirationTime?.getTime(), 1750000000000);
});

test('rejects insecure endpoints and malformed keys', () => {
  assert.throws(() => normalizePushEndpoint('http://push.example.test/subscription'), /invalid/i);
  assert.throws(
    () =>
      normalizeStudentPushSubscription({
        endpoint: 'https://push.example.test/subscription',
        keys: { p256dh: 'bad key with spaces', auth: 'valid_key' },
      }),
    /key is invalid/i,
  );
  assert.throws(
    () =>
      normalizeStudentPushSubscription({
        endpoint: 'https://push.example.test/subscription',
        keys: { p256dh: 'short', auth: 'valid_key' },
      }),
    /key is invalid/i,
  );
});

test('computes exponential retry backoff with jitter within expected bounds', () => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const before = Date.now();
    const retryDate = retryAt(attempt);
    const diffMs = retryDate.getTime() - before;
    const baseMinutes = Math.min(360, 2 ** Math.max(0, attempt - 1));
    const minMs = baseMinutes * 0.75 * 60_000;
    const maxMs = baseMinutes * 1.25 * 60_000;

    assert.ok(diffMs >= minMs, `Attempt ${attempt}: delay ${diffMs}ms should be >= ${minMs}ms`);
    assert.ok(diffMs <= maxMs, `Attempt ${attempt}: delay ${diffMs}ms should be <= ${maxMs}ms`);
  }
});

function createMockRepository() {
  const calls = {
    complete: [] as string[],
    invalidate: [] as Array<{ subscriptionId: string; error: string }>,
    retry: [] as Array<{ id: string; availableAt: Date; error: string }>,
    dead: [] as Array<{ id: string; error: string }>,
    cleanupCount: 0,
  };

  const mockRepo = {
    claim: async () => [],
    findSubscription: async (id: string) => {
      if (id === 'sub-expired') {
        return {
          id: 'sub-expired',
          endpoint: 'https://push.test/expired',
          p256dh: 'p256key',
          auth: 'authkey',
          expirationTime: new Date(Date.now() - 60_000),
        };
      }
      if (id === 'sub-valid') {
        return {
          id: 'sub-valid',
          endpoint: 'https://push.test/valid',
          p256dh: 'p256key',
          auth: 'authkey',
          expirationTime: null,
        };
      }
      return null;
    },
    complete: async (id: string) => {
      calls.complete.push(id);
    },
    invalidateSubscription: async (subscriptionId: string, error: string) => {
      calls.invalidate.push({ subscriptionId, error });
    },
    retry: async (id: string, availableAt: Date, error: string) => {
      calls.retry.push({ id, availableAt, error });
    },
    dead: async (id: string, error: string) => {
      calls.dead.push({ id, error });
    },
    cleanupInvalidSubscriptions: async () => {
      calls.cleanupCount += 1;
      return { removedSubscriptions: 1, prunedOutboxRows: 2 };
    },
  } as unknown as NotificationOutboxRepository;

  return { mockRepo, calls };
}

test('NotificationDeliveryWorker completes outbox on successful push delivery', async () => {
  const { mockRepo, calls } = createMockRepository();
  const worker = new NotificationDeliveryWorker(mockRepo, async () => ({ outcome: 'delivered' }));

  const item = {
    id: 'outbox-1',
    subscriptionId: 'sub-valid',
    payload: {
      title: 'Exam update',
      body: 'Schedule changed',
      url: '/student/news/exam-update',
      tag: 'bulletin-1-1',
      priority: 'important',
    },
    attempts: 1,
  };

  // @ts-expect-error accessing private deliver for testing
  await worker.deliver(item);

  assert.deepEqual(calls.complete, ['outbox-1']);
  assert.equal(calls.retry.length, 0);
  assert.equal(calls.dead.length, 0);
  assert.equal(calls.invalidate.length, 0);
});

test('NotificationDeliveryWorker invalidates subscription on 404/410 push response', async () => {
  const { mockRepo, calls } = createMockRepository();
  const worker = new NotificationDeliveryWorker(mockRepo, async () => ({
    outcome: 'invalid',
    statusCode: 410,
    message: 'Subscription has expired or is invalid',
  }));

  const item = {
    id: 'outbox-2',
    subscriptionId: 'sub-valid',
    payload: {
      title: 'Class update',
      body: 'Room changed',
      url: '/student/news/class-update',
      tag: 'bulletin-2-1',
      priority: 'normal',
    },
    attempts: 1,
  };

  // @ts-expect-error accessing private deliver for testing
  await worker.deliver(item);

  assert.equal(calls.complete.length, 0);
  assert.equal(calls.retry.length, 0);
  assert.equal(calls.invalidate.length, 1);
  assert.equal(calls.invalidate[0].subscriptionId, 'sub-valid');
  assert.match(calls.invalidate[0].error, /expired or is invalid/i);
});

test('NotificationDeliveryWorker retries on transient errors if attempts < MAX_ATTEMPTS', async () => {
  const { mockRepo, calls } = createMockRepository();
  const worker = new NotificationDeliveryWorker(mockRepo, async () => ({
    outcome: 'retry',
    message: 'Gateway timeout',
  }));

  const item = {
    id: 'outbox-3',
    subscriptionId: 'sub-valid',
    payload: {
      title: 'Lab update',
      body: 'Prep notes',
      url: '/student/news/lab-update',
      tag: 'bulletin-3-1',
      priority: 'normal',
    },
    attempts: 2,
  };

  // @ts-expect-error accessing private deliver for testing
  await worker.deliver(item);

  assert.equal(calls.complete.length, 0);
  assert.equal(calls.retry.length, 1);
  assert.equal(calls.retry[0].id, 'outbox-3');
  assert.equal(calls.dead.length, 0);
});

test('NotificationDeliveryWorker transitions to dead when attempts reach limit', async () => {
  const { mockRepo, calls } = createMockRepository();
  const worker = new NotificationDeliveryWorker(mockRepo, async () => ({
    outcome: 'retry',
    message: 'Gateway timeout',
  }));

  const item = {
    id: 'outbox-4',
    subscriptionId: 'sub-valid',
    payload: {
      title: 'Lab update',
      body: 'Prep notes',
      url: '/student/news/lab-update',
      tag: 'bulletin-4-1',
      priority: 'normal',
    },
    attempts: 5,
  };

  // @ts-expect-error accessing private deliver for testing
  await worker.deliver(item);

  assert.equal(calls.complete.length, 0);
  assert.equal(calls.retry.length, 0);
  assert.equal(calls.dead.length, 1);
  assert.equal(calls.dead[0].id, 'outbox-4');
});

test('NotificationDeliveryWorker invalidates expired subscriptions without pushing', async () => {
  let pushCalled = false;
  const { mockRepo, calls } = createMockRepository();
  const worker = new NotificationDeliveryWorker(mockRepo, async () => {
    pushCalled = true;
    return { outcome: 'delivered' };
  });

  const item = {
    id: 'outbox-5',
    subscriptionId: 'sub-expired',
    payload: {
      title: 'Expired check',
      body: 'Should not push',
      url: '/student/news/expired',
      tag: 'bulletin-5-1',
      priority: 'normal',
    },
    attempts: 1,
  };

  // @ts-expect-error accessing private deliver for testing
  await worker.deliver(item);

  assert.equal(pushCalled, false);
  assert.equal(calls.invalidate.length, 1);
  assert.equal(calls.invalidate[0].subscriptionId, 'sub-expired');
});

test('NotificationDeliveryWorker triggers cleanup on invalid subscriptions and outbox', async () => {
  const { mockRepo, calls } = createMockRepository();
  const worker = new NotificationDeliveryWorker(mockRepo);

  const result = await worker.cleanup(14);
  assert.equal(calls.cleanupCount, 1);
  assert.equal(result.removedSubscriptions, 1);
  assert.equal(result.prunedOutboxRows, 2);
});
