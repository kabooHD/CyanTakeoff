import { useEffect, useRef, useState } from 'react';
import { activeDoc, useApp, useActiveDoc } from '../model/store';
import { formatLength } from '../model/measure';
import type { Toggles, ToolId } from '../model/types';
import { TOOLS, toolById } from '../tools/tools';
import { useLinkUrls } from './ReviewText';
import { usePageSetup } from './PageSetup';
import { batchHint } from './filesRow';
import { useApplyStamp } from './ApplyStamp';
import { archiveAsPdfA, useColorProcess } from './ColorProcess';
import { exportText, publishFlattened, publishUncompressed, useExportImage } from './FileExports';
import { useUndoHistory } from './UndoHistory';
import { useTemplateDialog } from './Templates';
import { validateSignatures } from './DigitalSignature';
import { exportFormData, importFormData, mergeFormData, migrateTypewrittenText, resetForm } from './FormData';
import { autoCreateFormFields } from './autoFields';
import { Icon } from './icons';
import { MenuList, type MenuItem } from './ContextMenu';
import { allColumns, exportSummaryCsv, exportSummaryPdf, exportSummaryXlsx, openFile, openSample, exportMarkupsXfdf, importMarkupsXfdf } from './actions';
import { viewerApi } from './Viewer';
import { combineFiles, openPagesDialog, unflattenMarkups } from './PagesDialog';
import { openCompare } from './Compare';
import { openBatchCompare } from './BatchCompare';
import { openPrint } from './Print';
import { addBookmark } from './BookmarksPanel';
import { checkSpelling, useSpellContent } from './Spell';
import { useQuantityLink } from './QuantityLink';
import { removeStamps, useStampDialog } from './HeaderFooter';
import { useSecurityDialog } from './Security';
import { useReduceDialog } from './ReduceSize';
import { stepView, viewHistory } from './Rulers';
import { openSignDialog } from './DigitalSignature';
import { useFormsDialog } from './FormsEditor';
import { useSheetsDialog } from './Sheets';
import { usePrefsDialog } from './Prefs';
import { useSignature } from './Signature';
import { runApplyRedactions } from './redactUi';
import { effectiveCombo } from './commands';
import { arrangeItems } from './arrangeMenu';
import { useCursor } from './cursor';
import { balanceSplit, closeAll, hideShowPanels, refreshDocument, saveAll, toggleFullScreen } from './quickCommands';
import { useDocProps } from './DocProperties';
import { useCamera } from './Camera';
import { useStampManager } from './Stamps';
import { useManageStatus } from './StatusModels';
import { createFromFiles, createLayeredPdf, emailDocument, insertLayeredPages, publishCompressed, useDocTools } from './DocTools';
import { useRecent } from '../model/recent';
import { reopen } from './FileAccess';
import { copyPageToSnapshot, copyText, selectAllText } from './textCommands';
import { openCommandFinder, registerMenus } from './CommandFinder';
import { openSummaryDialog } from './SummaryDialog';

// ---------------- Menu bar ----------------

