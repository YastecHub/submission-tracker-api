import webpush from 'web-push';

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_CONTACT ?? 'mailto:admin@submitit.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

export async function sendPush(
  subscription: string,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  try {
    await webpush.sendNotification(JSON.parse(subscription), JSON.stringify(payload));
  } catch (err) {
    // Subscription may be expired — log but don't crash
    console.error('Push notification failed:', err);
  }
}
