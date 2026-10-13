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

## 4. Direction: cloud-native, browser-only (Onshape, not SolidWorks)

Like Onshape against SolidWorks, CyanTakeoff wins by changing where the work
lives, not only by copying features:

- **Browser-only, no desktop version.** Users can install it from the
  browser for its own window; it is the same web app.
- **Documents live in the cloud,** not as files mailed around: every save is
  a version you can go back to or compare; sharing is a link with
  permissions (view / comment / edit).
- **Collaboration is the default:** everyone in a document sees changes
  live; no separate "session" step.
- **Any device:** laptop, tablet on site, phone for viewing (touch support).
- **Self-hostable:** firms that will not use our cloud run their own server,
  which Onshape cannot offer.
- **Local mode stays:** open a PDF from disk, nothing uploaded.
- Browser-reserved keys (Ctrl+Tab, Ctrl+N, Ctrl+T, Ctrl+W) cannot match
  Revu; those actions get other keys.

## 4b. Architecture (as built)

Web-first, TypeScript only, so it runs in any browser (Windows, macOS,
Linux) and can be hosted as a static site:

- **UI:** React + zustand, Revu-style workspace (`src/ui`).
- **Rendering:** pdf.js (legacy build for older browsers), tiled detail
  canvas for sharp zoom, SVG overlay for markups.
- **PDF writing:** pdf-lib; markups saved as standard annotations with
  appearance streams, measurements in Revu's structure (`docs/formats/revu.md`).
- **Snapping:** vector geometry extracted from the page operator list.
- **Files stay on the user's machine:** opening and saving happen in the
  browser; nothing is uploaded unless a shared session is started.

## 5. Roadmap (revised after user research)

What Revu users complain about: subscription-only pricing, cost per seat,
Windows-only, support and licensing hassle. What keeps them on Revu: everyone
else uses it, Studio sessions (shared live review), and trust that files
won't break. So the plan now favours **getting real users early, file
fidelity, and shared sessions** over feature breadth.

### Done: v0.1 takeoff core
Revu-style workspace and published default shortcuts; markup tools; length,
polylength, area, perimeter, volume, count, angle, radius, diameter;
calibrate and preset scales; snap to content/markup/grid; Markups List with
columns, filters and CSV summary; Tool Chest; live measurement preview; save
and reopen; tested against real Revu files (values match Revu's own).

### Done: Next 1, takeoff essentials
- Revu's Apply Scale to Pages dialog (Preset / Custom / Calibrate, page
  range, precision, saved presets) and the prompt to set a scale before
  the first measurement
- Area/volume cutouts (polygon and ellipse)
- Viewports (different scales on one sheet), saved in Revu's `/VP` layout

### Done: Revu feature parity pass (before the public test)
Measurement gaps closed (separate X/Y scales, 3-point radius, partial-arc
radius, rotated text, Revu cutout rules), Dynamic Fill, the full Revu markup
tool set and arrangement commands, Spaces (Revu /BSISpaces), Legends,
slope / rise-drop / wall area, custom columns with formulas, Excel and PDF
summaries, replies and checkmarks, Search, split view, page operations,
Flatten, Compare and Overlay, page labels, Batch Link, Sets, Slip Sheet,
tool sets with Drawing mode, keyboard shortcut editor, Profiles, form
filling, image signatures, redaction and OCR.

### Now: closing the remaining gaps (before the public test)
- [x] View modes: Single Page, Continuous, Side by Side, Continuous Side by
  Side (Ctrl+4 to Ctrl+7), Rotate View (Ctrl+Shift+Plus/Minus)
- [x] Undo across page operations (the last 10 per document)
- [x] Compare: alignment points and vector comparison
- [x] Forms editor: create, rename and delete fields
- [x] Certificate digital signatures (sign with a .pfx/.p12, verify)
- [x] OCR in more languages; redaction that removes content without
  rasterising the page
- [x] Searched for public Revu tool sets (.btx), custom-column and cutout
  samples: none exist. Edited Revu markups now keep keys we do not write
  (e.g. /BSIColumnData). The formats wait for testers' files (wanted list in
  tests/fixtures/revu/README.md)

### Now: Revu parity, third pass (owner: "do all")
- [x] Print (Ctrl+P): page range, Document & Markups / Document Only /
  Markups Only, paper size (Auto or fixed), scaling, pages per sheet,
  auto-rotate, copies/collate/reverse, Dim Page Content, preview; layers
  print when shown and their Print usage is on
