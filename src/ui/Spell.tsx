// Spell check, as in Revu: text being typed is underlined by the browser's
// own checker (right-click for suggestions); Check Spelling (F7) walks the
// text of every markup (text, comments, replies) and text form field, with
// Ignore Once / Ignore All / Add to Dictionary / Change / Change All; Markup
// Spelling Mistakes puts a Squiggly markup under each misspelled word of the
// PDF's own text. Dictionaries: Hunspell (wooorm/dictionaries), 11
// languages loaded on first use from /dict/; words added go to a personal
// dictionary. The language is chosen in either dialog (Revu: Preferences >
// Spelling) and remembered.
import { skipSpelling } from '../model/prefs';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type NSpell from 'nspell';
import { useApp, type DocState } from '../model/store';
import { parsePageRange } from '../model/measure';
import { replaceAll, replaceAt, words } from '../model/spellText';
import { toolById } from '../tools/tools';
import { pageText } from './toolActions';

const LS = 'cyantakeoff:dictionary', LANG_LS = 'cyantakeoff:spell-language';
const spellers = new Map<string, Promise<NSpell>>();

/** Languages whose dictionaries are served under /dict (see vite.config.ts). */
export const SPELL_LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English (US)' }, { code: 'en-gb', name: 'English (UK)' }, { code: 'fr', name: 'French' }, { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' }, { code: 'it', name: 'Italian' }, { code: 'nl', name: 'Dutch' }, { code: 'pt', name: 'Portuguese' },
  { code: 'pl', name: 'Polish' }, { code: 'sv', name: 'Swedish' }, { code: 'da', name: 'Danish' },
];

/** The remembered language, or the browser's when we have it, else English. */
export function spellLanguage(): string {
  try { const v = localStorage.getItem(LANG_LS); if (v && SPELL_LANGUAGES.some((l) => l.code === v)) return v; } catch { /* storage unavailable */ }
  const nav = (navigator.language || 'en').toLowerCase();
  if (nav === 'en-gb') return 'en-gb';
  const two = nav.slice(0, 2);
  return SPELL_LANGUAGES.some((l) => l.code === two) ? two : 'en';
}
export function setSpellLanguage(code: string) {
  try { localStorage.setItem(LANG_LS, code); } catch { /* storage unavailable */ }
}

const personal = (): string[] => { try { return JSON.parse(localStorage.getItem(LS) ?? '[]'); } catch { return []; } };

export function loadSpeller(lang = spellLanguage()): Promise<NSpell> {
  let sp = spellers.get(lang);
  if (!sp) {
    sp = (async () => {
      const base = import.meta.env.BASE_URL;
      const [{ default: nspell }, aff, dic] = await Promise.all([
        import('nspell'),
        fetch(`${base}dict/${lang}.aff`).then((r) => r.text()),
        fetch(`${base}dict/${lang}.dic`).then((r) => r.text()),
      ]);
      const s = nspell(aff, dic);
      for (const w of personal()) s.add(w);
      return s;
    })();
    spellers.set(lang, sp);
    sp.catch(() => spellers.delete(lang));
  }
  return sp;
}

export async function addToDictionary(word: string) {
  try { localStorage.setItem(LS, JSON.stringify([...new Set([...personal(), word])])); } catch { /* storage unavailable */ }
  // Personal words apply in every language.
  for (const sp of spellers.values()) (await sp.catch(() => null))?.add(word);
}

/** Language select for the spell dialogs. */
function LanguageSelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <div className="form-row"><span>Language</span>
      <select aria-label="Spelling language" value={value} onChange={(e) => { setSpellLanguage(e.target.value); onChange(e.target.value); }}>
        {SPELL_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
      </select>
    </div>
  );
}

// ---------- the text to check ----------

type Target =
  | { kind: 'markup'; id: string; field: 'text' | 'comment'; page: number; label: string }
  | { kind: 'reply'; id: string; reply: string; page: number; label: string }
  | { kind: 'field'; name: string; page: number; label: string };

function targets(d: DocState): Target[] {
  const out: Target[] = [];
  const ms = [...d.markups].sort((a, b) => a.page - b.page);
  for (const m of ms) {
    const name = `${m.subject || toolById(m.type).name} (page ${d.loaded.pages[m.page]?.label ?? m.page + 1})`;
    if (m.text) out.push({ kind: 'markup', id: m.id, field: 'text', page: m.page, label: name });
    if (m.comment) out.push({ kind: 'markup', id: m.id, field: 'comment', page: m.page, label: `${name}, comment` });
    for (const r of m.replies ?? []) if (r.text) out.push({ kind: 'reply', id: m.id, reply: r.id, page: m.page, label: `${name}, reply` });
  }
  for (const f of d.loaded.fields) {
    if (f.type !== 'text') continue;
    out.push({ kind: 'field', name: f.name, page: f.widgets[0]?.page ?? 0, label: `Form field ${f.name}` });
  }
  return out;
}

