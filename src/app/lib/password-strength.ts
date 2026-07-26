// What the password still lacks. Drives both the hover tips and the score,
// so the two cannot drift apart.
export function passwordTips(pw: string): string[] {
  const tips: string[] = [];
  if (pw.length < 12) tips.push("Use 12 or more characters.");
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) tips.push("Mix upper and lower case.");
  if (!/\d/.test(pw)) tips.push("Add a number.");
  if (!/[^A-Za-z0-9]/.test(pw)) tips.push("Add a symbol.");
  return tips;
}

// Rough strength score, not entropy: length does most of the work, character
// variety nudges it up. 0 means below the 8-character minimum.
export function passwordScore(pw: string): number {
  if (pw.length < 8) return 0;
  return Math.min(4, 5 - passwordTips(pw).length);
}
