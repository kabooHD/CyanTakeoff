// Revu menu equivalents: Keyboard Shortcuts editor and Profiles (saved
// workspace setups: panels, snaps, tool defaults, Tool Chest, shortcuts).
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useApp } from '../model/store';
import { comboFromEvent } from '../tools/tools';
import { allCommands, effectiveCombo, usersOf } from './commands';
import { pickFile } from './toolActions';
import { DEFAULT_PREFS, type Prefs } from '../model/prefs';
import { saveStatusConfig, useStatusModels } from '../model/statusModels';
import { profileColumns, saveProfileColumns } from '../model/columns';

export const usePrefsDialog = create<{ open: 'keys' | 'profiles' | 'prefs' | null }>(() => ({ open: null }));
const close = () => usePrefsDialog.setState({ open: null });

export function PrefsDialogs() {
  const open = usePrefsDialog((x) => x.open);
  if (open === 'keys') return <KeysDialog />;
  if (open === 'profiles') return <ProfilesDialog />;
  if (open === 'prefs') return <PreferencesDialog />;
  return null;
}

function Frame({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

function KeysDialog() {
  const s = useApp();
  const [q, setQ] = useState('');
  const [capture, setCapture] = useState<string | null>(null);
  const custom = s.customKeys;
  // Capture the next key combination for the command being changed.
  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      if (e.key === 'Escape') { setCapture(null); return; }
      const combo = comboFromEvent(e);
      const others = usersOf(combo, custom).filter((x) => x.id !== capture);
      if (others.length && !confirm(`${combo} is used by ${others.map((x) => x.label).join(', ')}. Reassign it?`)) { setCapture(null); return; }
      const next = { ...custom, [capture]: combo };
      for (const o of others) next[o.id] = ''; // Revu "Reassign": the other command loses it
      s.setCustomKeys(next);
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capture, custom, s]);
  const cmds = allCommands().filter((c) => !q || `${c.group} ${c.label}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Frame title="Keyboard Shortcuts" wide>
      <div className="scale-dialog">
        <input aria-label="Filter commands" placeholder="Filter commands" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="keys-list">
          <table className="cc-list">
            <thead><tr><th>Group</th><th>Command</th><th>Shortcut</th><th /></tr></thead>
            <tbody>
              {cmds.map((c) => {
                const cur = effectiveCombo(c.id, custom);
                return (
                  <tr key={c.id} className={c.id in custom ? 'custom' : ''}>
                    <td className="muted">{c.group}</td><td>{c.label}</td>
                    <td>{capture === c.id ? <em>Press keys… (Esc cancels)</em> : <kbd>{cur || '—'}</kbd>}</td>
                    <td className="cc-actions">
                      <button onClick={() => setCapture(c.id)} aria-label={`Change shortcut for ${c.label}`}>Change</button>
                      <button disabled={!(c.id in custom)} onClick={() => { const n = { ...custom }; delete n[c.id]; s.setCustomKeys(n); }}>Reset</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          <button disabled={!Object.keys(custom).length} onClick={() => s.setCustomKeys({})}>Reset All</button>
          <span className="spacer" />
          <button className="primary" onClick={close}>Close</button>
        </div>
      </div>
    </Frame>
  );
}

// ---------------- Profiles ----------------

const LS = 'cyantakeoff:profiles';
interface Profile {
  name: string;
  left: unknown; right: unknown; markupsList: boolean; toggles: unknown;
  toolDefaults: unknown; toolSets: unknown; customKeys: Record<string, string>;
  statusConfig?: unknown; profileColumns?: unknown;
}
const load = (): Profile[] => { try { return JSON.parse(localStorage.getItem(LS) ?? '[]'); } catch { return []; } };
const store = (p: Profile[]) => { try { localStorage.setItem(LS, JSON.stringify(p)); } catch { /* storage unavailable */ } };

function capture(name: string): Profile {
  const s = useApp.getState();
  return { name, left: s.left, right: s.right, markupsList: s.markupsList, toggles: s.toggles, toolDefaults: s.toolDefaults, toolSets: s.toolSets, customKeys: s.customKeys, statusConfig: useStatusModels.getState(), profileColumns: profileColumns() };
}

export function applyProfile(p: Profile) {
  const s = useApp.getState();
  useApp.setState({ toggles: p.toggles as never, toolDefaults: p.toolDefaults as never, toolSets: p.toolSets as never });
  s.setCustomKeys(p.customKeys ?? {});
  s.setPanels({ left: p.left as never, right: p.right as never, markupsList: p.markupsList });
  if (p.statusConfig) saveStatusConfig(p.statusConfig as never);
  if (Array.isArray(p.profileColumns)) saveProfileColumns(p.profileColumns as never);
  s.setStatus(`Profile "${p.name}" applied`);
}

function ProfilesDialog() {
  const [list, setList] = useState(load);
  const save = (l: Profile[]) => { setList(l); store(l); };
  return (
    <Frame title="Profiles">
      <div className="scale-dialog">
        <p className="muted small">A profile saves your workspace: open panels, snaps, tool defaults, Tool Chest and keyboard shortcuts.</p>
        <table className="cc-list">
          <tbody>
            {list.map((p, i) => (
              <tr key={i}>
                <td>{p.name}</td>
                <td className="cc-actions">
                  <button onClick={() => { applyProfile(p); close(); }}>Apply</button>
                  <button onClick={() => save(list.map((x, k) => (k === i ? capture(p.name) : x)))}>Update</button>
                  <button onClick={() => {
                    const href = URL.createObjectURL(new Blob([JSON.stringify({ format: 'cyantakeoff-profile', version: 1, ...p })], { type: 'application/json' }));
                    Object.assign(document.createElement('a'), { href, download: `${p.name}.ctprofile.json` }).click();
                  }}>Export</button>
                  <button onClick={() => save(list.filter((_, k) => k !== i))}>Delete</button>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td className="muted">No saved profiles.</td></tr>}
          </tbody>
        </table>
        <div className="modal-actions">
          <button onClick={() => { const n = prompt('Profile name', 'My Profile'); if (n) save([...list.filter((x) => x.name !== n), capture(n)]); }}>Save Current…</button>
          <button onClick={async () => {
            const f = await pickFile('.json,application/json');
            if (!f) return;
            try { const p = JSON.parse(await f.text()); if (p.format !== 'cyantakeoff-profile') throw new Error(); save([...list, p]); }
            catch { useApp.getState().setStatus(`${f.name} is not a CyanTakeoff profile`); }
          }}>Import…</button>
          <span className="spacer" />
          <button className="primary" onClick={close}>Close</button>
        </div>
      </div>
    </Frame>
  );
}

// ---------- Preferences (Ctrl+K) ----------

const SECTIONS = ['General', 'Document', 'Navigation', 'Grid & Snap', 'Markup', 'Measure', 'Sketch', 'Forms', 'Signature', 'Markups List', 'Layers', 'Spelling', 'Presentation', 'Advanced'] as const;
type Section = typeof SECTIONS[number];

function PreferencesDialog() {
  const s = useApp();
  const p = s.prefs;
  const [section, setSection] = useState<Section>('General');
  const set = (patch: Partial<Prefs>) => s.setPrefs(patch);
  const check = (key: keyof Prefs, label: string, hint?: string) => (
    <label className="pref-row" title={hint}><input type="checkbox" checked={!!p[key]} onChange={(e) => set({ [key]: e.target.checked } as Partial<Prefs>)} /> {label}</label>
  );
  const select = <K extends keyof Prefs>(key: K, label: string, options: [Prefs[K] & string, string][]) => (
    <label className="pref-row"><span>{label}</span>
      <select aria-label={label} value={p[key] as string} onChange={(e) => set({ [key]: e.target.value } as Partial<Prefs>)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  const body: Record<Section, React.ReactNode> = {
    General: (
      <>
        <label className="pref-row"><span>User</span><input aria-label="User" value={s.author} onChange={(e) => s.setAuthor(e.target.value)} /></label>
        <label className="pref-row"><span>Theme</span>
          <select aria-label="Theme" value={s.toggles.darkMode ? 'dark' : 'light'} onChange={(e) => { if ((e.target.value === 'dark') !== !!s.toggles.darkMode) s.toggle('darkMode'); }}>
            <option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </label>
        {select('tabTruncation', 'Tab truncation', [['end', 'Cut long names at the end'], ['start', 'Cut long names at the start']])}
        {check('showRecentOnStartup', 'Show recent files on startup', 'Opens the File Access panel when no document is open')}
        {check('reopenLastSession', 'Reopen files from last session on startup', 'Files whose access is still granted open on their own; the others wait for a click in the File Access panel')}
        <label className="pref-row"><input type="checkbox" checked={!!s.toggles.crosshair} onChange={() => s.toggle('crosshair')} /> Show full-screen crosshair</label>
        <p className="muted small">File Access</p>
        {check('recentEnabled', 'Enable recent files')}
        <label className="pref-row"><span>Items in recent</span><input aria-label="Items in recent" type="number" min={0} max={100} value={p.recentMax} onChange={(e) => set({ recentMax: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></label>
        <label className="pref-row"><span>Recent history limit</span><input aria-label="Recent history limit" type="number" min={0} max={3650} value={p.recentDays} onChange={(e) => set({ recentDays: Math.max(0, Math.min(3650, Number(e.target.value) || 0)) })} /> days (0: no limit)</label>
      </>
    ),
    Document: (
      <>
        {select('defaultLayout', 'Page layout when opening', [['single', 'Single Page'], ['continuous', 'Continuous'], ['auto', 'By page size (under 14 in: Continuous)']])}
        {select('openDisplay', 'Display when opening', [['fitPage', 'Fit Page'], ['fitWidth', 'Fit Width'], ['actual', 'Actual Size']])}
        {select('saveMode', 'Save mode', [['publish', 'Publish Without Revisions (rewrite the file)'], ['revisions', 'Maintain Revisions (earlier versions stay in the file)'], ['compressed', 'Publish Compressed (object streams)']])}
        {check('rotateAllPages', 'Rotate all pages by default', 'Rotate Clockwise / Counterclockwise (Shift+Alt+Plus / Minus) turn every page')}
        {check('rememberLastPage', 'Remember last page', 'A file reopens on the page it was closed at')}
        {check('reorderBookmarks', 'Automatically reorder bookmarks', 'Top-level bookmarks follow their pages when thumbnails are reordered')}
        {check('redirectOnSlipSheet', 'Redirect links and bookmarks when inserting pages with Slip Sheet')}
        {check('findHyperlinks', 'Find hyperlinks in PDF content', 'Web addresses in the page text open on click')}
        <label className="pref-row"><span>Maximum zoom</span><input aria-label="Maximum zoom" type="number" min={400} max={6400} step={100} value={p.maxZoom} onChange={(e) => set({ maxZoom: Math.max(400, Math.min(6400, Number(e.target.value) || 6400)) })} /> %</label>
      </>
    ),
    'Grid & Snap': (
      <>
        <label className="pref-row"><span>Grid spacing</span><input aria-label="Grid spacing" type="number" min={2} max={288} value={p.gridSpacing} onChange={(e) => set({ gridSpacing: Math.max(2, Math.min(288, Number(e.target.value) || 12)) })} /> pt</label>
        <label className="pref-row"><span>Snap sensitivity</span><input aria-label="Snap sensitivity" type="range" min={5} max={25} value={p.snapSensitivity} onChange={(e) => set({ snapSensitivity: Number(e.target.value) })} /> {p.snapSensitivity} px</label>
        <label className="pref-row"><span>Snap colour</span><input aria-label="Snap colour" type="color" value={p.snapColor} onChange={(e) => set({ snapColor: e.target.value })} /></label>
        <label className="pref-row"><input type="checkbox" checked={!!s.toggles.grid} onChange={() => s.toggle('grid')} /> Show grid</label>
        <label className="pref-row"><input type="checkbox" checked={!!s.toggles.snap} onChange={() => s.toggle('snap')} /> Snap to grid</label>
        <label className="pref-row"><input type="checkbox" checked={!!s.toggles.content} onChange={() => s.toggle('content')} /> Snap to content</label>
        <label className="pref-row"><input type="checkbox" checked={!!s.toggles.markup} onChange={() => s.toggle('markup')} /> Snap to markup</label>
      </>
    ),
    'Markups List': (
      <>
        {check('zoomFitOnSelect', 'Zoom fit markups when selected', 'Selecting a row zooms to the markup instead of only scrolling to it')}
        {check('dominantOnly', 'Show measurement value for dominant markup only', 'A Group item shows its first markup\'s values instead of the sums')}
        {check('excludeFilteredOnExport', 'Exclude filtered markups on export', 'The Summary leaves out markups the filtered list does not show')}
        {check('wrapComments', 'Wrap comment text')}
        <label className="pref-row" title="Markups the filtered list does not show are dimmed on the page"><span>Dim filtered markups</span><input aria-label="Dim filtered markups" type="number" min={0} max={100} step={5} value={p.filteredDim} onChange={(e) => set({ filteredDim: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /> %</label>
      </>
    ),
    Layers: (
      <>
        {check('hideChildLayers', 'Hide child layers when hiding parent layers')}
        {check('layersOnPageOnly', 'Show layers on page only (when the panel opens)')}
      </>
    ),
    Spelling: (
      <>
        {check('spellCheck', 'Enable spell check', 'Text being typed is underlined by the browser\'s checker')}
        {check('spellUpperCase', 'Include upper case words')}
        <label className="pref-row"><span>Spell check colour</span><input aria-label="Spell check colour" type="color" value={p.spellColor} onChange={(e) => set({ spellColor: e.target.value })} /></label>
        <label className="pref-row pref-col"><span>Custom words (one per line)</span><textarea aria-label="Custom words" rows={5} value={p.customWords} onChange={(e) => set({ customWords: e.target.value })} /></label>
      </>
    ),
    Navigation: (
      <>
        {select('wheelSingle', 'Single page mode: mouse wheel', [['zoom', 'Zooms'], ['scroll', 'Scrolls']])}
        {select('wheelContinuous', 'Continuous mode: mouse wheel', [['zoom', 'Zooms'], ['scroll', 'Scrolls']])}
        {check('reverseWheel', 'Reverse mouse wheel when zooming')}
        {check('lockPanFitWidth', 'Lock panning in Fit Width', 'At the fit-width zoom, dragging the page only moves it vertically')}
        <label className="pref-row"><span>Sensitivity</span><input aria-label="Wheel sensitivity" type="range" min={1} max={10} value={p.wheelSensitivity} onChange={(e) => set({ wheelSensitivity: Number(e.target.value) })} /> {p.wheelSensitivity}</label>
        <p className="muted small">Ctrl+wheel always zooms and Shift+wheel always scrolls. Synchronize Views is in the View menu.</p>
      </>
    ),
    Markup: (
      <>
        {check('dynamicDefaults', 'Dynamically set as default properties', 'A property changed on a markup becomes the default of its tool')}
        <label className="pref-row"><input type="checkbox" checked={!!s.toggles.reuse} onChange={() => s.toggle('reuse')} /> Reuse tools</label>
        {check('autosizeText', 'Autosize text box and callout markups')}
        {check('scaleGroupProps', 'Scale appearance properties for grouped markups', 'Scaling a Group with its purple handles scales line widths and text sizes too')}
        {check('retainLayer', 'Retain layer information when copying markups', 'A markup pasted into another file keeps its layer; the layer is created there when missing')}
        {check('printPopups', 'Print pop-ups', 'Note comments print in a box beside the note')}
        <label className="pref-row"><span>Pop-up opacity</span><input aria-label="Pop-up opacity" type="number" min={0} max={100} step={5} disabled={!p.printPopups} value={p.popupOpacity} onChange={(e) => set({ popupOpacity: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /> %</label>
        {check('showAuthorDate', 'Show author and date when hovering a markup')}
        {select('dragShapes', 'Drag behavior for shapes', [['rect', 'Drag Rectangle (Ctrl+drag: curve)'], ['curves', 'Drag Curves (Ctrl+drag: rectangle)']])}
        {check('textHighlighting', 'Enable Text Highlighting', 'The Highlight tool marks the text it is dragged over; Ctrl+drag draws a free highlight. Off: always a free highlight')}
        {check('copyHighlightedText', 'Copy highlighted text into markup comment')}
        {select('snapshotDpi', 'Snapshot resolution', [[72 as never, '72 dpi'], [144 as never, '144 dpi'], [216 as never, '216 dpi'], [300 as never, '300 dpi']])}
        {check('includeMarkupsInSnapshots', 'Include markups in snapshots')}
      </>
    ),
    Measure: (
      <>
        {check('splitCountBySpace', 'Automatically split count measurements by Space', 'A count continued in another Space starts a new count (same style and subject)')}
        <p className="muted small">Dynamic Fill defaults (the tool's Settings change them for the session).</p>
        <label className="pref-row"><span>Fill size</span><input aria-label="Fill size" type="number" min={1} max={40} value={p.fillSize} onChange={(e) => set({ fillSize: Math.max(1, Number(e.target.value)) })} /> pt</label>
        <label className="pref-row"><span>Fill colour</span><input aria-label="Fill colour" type="color" value={p.fillColor} onChange={(e) => set({ fillColor: e.target.value })} /></label>
        <label className="pref-row"><span>Boundary size</span><input aria-label="Boundary size" type="number" min={1} max={40} value={p.fillBoundarySize} onChange={(e) => set({ fillBoundarySize: Math.max(1, Number(e.target.value)) })} /> pt</label>
        <label className="pref-row"><span>Boundary colour</span><input aria-label="Boundary colour" type="color" value={p.fillBoundaryColor} onChange={(e) => set({ fillBoundaryColor: e.target.value })} /></label>
        {select('fillSpeed', 'Fill speed', [['Slow', 'Slow'], ['Medium', 'Medium'], ['Fast', 'Fast']])}
        {select('fillSensitivity', 'Edge sensitivity', [['Low', 'Low'], ['Medium', 'Medium'], ['High', 'High']])}
        {check('fillHideMarkups', 'Momentarily hide markups while filling')}
      </>
    ),
    Sketch: (
      <>
        {select('sketchRotation', 'Rotation input', [['page', 'Relative to the page'], ['relative', 'Relative to the connected line']])}
        {select('ellipseMode', 'Ellipse mode', [['size', 'Width and height'], ['radius', 'Radius']])}
      </>
    ),
    Forms: (
      <>
        <label className="pref-row"><span>Highlight colour</span><input aria-label="Field highlight colour" type="color" value={p.fieldHighlightColor} onChange={(e) => set({ fieldHighlightColor: e.target.value })} /></label>
        <label className="pref-row"><span>Highlight opacity</span><input aria-label="Field highlight opacity" type="range" min={0} max={100} value={p.fieldHighlightOpacity} onChange={(e) => set({ fieldHighlightOpacity: Number(e.target.value) })} /> {p.fieldHighlightOpacity}%</label>
        <label className="pref-row"><input type="checkbox" checked={!s.toggles.noFieldHighlight} onChange={() => s.toggle('noFieldHighlight')} /> Highlight fields</label>
        {check('singleKeyInForms', 'Enable single key shortcuts', 'A tool\'s one-key shortcut (R, A, L…) works while a form field has the focus')}
      </>
    ),
    Presentation: (
      <>
        {check('presLoop', 'Loop after last page')}
        <label className="pref-row"><span>Auto advance every</span><input aria-label="Auto advance seconds" type="number" min={0} max={600} value={p.presAdvance} onChange={(e) => set({ presAdvance: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })} /> seconds (0: off)</label>
        <label className="pref-row"><span>Background colour</span><input aria-label="Presentation background" type="color" value={p.presBackground} onChange={(e) => set({ presBackground: e.target.value })} /></label>
        {select('presCursor', 'Mouse cursor', [['auto', 'Hide after a pause'], ['show', 'Always shown'], ['hide', 'Hidden']])}
      </>
    ),
    Advanced: (
      <>
        <label className="pref-row" title="How strongly the page content still shows under the Dimmer (Ctrl+F5)"><span>Dimmer amount</span><input aria-label="Dimmer amount" type="number" min={5} max={95} step={5} value={s.dimLevel} onChange={(e) => s.setView({ dimLevel: Math.max(5, Math.min(95, Number(e.target.value) || 50)) })} /> %</label>
        <p className="muted small">Rendering is the browser's (pdf.js); line weights can be disabled in the View menu.</p>
      </>
    ),
    Signature: (
      <>
        {select('hashAlgorithm', 'Algorithm', [['sha256', 'SHA-256'], ['sha384', 'SHA-384'], ['sha512', 'SHA-512']])}
        <p className="muted small">Digital IDs are chosen when signing (.pfx / .p12); trusted identities are managed in the Signatures panel.</p>
      </>
    ),
  };
  return (
    <Frame title="Preferences" wide>
      <div className="prefs-dialog">
        <div className="prefs-nav" role="tablist">
          {SECTIONS.map((x) => <button key={x} role="tab" aria-selected={section === x} className={section === x ? 'active' : ''} onClick={() => setSection(x)}>{x}</button>)}
        </div>
        <div className="prefs-body">{body[section]}</div>
      </div>
      <div className="modal-actions">
        <button onClick={() => { if (confirm('Reset every preference to its default?')) s.setPrefs(DEFAULT_PREFS); }}>Reset</button>
        <span className="spacer" />
        <button className="primary" onClick={close}>Close</button>
      </div>
    </Frame>
  );
}
