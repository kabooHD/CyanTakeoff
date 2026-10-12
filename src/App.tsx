import { useEffect, useState } from 'react';
import { activeDoc, useApp, useActiveDoc } from './model/store';
import { TOOLS, comboFromEvent } from './tools/tools';
import { DocTabs, MenuBar, StatusBar, Toolbar } from './ui/Chrome';
import { LeftPanel, RightPanel, SideTabs } from './ui/Panels';
import { MarkupsList } from './ui/MarkupsList';
import { Viewer, viewerApi } from './ui/Viewer';
import { AboutDialog, CalibrateDialog, ShortcutsDialog } from './ui/Dialogs';
import { openFile, openFileObject, openSample } from './ui/actions';
import { Icon } from './ui/icons';

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function App() {
  const doc = useActiveDoc();
  const [dialog, setDialog] = useState<'shortcuts' | 'about' | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const s = useApp.getState();
      const d = activeDoc();
      const combo = comboFromEvent(e);
      const run = (fn: () => void) => { e.preventDefault(); fn(); };
      switch (combo) {
        case 'Ctrl+O': return run(openFile);
        case 'Ctrl+S': return run(() => s.save());
        case 'Ctrl+Shift+S': return run(() => s.save(true));
        case 'Ctrl+W': return run(() => d && s.closeDoc(d.id));
        case 'Ctrl+Z': return run(s.undo);
        case 'Ctrl+Y': case 'Ctrl+Shift+Z': return run(s.redo);
        case 'Ctrl+C': return run(s.copy);
        case 'Ctrl+V': return run(s.paste);
        case 'Ctrl+A': return run(() => d && s.select(d.markups.filter((m) => m.page === d.page).map((m) => m.id)));
        case 'Delete': case 'Backspace': return run(() => d && s.deleteMarkups(d.selection));
        case 'Escape': return run(() => { s.setTool('select'); s.select([]); });
        case 'Ctrl+0': return run(viewerApi.fitPage);
        case 'Ctrl+2': return run(viewerApi.fitWidth);
        case 'Ctrl+1': return run(() => s.setZoom(1));
        case 'Ctrl+=': case 'Ctrl++': case 'Ctrl+Shift+=': return run(() => viewerApi.zoomBy(1.25));
        case 'Ctrl+-': return run(() => viewerApi.zoomBy(0.8));
        case 'PageDown': return run(() => d && s.setPage(d.page + 1));
        case 'PageUp': return run(() => d && s.setPage(d.page - 1));
        case 'Home': return run(() => s.setPage(0));
        case 'End': return run(() => d && s.setPage(d.loaded.pages.length - 1));
        case 'Alt+L': return run(() => s.setPanels({ markupsList: !s.markupsList }));
        case 'F1': return run(() => setDialog('shortcuts'));
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const key = combo.replace(/^Shift\+/, '');
      if (arrows[key] && d?.selection.length) {
        const k = combo.startsWith('Shift+') ? 10 : 1;
        const [dx, dy] = arrows[key];
        return run(() => s.updateMarkups(d.selection, (m) => ({ points: m.points.map((p) => ({ x: p.x + dx * k, y: p.y + dy * k })) })));
      }
      const tool = TOOLS.find((t) => t.shortcut === combo);
      if (tool && d) run(() => s.setTool(tool.id));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (useApp.getState().docs.some((d) => d.dirty)) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  return (
    <div className={`app ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={async (e) => {
        e.preventDefault(); setDragOver(false);
        for (const f of Array.from(e.dataTransfer.files)) if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') await openFileObject(f);
      }}>
      <MenuBar onShortcuts={() => setDialog('shortcuts')} onAbout={() => setDialog('about')} />
      <Toolbar />
      <div className="workspace">
        <SideTabs side="left" />
        <LeftPanel />
        <div className="center">
          <DocTabs />
          {doc ? <Viewer key={doc.id} doc={doc} /> : <StartPage />}
          <MarkupsList />
        </div>
        <RightPanel />
        <SideTabs side="right" />
      </div>
      <StatusBar />
      <CalibrateDialog />
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function StartPage() {
  return (
    <div className="start-page">
      <div className="start-card">
        <h1>CyanTakeoff</h1>
        <p className="muted">Open-source PDF markup and quantity takeoff</p>
        <div className="start-actions">
          <button className="primary" onClick={openFile}><Icon name="open" /> Open PDF…</button>
          <button onClick={openSample}>Open sample drawing</button>
        </div>
        <p className="muted small">or drag and drop PDF files anywhere</p>
      </div>
    </div>
  );
}
