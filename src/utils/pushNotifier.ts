import webpush from 'web-push';

let pushEnabled = false;
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (vapidPublicKey && vapidPrivateKey) {
  try {
    webpush.setVapidDetails(
      process.env.VAPID_CONTACT ?? 'mailto:admin@nexium.app',
      vapidPublicKey,
      vapidPrivateKey
    );
    pushEnabled = true;
  } catch (error) {
    console.warn('[push] Invalid VAPID configuration; push notifications are disabled.', error instanceof Error ? error.message : 'Unknown configuration error');
  }
} else if (vapidPublicKey || vapidPrivateKey) {
  console.warn('[push] Incomplete VAPID configuration; push notifications are disabled.');
}

export async function sendPush(
  subscription: string,
  payload: { title: string; body: string; url?: string }
): Promise<PushSendResult> {
  if (!pushEnabled) return { outcome: 'disabled', message: 'Push notifications are not configured' };
  try {
    await webpush.sendNotification(JSON.parse(subscription), JSON.stringify(payload), { timeout: 10_000 });
    return { outcome: 'delivered' };
  } catch (err) {
    const statusCode = typeof err === 'object' && err && 'statusCode' in err
      ? Number((err as { statusCode?: unknown }).statusCode)
      : undefined;
    const message = err instanceof Error ? err.message.slice(0, 500) : 'Push delivery failed';
    if (statusCode === 404 || statusCode === 410) return { outcome: 'invalid', statusCode, message };
    return { outcome: 'retry', statusCode, message };
  }
}

export type PushSendResult =
  | { outcome: 'delivered' }
  | { outcome: 'disabled' | 'invalid' | 'retry'; statusCode?: number; message: string };

export function isPushConfigured(): boolean {
  return pushEnabled;
}

export function getVapidPublicKey(): string | null {
  return pushEnabled && vapidPublicKey ? vapidPublicKey : null;
}
