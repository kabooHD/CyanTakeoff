// Trusted Certificates (Revu: Signatures > Trusted Identities): certificates
// whose signatures, and those of certificates they issued, are trusted.
// Kept in this browser as DER (base64).
import { create } from 'zustand';

export interface TrustedCert { name: string; der: string }
const LS = 'cyantakeoff:trusted-certs';
const load = (): TrustedCert[] => { try { return JSON.parse(localStorage.getItem(LS) ?? '[]'); } catch { return []; } };

export const useTrust = create<{ certs: TrustedCert[] }>(() => ({ certs: typeof localStorage === 'undefined' ? [] : load() }));

export function saveTrust(certs: TrustedCert[]) {
  useTrust.setState({ certs });
  try { localStorage.setItem(LS, JSON.stringify(certs)); } catch { /* storage unavailable */ }
}

const b64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
export const trustBytes = (): Uint8Array[] => useTrust.getState().certs.map((c) => Uint8Array.from(atob(c.der), (ch) => ch.charCodeAt(0)));
export const toTrusted = (name: string, der: Uint8Array): TrustedCert => ({ name, der: b64(der) });
