# CyanTakeoff

A free, open-source PDF markup, measurement and quantity takeoff application
for construction, designed so that people who use Bluebeam Revu today can
switch with almost no retraining: same layout, same tool names, same default
shortcuts, and markups saved as standard PDF annotations.

> Status: early fast-track build (v0.1). See [docs/PLAN.md](docs/PLAN.md) for
> the plan and roadmap.

## What works today

- **Revu-style workspace:** menu bar, toolbars, left/right panel tab strips
  (Thumbnails, Bookmarks, Properties, Tool Chest, Measurements), a document
  tab per file, the Markups List docked at the bottom, and a status bar with
  page navigation, scale, cursor position and Snap/Grid/Content/Markup/Reuse/Sync
  toggles.
- **Markup tools:** Text Box, Callout, Note, Pen, Highlight, Line, Arrow,
  Polyline, Rectangle, Ellipse, Polygon, Cloud. Double-click a tool to lock it.
- **Takeoff:** Calibrate (two points + known distance) or pick a preset scale
  (architectural, engineering, metric); Length, Polylength, Area, Perimeter,
  Volume (area × depth) and Count. Feet-inches display with fractions.
  Re-calibrating updates existing measurements on the page. Viewports give
  part of a sheet (a detail) its own scale.
- **Markups List:** sortable, filterable, editable status, totals, and
  Summary export to CSV (opens in Excel).
- **Tool Chest:** Recent Tools and My Tools (with a sample takeoff set); add
  any markup with right-click → Add to My Tools.
- **Editing:** select, multi-select (Ctrl+click or drag a box), move, drag
  vertices, Shift for 45° constraint, snapping to drawing content (line
  endpoints and lines), markup points and grid,
  copy/paste, undo/redo, arrow-key nudge.
- **Files:** open several PDFs at once (or drag and drop), save back in place
  (Chrome/Edge) or download. Markups are written as standard PDF annotations
  with appearance streams, and measurements carry ISO 32000 `/Measure`
  dictionaries plus a page viewport scale, so other PDF tools can display them.
  Annotations already in a file, including measurements from other tools, are
  imported; annotation types CyanTakeoff doesn't edit yet (stamps, images,
  form fields) are left untouched and still displayed.
- Sharp rendering at any zoom on large sheets (tiled detail rendering), mouse
  wheel zooms at the cursor, Space or middle mouse button pans.

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
