// Password prompt for protected files, and Document > Security (Ctrl+L):
// no security, or password security (AES-256) with a password to open, a
// permissions password and what others may do. Applied when the file is
// saved. When a file was opened with its open password only, changing its
// security needs the permissions (owner) password, as in Revu.
import { useState } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import { setAskPassword } from '../model/prompts';
import { PERM, unlock, type NewSecurity } from '../pdf/crypt';

// ---------- password prompt ----------

interface Ask { name: string; retry: boolean; resolve: (pw: string | null) => void }
const useAsk = create<{ ask: Ask | null }>(() => ({ ask: null }));
setAskPassword((name, retry) => new Promise((resolve) => useAsk.setState({ ask: { name, retry, resolve } })));

export function PasswordPrompt() {
  const ask = useAsk((x) => x.ask);
  const [pw, setPw] = useState('');
  if (!ask) return null;
  const done = (v: string | null) => { useAsk.setState({ ask: null }); setPw(''); ask.resolve(v); };
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="Password" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') done(null); }}>
        <div className="modal-title">Password</div>
        <form className="scale-dialog" onSubmit={(e) => { e.preventDefault(); done(pw); }}>
          <p>“{ask.name}” is password protected. Enter a password to open it.</p>
          {ask.retry && <p className="error" role="alert">Wrong password. Try again.</p>}
          <div className="form-row"><span>Password</span><input autoFocus type="password" aria-label="Document password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <div className="modal-actions"><span className="spacer" /><button className="primary" type="submit">OK</button><button type="button" onClick={() => done(null)}>Cancel</button></div>
        </form>
      </div>
    </div>
  );
}

// ---------- Security dialog ----------

export const useSecurityDialog = create<{ open: boolean }>(() => ({ open: false }));

export function SecurityDialog() {
  const open = useSecurityDialog((x) => x.open);
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  return open && d ? <SecurityForm d={d} /> : null;
}

const PERMS: [keyof typeof PERM, string][] = [['print', 'Printing'], ['modify', 'Changing the document'], ['copy', 'Copying content'], ['annotate', 'Commenting (markups)'], ['fillForms', 'Filling form fields'], ['assemble', 'Page assembly']];

function SecurityForm({ d }: { d: DocState }) {
  const cur = d.securityChange === 'remove' ? null : d.securityChange ?? null;
  const protectedNow = d.securityChange ? d.securityChange !== 'remove' : !!d.security;
  const [on, setOn] = useState(protectedNow);
  const [requireOpen, setRequireOpen] = useState(cur ? !!cur.userPassword : true);
  const [user, setUser] = useState(cur?.userPassword ?? '');
  const [user2, setUser2] = useState(cur?.userPassword ?? '');
  const [owner, setOwner] = useState(cur?.ownerPassword ?? '');
  const startP = cur?.permissions ?? d.security?.info.P ?? -1;
  const [perms, setPerms] = useState<Record<string, boolean>>(Object.fromEntries(PERMS.map(([k]) => [k, (startP & PERM[k]) !== 0])));
  const [auth, setAuth] = useState('');
  const [error, setError] = useState('');
  const close = () => useSecurityDialog.setState({ open: false });
  const needOwner = !!d.security && !d.security.owner;
  const ok = async () => {
    if (needOwner) {
      const u = await unlock(d.security!.info, auth);
      if (!u?.owner) { setError('Enter the permissions password to change this file\'s security.'); return; }
    }
    if (on && requireOpen && (!user || user !== user2)) { setError(user ? 'The open passwords do not match.' : 'Enter a password to open the document.'); return; }
    if (on && !requireOpen && !owner) { setError('Set a permissions password, or require a password to open.'); return; }
    const change: NewSecurity | 'remove' = on
      ? { userPassword: requireOpen ? user : '', ownerPassword: owner, permissions: PERMS.reduce((p, [k]) => p | (perms[k] ? PERM[k] : 0), 0) | (perms.print ? PERM.printHigh : 0) }
      : 'remove';
    useApp.setState((s) => ({ docs: s.docs.map((x) => (x.id === d.id ? { ...x, securityChange: change, dirty: true } : x)) }));
    useApp.getState().setStatus(on ? 'Password security will be applied when you save' : 'Security will be removed when you save');
    close();
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Security" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Security</div>
        <div className="scale-dialog">
          <div className="form-row"><span>Current</span><span className="muted">{d.security ? `Password security (${d.security.info.R >= 5 ? 'AES-256' : d.security.info.stm === 'AESV2' ? 'AES-128' : `RC4 ${d.security.info.length}-bit`})${d.security.owner ? '' : ', opened with the open password'}` : 'None'}</span></div>
          {needOwner && <div className="form-row"><span>Permissions password</span><input type="password" aria-label="Current permissions password" value={auth} onChange={(e) => setAuth(e.target.value)} /></div>}
          <div className="form-row"><span>Security</span>
            <select aria-label="Security method" value={on ? 'password' : 'none'} onChange={(e) => setOn(e.target.value === 'password')}>
              <option value="none">No Security</option><option value="password">Password Security (AES-256)</option>
            </select>
          </div>
          {on && <>
            <div className="form-row"><label><input type="checkbox" checked={requireOpen} onChange={(e) => setRequireOpen(e.target.checked)} /> Require a password to open the document</label></div>
            {requireOpen && <>
              <div className="form-row"><span>Open password</span><input type="password" aria-label="Open password" value={user} onChange={(e) => setUser(e.target.value)} /></div>
              <div className="form-row"><span>Confirm</span><input type="password" aria-label="Confirm open password" value={user2} onChange={(e) => setUser2(e.target.value)} /></div>
            </>}
            <div className="form-row"><span>Permissions password</span><input type="password" aria-label="Permissions password" value={owner} onChange={(e) => setOwner(e.target.value)} /></div>
            <div className="form-row"><span>Allow</span>
              <div className="perm-list">{PERMS.map(([k, label]) => (
                <label key={k}><input type="checkbox" checked={perms[k]} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} /> {label}</label>
              ))}</div>
            </div>
            <p className="muted small">Permissions are honoured by PDF viewers that respect them; the open password encrypts the file.</p>
          </>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions"><span className="spacer" /><button className="primary" onClick={ok}>OK</button><button onClick={close}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}
