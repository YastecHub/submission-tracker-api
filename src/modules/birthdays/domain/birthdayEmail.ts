/**
 * The birthday card email. Built with tables and inline styles so it looks the same in
 * Gmail, Outlook and phone mail apps (email clients ignore most modern CSS).
 */
export const CLASS_LABEL = 'Pharm.D 200L';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** A square, face-centred crop of a Cloudinary photo (other https URLs are used as they are). */
export function cardPhotoUrl(photoUrl: string | null): string | null {
  if (!photoUrl || !/^https:\/\//i.test(photoUrl)) return null;
  return photoUrl.includes('/res.cloudinary.com/') && photoUrl.includes('/upload/')
    ? photoUrl.replace('/upload/', '/upload/c_fill,g_face,w_320,h_320,q_auto,f_jpg/')
    : photoUrl;
}

export function birthdayEmailSubject(name: string): string {
  return `Happy birthday, ${name}! 🎂💐`;
}

export function birthdayEmailHtml(input: { name: string; photoUrl: string | null; appUrl: string }): string {
  const name = escapeHtml(input.name);
  const photo = cardPhotoUrl(input.photoUrl);
  const link = `${input.appUrl}/student`;
  const portrait = photo
    ? `<img src="${escapeHtml(photo)}" width="140" height="140" alt="${name}" style="display:block;margin:0 auto;width:140px;height:140px;border-radius:50%;border:5px solid #ffffff;object-fit:cover;box-shadow:0 6px 18px rgba(107,33,168,0.25)">`
    : `<div style="margin:0 auto;width:140px;height:140px;border-radius:50%;border:5px solid #ffffff;background:#fde68a;font-size:64px;line-height:140px;text-align:center;box-shadow:0 6px 18px rgba(107,33,168,0.25)">🎂</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Happy birthday, ${name}!</title></head>
<body style="margin:0;padding:0;background:#f5f0ff">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">The whole class is celebrating you today 💐 Open your birthday card.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0ff;padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:24px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1f2937;box-shadow:0 10px 30px rgba(76,29,149,0.15)">
      <tr><td style="background:#4c1d95;background-image:linear-gradient(135deg,#7c3aed,#4c1d95);padding:22px 24px 70px;text-align:center">
        <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
          <td style="vertical-align:middle"><img src="${input.appUrl}/icon-192.png" width="34" height="34" alt="" style="display:block;border-radius:8px"></td>
          <td style="vertical-align:middle;padding-left:10px;color:#fde68a;font-size:20px;font-weight:800;letter-spacing:2px">NEXIUM</td>
        </tr></table>
        <p style="margin:18px 0 0;font-size:30px;letter-spacing:6px">🌸🌷🌹💐🌼🌺</p>
      </td></tr>
      <tr><td style="padding:0 24px;text-align:center">
        <div style="margin-top:-60px">${portrait}</div>
      </td></tr>
      <tr><td style="padding:18px 28px 6px;text-align:center">
        <p style="margin:0;color:#7c3aed;font-size:13px;font-weight:700;letter-spacing:3px;text-transform:uppercase">It's your special day</p>
        <h1 style="margin:8px 0 0;font-size:32px;line-height:1.2;color:#111827">Happy birthday, ${name}! 🎂</h1>
      </td></tr>
      <tr><td style="padding:14px 32px 0;text-align:center;font-size:16px;line-height:1.65;color:#374151">
        <p style="margin:0">Today the whole of Class Nexium is celebrating <strong>you</strong>. May this new year bring you good health, great results, sweet friendships and every good thing you've been praying for.</p>
        <p style="margin:14px 0 0">Thank you for being part of our class. We're so glad you're here 💜</p>
      </td></tr>
      <tr><td style="padding:22px 28px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px dashed #f59e0b;border-radius:16px">
          <tr><td style="padding:16px 18px;text-align:center;font-size:15px;color:#92400e">🎁 <strong>A birthday surprise is waiting for you.</strong><br>Open NEXIUM to get your flowers.</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:24px 28px 8px;text-align:center">
        <a href="${link}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:15px 34px;border-radius:12px">Open my flowers 💐</a>
      </td></tr>
      <tr><td style="padding:18px 28px 26px;text-align:center">
        <p style="margin:0;font-size:26px;letter-spacing:4px">🎉🎈🎊</p>
        <p style="margin:10px 0 0;font-size:15px;color:#4c1d95;font-weight:700">From all of ${CLASS_LABEL} 💜</p>
        <p style="margin:4px 0 0;font-size:12px;color:#9ca3af">Class Nexium '31 · Faculty of Pharmacy, University of Lagos</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
