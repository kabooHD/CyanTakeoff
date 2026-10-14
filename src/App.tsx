import { LayerDialogs } from './ui/LayersPanel';
import { DigitalSignDialog, useDigitalSign } from './ui/DigitalSignature';
import { FormsDialogs, useFormsDialog } from './ui/FormsEditor';
import { useEffect, useState } from 'react';
import { activeDoc, useApp, useActiveDoc } from './model/store';
import { TOOLS, comboFromEvent } from './tools/tools';
import { resolveCombo } from './ui/commands';
import type { ToolId } from './model/types';
import { align, flip, group, reorder, ungroup } from './model/arrange';
import { markupBounds } from './ui/hit';
import { translated } from './model/markup';
import { DocTabs, MenuBar, StatusBar, Toolbar } from './ui/Chrome';
import { LeftPanel, RightPanel, SideTabs } from './ui/Panels';
import { MarkupsList } from './ui/MarkupsList';
import { Viewer, viewerApi } from './ui/Viewer';
import { AboutDialog, LinkDialog, ScaleDialog, ShortcutsDialog } from './ui/Dialogs';
import { openFile, openFileObject, openSample } from './ui/actions';
import { Icon } from './ui/icons';
import { SpaceDialog } from './ui/SpacesPanel';
import { nextHit, useSearch } from './ui/Search';
import { PagesDialog, openPagesDialog, unflattenMarkups } from './ui/PagesDialog';
import { rotatePages } from './pdf/pages';
import { CompareDialog } from './ui/Compare';
import { PrintDialog, openPrint } from './ui/Print';
import { stepView } from './ui/Rulers';
import { addBookmark } from './ui/BookmarksPanel';
import { StyleManagerDialog } from './ui/LineStyles';
import { SpellContentDialog, SpellDialog, checkSpelling } from './ui/Spell';
import { SequenceDialog } from './ui/SequenceDialog';
import { QuantityLinkDialog } from './ui/QuantityLink';
import { AutoMarkDialog } from './ui/AutoMark';
import { StampDialog } from './ui/HeaderFooter';
import { PasswordPrompt, SecurityDialog, useSecurityDialog } from './ui/Security';
import { ReduceDialog } from './ui/ReduceSize';
import { SheetsDialog } from './ui/Sheets';
import { PrefsDialogs } from './ui/Prefs';
import { SignatureDialog } from './ui/Signature';
import { runApplyRedactions } from './ui/redactUi';
import { DocPropertiesDialog, useDocProps } from './ui/DocProperties';
import { Presentation } from './ui/Presentation';
import { PlaceDialog } from './ui/LinksPanel';
import { RecentList } from './ui/FileAccess';
import { StampManagerDialog } from './ui/Stamps';
import { startOffset } from './ui/OffsetBar';
import { MultiplyDialog } from './ui/Multiply';
import { LinkUrlsDialog, ReviewTextDialog } from './ui/ReviewText';
import { PageSetupDialogs } from './ui/PageSetup';
import { ApplyStampDialog } from './ui/ApplyStamp';
import { ColorProcessDialogs } from './ui/ColorProcess';
import { ExportImageDialog } from './ui/FileExports';
import { UndoHistoryDialog } from './ui/UndoHistory';
import { CameraDialog, useCamera } from './ui/Camera';
import { ManageStatusDialog } from './ui/StatusModels';
import { DocToolsDialogs, emailDocument, publishCompressed, useDocTools } from './ui/DocTools';
import { copyPageToSnapshot, copyText, selectAllText } from './ui/textCommands';
import { autosizeTextBoxes, balanceSplit, editAction, refreshDocument, removeSelectedFromGroup, saveAll, toggleFullScreen } from './ui/quickCommands';

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function App() {
  const doc = useActiveDoc();
  const split = useApp((st) => st.split);
  const splitRatio = useApp((st) => st.splitRatio);
  const docs = useApp((st) => st.docs);
  const busy = useApp((st) => st.busy);
  const [dialog, setDialog] = useState<'shortcuts' | 'about' | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const darkMode = useApp((s) => !!s.toggles.darkMode);
  useEffect(() => { document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'; }, [darkMode]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const s = useApp.getState();
      // Saving or a page operation is in progress: edits now would be lost when it finishes.
      if (s.busy) { e.preventDefault(); return; }
      const d = activeDoc();
      const combo = resolveCombo(comboFromEvent(e), useApp.getState().customKeys);
      if (!combo) return;
      if (combo.startsWith('tool:')) {
        const id = combo.slice(5) as ToolId;
        if (d) { e.preventDefault(); s.setTool(id === 'radius' ? s.radiusTool : id); }
        return;
      }
      const run = (fn: () => void) => { e.preventDefault(); fn(); };
      // Revu 20/21 default shortcuts (support.bluebeam.com, "Keyboard shortcuts
      // and mouse navigation"). Browser-reserved keys (Ctrl+F4, Ctrl+Tab, Ctrl+N,
      // Ctrl+T) cannot be intercepted on the web; Ctrl+W/PgUp/PgDn are kept as extras.
      const left = (p: 'thumbnails' | 'bookmarks' | 'spaces' | 'search' | 'sets' | 'signatures' | 'layers' | 'links' | 'files') => run(() => s.setPanels({ left: s.left === p ? null : p }));
      const right = (p: 'properties' | 'toolchest' | 'measurements') => run(() => s.setPanels({ right: s.right === p ? null : p }));
      switch (combo) {
        // File
        case 'Ctrl+O': return run(openFile);
        case 'Ctrl+S': return run(() => s.save());
        case 'Ctrl+F2': return run(saveAll);
        case 'Ctrl+N': return run(() => useDocTools.setState({ open: 'new' }));
        case 'Ctrl+E': return run(() => d && emailDocument());
        case 'Ctrl+Shift+P': return run(() => d && publishCompressed());
        case 'Shift+Alt+O': return run(() => d && useDocTools.setState({ open: 'crop' }));
        case 'Ctrl+Alt+D': return run(() => d && useDocTools.setState({ open: 'deskew' }));
        case 'F5': case 'Shift+F5': return run(() => d && refreshDocument());
        case 'Ctrl+D': return run(() => d && useDocProps.setState({ open: true }));
        case 'Alt+Z': return run(autosizeTextBoxes);
        case 'Ctrl+Shift+E': return run(() => editAction());
        case 'Ctrl+Alt+I': return run(() => d && useCamera.setState({ open: true }));
        case 'Ctrl+Shift+Alt+G': return run(removeSelectedFromGroup);
        case 'F11': return run(toggleFullScreen);
        case 'Ctrl+Enter': return run(() => d && useApp.setState({ presentation: true }));
        case 'Shift+F10': return run(() => d && viewerApi.contextMenu());
        case 'Shift+F12': return run(balanceSplit);
        case 'Shift+Z': return run(() => d && s.setTool(s.tool === 'zoom' ? 'select' : 'zoom'));
        case 'F4': return run(() => s.toggle('navBar'));
        case 'Ctrl+Shift+S': return run(() => s.save(true));
        case 'Ctrl+F4': case 'Ctrl+W': return run(() => d && s.closeDoc(d.id));
        case 'Ctrl+P': return run(() => d && openPrint());
        case 'Ctrl+L': return run(() => d && useSecurityDialog.setState({ open: true }));
        case 'Ctrl+Shift+W': return run(() => s.docs.forEach((x) => s.closeDoc(x.id)));
        // Edit
        case 'Ctrl+Z': return run(s.undo);
        case 'Ctrl+Y': case 'Ctrl+Shift+Z': return run(s.redo);
        case 'Ctrl+C': return run(() => { if (s.textSel && !d?.selection.length) copyText(); else s.copy(); });
        case 'Ctrl+Shift+A': return run(() => d && selectAllText());
        case 'Ctrl+Alt+C': return run(() => d && copyPageToSnapshot());
        case 'Ctrl+X': return run(() => { if (d) { s.copy(); s.deleteMarkups(d.selection); } });
        case 'Ctrl+V': return run(() => s.paste());
        case 'Ctrl+Shift+V': return run(() => s.paste(true));
        case 'Ctrl+A': return run(() => d && s.select(d.markups.filter((m) => m.page === d.page).map((m) => m.id)));
        case 'Delete': case 'Backspace': return run(() => d && s.deleteMarkups(d.selection));
        case 'O': if (d?.selection.length && s.tool === 'select') return run(startOffset); break;
        case 'Escape': return run(() => { useApp.setState({ textSel: null, offsetOp: null }); useDigitalSign.setState({ pending: null }); s.setTool('select'); s.select([]); useApp.setState({ painter: null }); });
        // Markup arrangement (Revu defaults)
        case 'Ctrl+G': return run(() => s.arrange(group));
        case 'Ctrl+Shift+G': return run(() => s.arrange(ungroup));
        case 'Ctrl+J': return run(() => s.arrange((m, ids) => reorder(m, ids, 'forward')));
        case 'Ctrl+Shift+J': return run(() => s.arrange((m, ids) => reorder(m, ids, 'front')));
        case 'Ctrl+[': return run(() => s.arrange((m, ids) => reorder(m, ids, 'backward')));
        case 'Ctrl+Shift+[': case 'Ctrl+Shift+{': return run(() => s.arrange((m, ids) => reorder(m, ids, 'back')));
        case 'Ctrl+Shift+L': return run(s.toggleLock);
        case 'Ctrl+Alt+L': return run(() => s.arrange((m, ids) => align(m, ids, 'left', markupBounds)));
        case 'Ctrl+Alt+E': return run(() => s.arrange((m, ids) => align(m, ids, 'center', markupBounds)));
        case 'Ctrl+Alt+R': return run(() => s.arrange((m, ids) => align(m, ids, 'right', markupBounds)));
        case 'Ctrl+Alt+T': return run(() => s.arrange((m, ids) => align(m, ids, 'top', markupBounds)));
        case 'Ctrl+Alt+M': return run(() => s.arrange((m, ids) => align(m, ids, 'middle', markupBounds)));
        case 'Ctrl+Alt+B': return run(() => s.arrange((m, ids) => align(m, ids, 'bottom', markupBounds)));
        case 'Ctrl+Alt+H': return run(() => s.arrange((m, ids) => flip(m, ids, 'horizontal')));
        case 'Ctrl+Alt+V': return run(() => s.arrange((m, ids) => flip(m, ids, 'vertical')));
        case 'Ctrl+Shift+C': return run(() => {
          const m = d?.markups.find((x) => x.id === d.selection[0]);
          if (m) useApp.setState({ painter: { style: m.style }, status: 'Format Painter: click a markup to apply this format (Esc cancels).' });
        });
        // View
        case 'Ctrl+9': return run(viewerApi.fitPage);
        case 'Ctrl+0': return run(viewerApi.fitWidth);
        case 'Ctrl+8': return run(() => s.setZoom(1));
        case '+': case '=': case 'Shift++': case 'Shift+=': case 'Ctrl+=': case 'Ctrl++':
          return run(() => viewerApi.zoomBy(1.25));
        case 'Ctrl+4': return run(() => s.setViewMode('single'));
        case 'Ctrl+5': return run(() => s.setViewMode('continuous'));
        case 'Ctrl+6': return run(() => s.setViewMode('side'));
        case 'Ctrl+7': return run(() => s.setViewMode('continuous-side'));
        case 'Ctrl+Shift++': case 'Ctrl+Shift+=': return run(() => s.rotateView(90));
        case 'Ctrl+Shift+-': case 'Ctrl+Shift+_': return run(() => s.rotateView(-90));
        case '-': case 'Ctrl+-': return run(() => viewerApi.zoomBy(0.8));
        case 'Shift+F9': return run(() => s.toggle('grid'));
        case 'Ctrl+R': return run(() => s.toggle('rulers'));
        case 'Ctrl+B': return run(() => d && addBookmark());
        case 'F7': return run(() => d && checkSpelling());
        case 'Ctrl+F5': return run(() => s.toggle('dimmer'));
        case 'Alt+ArrowLeft': return run(() => stepView(-1, viewerApi.centerOn));
        case 'Alt+ArrowRight': return run(() => stepView(1, viewerApi.centerOn));
        case 'Ctrl+Shift+F9': return run(() => s.toggle('snap'));
        case 'Ctrl+Shift+F8': return run(() => s.toggle('content'));
        case 'Ctrl+Shift+F7': return run(() => s.toggle('markup'));
        // Navigation
        case 'Ctrl+ArrowRight': case 'PageDown': return run(() => d && s.setPage(d.page + 1));
        case 'Ctrl+ArrowLeft': case 'PageUp': return run(() => d && s.setPage(d.page - 1));
        case 'Home': return run(() => s.setPage(0));
        case 'End': return run(() => d && s.setPage(d.loaded.pages.length - 1));
        // Window
        case 'Alt+L': return run(() => s.setPanels({ markupsList: !s.markupsList }));
        case 'Alt+T': return left('thumbnails');
        case 'Alt+B': return left('bookmarks');
        case 'Alt+S': return left('spaces');
        case 'Alt+Y': return left('layers');
        case 'Alt+N': return left('links');
        case 'Alt+A': return left('files');
        case 'Alt+1': return left('search');
        case 'Alt+2': return left('sets');
        case 'Alt+4': return left('signatures');
        case 'Ctrl+F': return run(() => { s.setPanels({ left: 'search' }); useSearch.setState((x) => ({ focusTick: x.focusTick + 1 })); });
        case 'F3': return run(() => nextHit(1));
        case 'Shift+A': return run(runApplyRedactions);
        case 'Ctrl+Shift+F': return run(() => d && useFormsDialog.setState({ editor: true }));
        case 'Ctrl+Shift+O': return run(() => d && openPagesDialog('ocr'));
        case 'Ctrl+Shift+I': return run(() => d && openPagesDialog('insert'));
        case 'Ctrl+Shift+N': return run(() => d && openPagesDialog('insert-blank'));
        case 'Ctrl+Shift+D': return run(() => d && openPagesDialog('delete'));
        case 'Ctrl+Shift+X': return run(() => d && openPagesDialog('extract'));
        case 'Ctrl+Shift+Y': return run(() => d && openPagesDialog('replace'));
        case 'Ctrl+Shift+R': return run(() => d && openPagesDialog('rotate'));
        case 'Ctrl+Shift+M': return run(() => d && openPagesDialog('flatten'));
        case 'Ctrl+Shift+U': return run(() => d && unflattenMarkups());
        case 'Shift+Alt++': case 'Shift+Alt+=': return run(() => d && s.transformDoc((lib) => rotatePages(lib, [d.page], 90), 'Rotated clockwise'));
        case 'Shift+Alt+-': case 'Shift+Alt+_': return run(() => d && s.transformDoc((lib) => rotatePages(lib, [d.page], -90), 'Rotated counterclockwise'));
        case 'Ctrl+H': return run(() => s.splitView('h'));
        case 'Ctrl+2': return run(() => s.splitView('v'));
        case 'Ctrl+Shift+2': case 'Ctrl+Shift+@': return run(s.unsplit);
        case 'Ctrl+1': return run(() => s.split && s.focusPane(s.activePane ? 0 : 1));
        case 'Ctrl+I': return run(() => (s.split ? s.unsplit() : s.splitView('v')));
        case 'Shift+F3': return run(() => nextHit(-1));
        case 'Alt+P': return right('properties');
        case 'Alt+X': return right('toolchest');
        case 'Alt+U': return right('measurements');
        case 'Shift+F4': return run(() => s.setPanels({ left: null, right: null }));
        case 'F1': return run(() => setDialog('shortcuts'));
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const key = combo.replace(/^Shift\+/, '');
      if (arrows[key] && d?.selection.length) {
        const k = combo.startsWith('Shift+') ? 10 : 1;
        const [dx, dy] = arrows[key];
        return run(() => s.updateMarkups(d.selection.filter((id) => !d.markups.find((m) => m.id === id)?.locked), (m) => translated(m, dx * k, dy * k)));
      }
      const tool = TOOLS.find((t) => t.shortcut === combo);
      // The radius shortcut calls the most recently used radius tool (Revu).
      if (tool && d) run(() => s.setTool(tool.id === 'radius' ? s.radiusTool : tool.id));
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
      onDragOver={(e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={async (e) => {
        e.preventDefault(); setDragOver(false);
        // Chrome and Edge give dropped files a handle too, so they save in place and reopen from File Access.
        const items = Array.from(e.dataTransfer.items).filter((it) => it.kind === 'file');
        const handles = items.map((it) => (it as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.().catch(() => null));
        const files = Array.from(e.dataTransfer.files);
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          if (!(/\.pdf$/i.test(f.name) || f.type === 'application/pdf')) continue;
          const h = await handles[i];
          await openFileObject(f, h && h.kind === 'file' ? h as FileSystemFileHandle : undefined);
        }
      }}>
      {busy && <div className="busy-overlay" aria-busy="true" onPointerDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); }} />}
      <MenuBar onShortcuts={() => setDialog('shortcuts')} onAbout={() => setDialog('about')} />
      <Toolbar />
      <div className="workspace">
        <SideTabs side="left" />
        <LeftPanel />
        <div className="center">
          <DocTabs />
          {!doc ? <StartPage /> : split ? (
            <div className={`split-view ${split.dir}`}>
              {[0, 1].map((pane) => {
                const d = docs.find((x) => x.id === (pane ? split.docId : split.mainDocId));
                return [
                  pane === 1 && <SplitDivider key="div" dir={split.dir} />,
                  <div key={`p${pane}`} className="split-pane" style={{ flex: `${pane ? 1 - splitRatio : splitRatio} 1 0` }}>
                    {d && <Viewer key={`${pane}:${d.id}`} doc={d} pane={pane as 0 | 1} />}
                  </div>,
                ];
              })}
            </div>
          ) : <Viewer key={doc.id} doc={doc} />}
          <MarkupsList />
        </div>
        <RightPanel />
        <SideTabs side="right" />
      </div>
      <StatusBar />
      <ScaleDialog />
      <LinkDialog />
      <SpaceDialog />
      <PagesDialog />
      <CompareDialog />
      <PrintDialog />
      <MultiplyDialog />
      <ReviewTextDialog />
      <LinkUrlsDialog />
      <PageSetupDialogs />
      <ApplyStampDialog />
      <ColorProcessDialogs />
      <ExportImageDialog />
      <UndoHistoryDialog />
      <StyleManagerDialog />
      <SpellDialog />
      <SequenceDialog />
      <QuantityLinkDialog />
      <AutoMarkDialog />
      <StampDialog />
      <SecurityDialog />
      <PasswordPrompt />
      <ReduceDialog />
      <SpellContentDialog />
      <SheetsDialog />
      <PrefsDialogs />
      <SignatureDialog />
      <FormsDialogs />
      <DigitalSignDialog />
      <LayerDialogs />
      <DocPropertiesDialog />
      <Presentation />
      <PlaceDialog />
      <DocToolsDialogs />
      <StampManagerDialog />
      <ManageStatusDialog />
      <CameraDialog />
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Drag to resize the two panes of a split view (Window > Balance evens them). */
function SplitDivider({ dir }: { dir: 'h' | 'v' }) {
  return (
    <div className="split-divider" role="separator" aria-orientation={dir === 'h' ? 'horizontal' : 'vertical'} title="Drag to resize (Shift+F12: Balance)"
      onDoubleClick={balanceSplit}
      onPointerDown={(e) => {
        const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
          const r = dir === 'h' ? (ev.clientY - box.top) / box.height : (ev.clientX - box.left) / box.width;
          useApp.setState({ splitRatio: Math.max(0.1, Math.min(0.9, r)) });
        };
        const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      }} />
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
          <button onClick={() => useDocTools.setState({ open: 'new' })}>New PDF…</button>
          <button onClick={openSample}>Open sample drawing</button>
        </div>
        <p className="muted small">or drag and drop PDF files anywhere</p>
        <div className="start-recent"><div className="links-head">Recent Files</div><RecentList limit={8} /></div>
      </div>
    </div>
  );
}
