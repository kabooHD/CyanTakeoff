// Document > Document Properties (Ctrl+D): title, author, subject and
// keywords (saved in the file's Info dictionary) and what the file is:
// creator, producer, dates, PDF version, pages, page size, file size and
// security.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import { parsePdfDate } from '../model/pdfDate';

export const useDocProps = create<{ open: boolean }>(() => ({ open: false }));

export function DocPropertiesDialog() {
  const open = useDocProps((x) => x.open);
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  return open && d ? <DocPropsForm key={d.id} d={d} /> : null;
}

type Info = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const fmtDate = (v: unknown) => parsePdfDate(str(v))?.toLocaleString() ?? '—';
const fmtSize = (n: number) => (n > 1 << 20 ? `${(n / (1 << 20)).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const inches = (pt: number) => `${(pt / 72).toFixed(2)} in`;

function DocPropsForm({ d }: { d: DocState }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [f, setF] = useState({ title: '', author: '', subject: '', keywords: '' });
  useEffect(() => {
    d.loaded.pdf.getMetadata().then((m) => {
      const i = (m.info ?? {}) as Info;
      setInfo(i);
      setF({ title: str(i.Title), author: str(i.Author), subject: str(i.Subject), keywords: str(i.Keywords) });
    }).catch(() => setInfo({}));
  }, [d.loaded.pdf]);
  const close = () => useDocProps.setState({ open: false });
  const ok = async () => {
    if (!info) return;
    const changed = f.title !== str(info.Title) || f.author !== str(info.Author) || f.subject !== str(info.Subject) || f.keywords !== str(info.Keywords);
    close();
    if (!changed) return;
    await useApp.getState().transformDoc((lib) => {
      lib.setTitle(f.title);
      lib.setAuthor(f.author);
      lib.setSubject(f.subject);
      lib.setKeywords(f.keywords ? [f.keywords] : []);
      lib.setModificationDate(new Date());
    }, 'Document properties changed');
  };
  const p = d.loaded.pages[d.page];
  const sizes = new Set(d.loaded.pages.map((x) => `${inches(x.width)} × ${inches(x.height)}`));
  const field = (k: keyof typeof f, label: string) => (
    <div className="form-row"><span>{label}</span><input aria-label={label} autoFocus={k === 'title'} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Document Properties" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Document Properties</div>
        <form className="scale-dialog" onSubmit={(e) => { e.preventDefault(); ok(); }}>
          <div className="form-row"><span>File</span><span>{d.name}</span></div>
          {field('title', 'Title')}
          {field('author', 'Author')}
          {field('subject', 'Subject')}
          {field('keywords', 'Keywords')}
          <dl className="doc-info">
            <dt>Creator</dt><dd>{str(info?.Creator) || '—'}</dd>
            <dt>Producer</dt><dd>{str(info?.Producer) || '—'}</dd>
            <dt>Created</dt><dd>{fmtDate(info?.CreationDate)}</dd>
            <dt>Modified</dt><dd>{fmtDate(info?.ModDate)}</dd>
            <dt>PDF version</dt><dd>{str(info?.PDFFormatVersion) || '—'}</dd>
            <dt>Pages</dt><dd data-testid="doc-pages">{d.loaded.pages.length}</dd>
            <dt>Page size</dt><dd>{sizes.size === 1 ? [...sizes][0] : `${p ? `${inches(p.width)} × ${inches(p.height)} (this page), ` : ''}${sizes.size} sizes`}</dd>
            <dt>File size</dt><dd>{fmtSize(d.bytes.length)}</dd>
            <dt>Security</dt><dd>{d.security ? 'Password security' : 'None'}</dd>
            <dt>Markups</dt><dd>{d.markups.length}</dd>
          </dl>
          <div className="modal-actions"><span className="spacer" /><button className="primary" type="submit" disabled={!info}>OK</button><button type="button" onClick={close}>Cancel</button></div>
        </form>
      </div>
    </div>
  );
}
