import webpush from 'web-push';

let pushEnabled = false;
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (vapidPublicKey && vapidPrivateKey) {
  try {
    webpush.setVapidDetails(
      process.env.VAPID_CONTACT ?? 'mailto:admin@submitit.app',
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
): Promise<void> {
  if (!pushEnabled) return;
  try {
    await webpush.sendNotification(JSON.parse(subscription), JSON.stringify(payload));
  } catch (err) {
    // Subscription may be expired — log but don't crash
    console.error('Push notification failed:', err);
  }
}
