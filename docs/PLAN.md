# CyanTakeoff: Plan

## 1. Goal

Build a fully open-source desktop application (plus an optional self-hosted
collaboration server) that covers what construction teams use Bluebeam Revu
for: viewing drawings, marking them up, measuring and quantity takeoff,
comparing revisions, organizing drawing sets, and reviewing together in real
time.

Bluebeam users should be able to switch without retraining:

- **Same mental model.** Markups List, Tool Chest, Properties panel,
  calibration, Sets, Overlay/Compare, Sessions.
- **Same muscle memory.** Default keyboard shortcuts and tool behaviour match
  Revu's defaults (R rectangle, C cloud, L line, Shift+Alt+L length, and so
  on). Revu's own shortcuts are customizable, and ours will be too.
- **Same files.** Markups and measurements live in the PDF as standard
  annotations, so a drawing marked up in Revu opens in CyanTakeoff with its
  markups, scales and quantities intact, and the reverse also works.

### Ground rules (legal)

- **Clean-room only.** We do not copy Bluebeam code, icons, images, help text
  or file assets. The layout and workflows should feel familiar, but every
  pixel is our own work.
- **Interoperability through documented formats first.** That means
  ISO 32000 PDF annotations, the `/Measure` and `/VP` viewport dictionaries,
  XFDF, and CSV/XLSX. For Revu-specific files (`.btx` tool sets, `.bpx`
  profiles, custom annotation keys), we study only files that users created
  themselves, and we document what we find in `docs/formats/`.
- **No trademark use** in the product name, icons or marketing beyond factual
  compatibility statements.

## 2. Product scope (feature map)

| Area | Bluebeam equivalent | CyanTakeoff scope |
|---|---|---|
| Viewer | Revu viewer | Fast tiled rendering of large vector drawings, tabs, split view, thumbnails, bookmarks, search |
| Markup | Markup tools | Text box, callout, typewriter, note, line, arrow, polyline, polygon, rectangle, ellipse, cloud, cloud+, arc, pen, highlighter, highlight/strike/underline, stamps, images, snapshots, hyperlinks, eraser |
| Markups List | Markups List | Sortable/filterable grid of every markup, custom columns, status/check marks, replies, summary export to CSV/XLSX/PDF |
| Tool Chest | Tool Chest | Reusable tool sets in "properties" or "drawing" mode, import/export, shared tool sets |
| Measure / takeoff | Measurements | Calibrate, viewports with per-area scales, length, polylength, area, perimeter, volume, count, diameter, angle, radius, cutouts, depth, slope, Dynamic Fill, Legends, custom columns with formulas |
| Compare | Overlay pages, Compare Documents | Raster overlay with colour tint and alignment points; vector diff with clouded changes |
| Sets | Sets | Multi-PDF drawing sets with sheet index, page labels, hyperlinks across sheets |
| Batch | Batch Link, Slip Sheet, Stamp, Flatten, Summary | Auto-link sheet references, slip-sheet new revisions while carrying markups forward, batch stamp/flatten/export |
| Document tools | Pages, Combine, Split, OCR, Forms, Signatures | Insert/extract/rotate/reorder pages, combine/split, OCR (searchable PDF), form fill/create, digital signatures and validation, redaction |
| Spaces | Spaces | Named regions that tag the markups placed inside them (rooms, zones) |
| Profiles | Profiles | Saved workspace layouts, toolbars and shortcuts; Revu-like default profile |
| Collaboration | Studio Sessions / Projects | Self-hosted server for live review sessions and versioned project files |
| Cloud/mobile | Bluebeam Cloud | Later: web/tablet client on the same server |

## 3. UX plan: a Revu-like layout

```
┌──────────────────────────────────────────────────────────────┐
│ Menu bar: File Edit View Document Batch Tools Window Help    │
│ Toolbars: file | markup tools | measure tools | navigation   │
├────┬──────────────────────────────────────────────┬──────┬───┤
│ Tab│                                              │Props │Tab│
│ bar│        Document tabs + canvas (split views)  │Panel │bar│
│ (L)│                                              │ /Tool│(R)│
│    │                                              │ Chest│   │
├────┴──────────────────────────────────────────────┴──────┴───┤
│ Markups List (bottom panel, dockable)                        │
├──────────────────────────────────────────────────────────────┤
│ Status bar: page nav · zoom · scale · Snap/Grid/Content/     │
│             Markup/Reuse/Sync toggles · coordinates          │
└──────────────────────────────────────────────────────────────┘
```

- Panels are dockable and tabbed on the left, right and bottom (Thumbnails,
  Bookmarks, Tool Chest, Properties, Measurements, Layers, Sets, Studio,
  Search, Spaces, Signatures), matching Revu's panel names and default
  positions.
- Tools behave like Revu's: double-click a tool to lock it, the Properties
  panel edits the current selection or tool defaults, right-click gives
  context menus with the same commands, and Enter or a double-click finishes
  a polyline or area.
