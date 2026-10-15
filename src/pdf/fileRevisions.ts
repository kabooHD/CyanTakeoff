// Revisions inside a PDF (Revu: Save Mode "Maintain Revisions", File >
// Revert As). A file saved by incremental update keeps every earlier
// version: each ends at its own %%EOF, so the bytes up to that marker are
// a complete PDF as it was then.

export interface FileRevision { /** 1-based, 1 = the first save. */ n: number; /** Byte length of the file at that revision. */ end: number }

/** Every revision in the file, oldest first; the last one is the current file. */
export function fileRevisions(bytes: Uint8Array): FileRevision[] {
  const out: FileRevision[] = [];
  const M = [0x25, 0x25, 0x45, 0x4f, 0x46]; // %%EOF
  for (let i = 0; i + 5 <= bytes.length; i++) {
    if (bytes[i] !== 0x25 || bytes[i + 1] !== 0x25) continue;
    let ok = true;
    for (let k = 2; k < 5; k++) if (bytes[i + k] !== M[k]) { ok = false; break; }
    if (!ok) continue;
    let end = i + 5;
    while (end < bytes.length && (bytes[end] === 0x0d || bytes[end] === 0x0a)) end++;
    out.push({ n: out.length + 1, end });
    i = end - 1;
  }
  return out;
}

/** The file as it was at revision `r`. */
export const revisionBytes = (bytes: Uint8Array, r: FileRevision) => bytes.slice(0, r.end);
