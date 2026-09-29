import assert from 'node:assert/strict';
import test from 'node:test';
import { AnnouncementService } from '../src/modules/announcements/application/announcementService';
import type { AnnouncementRepository } from '../src/modules/announcements/infrastructure/announcementRepository';
import type { AnnouncementAiRunRepository } from '../src/modules/announcements/infrastructure/announcementAiRunRepository';

function createMockRepo() {
  const calls = {
    acknowledge: [] as Array<{ id: string; studentId: string }>,
    getAnalytics: [] as string[],
    getOutstandingStudents: [] as Array<{ id: string; params: { skip: number; take: number; search?: string } }>,
  };

  const mockRepo = {
    acknowledge: async (id: string, studentId: string) => {
      calls.acknowledge.push({ id, studentId });
      if (id === 'missing-announcement' || id === 'no-ack-announcement') return null;
      return { id, version: 2, acknowledged: true };
    },
    getAnalytics: async (id: string) => {
      calls.getAnalytics.push(id);
      if (id === 'missing-announcement') return null;
      return {
        totalReads: 50,
        totalAcknowledged: 40,
        uniqueReaders: 50,
        totalRegisteredStudents: 100,
        readRate: 0.5,
        acknowledgementRate: 0.8,
        classAcknowledgementRate: 0.4,
        pushStats: {
          delivered: 85,
          pending: 5,
          failed: 10,
        },
        version: 2,
        requiresAcknowledgement: true,
        status: 'published' as const,
      };
    },
    getOutstandingStudents: async (id: string, params: { skip: number; take: number; search?: string }) => {
      calls.getOutstandingStudents.push({ id, params });
      if (id === 'missing-announcement' || id === 'no-ack-announcement') return null;
      return {
        students: [
          {
            id: 's-1',
            matricNumber: 'SCI/20/001',
            fullName: 'Ada Lovelace',
            email: 'ada@school.edu',
            hasOpened: false,
            lastReadVersion: null,
            acknowledgedVersion: null,
            firstReadAt: null,
            lastReadAt: null,
            acknowledgedAt: null,
          },
          {
            id: 's-2',
            matricNumber: 'SCI/20/002',
            fullName: 'Alan Turing',
            email: 'alan@school.edu',
            hasOpened: true,
            lastReadVersion: 1,
            acknowledgedVersion: 1, // Stale: post is at version 2
            firstReadAt: new Date().toISOString(),
            lastReadAt: new Date().toISOString(),
            acknowledgedAt: new Date().toISOString(),
          },
        ],
        total: 2,
        version: 2,
      };
    },
  } as unknown as AnnouncementRepository;

  const mockAiRuns = {} as AnnouncementAiRunRepository;

  return { mockRepo, mockAiRuns, calls };
}

test('AnnouncementService.acknowledge records student acknowledgement on valid post', async () => {
  const { mockRepo, mockAiRuns, calls } = createMockRepo();
  const service = new AnnouncementService(mockRepo, mockAiRuns);

  const result = await service.acknowledge('announcement-1', 'student-123');
  assert.deepEqual(result, { id: 'announcement-1', version: 2, acknowledged: true });
  assert.equal(calls.acknowledge.length, 1);
  assert.equal(calls.acknowledge[0].studentId, 'student-123');
});

test('AnnouncementService.acknowledge throws notFound if post does not require acknowledgement or is missing', async () => {
  const { mockRepo, mockAiRuns } = createMockRepo();
  const service = new AnnouncementService(mockRepo, mockAiRuns);

  await assert.rejects(
    () => service.acknowledge('no-ack-announcement', 'student-123'),
    (err: { statusCode?: number; message?: string }) => {
      assert.equal(err.statusCode, 404);
      assert.match(err.message ?? '', /acknowledgement/i);
      return true;
    },
  );
});

test('AnnouncementService.getAnalytics returns aggregate read, acknowledgement and push stats', async () => {
  const { mockRepo, mockAiRuns, calls } = createMockRepo();
  const service = new AnnouncementService(mockRepo, mockAiRuns);

  const result = await service.getAnalytics('announcement-1');
  assert.equal(result.totalReads, 50);
  assert.equal(result.totalAcknowledged, 40);
  assert.equal(result.readRate, 0.5);
  assert.equal(result.acknowledgementRate, 0.8);
  assert.equal(result.classAcknowledgementRate, 0.4);
  assert.deepEqual(result.pushStats, { delivered: 85, pending: 5, failed: 10 });
  assert.equal(calls.getAnalytics.length, 1);
});

test('AnnouncementService.getAnalytics throws notFound for nonexistent announcements', async () => {
  const { mockRepo, mockAiRuns } = createMockRepo();
  const service = new AnnouncementService(mockRepo, mockAiRuns);

  await assert.rejects(
    () => service.getAnalytics('missing-announcement'),
    (err: { statusCode?: number }) => err.statusCode === 404,
  );
});

test('AnnouncementService.getOutstandingStudents paginates and filters unacknowledged students', async () => {
  const { mockRepo, mockAiRuns, calls } = createMockRepo();
  const service = new AnnouncementService(mockRepo, mockAiRuns);

  const result = await service.getOutstandingStudents('announcement-1', { page: 1, limit: 10, search: 'Ada' });
  assert.equal(result.total, 2);
  assert.equal(result.students.length, 2);
  assert.equal(result.page, 1);
  assert.equal(result.limit, 10);
  assert.equal(result.totalPages, 1);
  assert.equal(calls.getOutstandingStudents[0].params.search, 'Ada');
  assert.equal(calls.getOutstandingStudents[0].params.take, 10);
});

test('AnnouncementService.getOutstandingStudents throws notFound when post does not require acknowledgement', async () => {
  const { mockRepo, mockAiRuns } = createMockRepo();
  const service = new AnnouncementService(mockRepo, mockAiRuns);

  await assert.rejects(
    () => service.getOutstandingStudents('no-ack-announcement', { page: 1, limit: 10 }),
    (err: { statusCode?: number }) => err.statusCode === 404,
  );
});
