import { badRequest } from '../../../shared/errors/AppError';

export interface StudentPushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: Date | null;
}

function key(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw badRequest(`${label} is invalid`);
  }
  return value;
}

export function normalizeStudentPushSubscription(value: unknown): StudentPushSubscriptionInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('Notification subscription is invalid');
  }
  const input = value as { endpoint?: unknown; expirationTime?: unknown; keys?: unknown };
  if (typeof input.endpoint !== 'string' || input.endpoint.length > 2048) {
    throw badRequest('Notification subscription is invalid');
  }
  try {
    const endpoint = new URL(input.endpoint);
    if (endpoint.protocol !== 'https:') throw new Error('invalid protocol');
  } catch {
    throw badRequest('Notification subscription is invalid');
  }
  if (!input.keys || typeof input.keys !== 'object' || Array.isArray(input.keys)) {
    throw badRequest('Notification subscription keys are invalid');
  }
  const keys = input.keys as { p256dh?: unknown; auth?: unknown };
  let expirationTime: Date | null = null;
  if (input.expirationTime !== undefined && input.expirationTime !== null) {
    if (typeof input.expirationTime !== 'number' || !Number.isFinite(input.expirationTime)) {
      throw badRequest('Notification subscription expiry is invalid');
    }
    expirationTime = new Date(input.expirationTime);
    if (Number.isNaN(expirationTime.getTime())) throw badRequest('Notification subscription expiry is invalid');
  }
  return {
    endpoint: input.endpoint,
    p256dh: key(keys.p256dh, 'Notification subscription key'),
    auth: key(keys.auth, 'Notification authentication key'),
    expirationTime,
  };
}

export function normalizePushEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw badRequest('Notification subscription is invalid');
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== 'https:') throw new Error('invalid protocol');
  } catch {
    throw badRequest('Notification subscription is invalid');
  }
  return value;
}