- [x] Rulers (Ctrl+R, units by right-click), Full-Screen Crosshair, Dimmer
  (Ctrl+F5, 25/50/75%), Previous/Next View (Alt+Left/Right)
- [x] Bookmarks editing: Add Bookmark (Ctrl+B) at the current view, before/
  after/child, rename, delete, drag to reorder or nest (Ctrl+drag copies),
  Set to Current View, Properties, from page labels, Audit, Export CSV;
  saved to /Outlines keeping untouched items and actions
- [x] Line styles (15 standard incl. center/hidden/phantom/double and
  utility lines with text; Line Style Editor: lines, offsets, dash/space/
  dot/text) and hatch patterns (10 standard; Hatch Pattern Editor; saved as
  PDF tiling patterns); custom sets import/export as JSON
- [ ] Spell check in text markups and comments
- [ ] Visual Search
- [ ] Sequences (auto-numbered markups)
- [ ] Quantity Link (measurement totals into Excel)
- [ ] AutoMark (bookmarks from title blocks)
- [ ] Header/Footer, Watermark, Bates numbering
- [ ] Password protection, Reduce file size, XFDF import/export
- [ ] Edit Text / Edit Content
- [ ] Touch and pen support

### Next 2: public test build in local mode (days)
- Host on a VPS (static site + HTTPS), with a feedback link
- Post to Revu user communities; collect real Revu files and bug reports
- Publish a compatibility report: which Revu markups round-trip, with tests
- Before inviting testers (from the user research in 8c):
  - [x] Layers panel (Revu Alt+Y): PDF layers of the drawing and markup
    layers; show/hide/isolate, Markup Layer, add/rename/delete (content and
    markups removed or moved to the base PDF), properties, configurations,
    drag to reorder, Add Layer from Page with Align Points. Unlike Revu,
    a new empty layer shows in the list at once (a Reddit complaint).
  - [x] Layers, second pass: zoom-range visibility, Export usage and Export
    Layer to Page, Flatten > Assign Layer, Move / Rotate / Scale a layer's
    content after placing it (the other Reddit request).
  - Low-end machines: measure load time, memory and pan/zoom speed on a
    4 GB laptop with a 100-sheet set; cap undo by memory (not 10 copies of
    the file); lower render limits when `navigator.deviceMemory` is small;
    split the 1.5 MB main script so first load is lighter.
  - Speed on large drawing sets as a stated goal (competitors sell on it).
