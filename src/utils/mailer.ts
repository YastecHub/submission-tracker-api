import { Resend } from 'resend';

type ClassRepRole = 'cr' | 'acr' | 'fin_sec';

const ROLE_LABELS: Record<ClassRepRole, string> = {
  cr: 'Class Representative (CR)',
  acr: 'Assistant Class Representative (ACR)',
  fin_sec: 'Financial Secretary (Fin Sec)',
};

const SHORT_ROLE_LABELS: Record<ClassRepRole, string> = {
  cr: 'Class Rep',
  acr: 'Assistant Class Rep',
  fin_sec: 'Financial Secretary',
};

// Every class rep has the same rights, so everyone gets the same guide.
const CLASS_REP_FEATURES = `
<ul style="padding-left:20px;line-height:1.9;color:#374151;">
  <li><strong>Submission Events</strong> - create assignments, attendance or lab events with a deadline, then close, reopen or extend them</li>
  <li><strong>Scan or Confirm</strong> - confirm student submissions by scanning their QR code or from the submissions list</li>
  <li><strong>Payment Collections</strong> - collect dues, review receipts, confirm or reject them and scan collection tickets</li>
  <li><strong>Class Ledger</strong> - record money in and out with proof, shown to students on the transparency page</li>
  <li><strong>Nexium Bulletin</strong> - write, publish and track class announcements</li>
  <li><strong>Export to Excel</strong> - download submission and payment lists anytime</li>
  <li><strong>Push Notifications</strong> - get alerted the moment a student submits, even when you're not on the app</li>
</ul>
`;

function appUrl(): string {
  const configured = process.env.CLIENT_URL?.split(',')[0]?.trim();
  return configured || 'https://nexium31.app';
}

function buildEmail(name: string, role: ClassRepRole): string {
  const roleLabel = ROLE_LABELS[role];
  const intro = 'As a class rep you can manage submissions, payments, the class ledger and the Bulletin.';

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
      <p style="color:#111827;font-size:16px;margin-top:0;">Hi <strong>${escapeEmailHtml(name)}</strong>,</p>
      <p style="color:#374151;font-size:15px;">
        You've been set up as the <strong>${roleLabel}</strong> on NEXIUM. ${intro}
      </p>

      <h2 style="color:#111827;font-size:16px;margin-bottom:8px;">Here's what you can do:</h2>
      ${CLASS_REP_FEATURES}

      <div style="margin-top:28px;text-align:center;">
        <a href="${appUrl()}/login"
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

function getResendClient(): Resend {
  return new Resend(process.env.RESEND_API_KEY);
}

export function getMailFrom(): string {
  const configured = process.env.MAIL_FROM?.trim();
  if (configured) {
    if (!configured.includes('<') && configured.includes('@')) {
      return `NEXIUM <${configured}>`;
    }
    return configured;
  }
  return 'NEXIUM <notifications@nexium31.app>';
}

export async function sendWelcomeEmail(
  name: string,
  email: string,
  role: ClassRepRole
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return; // skip silently in dev if key not set

  const client = getResendClient();

  await client.emails.send({
    from: getMailFrom(),
    to: email,
    subject: `Welcome to NEXIUM, ${name}! Here's your ${SHORT_ROLE_LABELS[role]} guide`,
    html: buildEmail(name, role),
  });
}

export async function sendStudentRegistrationOtp(name: string, email: string, code: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) throw new Error('Email delivery is not configured');
  const client = getResendClient();
  const result = await client.emails.send({
    from: getMailFrom(),
    to: email,
    subject: 'Your NEXIUM verification code',
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#111827">
      <h2>Verify your student account</h2>
      <p>Hello ${escapeEmailHtml(name)},</p>
      <p>Your verification code is:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p>
      <p>This code expires in 10 minutes. If you did not request it, you can ignore this message.</p>
    </div>`,
  });
  if (result.error) throw new Error(result.error.message);
}

function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
