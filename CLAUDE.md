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
  (write Revu-structured annotations), `geometry.ts` (snap to content)
- `src/tools/tools.ts`: tool list and Revu default shortcuts (pinned by
  `tests/shortcuts.test.ts`)
- `src/ui/`: Viewer (drawing interactions), Chrome (menus, toolbar, status
  bar), Panels, MarkupsList, Dialogs (scale dialog)

## Commands
```
npm run typecheck && npm test && npm run build
npx vite preview --port 4173 --strictPort &   # then
npm run e2e        # drives the app in Chromium, screenshots in test-results/
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

## Status (2026-10-13)
Done: Revu-style workspace and official default shortcuts; markup tools
(incl. Cloud+, Typewriter, Arc, Dimension, Stamp, Flag, Strikethrough/
Underline/Squiggly and text Highlight, Image, Snapshot, Hyperlink, File
Attachment, Eraser); Group/Ungroup, Arrange, Lock, Align, Flip, Format
Painter, Lasso; Spaces (Revu /BSISpaces, panel, Space column); slope, rise/drop, wall area;
custom columns incl. formulas; Summary to Excel (.xlsx);
length, polylength, area, perimeter, volume, count, angle, radius, diameter;
cutouts (polygon/ellipse, Revu fuse/trim rules); Dynamic Fill;
separate X/Y scales; 3-point radius; viewports (regions with their own scale, Revu
`/VP` layout); Apply Scale to Pages dialog (preset/custom/
calibrate, page range, precision, saved presets) and scale prompt; snap to
content/markup/grid; live measurement preview; Markups List (columns,
filters, reorder, CSV summary); Tool Chest; save/reopen; Revu round-trip.

Next (from `docs/PLAN.md`):
1. Public test build in local mode (deploy only when the owner says so)
2. Cloud documents: sign-in, versions, share links (guests join by link
   with a display name), live collaboration, self-hostable
3. Compare versions, Sets, slip sheets, Spaces, Legends, Dynamic Fill, XLSX

Known gaps: Revu cutout storage unknown (ours in CTData); curved segments
on polygons/cutouts (Ctrl+drag) not supported.