function textOf(d: DocState, t: Target): string {
  if (t.kind === 'field') return String(d.formValues[t.name] ?? d.loaded.fields.find((f) => f.name === t.name)?.value ?? '');
  const m = d.markups.find((x) => x.id === t.id);
  if (!m) return '';
  if (t.kind === 'reply') return m.replies?.find((r) => r.id === t.reply)?.text ?? '';
  return (t.field === 'text' ? m.text : m.comment) ?? '';
}

function setText(t: Target, text: string) {
  const s = useApp.getState();
  if (t.kind === 'field') { s.setFieldValue(t.name, text); return; }
  if (t.kind === 'reply') { s.updateMarkups([t.id], (m) => ({ replies: m.replies?.map((r) => (r.id === t.reply ? { ...r, text } : r)) })); return; }
  s.updateMarkups([t.id], () => (t.field === 'text' ? { text } : { comment: text }));
}

const active = () => { const s = useApp.getState(); return s.docs.find((d) => d.id === s.activeId); };

// ---------- Check Spelling (F7) ----------

interface Issue { t: number; start: number; end: number; word: string; suggestions: string[] }
interface SpellState { open: boolean; issue: Issue | null; done: boolean; ignoreAll: string[]; from: { t: number; off: number } }
export const useSpell = create<SpellState>(() => ({ open: false, issue: null, done: false, ignoreAll: [], from: { t: 0, off: 0 } }));

async function findNext() {
  const d = active();
  if (!d) return;
  const sp = await loadSpeller();
  const st = useSpell.getState();
  const s0 = useApp.getState();
  const list = targets(d);
  for (let t = st.from.t; t < list.length; t++) {
    const text = textOf(d, list[t]);
    for (const w of words(text)) {
      if (t === st.from.t && w.start < st.from.off) continue;
      if (st.ignoreAll.includes(w.word) || skipSpelling(w.word, s0.prefs.spellUpperCase, s0.prefs.customWords) || sp.correct(w.word)) continue;
      useSpell.setState({ issue: { t, start: w.start, end: w.end, word: w.word, suggestions: sp.suggest(w.word).slice(0, 8) }, done: false });
      const tg = list[t];
      const s = useApp.getState();
      if (tg.kind !== 'field') { s.setPage(tg.page); s.select([tg.id]); }
      else s.setPage(tg.page);
      return;
    }
  }
  useSpell.setState({ issue: null, done: true });
}

export function checkSpelling() {
  if (!active()) return;
  useSpell.setState({ open: true, issue: null, done: false, ignoreAll: [], from: { t: 0, off: 0 } });
  findNext().catch((e) => useApp.getState().setStatus(`Spell check unavailable: ${(e as Error).message}`));
}

