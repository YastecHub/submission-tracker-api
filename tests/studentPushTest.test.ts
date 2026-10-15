import test from 'node:test';
import assert from 'node:assert/strict';
import { StudentPushSubscriptionService, TEST_NOTIFICATION } from '../src/modules/announcements/application/studentPushSubscriptionService';
import type { StudentPushSubscriptionRepository } from '../src/modules/announcements/infrastructure/studentPushSubscriptionRepository';
import type { PushSendResult } from '../src/utils/pushNotifier';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1';

function setup(outcome: PushSendResult, configured = true) {
  const removed: string[] = [];
  const sent: Array<{ subscription: any; payload: any }> = [];
  const repo = {
    findOwned: async (studentId: string, endpoint: string) => (studentId === 's1' && endpoint === ENDPOINT ? { endpoint, p256dh: 'key', auth: 'auth', expirationTime: null } : null),
    remove: async (_studentId: string, endpoint: string) => { removed.push(endpoint); return { count: 1 }; },
  } as unknown as StudentPushSubscriptionRepository;
  const service = new StudentPushSubscriptionService(repo, async (subscription, payload) => { sent.push({ subscription: JSON.parse(subscription), payload }); return outcome; }, () => configured);
  return { service, removed, sent };
}

test('test notification goes straight to the student\'s own device', async () => {
  const { service, sent } = setup({ outcome: 'delivered' });
  assert.deepEqual(await service.sendTest('s1', { endpoint: ENDPOINT }), { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subscription.endpoint, ENDPOINT);
  assert.deepEqual(sent[0].subscription.keys, { p256dh: 'key', auth: 'auth' });
  assert.equal(sent[0].payload, TEST_NOTIFICATION);
});

test('test notification: clear errors for another student\'s device, a dead device, a failure, and no server setup', async () => {
  await assert.rejects(setup({ outcome: 'delivered' }).service.sendTest('s2', { endpoint: ENDPOINT }), /not on for this device/);
  const dead = setup({ outcome: 'invalid', message: 'gone', statusCode: 410 });
  await assert.rejects(dead.service.sendTest('s1', { endpoint: ENDPOINT }), /Turn them on again/);
  assert.deepEqual(dead.removed, [ENDPOINT], 'a dead device is forgotten');
  await assert.rejects(setup({ outcome: 'retry', message: 'timeout' }).service.sendTest('s1', { endpoint: ENDPOINT }), /didn't answer/);
  await assert.rejects(setup({ outcome: 'delivered' }, false).service.sendTest('s1', { endpoint: ENDPOINT }), /aren't switched on for NEXIUM yet/);
});