- Tester outreach (do later, with Claude's help):
  1. Have Claude compile a list of companies publicly known to use
     Bluebeam (case studies, job ads asking for Revu, partner lists,
     public bid documents), with only public business contact details.
  2. Send each a short personal invitation to try the test build (free,
     in the browser, opens their Revu files, nothing uploaded).
  3. Rules: send from a separate subdomain (protects cyantakeoff.com
     deliverability), small batches, honest sender and subject, the
     postal address and a one-click opt-out in every email, honour opt-outs
     at once (CAN-SPAM in the US; in the EU/UK prefer role addresses such as
     info@ and keep a note of the legitimate-interest basis under GDPR/PECR;
     Canada's CASL is stricter: only addresses published for business use).
  4. Track replies, sign-ups and which features they ask about.

### Next 3: cloud documents (2–3 weeks)
- Sign-in, upload, storage, version history
- Share links with view / comment / edit permissions
- Live collaboration in the same document (attendees, per-user markups,
  chat), no install for guests
- Self-hostable server (Docker)
- We cannot join Revu's Studio sessions (closed service); the pitch is
  "anyone can join with a link, on any device"

### Next 4: after the public test
Compare against earlier versions of a cloud document, touch support.

### Later
Certificate digital signatures, form field creation, Revu tool set (.btx)
import once its format is documented, accessibility, localisation.

## 6. File fidelity is the headline

Firms won't adopt a tool that might damage their Revu files. Rules:

- Never rewrite an annotation the user didn't change; keep unknown keys and
  unsupported markups byte-for-byte.
- Every Revu file we can get joins `tests/fixtures/revu` with a test that
  compares our values to the values Revu displayed.
- Round-trip tests (open, edit, save, reopen) run on every change.

## 7. Clean-room rule

CyanTakeoff is built only from public documentation, files users create,
and our own code. **No decompiled Revu code, no code or data derived from
it, and no Bluebeam assets** may be used or contributed. This keeps the
project legally safe and credible.

## 8. Competition

OpenRevu (Python/Qt, AGPL, broad features, own file format) and OpenPDF
Studio (Tauri/Rust) exist. CyanTakeoff's difference: exact Revu
compatibility proven on real files, Revu's exact UX and shortcuts, and it
runs in any browser.

Seen in user discussions (2026): PDF-XChange Editor (cheap, general
PDF editing, weak overlays and collaboration), Drawboard (tablet-first,
criticised as "cartoonish", paywalled features), Easy Takeoffs and
deta.studio (browser-based takeoff/markup, cheaper than Revu), Ncored
(desktop, sells on speed with large drawing sets, one-time price), Xyicon
(overlay of scanned revisions by reference point), Foxit, Nitro, Xodo,
Lumin. None claims Revu file compatibility or Revu's exact UX.

## 8c. What users say (Reddit, analysed October 2026)

Two threads: "Is Bluebeam actually bad" (r/Revu) and "Bluebeam
alternatives?" (r/StructuralEngineering).

What keeps people on Revu (we must match all of it):
- Markups List, Tool Chest, Profiles that can be shared, Legends for
  takeoff, markup statuses, stamps and forms, layer control, accurate
  dimension lines, overlays with recolouring, Studio Sessions. All built
  except Layers (gap) and Studio (our cloud collaboration, Next 3).
- "No program, paid or free, holds a candle to Bluebeam" is the common
  view: compatibility and parity are the bar, not "good enough".

Pain we can turn into reasons to switch:
- **Price and subscription:** anger at the move to subscription-only and
  the price rise. Our answer: free local mode, open source, transparent
  pricing for the cloud (8b).
- **Licences tied to machines:** people get logged out when they switch
  between desktop and laptop. Ours: nothing to install or license; open it
  in any browser.
- **No Mac (or tablet) version:** browser-only covers Mac, Linux, iPad and
  Chromebook. Say it loudly; touch support matters (Next 4).
- **Stability:** reports of corrupted files and files stuck "in" Studio.
  Ours: files are never rewritten beyond what the user changed, signed
  files are saved incrementally, round-trip tests. Make "your files are
  safe" a headline, with the compatibility report as proof.
- **Speed on large sets:** a competitor is built entirely on this. Needs a
  measured answer before we claim it (see Next 2).
- **Layers are hard to use:** creating a layer shows nothing until a markup
  is added; no way to work on stacked drawings individually; no move/scale/
  rotate of an overlaid sheet after alignment. When we build Layers: keep
  Revu's behaviour (no retraining) but show new empty layers, and let an
  overlaid sheet be re-aligned at any time (we already align by two points).
- **Small things that annoy:** Ctrl+Backspace (delete word) not working in
  Revu's text editing (browsers do it natively; keep it), rotating by
  fractions of a degree.
- **Overlay of scans:** aligning a scanned revision over a vector one by
  base point, scale and rotation (we have Align Points; add free nudge /
  rotate / scale of the overlay later).

## 8b. Business model

Goal: about $2,000/month for the maintainer, plus running costs.

- **Free:** local mode, viewing, shared-link documents, self-hosting (open
  source).
- **Paid:** hosted cloud with private documents, version history, live
  collaboration and storage. Roughly $10–15 per user per month, or a team
  plan around $50–90/month (Revu: about $22–49 per user per month).
- **Transparent budget:** costs and the maintainer's fixed $2,000 are
  published monthly (for example on Open Collective). Surplus lowers next
  month's price or becomes account credit, rather than card refunds.
- Rough target: 150–220 paying users, or 25–45 small teams.

## 9. Decisions

- **Hosting:** cyantakeoff.com on the existing VPS (8 vCPU, 16 GB RAM,
  160 GB disk, 20 TB traffic); Caddy for HTTPS; deployed by GitHub Actions.
  Add object storage when stored drawings outgrow the disk.
- **Guests:** anyone with a share link can join without an account (they
  type a display name); creating and owning documents needs an account.
  Link permissions: view, comment, or edit, set by the owner.
- **Testers:** recruit Revu users on Reddit (r/Bluebeam and similar), and
  by email to companies known to use Bluebeam (list compiled with Claude
  later, see Next 2); ask only for non-confidential drawings.

### Still open
1. Sign-in method: email links, or Google / Microsoft accounts?
2. Business registration and payments (Stripe / Open Collective), with local
   tax advice.