export function SpellDialog() {
  const st = useSpell();
  const [choice, setChoice] = useState('');
  useEffect(() => { setChoice(st.issue?.suggestions[0] ?? st.issue?.word ?? ''); }, [st.issue]);
  if (!st.open) return null;
  const d = active();
  const list = d ? targets(d) : [];
  const iss = st.issue;
  const tg = iss ? list[iss.t] : undefined;
  const text = d && tg ? textOf(d, tg) : '';
  const close = () => useSpell.setState({ open: false, issue: null });
  const next = (off: number) => { if (iss) { useSpell.setState({ from: { t: iss.t, off } }); findNext(); } };
  const restart = () => { useSpell.setState({ issue: null, done: false, from: { t: 0, off: 0 } }); findNext().catch((e) => useApp.getState().setStatus(`Spell check unavailable: ${(e as Error).message}`)); };
  const change = (all: boolean) => {
    if (!iss || !tg || !d) return;
    const by = choice.trim();
    if (!by) return;
    if (all) {
      for (const x of list) { const tx = textOf(active()!, x); const nx = replaceAll(tx, iss.word, by); if (nx !== tx) setText(x, nx); }
    } else setText(tg, replaceAt(text, iss.start, iss.end, by));
    next(iss.start + by.length);
  };
  return (
    <div className="modal-backdrop">
      <div className="modal spell-dialog" role="dialog" aria-label="Check Spelling" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Check Spelling</div>
        <div className="scale-dialog">
          <LanguageSelect value={spellLanguage()} onChange={restart} />
          {st.done || !iss ? (
            <p>{st.done ? 'Spell check complete.' : 'Checking…'}</p>
          ) : (
            <>
              <div className="muted small">{tg?.label}</div>
              <div className="spell-context" aria-label="Context">
                {text.slice(Math.max(0, iss.start - 60), iss.start)}<mark>{text.slice(iss.start, iss.end)}</mark>{text.slice(iss.end, iss.end + 60)}
              </div>
              <div className="form-row"><span>Change to</span><input aria-label="Change to" value={choice} onChange={(e) => setChoice(e.target.value)} /></div>
              <div className="form-row"><span>Suggestions</span>
                <select aria-label="Suggestions" size={5} value={choice} onChange={(e) => setChoice(e.target.value)} style={{ minWidth: 180 }}>
                  {iss.suggestions.map((x) => <option key={x}>{x}</option>)}
                  {!iss.suggestions.length && <option disabled>(no suggestions)</option>}
                </select>
              </div>
            </>
          )}
          <div className="modal-actions">
            {iss && <>
              <button onClick={() => next(iss.end)}>Ignore Once</button>
              <button onClick={() => { useSpell.setState({ ignoreAll: [...st.ignoreAll, iss.word] }); next(iss.end); }}>Ignore All</button>
              <button onClick={async () => { await addToDictionary(iss.word); next(iss.end); }}>Add to Dictionary</button>
              <button className="primary" onClick={() => change(false)}>Change</button>
              <button onClick={() => change(true)}>Change All</button>
            </>}
            <span className="spacer" />
            <button onClick={close}>{st.done ? 'Close' : 'Cancel'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Markup Spelling Mistakes (PDF content) ----------

export const useSpellContent = create<{ open: boolean }>(() => ({ open: false }));

/** Put a Squiggly markup under each misspelled word of the PDF's text on these pages. */
export async function markSpellingMistakes(d: DocState, pages: number[], color: string, suggestions: boolean): Promise<number> {
  const sp = await loadSpeller();
  const s = useApp.getState();
  let n = 0;
  for (const p of pages) {
    const pdfPage = await d.loaded.pdf.getPage(p + 1);
    const boxes = await pageText(pdfPage, d.loaded.pages[p].viewport);
    for (const b of boxes) {
      const len = b.str.length;
      for (const w of words(b.str)) {
        if (skipSpelling(w.word, s.prefs.spellUpperCase, s.prefs.customWords) || sp.correct(w.word)) continue;
        // Word extent: its share of the run's width (horizontal text).
        const x0 = b.x0 + ((b.x1 - b.x0) * w.start) / len, x1 = b.x0 + ((b.x1 - b.x0) * w.end) / len;
        s.addMarkup({
          type: 'squiggly', page: p, points: [{ x: x0, y: b.y0 }, { x: x1, y: b.y1 }],
          style: { ...s.toolDefaults.squiggly, color }, subject: 'Spelling',
          comment: suggestions ? sp.suggest(w.word).slice(0, 5).join(', ') : '',
        });
        n++;
      }
    }
  }
  s.setStatus(n ? `Markup Spelling Mistakes: ${n} word${n === 1 ? '' : 's'} marked` : 'Markup Spelling Mistakes: no spelling mistakes found');
  return n;
}

export function SpellContentDialog() {
  const open = useSpellContent((x) => x.open);
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  const [color, setColor] = useState(() => useApp.getState().prefs.spellColor);
  const [sugg, setSugg] = useState(true);
  const [range, setRange] = useState<'all' | 'current' | 'custom'>('all');
  const [custom, setCustom] = useState('1');
  const [lang, setLang] = useState(spellLanguage);
  if (!open || !d) return null;
  const close = () => useSpellContent.setState({ open: false });
  const ok = async () => {
    const n = d.loaded.pages.length;
    const pages = range === 'all' ? Array.from({ length: n }, (_, i) => i) : range === 'current' ? [d.page] : parsePageRange(custom, n);
    close();
    try { await markSpellingMistakes(d, pages, color, sugg); } catch (e) { useApp.getState().setStatus(`Spell check unavailable: ${(e as Error).message}`); }
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Markup Spelling Mistakes" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Markup Spelling Mistakes</div>
        <div className="scale-dialog">
          <LanguageSelect value={lang} onChange={setLang} />
          <div className="form-row"><span>Color</span><input type="color" aria-label="Squiggly colour" value={color} onChange={(e) => setColor(e.target.value)} /></div>
          <div className="form-row"><label><input type="checkbox" checked={sugg} onChange={(e) => setSugg(e.target.checked)} /> Place suggestions in comment</label></div>
          <div className="form-row"><span>Pages</span>
            <select aria-label="Pages" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
              <option value="all">All Pages</option><option value="current">Current ({d.loaded.pages[d.page]?.label})</option><option value="custom">Custom</option>
            </select>
            {range === 'custom' && <input aria-label="Custom pages" value={custom} onChange={(e) => setCustom(e.target.value)} style={{ width: 100 }} />}
          </div>
          <div className="modal-actions"><span className="spacer" /><button className="primary" onClick={ok}>OK</button><button onClick={close}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}