- The default "Revu" profile reproduces the familiar layout. A shortcut
  reference card ships with it.
- **UX validation:** we recruit 5 to 10 daily Revu users (estimators, PMs,
  architects) and run task-based tests at every milestone, such as "take off
  all slab area on A-201" or "compare rev 3 to rev 4". We measure time per
  task against Revu.

## 4. Architecture

```
┌───────────────────────── Desktop app ──────────────────────────┐
│ UI (TypeScript + React, docking layout, canvas/WebGL viewport)  │
│        ▲ commands / events (typed IPC)                          │
│ Tauri 2 shell (Windows / macOS / Linux)                         │
│        ▼                                                        │
│ ct-core (Rust)                                                  │
│  ├─ ct-render   : PDFium bindings, tile cache, GPU upload       │
│  ├─ ct-doc      : PDF object model, incremental save (lopdf)    │
│  ├─ ct-markup   : annotation model ⇄ PDF annots / XFDF          │
│  ├─ ct-measure  : calibration, viewports, geometry, quantities  │
│  ├─ ct-snap     : vector content extraction, snapping, hit-test │
│  ├─ ct-compare  : raster overlay + vector diff                  │
│  ├─ ct-ocr      : Tesseract integration                         │
│  ├─ ct-sign     : PAdES signing / validation                    │
│  └─ ct-sync     : session op-log client                         │
└─────────────────────────────────────────────────────────────────┘
                 │ HTTPS + WebSocket
┌──────────── ct-server (self-hosted, optional) ──────────────────┐
│ Rust (axum) · PostgreSQL · S3-compatible storage · OIDC auth    │
│ Sessions (live markup op-log) · Projects (versioned files)      │
└─────────────────────────────────────────────────────────────────┘
```

### Key technology choices (recommended)

| Concern | Choice | Why |
|---|---|---|
| PDF rendering | **PDFium** (BSD/Apache) | Same engine as Chrome. Fast and robust on huge vector construction drawings. Its permissive licence keeps our options open (MuPDF is AGPL). |
| PDF writing | **lopdf** (Rust) with incremental updates, plus qpdf for repair and linearization | Saves markups without rewriting the whole file, which keeps saves fast and signatures valid |
| Core language | **Rust** | Memory safety for parsing untrusted PDFs, performance, and it compiles to WASM for a later web client |
| UI | **Tauri 2 + React/TypeScript** | Native installers on all three OSes. The same UI code can later power the web client. The docking layout is easier to make Revu-like in web tech than in most native toolkits. |
| Viewport | Tiled raster from PDFium, with markups drawn as vectors on WebGL/Canvas | Smooth pan and zoom on 36"×48" sheets, and markups stay crisp |
| OCR | Tesseract | Mature and Apache-licensed |
| Collaboration | Per-markup op-log with last-writer-wins on each field and server ordering | Markups are discrete objects, so a full CRDT is unnecessary. This keeps the server simple and auditable. |
| Data export | CSV, XLSX (rust_xlsxwriter), XFDF, JSON | Takeoff numbers have to reach estimating spreadsheets |

**Fallback if Tauri's webview proves too slow:** keep `ct-core` and move the
UI to Qt 6 (LGPL). That is why everything except presentation lives in Rust
crates behind a command API.

### Markup and measurement storage (the interoperability core)

- Each markup is a standard PDF annotation (`/Square`, `/Circle`, `/Line`,
  `/PolyLine`, `/Polygon`, `/FreeText`, `/Ink`, `/Stamp`, …) with appearance
  streams, so any PDF reader can display it.
- Measurements use the standard `/Measure` dictionary and page `/VP`
  viewports, which are what Revu itself reads and writes. We also preserve
  unknown vendor keys on round-trip so we never destroy Revu data.
- Extra CyanTakeoff data (custom columns, Spaces, tool-set link) goes in a
  namespaced private key, so other readers ignore it.
- A **round-trip test corpus**: real drawings marked up in Revu and in
  CyanTakeoff, checked automatically for markup count, geometry, scale and
  quantity equality after open → edit → save cycles.

## 5. Roadmap

Every phase ends with a usable release. Durations assume a core team of
**4 to 6 engineers plus 1 designer**, and should be read as rough estimates.

### Phase 0: Foundations (months 0–2)
- Repo, licence, CI (Windows/macOS/Linux), code of conduct, contribution guide
- Rust workspace + Tauri shell + PDFium bindings
- Tile renderer with smooth pan/zoom on a 200-page set
- Performance budget: open a 50 MB drawing in under 2 s, 60 fps pan
- Collect the test corpus of real-world drawings and Revu-authored PDFs

### Phase 1: Viewer + Markup MVP (months 2–6) → **v0.1**
- Tabs, thumbnails, bookmarks, text search, page navigation, split view
- Core markup tools, the Properties panel, undo/redo, incremental save
- Markups List with sort, filter, status, author, date, comments/replies
- Revu-like default layout and shortcuts
- Read and write PDFs marked up in Revu without data loss

