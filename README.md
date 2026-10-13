# CyanTakeoff

A free, open-source PDF markup, measurement and quantity takeoff application
for construction, designed so that people who use Bluebeam Revu today can
switch with almost no retraining: same layout, same tool names, same default
shortcuts, and markups saved as standard PDF annotations.

> Status: early fast-track build (v0.1). See [docs/PLAN.md](docs/PLAN.md) for
> the plan and roadmap.

## What works today

- **Revu-style workspace:** menu bar (incl. CyanTakeoff and Batch menus),
  toolbars, side panel tabs (Thumbnails, Bookmarks, Spaces, Search, Sets;
  Properties, Tool Chest, Measurements), Markups List, status bar with
  Snap/Grid/Content/Markup/Reuse/Sync, split view, and Revu's default
  keyboard shortcuts (editable, with Profiles).
- **Markup tools:** Text Box, Typewriter, Callout, Note, Flag, Pen, Eraser,
  Highlight (text-aware), Strikethrough, Underline, Squiggly, Line, Arrow,
  Dimension, Arc, Polyline, Rectangle, Ellipse, Polygon, Cloud, Cloud+,
  Stamp, Image, Snapshot, Hyperlink, File Attachment, Legend; Group,
  Arrange, Lock, Align, Flip, Format Painter, Lasso.
- **Takeoff:** page scales (preset, custom, calibrate, separate X/Y),
  viewports; Length, Polylength, Area, Perimeter, Volume, Count, Angle,
  Radius (incl. 3-point), Diameter; cutouts with Revu's rules; Dynamic Fill;
  slope, rise/drop and wall area; Spaces; Legends.
- **Markups List:** sort, filter, search, columns (incl. custom columns
  with formulas), replies, checkmarks, totals; Summary to Excel, PDF or CSV.
- **Documents:** search, page operations (insert, delete, extract, replace,
  rotate, reorder), combine, split, flatten, Compare and Overlay, page
  labels from sheet numbers, Batch Link, Slip Sheet, form filling and
  field creation, image signatures, digital signatures with your own
  certificate (.pfx/.p12, checked in the Signatures panel), redaction and
  OCR.
- **Files:** everything is saved as standard PDF annotations the way Revu
  writes them; files are opened and saved in the browser, nothing uploaded.

## Revu compatibility

Tested against real Revu-authored PDFs (`tests/fixtures/revu`): CyanTakeoff
opens their length, area, polylength, perimeter, volume and count
measurements and computes exactly the values Revu displayed, and writes its
own measurements in the same structure. Radius, diameter and angle
measurements, stamps and other markups it can't edit yet are kept unchanged.
Format notes: [docs/formats/revu.md](docs/formats/revu.md).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build and checks:

```bash
npm run typecheck && npm test && npm run build
npx vite preview --port 4173 &   # then:
npm run e2e                      # drives the app in Chromium, saves screenshots to test-results/
npm run sample                   # regenerates public/sample-floorplan.pdf
```

## Deploy (cyantakeoff.com)

Deployment is manual: `.github/workflows/deploy.yml` builds the app and
publishes it to a Debian/Ubuntu VPS running Caddy (automatic HTTPS) only when
run from the Actions tab. One-time setup before the first run:

1. **DNS:** at your domain registrar, add two `A` records pointing to the
   VPS IP address: `@` (cyantakeoff.com) and `www`.
2. **GitHub secrets:** repository Settings > Secrets and variables > Actions
   > New repository secret: `VPS_HOST` (the IP), optionally `VPS_USER`
   (default `root`), and either `VPS_SSH_KEY` (a private key whose public
   key is on the server) or `VPS_PASSWORD`.
3. **Run it:** Actions tab > Deploy > Run workflow.

The first run installs Caddy and rsync on the server (`deploy/setup-vps.sh`).

## Layout

```
src/model/    data model, measurement math, app state (zustand)
src/pdf/      PDF import (pdf.js + pdf-lib) and annotation writing
src/tools/    tool definitions and default shortcuts
src/ui/       Revu-style workspace components
tests/        unit tests (vitest) and the browser end-to-end test
```

## Legal

CyanTakeoff is an independent project and is not affiliated with, endorsed
by, or derived from Bluebeam, Inc. "Bluebeam" and "Revu" are trademarks of
their respective owners and are used here only to describe compatibility
goals. All code, icons and text are original work. Licensed under Apache-2.0.
