export function emailReflectsStudentName(email: string, fullName: string): boolean {
  const localPart = email.split('@')[0]?.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase() ?? '';
  const tokens = Array.from(new Set(
    fullName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3),
  ));
  const requiredMatches = Math.min(2, tokens.length);
  return requiredMatches > 0 && tokens.filter((token) => localPart.includes(token)).length >= requiredMatches;
}