export function MenuBar({ onShortcuts, onAbout }: { onShortcuts: () => void; onAbout: () => void }) {
  const s = useApp();
  const doc = useActiveDoc();
  const [open, setOpen] = useState<string | null>(null);
  const recent = useRecent((x) => x.list);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);

  const noDoc = !doc;
  const toolItems = (group: 'markup' | 'measure' | 'form'): MenuItem[] => TOOLS.filter((t) => t.group === group && !['viewport', 'space', 'legend', 'visual-pick', 'region-pick', 'edit-text', 'erase-content', 'cut-content', 'sketch-polygon', 'sketch-polyline', 'sketch-rectangle', 'sketch-ellipse', 'review-text', 'caret'].includes(t.id)).map((t) => ({
    label: t.name, shortcut: effectiveCombo(`tool:${t.id}`, s.customKeys) || undefined, disabled: noDoc, checked: s.tool === t.id, action: () => s.setTool(t.id),
  }));

  const menus: Record<string, MenuItem[]> = {
    CyanTakeoff: [
      { label: 'Preferences…', shortcut: 'Ctrl+K', action: () => usePrefsDialog.setState({ open: 'prefs' }) },
      { label: 'Keyboard Shortcuts…', action: () => usePrefsDialog.setState({ open: 'keys' }) },
      { label: 'Profiles…', action: () => usePrefsDialog.setState({ open: 'profiles' }) },
      { label: 'Author Name…', action: () => { const a = prompt('Author name for new markups', s.author); if (a) s.setAuthor(a); } },
      { sep: true },
      { label: 'About CyanTakeoff', action: onAbout },
    ],
    File: [
      { label: 'New PDF…', shortcut: 'Ctrl+N', action: () => useDocTools.setState({ open: 'new' }) },
      { label: 'New PDF from Template…', action: () => useTemplateDialog.setState({ open: true }) },
      { label: 'Open…', shortcut: 'Ctrl+O', action: openFile },
      { label: 'Open Sample Drawing', action: openSample },
      ...recent.slice(0, 8).map((r) => ({ label: `Open Recent › ${r.name}`, action: () => reopen(r) })),
      { label: 'Create › From File…', action: () => void createFromFiles() },
      { label: 'Create › From Multiple Files…', action: () => void createFromFiles() },
      { label: 'Create › Layered PDF…', action: () => createLayeredPdf() },
      { label: 'Combine Files…', action: combineFiles },
      { label: 'Close', shortcut: 'Ctrl+F4', disabled: noDoc, action: () => doc && s.closeDoc(doc.id) },
      { label: 'Close All', shortcut: 'Ctrl+Shift+W', disabled: noDoc, action: closeAll },
      { sep: true },
      { label: 'Save', shortcut: 'Ctrl+S', disabled: noDoc, action: () => s.save() },
      { label: 'Save As…', shortcut: 'Ctrl+Shift+S', disabled: noDoc, action: () => s.save(true) },
      { label: 'Revert As…', disabled: noDoc, action: () => useDocTools.setState({ open: 'revert' }) },
      { label: 'Save All', shortcut: 'Ctrl+F2', disabled: !s.docs.some((x) => x.dirty), action: saveAll },
      { label: 'Refresh', shortcut: 'F5', disabled: !doc?.fileHandle, action: refreshDocument },
      { sep: true },
      { label: 'Export Markups Summary (CSV)', disabled: noDoc, action: () => exportSummaryCsv() },
      { label: 'Import Markups (XFDF)…', disabled: noDoc, action: () => importMarkupsXfdf() },
      { label: 'Export Markups (XFDF)', disabled: noDoc, action: () => exportMarkupsXfdf() },
      { sep: true },
      { label: 'Export as Image…', disabled: noDoc, action: () => useExportImage.setState({ open: true }) },
      { label: 'Export Text', disabled: noDoc, action: exportText },
      { label: 'Publish as Flattened', disabled: noDoc, action: publishFlattened },
      { label: 'Publish as Compressed', shortcut: 'Ctrl+Shift+P', disabled: noDoc, action: publishCompressed },
      { label: 'Publish as Uncompressed', disabled: noDoc, action: publishUncompressed },
      { label: 'Email…', shortcut: 'Ctrl+E', disabled: noDoc, action: emailDocument },
      { label: 'Reduce File Size…', disabled: noDoc, action: () => useReduceDialog.setState({ open: true }) },
      { sep: true },
      { label: 'Print…', shortcut: 'Ctrl+P', disabled: noDoc, action: openPrint },
    ],
    Edit: [
      { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !doc?.undo.length, action: s.undo },
      { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !doc?.redo.length, action: s.redo },
      { label: 'Undo History…', disabled: !doc?.undo.length, action: () => useUndoHistory.setState({ open: true }) },
      { sep: true },
      { label: 'Cut', shortcut: 'Ctrl+X', disabled: !doc?.selection.length, action: () => { if (doc) { s.copy(); s.deleteMarkups(doc.selection); } } },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: !doc?.selection.length, action: s.copy },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !s.clipboard.length || noDoc, action: () => s.paste() },
      { label: 'Paste in Place', shortcut: 'Ctrl+Shift+V', disabled: !s.clipboard.length || noDoc, action: () => s.paste(true) },
      { label: 'Check Spelling in Markups and Form Fields', shortcut: 'F7', disabled: noDoc, action: checkSpelling },
      { label: 'Markup Spelling Mistakes…', disabled: noDoc, action: () => useSpellContent.setState({ open: true }) },
      { sep: true },
      { label: 'Delete', shortcut: 'Del', disabled: !doc?.selection.length, action: () => doc && s.deleteMarkups(doc.selection) },
      { label: 'Select All', shortcut: 'Ctrl+A', disabled: noDoc, action: () => doc && s.select(doc.markups.filter((m) => m.page === doc.page).map((m) => m.id)) },
      { label: 'Select Text', shortcut: 'Shift+T', checked: s.tool === 'select-text', disabled: noDoc, action: () => s.setTool('select-text') },
      { label: 'Select All Text', shortcut: 'Ctrl+Shift+A', disabled: noDoc, action: selectAllText },
      { label: 'Copy Text', disabled: !s.textSel, action: copyText },
      { label: 'Copy Page to Snapshot', shortcut: 'Ctrl+Alt+C', disabled: noDoc, action: copyPageToSnapshot },
      { sep: true },
      ...arrangeItems(),
    ],
    View: [
      { label: 'Zoom In', shortcut: 'Plus', disabled: noDoc, action: () => viewerApi.zoomBy(1.25) },
      { label: 'Zoom Out', shortcut: 'Minus', disabled: noDoc, action: () => viewerApi.zoomBy(0.8) },
      { label: 'Fit Page', shortcut: 'Ctrl+9', disabled: noDoc, action: () => viewerApi.fitPage() },
      { label: 'Fit Width', shortcut: 'Ctrl+0', disabled: noDoc, action: () => viewerApi.fitWidth() },
      { label: 'Actual Size', shortcut: 'Ctrl+8', disabled: noDoc, action: () => s.setZoom(1) },
      { sep: true },
      { label: 'Single Page', shortcut: 'Ctrl+4', checked: s.viewMode === 'single', action: () => s.setViewMode('single') },
      { label: 'Continuous', shortcut: 'Ctrl+5', checked: s.viewMode === 'continuous', action: () => s.setViewMode('continuous') },
      { label: 'Side by Side', shortcut: 'Ctrl+6', checked: s.viewMode === 'side', action: () => s.setViewMode('side') },
      { label: 'Continuous Side by Side', shortcut: 'Ctrl+7', checked: s.viewMode === 'continuous-side', action: () => s.setViewMode('continuous-side') },
      { label: 'Rotate View Clockwise', shortcut: 'Ctrl+Shift+Plus', disabled: noDoc, action: () => s.rotateView(90) },
      { label: 'Rotate View Counterclockwise', shortcut: 'Ctrl+Shift+Minus', disabled: noDoc, action: () => s.rotateView(-90) },
      { sep: true },
      { label: 'Split Vertical', shortcut: 'Ctrl+2', disabled: noDoc, checked: s.split?.dir === 'v', action: () => s.splitView('v') },
      { label: 'Split Horizontal', shortcut: 'Ctrl+H', disabled: noDoc, checked: s.split?.dir === 'h', action: () => s.splitView('h') },
      { label: 'Toggle Split', shortcut: 'Ctrl+I', disabled: noDoc, action: s.toggleSplit },
      { label: 'Switch', shortcut: 'Ctrl+1', disabled: !s.split, action: () => s.focusPane(s.activePane ? 0 : 1) },
      { label: 'Unsplit', shortcut: 'Ctrl+Shift+2', disabled: !s.split, action: s.unsplit },
      { label: 'Synchronize Document', checked: !!s.toggles.syncDoc, action: () => s.toggle('syncDoc') },
      { label: 'Synchronize Page', checked: s.toggles.sync, action: () => s.toggle('sync') },
      { sep: true },
      { label: 'Previous View', shortcut: 'Alt+Left', disabled: !viewHistory.canBack, action: () => stepView(-1, viewerApi.centerOn) },
      { label: 'Next View', shortcut: 'Alt+Right', disabled: !viewHistory.canForward, action: () => stepView(1, viewerApi.centerOn) },
      { sep: true },
      { label: 'Rulers', shortcut: 'Ctrl+R', checked: s.toggles.rulers, action: () => s.toggle('rulers') },
      { label: 'Full-Screen Crosshair', checked: s.toggles.crosshair, action: () => s.toggle('crosshair') },
      { label: 'Pen Mode (finger pans, pen draws)', checked: s.toggles.penMode, action: () => s.toggle('penMode') },
      { label: 'Dimmer', shortcut: 'Ctrl+F5', checked: s.toggles.dimmer, action: () => s.toggle('dimmer') },
      ...[25, 50, 75].map((n) => ({ label: `    Dimmer ${n}%`, checked: s.dimLevel === n, action: () => { s.setView({ dimLevel: n }); if (!s.toggles.dimmer) s.toggle('dimmer'); } })),
      { label: 'Show Cover Page in Side-by-Side', checked: !!s.toggles.coverPage, action: () => s.toggle('coverPage') },
      { label: 'Dark Mode', checked: !!s.toggles.darkMode, action: () => s.toggle('darkMode') },
      { label: 'Disable Line Weights', checked: !!s.toggles.noLineWeights, action: () => s.toggle('noLineWeights') },
      { label: 'Always Show Reply Indicators', checked: !!s.toggles.replyIndicators, action: () => s.toggle('replyIndicators') },
      { label: 'Show Grid', shortcut: 'Shift+F9', checked: s.toggles.grid, action: () => s.toggle('grid') },
      { label: 'Snap to Grid', shortcut: 'Ctrl+Shift+F9', checked: s.toggles.snap, action: () => s.toggle('snap') },
    ],
    Document: [
      { label: 'First Page', shortcut: 'Home', disabled: noDoc, action: () => s.setPage(0) },
      { label: 'Previous Page', shortcut: 'Ctrl+Left', disabled: noDoc, action: () => doc && s.setPage(doc.page - 1) },
      { label: 'Next Page', shortcut: 'Ctrl+Right', disabled: noDoc, action: () => doc && s.setPage(doc.page + 1) },
      { label: 'Last Page', shortcut: 'End', disabled: noDoc, action: () => doc && s.setPage(doc.loaded.pages.length - 1) },
      { sep: true },
      { label: 'Add Bookmark', shortcut: 'Ctrl+B', disabled: noDoc, action: () => addBookmark() },
      { sep: true },
      { label: 'Insert Pages…', shortcut: 'Ctrl+Shift+I', disabled: noDoc, action: () => openPagesDialog('insert') },
      { label: 'Insert Blank Page…', shortcut: 'Ctrl+Shift+N', disabled: noDoc, action: () => openPagesDialog('insert-blank') },
      { label: 'Insert Layered Pages…', disabled: noDoc, action: insertLayeredPages },
      { label: 'Delete Pages…', shortcut: 'Ctrl+Shift+D', disabled: noDoc, action: () => openPagesDialog('delete') },
      { label: 'Extract Pages…', shortcut: 'Ctrl+Shift+X', disabled: noDoc, action: () => openPagesDialog('extract') },
      { label: 'Replace Pages…', shortcut: 'Ctrl+Shift+Y', disabled: noDoc, action: () => openPagesDialog('replace') },
      { label: 'Rotate Pages…', shortcut: 'Ctrl+Shift+R', disabled: noDoc, action: () => openPagesDialog('rotate') },
      { label: 'Crop Pages…', shortcut: 'Shift+Alt+O', disabled: noDoc, action: () => useDocTools.setState({ open: 'crop' }) },
      { label: 'Deskew…', shortcut: 'Ctrl+Alt+D', disabled: noDoc, action: () => useDocTools.setState({ open: 'deskew' }) },
      { label: 'Split Document…', disabled: noDoc, action: () => openPagesDialog('split') },
      { sep: true },
      { label: 'Header & Footer…', disabled: noDoc, action: () => useStampDialog.setState({ open: 'header' }) },
      { label: 'Remove Header & Footer', disabled: noDoc, action: () => removeStamps('Header') },
      { label: 'Watermark…', disabled: noDoc, action: () => useStampDialog.setState({ open: 'watermark' }) },
      { label: 'Remove Watermark', disabled: noDoc, action: () => removeStamps('Watermark') },
      { label: 'Document Properties…', shortcut: 'Ctrl+D', disabled: noDoc, action: () => useDocProps.setState({ open: true }) },
      { label: 'Security…', shortcut: 'Ctrl+L', disabled: noDoc, action: () => useSecurityDialog.setState({ open: true }) },
      { sep: true },
      { label: 'Slip Sheet…', disabled: noDoc, action: () => openPagesDialog('slip-sheet') },
      { label: 'Page Labels…', disabled: noDoc, action: () => useSheetsDialog.setState({ open: 'labels' }) },
      { label: 'Number Pages…', disabled: noDoc, action: () => usePageSetup.setState({ open: 'number' }) },
      { label: 'Create Page Labels from Bookmarks…', disabled: noDoc, action: () => usePageSetup.setState({ open: 'bookmarks' }) },
      { label: 'Page Setup…', disabled: noDoc, action: () => usePageSetup.setState({ open: 'setup' }) },
      { label: 'Color Processing…', disabled: noDoc, action: () => useColorProcess.setState({ open: 'color' }) },
      { label: 'Repair PDF…', disabled: noDoc, action: () => useColorProcess.setState({ open: 'repair' }) },
      { label: 'Archive as PDF/A', disabled: noDoc, action: archiveAsPdfA },
      { label: 'Batch Link…', disabled: noDoc, action: () => useSheetsDialog.setState({ open: 'batch-link' }) },
      { sep: true },
      { label: 'Flatten Markups…', shortcut: 'Ctrl+Shift+M', disabled: noDoc, action: () => openPagesDialog('flatten') },
      { label: 'Unflatten', shortcut: 'Ctrl+Shift+U', disabled: noDoc, action: unflattenMarkups },
      { sep: true },
      { label: 'Signature…', disabled: noDoc, action: () => useSignature.setState({ open: true }) },
      { label: 'Certify Document (Digital ID)…', disabled: noDoc, action: () => openSignDialog(undefined, true) },
      { label: 'Validate Signatures', disabled: noDoc, action: validateSignatures },
      { label: 'Sign Document (Digital ID)…', disabled: noDoc, action: () => openSignDialog() },
      { label: 'Mark for Redaction', shortcut: 'Shift+R', disabled: noDoc, action: () => s.setTool('redaction') },
      { label: 'Mark Text for Redaction', shortcut: 'Shift+K', disabled: noDoc, action: () => s.setTool('redact-text') },
      { label: 'Apply Redactions…', shortcut: 'Shift+A', disabled: noDoc, action: runApplyRedactions },
      { label: 'OCR…', shortcut: 'Ctrl+Shift+O', disabled: noDoc, action: () => openPagesDialog('ocr') },
      { sep: true },
      { label: 'Compare Documents…', disabled: noDoc, action: () => openCompare('compare') },
      { label: 'Overlay Pages…', disabled: noDoc, action: () => openCompare('overlay') },
    ],
    Tools: [
      { label: 'Select', shortcut: 'V', checked: s.tool === 'select', action: () => s.setTool('select') },
      { label: 'Pan', shortcut: 'Shift+V', checked: s.tool === 'pan', action: () => s.setTool('pan') },
      { sep: true },
      ...toolItems('markup'),
      { label: 'Camera…', shortcut: 'Ctrl+Alt+I', disabled: noDoc, action: () => useCamera.setState({ open: true }) },
      { label: 'Manage Stamps…', action: () => useStampManager.setState({ open: true }) },
      { label: 'Manage Status…', action: () => useManageStatus.setState({ open: true }) },
      { sep: true },
      { label: 'Edit Text', checked: s.tool === 'edit-text', disabled: noDoc, action: () => { s.setTool('edit-text'); s.setStatus('Edit Text: click a line of text on the drawing.'); } },
      { label: 'Erase Content', checked: s.tool === 'erase-content', disabled: noDoc, action: () => { s.setTool('erase-content'); s.setStatus('Erase Content: drag a rectangle; everything under it is removed from the page.'); } },
      { label: 'Review Text', checked: s.tool === 'review-text', disabled: noDoc, action: () => { s.setTool('review-text'); s.setStatus('Review Text: drag across text to replace it, or click where text is to be inserted.'); } },
      { label: 'Create Hyperlinks from URLs…', disabled: noDoc, action: () => useLinkUrls.setState({ open: true }) },
      { label: 'Cut Content', checked: s.tool === 'cut-content', disabled: noDoc, action: () => { s.setTool('cut-content'); s.setStatus('Cut Content: drag a rectangle; the content under it goes to the clipboard (paste with Ctrl+V) and is removed from the page.'); } },
      { sep: true },
      ...(['sketch-polygon', 'sketch-polyline', 'sketch-rectangle', 'sketch-ellipse'] as const).map((id) => ({
        label: toolById(id).name, checked: s.tool === id, disabled: noDoc, action: () => { s.setTool(id); s.setStatus(`${toolById(id).name}: click the first point, then type the sizes.`); },
      })),
      { sep: true },
      { label: 'Automatically Create Form Fields', disabled: noDoc, action: () => void autoCreateFormFields() },
      ...toolItems('form'),
      { label: 'Forms Editor…', shortcut: 'Ctrl+Shift+F', disabled: noDoc, action: () => useFormsDialog.setState({ editor: true }) },
      { label: 'Import Form Data…', disabled: noDoc, action: () => importFormData() },
      { label: 'Export Form Data (FDF)', disabled: noDoc, action: () => exportFormData('fdf') },
      { label: 'Export Form Data (XML)', disabled: noDoc, action: () => exportFormData('xml') },
      { label: 'Export Form Data (CSV)', disabled: noDoc, action: () => exportFormData('csv') },
      { label: 'Merge Form Data (CSV)', disabled: noDoc, action: () => mergeFormData('csv') },
      { label: 'Reset Form', disabled: noDoc, action: resetForm },
      { label: 'Highlight Fields', checked: !s.toggles.noFieldHighlight, action: () => s.toggle('noFieldHighlight') },
      { label: 'Migrate Typewritten Text', disabled: noDoc, action: migrateTypewrittenText },
    ],
    Measure: [
      { label: 'Set Scale…', disabled: noDoc, action: () => doc && s.openScaleDialog({ page: doc.page }) },
      { sep: true },
      ...toolItems('measure'),
    ],
    Batch: [
      { label: 'Batch Link…', disabled: noDoc, action: () => useSheetsDialog.setState({ open: 'batch-link' }) },
      { label: 'Compare Documents…', disabled: s.docs.length < 2, action: () => openBatchCompare('compare') },
      { label: 'Overlay Pages…', disabled: s.docs.length < 2, action: () => openBatchCompare('overlay') },
      { label: 'Apply Stamp…', disabled: noDoc, action: () => { batchHint.set(); useApplyStamp.setState({ open: true }); } },
      { label: 'Sign & Seal…', disabled: noDoc, action: () => { batchHint.set(); openSignDialog(); } },
      { label: 'Rotate Pages…', disabled: noDoc, action: () => { batchHint.set(); openPagesDialog('rotate'); } },
      { label: 'Split Documents…', disabled: noDoc, action: () => { batchHint.set(); openPagesDialog('split'); } },
      { label: 'Crop Pages…', disabled: noDoc, action: () => { batchHint.set(); useDocTools.setState({ open: 'crop' }); } },
      { label: 'Page Setup…', disabled: noDoc, action: () => { batchHint.set(); usePageSetup.setState({ open: 'setup' }); } },
      { label: 'Security…', disabled: noDoc, action: () => { batchHint.set(); useSecurityDialog.setState({ open: true }); } },
      { label: 'Reduce File Size…', disabled: noDoc, action: () => { batchHint.set(); useReduceDialog.setState({ open: true }); } },
      { label: 'OCR…', disabled: noDoc, action: () => { batchHint.set(); openPagesDialog('ocr'); } },
      { label: 'Print…', disabled: noDoc, action: () => { batchHint.set(); openPrint(); } },
      { label: 'Color Processing…', disabled: noDoc, action: () => { batchHint.set(); useColorProcess.setState({ open: 'color' }); } },
      { label: 'Repair PDF…', disabled: noDoc, action: () => { batchHint.set(); useColorProcess.setState({ open: 'repair' }); } },
      { label: 'Slip Sheet…', disabled: noDoc, action: () => openPagesDialog('slip-sheet') },
      { label: 'Flatten…', disabled: noDoc, action: () => openPagesDialog('flatten') },
      { label: 'Bates Numbering…', disabled: noDoc, action: () => useStampDialog.setState({ open: 'bates' }) },
      { label: 'Header & Footer…', disabled: noDoc, action: () => useStampDialog.setState({ open: 'header' }) },
      { label: 'Watermark…', disabled: noDoc, action: () => useStampDialog.setState({ open: 'watermark' }) },
      { label: 'Quantity Link (Excel)…', disabled: noDoc, action: () => useQuantityLink.setState({ open: true }) },
      { label: 'Summary (Excel)', disabled: noDoc, action: () => { const d = activeDoc(); if (d) exportSummaryXlsx(d.markups, allColumns(d)); } },
      { label: 'Summary (PDF)', disabled: noDoc, action: () => { const d = activeDoc(); if (d) exportSummaryPdf(d.markups, allColumns(d)); } },
      { label: 'Summary…', disabled: noDoc, action: openSummaryDialog },
      { label: 'Combine Files…', action: combineFiles },
    ],
    Window: [
      { label: 'Thumbnails', shortcut: 'Alt+T', checked: s.left === 'thumbnails', action: () => s.setPanels({ left: s.left === 'thumbnails' ? null : 'thumbnails' }) },
      { label: 'Bookmarks', shortcut: 'Alt+B', checked: s.left === 'bookmarks', action: () => s.setPanels({ left: s.left === 'bookmarks' ? null : 'bookmarks' }) },
      { label: 'Properties', shortcut: 'Alt+P', checked: s.right === 'properties', action: () => s.setPanels({ right: s.right === 'properties' ? null : 'properties' }) },
      { label: 'Tool Chest', shortcut: 'Alt+X', checked: s.right === 'toolchest', action: () => s.setPanels({ right: s.right === 'toolchest' ? null : 'toolchest' }) },
      { label: 'Measurements', shortcut: 'Alt+U', checked: s.right === 'measurements', action: () => s.setPanels({ right: s.right === 'measurements' ? null : 'measurements' }) },
      { label: 'File Access', shortcut: 'Alt+A', checked: s.left === 'files', action: () => s.setPanels({ left: s.left === 'files' ? null : 'files' }) },
      { label: 'Links', shortcut: 'Alt+N', checked: s.left === 'links', action: () => s.setPanels({ left: s.left === 'links' ? null : 'links' }) },
      { label: 'Flags', checked: s.left === 'flags', action: () => s.setPanels({ left: s.left === 'flags' ? null : 'flags' }) },
      { label: 'Layers', shortcut: 'Alt+Y', checked: s.left === 'layers', action: () => s.setPanels({ left: s.left === 'layers' ? null : 'layers' }) },
      { label: 'Search', shortcut: 'Alt+1', checked: s.left === 'search', action: () => s.setPanels({ left: s.left === 'search' ? null : 'search' }) },
      { label: 'Sets', shortcut: 'Alt+2', checked: s.left === 'sets', action: () => s.setPanels({ left: s.left === 'sets' ? null : 'sets' }) },
      { label: 'Spaces', shortcut: 'Alt+S', checked: s.left === 'spaces', action: () => s.setPanels({ left: s.left === 'spaces' ? null : 'spaces' }) },
      { label: 'Signatures', shortcut: 'Alt+4', checked: s.left === 'signatures', action: () => s.setPanels({ left: s.left === 'signatures' ? null : 'signatures' }) },
      { label: 'Markups List', shortcut: 'Alt+L', checked: s.markupsList, action: () => s.setPanels({ markupsList: !s.markupsList }) },
      { sep: true },
      { label: 'Navigation Bar', shortcut: 'F4', checked: s.toggles.navBar, action: () => s.toggle('navBar') },
      { label: 'Full Screen', shortcut: 'F11', action: toggleFullScreen },
      { label: 'Presentation', shortcut: 'Ctrl+Enter', disabled: noDoc, action: () => useApp.setState({ presentation: true }) },
      { label: 'Balance', shortcut: 'Shift+F12', disabled: !s.split, action: balanceSplit },
      { sep: true },
      { label: 'Hide/Show Panels', shortcut: 'Shift+F4', action: hideShowPanels },
      { label: 'Auto-Hide Panel Access', checked: !!s.toggles.autoHidePanelAccess, action: () => s.toggle('autoHidePanelAccess') },
      { label: 'Auto-Hide Tabs', checked: !!s.toggles.autoHideTabs, action: () => s.toggle('autoHideTabs') },
      { label: 'Reset Layout', action: () => s.setPanels({ left: 'thumbnails', right: 'properties', markupsList: true }) },
    ],
    Help: [
      { label: 'Find Tools + Commands…', action: openCommandFinder },
      { label: 'Keyboard Shortcuts', shortcut: 'F1', action: onShortcuts },
      { label: 'About CyanTakeoff', action: onAbout },
    ],
  };

  // Help > Find Tools + Commands searches these menus.
  useEffect(() => { registerMenus(menus); });

  return (
    <div className="menubar" ref={ref}>
      <span className="app-badge" title="CyanTakeoff">CT</span>
      {Object.entries(menus).map(([name, items]) => (
        <div key={name} className="menubar-item">
          <button className={open === name ? 'active' : ''}
            onClick={() => setOpen(open === name ? null : name)}
            onMouseEnter={() => open && setOpen(name)}>{name}</button>
          {open === name && (
            <div className="menu-dropdown"><MenuList items={items} onClose={() => setOpen(null)} /></div>
          )}
        </div>
      ))}
      <div className="menubar-title">{doc ? `${doc.name}${doc.dirty ? ' *' : ''} - CyanTakeoff` : 'CyanTakeoff'}</div>
    </div>
  );
}