### Phase 2: Takeoff (months 5–10) → **v0.3, the "CyanTakeoff" release**
- Calibrate, viewports, and per-viewport scales and precision
- Length, polylength, area, perimeter, volume, count, angle, radius, diameter
- Cutouts, snapping to PDF content (endpoints, midpoints, intersections),
  ortho/angle lock
- Tool Chest with measurement tool sets (e.g. "Concrete slab 6"" with
  colour, depth and unit cost)
- Custom columns with formulas (qty × unit cost), Legends, Spaces
- Dynamic Fill (flood-fill areas bounded by drawing lines)
- Export quantities to CSV/XLSX and a summary PDF

### Phase 3: Document productivity (months 9–14) → **v0.5**
- Page operations, combine/split, rotate, insert blank pages, page labels
- Overlay pages and Compare Documents
- Sets and batch hyperlinking of sheet references
- Batch Slip Sheet (carry markups to a new revision), batch stamp/flatten
- OCR, form fill, redaction
- Profiles, a customizable toolbar, and a shortcut editor

### Phase 4: Collaboration (months 12–18) → **v0.8**
- `ct-server` with OIDC/SSO, Docker/Helm deployment
- Live Sessions: invite users, real-time markup sync, attendee list, chat,
  per-user record, session report
- Projects: shared folders with check-in/check-out and version history
- Offline mode with later reconciliation

### Phase 5: Hardening + 1.0 (months 18–24) → **v1.0**
- Digital signatures (PAdES) and validation, certificate stores
- Accessibility (keyboard-only use, screen readers), localization
- Import Revu tool sets and profiles (clean-room)
- Signed installers, auto-update, MSI and group policy for IT departments
- Security audit of the PDF parsing surface (fuzzing in CI from Phase 0)

### Later
- Web and tablet client (React UI + Rust core compiled to WASM)
- 3D/IFC model viewing, BIM links
- AI-assisted takeoff (auto-count symbols, room detection), kept as an
  optional plugin
- Plugin/scripting API (Rust + WASM or Lua) for custom tools and exports

## 6. Repository layout (target)

```
CyanTakeoff/
├── apps/
│   ├── desktop/          # Tauri app (src-tauri + React UI)
│   └── server/           # ct-server
├── crates/
│   ├── ct-core/  ct-render/  ct-doc/  ct-markup/  ct-measure/
│   ├── ct-snap/  ct-compare/  ct-ocr/  ct-sign/  ct-sync/
├── ui/                   # shared React component library + design tokens
├── docs/
│   ├── PLAN.md
│   ├── formats/          # interoperability notes (PDF measure, XFDF, …)
│   └── ux/               # layout specs, shortcut map, usability results
├── tests/corpus/         # sample drawings + golden round-trip results
└── .github/workflows/    # CI, fuzzing, release
```

## 7. Quality gates

- **Correctness:** golden tests for every measurement type, including scale
  conversions, imperial/metric units and cutouts. Quantities must match
  hand-checked values exactly at the stated precision.
- **Interop:** round-trip corpus tests run on every PR.
- **Performance:** benchmarks in CI that fail on regressions over 10%.
- **Safety:** `cargo-fuzz` on the PDF parser and annotation reader. No
  `unsafe` outside the FFI crates.
- **UX:** usability sessions with Revu users at the end of each phase.

## 8. Project and community

- **Licence (recommended):** Apache-2.0 for the app and core crates, which is
  enterprise-friendly and compatible with PDFium. Optionally AGPL-3.0 for
  `ct-server`, so that hosted forks stay open.
- Public roadmap on GitHub Projects, "good first issue" labels, RFCs for
  file-format and UX decisions.
- Funding options: Open Collective/sponsors, paid support, and hosted
  `ct-server` for firms that don't want to self-host. The software stays
  100% open.

## 9. Open decisions

1. **Licence:** Apache-2.0 everywhere, or AGPL for the server?
2. **UI stack:** Tauri + React (recommended) or native Qt?
3. **Platform priority:** Windows-first (most Revu users) with macOS/Linux
   built in CI from day one? (Recommended.)
4. **First wedge:** ship takeoff (Phase 2) before compare/sets (Phase 3), as
   the name suggests? (Recommended.)
5. **Team and timeline:** is the 4–6 engineer assumption right? With 1–2
   people, expect each phase to take 2–3× longer.

## 10. Immediate next steps

1. Confirm the open decisions above.
2. Scaffold the Rust workspace, Tauri app and CI (Phase 0).
3. Prove the risky part first: a PDFium tile-renderer spike on a heavy
   E-size drawing, measured against the performance budget.
4. Start the interop corpus: gather Revu-marked PDFs with measurements and
   document their annotation structure in `docs/formats/`.
