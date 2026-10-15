# CyanTakeoff: working notes for Claude

Open-source, browser-only "carbon copy" of Bluebeam Revu for PDF markup and
quantity takeoff, so Revu users can switch with no retraining. The owner
builds it with AI. The goal is exact Revu behaviour, layout, shortcuts and
file compatibility. The product inspiration is Onshape vs SolidWorks:
cloud-native, no desktop version ever.

## Read first
- `docs/PLAN.md`: direction, roadmap, decisions, business model.
- `docs/revu-behaviour.md`: Revu behaviour spec (our own summary of
  Bluebeam's help pages). Follow it when building features.
- `docs/formats/revu.md`: how Revu stores markups and measurements in PDF.
- `docs/revu-shortcuts.md`: Revu's full default shortcut table (reference).

## Stack and layout
TypeScript, React, zustand, pdf.js (legacy build), pdf-lib, Vite, vitest,
playwright-core.
- `src/model/`: types, measurement math (`measure.ts`), app store (`store.ts`)
- `src/pdf/`: `importAnnots.ts` (read annotations incl. Revu), `save.ts`
  (write Revu-structured annotations), `geometry.ts` (snap to content),
  `incremental.ts` (incremental updates: signed files are always saved this
  way), `sign.ts` (digital signatures)
- `src/tools/tools.ts`: tool list and Revu default shortcuts (pinned by
  `tests/shortcuts.test.ts`)
- `src/ui/`: Viewer (drawing interactions), Chrome (menus, toolbar, status
  bar), Panels, MarkupsList, Dialogs (scale dialog)

## Commands
```
npm run typecheck && npm test && npm run build
npx vite preview --port 4173 --strictPort &   # then
npm run e2e        # drives the app in Chromium, screenshots in test-results/
npm run perf       # low-end machine measurements (docs/perf.md)
```
Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. The
preview server can die between turns: restart it if e2e cannot connect.

## Rules
- **Clean-room only:** public docs, user-made files, our own code. Never
  decompiled Revu code or Bluebeam assets. Never commit Bluebeam help text
  verbatim; summarise it.
- **File fidelity:** never rewrite annotations the user did not change;
  preserve unknown/unsupported annotations. Revu fixtures in
  `tests/fixtures/revu` (Revu 20, MIT, from pymkup) are the answer key:
  Revu writes the displayed value in /Contents.
- When unsure how Revu behaves, look it up (see below) instead of guessing.
- Every feature: unit tests where there is math, plus an e2e check; run the
  full suite before committing. Commit messages end with the attribution
  lines from the system reminder.
- When a roadmap item is done, update `docs/PLAN.md` (roadmap) and the
  Status/Next sections below in the same commit, so they never drift.
- Do not deploy. Deployment (`.github/workflows/deploy.yml`, Caddy on the
  owner's Hetzner Debian VPS, cyantakeoff.com) is manual and is the last
  step before going public.

## Product decisions that shape the code (details in `docs/PLAN.md`)
- Browser-only, any device; never a desktop build or native dependency.
- Local mode (open/save files on the user's machine, no account) must keep
  working when cloud features are added.
- Cloud: owners sign in; guests join a document by link with just a display
  name; the owner sets view, comment or edit.
- Must stay self-hostable (static app + a server anyone can run).
- Files stay standard PDFs readable by Revu; no proprietary format.

## Environment
- Network allowlist includes GitHub, npm, PyPI, support.bluebeam.com and
  dot.sd.gov. Fetch Bluebeam help pages with every section expanded:
  `node scripts/fetch-help.mjs <url>` (output in /tmp/bb). Revu 20 help:
  `https://support.bluebeam.com/online-help/revu20/Content/RevuHelp/...`
- Latest Revu is 21.11 (Sept 2026). No Revu 21 sample files yet.

## Status (2026-10-14)
Done: Revu-style workspace and official default shortcuts; markup tools
(incl. Cloud+, Typewriter, Arc, Dimension, Stamp, Flag, Strikethrough/
Underline/Squiggly and text Highlight, Image, Snapshot, Hyperlink, File
Attachment, Eraser); Group/Ungroup, Arrange, Lock, Align, Flip, rotation (src/model/rotate.ts: handle with 15° steps, box shapes keep an angle), purple scale handles (src/model/scale.ts), cloud Size/Invert (cloudArcLength in measure.ts), Highlight = Multiply, Flip Text, note icons (src/model/noteIcons.ts), image mask colour and encoding (src/model/imageMask.ts, src/ui/imageTools.ts), Blend Mode (src/model/blend.ts, /BM), band selection direction (src/model/select.ts), Length caption leader line, Format
Painter, Lasso; Spaces (Revu /BSISpaces, panel, Space column); slope, rise/drop, wall area;
custom columns incl. formulas; Summary to Excel (.xlsx), CSV or PDF report;
Legends (src/model/legend.ts: extra columns, title/header options, custom source pages, symbol size; src/ui/legendCommands.ts: Apply to All Pages, Copy Legend to Snapshot); Markups List replies, Checkmark/Lock/Creation Date/position/Wall Area/Rise/Sequence columns, right-click menu
(src/ui/markupMenu.ts), Hide Markups, Saved Filters, custom column filters (src/model/listFilter.ts; filtered-out markups dimmed via store listVisible), section grouping, arrow
keys and jump-to-markup; Search (Ctrl+F); split view (Ctrl+2/Ctrl+H); undo/redo of page operations; view modes (single, continuous, side by side, cover page, Dark Mode, line-weight and reply-indicator toggles,
continuous side by side: Ctrl+4..7) and Rotate View (Ctrl+Shift+Plus/Minus); page operations (insert,
blank, delete, extract, replace keeping markups, rotate, reorder by
thumbnail drag, split, combine) and Flatten (per-type; All / Exclude Filtered / selection scope; Overlay Text on the assigned layer; Capture summary attachment); Compare Documents (clouds
differences, visual or vector, alignment points) and Overlay Pages (two-colour overlay PDF); Page Labels from
title-block sheet numbers, Batch Link (incl. across open files; terms, appearance, overlap and report in src/model/batchLink.ts), Sets panel
(open files as one set; revision stacks and Set Options in src/model/revisions.ts), Slip Sheet (by sheet number or index with a wildcard filter, replace or insert before, markups carried, Superseded stamp, CSV report; src/model/slipSheet.ts);
Tool Chest tool sets (new/rename/export/import, Properties vs Drawing mode,
Symbol/Detail view, set scale, hide, Comment Persistence, Update on Reuse:
src/model/toolScale.ts),
Keyboard Shortcuts editor (src/ui/commands.ts), Profiles; Print (Ctrl+P,
src/ui/Print.tsx, layout math in src/model/print.ts, page filters, Print Spaces, sheet order/border; Selected pages from
the Thumbnails selection in src/ui/Panels.tsx, margins); Rulers, crosshair,
Dimmer, Previous/Next View (src/ui/Rulers.tsx, src/model/rulers.ts);
Bookmarks editing incl. Action dialog, Save Collapse State, Export as PDF (src/ui/BookmarksPanel.tsx, src/pdf/bookmarks.ts, src/pdf/bookmarksReport.ts) and
AutoMark (src/ui/AutoMark.tsx); line
styles and hatch patterns (src/model/lineStyles.ts, src/ui/LineStyles.tsx;
AutoCAD .pat import in src/model/pat.ts);
spell check (F7, src/ui/Spell.tsx, nspell + 11 Hunspell dictionaries served from /dict/);
VisualSearch (src/model/visualSearch.ts matcher, src/ui/VisualSearch.tsx);
Sequences (src/model/sequence.ts, src/ui/SequenceDialog.tsx); Quantity Link
(src/ui/QuantityLink.tsx, cell writes in src/model/xlsxEdit.ts); Header &
Footer, Bates, Watermark (src/pdf/stamps.ts, src/ui/HeaderFooter.tsx);
password security (src/pdf/crypt.ts: R2-R6 decrypt, AES-256 encrypt;
src/ui/Security.tsx), Reduce File Size (src/pdf/reduce.ts), XFDF
(src/pdf/xfdf.ts); New PDF from Template (src/model/templates.ts, src/ui/Templates.tsx);
Export as Image / Text, Publish as Flattened / Uncompressed (src/ui/FileExports.tsx),
Undo History (src/ui/UndoHistory.tsx), Crop Image (src/model/cropImage.ts), Certify
Document and Validate Signatures (DocMDP in src/pdf/sign.ts);
Color Processing, Archive as PDF/A, Repair PDF (src/ui/ColorProcess.tsx,
src/pdf/colorProcess.ts, src/pdf/pdfa.ts, src/pdf/repair.ts);
Number Pages, Page Labels from Bookmarks, Page Setup (src/ui/PageSetup.tsx,
src/model/pageLabels.ts, pageSetup in src/pdf/docTools.ts);
Review Text and Create Hyperlinks from URLs (src/ui/ReviewText.tsx,
src/model/urls.ts); Edit Text / Erase Content / Cut Content (src/pdf/editText.ts, using
the redaction walker's text probe); touch and pen (pinch, pan, long press,
Pen Mode; in Viewer.tsx); small Revu commands (src/ui/quickCommands.ts:
Save All, Refresh, Autosize Text Box, Remove Selected from Group, Full
Screen, Balance with a draggable split; Document Properties Ctrl+D in
src/ui/DocProperties.tsx; Presentation Ctrl+Enter in src/ui/Presentation.tsx;
F4 navigation bar, Shift+F10 context menu); Select Text / Select All Text
(src/model/textSelect.ts, src/ui/textCommands.ts), Snapshot with markups
(src/ui/markupRaster.tsx), Snapshot Content, Copy Page to Snapshot;
Links panel with Places (src/ui/LinksPanel.tsx, src/pdf/places.ts) and
File Access recent files (src/model/recent.ts, src/ui/FileAccess.tsx);
New PDF, Create From File(s) (images to PDF), Crop Pages, Deskew, Email, Publish as Compressed (src/ui/DocTools.tsx,
src/pdf/docTools.ts, src/model/deskew.ts); Unflatten (flattenPage recovery,
unflattenPage in src/pdf/pages.ts); custom stamps (src/model/stamps.ts,
src/ui/Stamps.tsx), status models (src/model/statusModels.ts,
src/ui/StatusModels.tsx), Edit Action on any markup, Offset
(src/model/offset.ts, src/ui/OffsetBar.tsx), Multiply (src/model/multiply.ts,
src/ui/Multiply.tsx), Hide/Show markups, Sketch to Scale (src/model/sketch.ts,
src/ui/SketchBar.tsx), Camera (src/ui/Camera.tsx), Capture photos (src/ui/Capture.tsx), Find Tools + Commands (src/ui/CommandFinder.tsx), Batch Compare/Overlay (src/model/batchPairs.ts, src/ui/BatchCompare.tsx), Flags panel (src/model/flags.ts, src/pdf/flags.ts, src/ui/FlagsPanel.tsx), Set Tags and Drawing Log (src/model/tags.ts, src/ui/Tags.tsx), Thumbnails toolbar and page clipboard (src/ui/pageClipboard.ts), Search scopes and Check Options (src/model/searchScope.ts), document properties panel (src/pdf/docInfo.ts, src/ui/DocumentProps.tsx), Preferences Ctrl+K (src/model/prefs.ts, src/ui/Prefs.tsx: General, Document, Navigation, Grid & Snap, Markup, Measure, Sketch, Forms, Signature, Markups List, Layers, Spelling), text formatting (src/model/textStyle.ts: DS/RC), Count groups and symbols (src/model/count.ts), line ends and callout leaders (src/model/lineEnds.ts), Summary dialog (src/model/summary.ts, src/ui/SummaryDialog.tsx, src/pdf/summary.ts), capture export (src/model/captureExport.ts), Create Stamp templates/dynamic text/PDF import-export (src/model/stamps.ts, src/ui/Stamps.tsx), Dynamic Fill settings and Measure prefs, caption move/rotate (captionOffset/Angle in measureDisplay.ts), choice items/profile columns (src/model/columns.ts), Batch Sign & Seal, Insert Layered
Pages (DocTools.tsx),
Replace Checked (src/ui/Search.tsx); low-end machine pass (src/model/device.ts: undo
memory budget, cold undo snapshots, canvas limits; docs/perf.md); CyanTakeoff (=Revu)
and Batch menus (batch over open documents: src/ui/filesRow.tsx Files option in the
dialogs, Apply Stamp in src/ui/ApplyStamp.tsx); form filling (AcroForm inputs saved into the form) and
field creation (Tools > field tools incl. Button, X = signature field, Automatically Create Form Fields in src/model/autoFields.ts, tab order and field alignment in src/model/fieldLayout.ts, Forms Editor
Ctrl+Shift+F; form data import/export/merge/reset/migrate in src/model/formData.ts,
src/ui/FormData.tsx), image
signatures (draw/type, reusable), digital signatures (src/pdf/sign.ts:
.pfx/.p12, PKCS#7 detached, incremental updates in src/pdf/incremental.ts;
trust list src/model/trust.ts with chain checks, RFC 3161 timestamps;
Signatures panel Alt+4), redaction (mark area/text; apply removes the
content under the marks: src/pdf/redactContent.ts), OCR (tesseract.js,
18 languages incl. Cyrillic, Greek, Arabic, Hebrew, CJK; invisible text in a
glyphless Unicode font, src/pdf/glyphless.ts; assets served from /ocr/);
length, polylength, area, perimeter, volume, count, angle, radius, diameter;
cutouts (polygon/ellipse, Revu fuse/trim rules); curved segments
(src/model/curves.ts: Ctrl+drag, Ctrl/Shift+click, Convert to Arc; PDF 2.0
/Path); Dynamic Fill;
Layers panel (Alt+Y, src/ui/LayersPanel.tsx, src/pdf/layers.ts: PDF
optional content, show/hide/isolate, Markup Layer, add before/after/child,
groups, rename, delete with content/markups, properties, configurations,
drag to reorder, Add Layer from Page with Align Points, zoom-range and
Export usage, Export Layer to Page, Move/Rotate/Scale a layer, Flatten >
Assign Layer; markups' /OC);
measurement display options (caption, segment values, centroid, own units:
src/model/measureDisplay.ts); separate X/Y scales; 3-point radius; viewports (regions with their own scale, Revu
`/VP` layout); Apply Scale to Pages dialog (preset/custom/
calibrate, page range, precision, saved presets) and scale prompt; snap to
content/markup/grid; live measurement preview; Markups List (columns,
filters, reorder, CSV summary); Tool Chest; save/reopen; Revu round-trip.

Next (from `docs/PLAN.md`):
1. Public test build in local mode (deploy only when the owner says so);
   before it: tester outreach by email to Bluebeam-using companies (list
   compiled later); a check on real 4 GB hardware
2. Cloud documents: sign-in, versions, share links (guests join by link
   with a display name), live collaboration, self-hostable
3. Compare versions, Sets, slip sheets, Spaces, Legends, Dynamic Fill, XLSX

Known gaps: low-end performance measured only with CPU throttling (docs/perf.md,
`npm run perf`); pdf.js and pdf-lib load right after the
first paint, not only when a file is opened (split chunks, docs/perf.md); need Revu-made samples (none public; wanted list in
tests/fixtures/revu/README.md): cutout storage (ours in CTData), custom
column values (/BSIColumnData kept on edit but not read), .btx tool sets;
timestamps need a TSA that allows browser
requests (CORS); revocation (OCSP/CRL) is not checked.
