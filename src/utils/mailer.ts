import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FEATURES_CR = `
<ul style="padding-left:20px;line-height:1.9;color:#374151;">
  <li><strong>Create Submission Events</strong> — set up assignments, attendance or lab events with a deadline</li>
  <li><strong>Shareable Link + QR Code</strong> — share one link or QR and students fill in their details instantly</li>
  <li><strong>Scan to Confirm</strong> — use the in-app QR scanner to confirm submissions physically in real time</li>
  <li><strong>Manual Confirm</strong> — tap any submission to confirm it from the submissions list</li>
  <li><strong>Live Dashboard</strong> — see total, confirmed, and pending counts update as students submit</li>
  <li><strong>Search &amp; Filter</strong> — quickly find a student by name or matric number</li>
  <li><strong>Export to Excel</strong> — download the full submission list as a spreadsheet anytime</li>
  <li><strong>Close / Re-open Events</strong> — block new submissions when done, reopen if needed</li>
  <li><strong>Push Notifications</strong> — enable browser notifications to be alerted the moment a student submits, even when you're not on the app</li>
</ul>
`;

const FEATURES_ACR = `
<ul style="padding-left:20px;line-height:1.9;color:#374151;">
  <li><strong>Scan to Confirm</strong> — use the in-app QR scanner to confirm student submissions physically</li>
  <li><strong>Manual Confirm</strong> — tap any submission in the list to mark it confirmed</li>
  <li><strong>View Submissions</strong> — browse all submissions and track confirmed vs pending counts</li>
  <li><strong>Search Students</strong> — find any student quickly by name or matric number</li>
  <li><strong>Push Notifications</strong> — get instant browser alerts when students submit</li>
</ul>
`;

function buildEmail(name: string, role: 'cr' | 'acr'): string {
  const roleLabel = role === 'cr' ? 'Class Representative (CR)' : 'Assistant Class Representative (ACR)';
  const features = role === 'cr' ? FEATURES_CR : FEATURES_ACR;
  const intro =
    role === 'cr'
      ? 'You have full control over submission events — from creating them to confirming and exporting records.'
      : 'You can confirm student submissions by scanning QR codes or from the submissions list.';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:Inter,Arial,sans-serif;background:#f9fafb;margin:0;padding:32px 16px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

    <div style="background:linear-gradient(135deg,#7c3aed 0%,#6b21a8 50%,#4c1d95 100%);padding:32px 32px 24px;">
      <h1 style="color:#fde68a;margin:0;font-size:26px;font-weight:800;letter-spacing:1px;">NEXIUM</h1>
      <p style="color:#e9d5ff;margin:6px 0 0;font-size:14px;">Class management • submissions • payments • transparency</p>
    </div>

    <div style="padding:32px;">
      <p style="color:#111827;font-size:16px;margin-top:0;">Hi <strong>${name}</strong>,</p>
      <p style="color:#374151;font-size:15px;">
        You've been set up as the <strong>${roleLabel}</strong> on NEXIUM. ${intro}
      </p>

      <h2 style="color:#111827;font-size:16px;margin-bottom:8px;">Here's what you can do:</h2>
      ${features}

      <div style="margin-top:28px;text-align:center;">
        <a href="https://submitit.vercel.app"
           style="background:linear-gradient(135deg,#7c3aed,#6b21a8);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:15px;display:inline-block;box-shadow:0 4px 12px rgba(107,33,168,0.3);">
          Open NEXIUM
        </a>
      </div>

      <p style="color:#9ca3af;font-size:12px;margin-top:32px;text-align:center;">
        This email was sent because you logged into NEXIUM for the first time.<br/>
        If you didn't expect this, please ignore it.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

export async function sendWelcomeEmail(
  name: string,
  email: string,
  role: 'cr' | 'acr'
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return; // skip silently in dev if key not set

  const roleLabel = role === 'cr' ? 'Class Representative' : 'Assistant Class Rep';

  await resend.emails.send({
    from: 'NEXIUM <onboarding@resend.dev>',
    to: email,
    subject: `Welcome to NEXIUM, ${name}! Here's your ${roleLabel} guide`,
    html: buildEmail(name, role),
  });
}
