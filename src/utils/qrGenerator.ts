import QRCode from 'qrcode';

export async function generateQR(submissionId: string): Promise<string> {
  const data = await QRCode.toDataURL(submissionId, {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    margin: 1,
  });
  return data; // base64 data URL
}