// ---------------- Toolbar ----------------

function ToolButton({ id }: { id: ToolId }) {
  const s = useApp();
  const t = toolById(id);
  const active = s.tool === id && !s.preset;
  return (
    <button className={`tb-btn ${active ? 'active' : ''} ${active && s.toolLocked ? 'locked' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      title={`${t.name}${effectiveCombo(`tool:${t.id}`, s.customKeys) ? ` (${effectiveCombo(`tool:${t.id}`, s.customKeys)})` : ''}\nDouble-click to lock`}
      onClick={() => s.setTool(id)}
      onDoubleClick={() => s.setTool(id, { locked: true })}>
      <Icon name={id} />
    </button>
  );
}

export function Toolbar() {
  const s = useApp();
  const doc = useActiveDoc();
  return (
    <div className="toolbar">
      <div className="tb-group">
        <button className="tb-btn" title="Open (Ctrl+O)" onClick={openFile}><Icon name="open" /></button>
        <button className="tb-btn" title="Save (Ctrl+S)" disabled={!doc} onClick={() => s.save()}><Icon name="save" /></button>
        <button className="tb-btn" title="Undo (Ctrl+Z)" disabled={!doc?.undo.length} onClick={s.undo}><Icon name="undo" /></button>
        <button className="tb-btn" title="Redo (Ctrl+Y)" disabled={!doc?.redo.length} onClick={s.redo}><Icon name="redo" /></button>
      </div>
      <div className="tb-group">
        <ToolButton id="select" /><ToolButton id="pan" /><ToolButton id="zoom" />
      </div>
      <div className="tb-group">
        {TOOLS.filter((t) => t.group === 'markup' && !['legend', 'redaction', 'redact-text'].includes(t.id)).map((t) => <ToolButton key={t.id} id={t.id} />)}
      </div>
      <div className="tb-group">
        {TOOLS.filter((t) => t.group === 'measure' && t.id !== 'viewport' && t.id !== 'space').map((t) => <ToolButton key={t.id} id={t.id} />)}
      </div>
      <div className="tb-group">
        <button className="tb-btn" title="Fit Page (Ctrl+9)" disabled={!doc} onClick={() => viewerApi.fitPage()}><Icon name="fitpage" /></button>
        <button className="tb-btn" title="Fit Width (Ctrl+0)" disabled={!doc} onClick={() => viewerApi.fitWidth()}><Icon name="fitwidth" /></button>
        <button className="tb-btn" title="Zoom Out (Minus)" disabled={!doc} onClick={() => viewerApi.zoomBy(0.8)}><Icon name="zoomout" /></button>
        <button className="tb-btn" title="Zoom In (Plus)" disabled={!doc} onClick={() => viewerApi.zoomBy(1.25)}><Icon name="zoomin" /></button>
      </div>
    </div>
  );
}

export function DocTabs() {
  const s = useApp();
  if (!s.docs.length) return null;
  return (
    <div className={`doc-tabs ${s.toggles.autoHideTabs ? 'auto-hide' : ''}`}>
      {s.docs.map((d) => (
        <div key={d.id} className={`doc-tab ${d.id === s.activeId ? 'active' : ''}`} onClick={() => s.setActive(d.id)}
          onAuxClick={(e) => e.button === 1 && s.closeDoc(d.id)} title={d.name}>
          <span className={s.prefs.tabTruncation === 'start' ? 'cut-start' : ''}>{d.name}{d.dirty ? ' *' : ''}</span>
          <button className="tab-close" onClick={(e) => { e.stopPropagation(); s.closeDoc(d.id); }} title="Close"><Icon name="close" size={12} /></button>
        </div>
      ))}
    </div>
  );
}

// ---------------- Status bar ----------------

const TOOL_HINTS: Partial<Record<string, string>> = {
  'two-point': 'Click and drag, or click two points. Hold Shift for horizontal, vertical or 45°.',
  box: 'Click and drag to draw.',
  poly: 'Click to add points. Double-click or Enter to finish, Backspace removes the last point.',
  freehand: 'Click and drag to draw.',
  point: 'Click to place.',
  count: 'Click each item to count it. Enter or Esc to finish.',
  callout: 'Click the arrow point, then click where the text box goes.',
};

const TOGGLES: { key: keyof Toggles; label: string; title: string }[] = [
  { key: 'snap', label: 'Snap', title: 'Snap to Grid (Ctrl+Shift+F9)' },
  { key: 'grid', label: 'Grid', title: 'Show Grid (Shift+F9)' },
  { key: 'content', label: 'Content', title: 'Snap to Content: line endpoints and lines in the drawing (Ctrl+Shift+F8)' },
  { key: 'markup', label: 'Markup', title: 'Snap to Markup (Ctrl+Shift+F7)' },
  { key: 'reuse', label: 'Reuse', title: 'Reuse Markup Tools: keep the tool after placing a markup, until Esc or right-click' },
  { key: 'sync', label: 'Sync', title: 'Synchronize Page: both panes of a split view share zoom and scrolling' },
];

export function StatusBar() {
  const s = useApp();
  const doc = useActiveDoc();
  const cursor = useCursor();
  const [pageInput, setPageInput] = useState('');
  const n = doc?.loaded.pages.length ?? 0;
  const scale = doc?.calibrations[doc.page];
  const pos = cursor.p && (scale
    ? `${formatLength(cursor.p.x * scale.factor, scale.unit)}, ${formatLength(cursor.p.y * (scale.yFactor ?? scale.factor), scale.unit)}`
    : `${(cursor.p.x / 72).toFixed(2)}", ${(cursor.p.y / 72).toFixed(2)}"`);
  const page = doc?.loaded.pages[doc.page];
  const t = toolById(s.tool);
  const hint = TOOL_HINTS[t.interaction] ?? '';
  return (
    <div className="statusbar">
      {/* Left: snap/reuse toggles and help for the current tool, as in Revu */}
      <div className="sb-toggles">
        {TOGGLES.map((x) => (
          <button key={x.key} className={s.toggles[x.key] ? 'on' : ''} title={x.title}
            onMouseDown={(e) => e.preventDefault()} onClick={() => s.toggle(x.key)}>{x.label}</button>
        ))}
      </div>
      <div className="sb-section sb-status" title={s.status}>
        {s.busy ? '⏳ ' : ''}{s.tool !== 'select' && hint ? `${t.name}: ${hint}` : s.status}
      </div>
      {doc && s.toggles.navBar && (
        <div className="sb-section sb-nav">
          <button onClick={() => s.setPage(0)} title="First Page (Home)"><Icon name="first" size={14} /></button>
          <button onClick={() => s.setPage(doc.page - 1)} title="Previous Page (Ctrl+Left)"><Icon name="prev" size={14} /></button>
          <input value={pageInput || page?.label || ''} onChange={(e) => setPageInput(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={() => setPageInput('')}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const v = pageInput.trim();
              const byLabel = doc.loaded.pages.findIndex((p) => p.label === v);
              s.setPage(byLabel >= 0 ? byLabel : Number(v) - 1);
              setPageInput('');
              (e.target as HTMLInputElement).blur();
            }} />
          <span>({doc.page + 1} of {n})</span>
          <button onClick={() => s.setPage(doc.page + 1)} title="Next Page (Ctrl+Right)"><Icon name="next" size={14} /></button>
          <button onClick={() => s.setPage(n - 1)} title="Last Page (End)"><Icon name="last" size={14} /></button>
          <span className="sb-zoom">{Math.round((doc.zoom || 1) * 100)}%</span>
        </div>
      )}
      {/* Right: page scale (click to set), page size, cursor position */}
      {doc && (
        <button className="sb-section sb-scale" title="Page scale. Click to set or reset it."
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => s.openScaleDialog({ page: doc.page })}>
          {scale ? scale.label : 'Scale Not Set'}
        </button>
      )}
      {doc && page && <div className="sb-section sb-size" title="Page size">{(page.width / 72).toFixed(2)} x {(page.height / 72).toFixed(2)} in</div>}
      {doc && <div className="sb-section sb-pos" title="Cursor position">{pos ?? ''}</div>}
    </div>
  );
}
