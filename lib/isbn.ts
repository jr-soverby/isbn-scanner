/**
 * Turns user input or a scanned EAN-13 into a valid ISBN-13, or null.
 * Accepts ISBN-13 (978/979 prefix) and ISBN-10, with or without hyphens/spaces.
 */
export function normalizeIsbn(raw: string): string | null {
  const s = raw.replace(/[\s-]/g, '').toUpperCase();

  if (/^\d{13}$/.test(s)) {
    return /^97[89]/.test(s) && isValidIsbn13(s) ? s : null;
  }
  if (/^\d{9}[\dX]$/.test(s)) {
    return isValidIsbn10(s) ? isbn10To13(s) : null;
  }
  return null;
}

/** True for any 13-digit EAN, used to tell "not a book" apart from "misread". */
export function isEan13(raw: string): boolean {
  return /^\d{13}$/.test(raw) && isValidIsbn13(raw);
}

function isValidIsbn13(s: string): boolean {
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

function isValidIsbn10(s: string): boolean {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = s[i];
    if (ch === 'X' && i !== 9) return false;
    sum += (ch === 'X' ? 10 : Number(ch)) * (10 - i);
  }
  return sum % 11 === 0;
}

function isbn10To13(s: string): string {
  const core = '978' + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  return core + ((10 - (sum % 10)) % 10);
}
