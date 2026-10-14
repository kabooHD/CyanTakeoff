// PDF date strings (ISO 32000 7.9.4): D:YYYYMMDDHHmmSSOHH'mm'.
export function parsePdfDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?'?/.exec(s.trim());
  if (!m) return null;
  const n = (v: string | undefined, d: number) => (v ? Number(v) : d);
  const utc = Date.UTC(n(m[1], 0), n(m[2], 1) - 1, n(m[3], 1), n(m[4], 0), n(m[5], 0), n(m[6], 0));
  const sign = m[7] === '-' ? -1 : m[7] === '+' ? 1 : 0;
  const off = sign * (n(m[8], 0) * 60 + n(m[9], 0));
  const d = new Date(utc - off * 60000);
  return Number.isNaN(d.getTime()) ? null : d;
}
