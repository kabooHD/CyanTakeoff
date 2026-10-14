# Revu behaviour notes (measurement)

Our own summary of how Revu 20/21 behaves, written from Bluebeam's public
help pages (Measurements panel, Calibrate / Setting Page Scales, Cutout,
Status bar, Markups List, Keyboard shortcuts). Used as the spec for
CyanTakeoff's carbon-copy UX. Fetch the pages again with
`node scripts/fetch-help.mjs <url>`.

## Measurements panel
- Toolbar menu: Show Measurement Tools, Snap Orthogonal (45°, also Shift),
  Snap to Content, Highlight Viewports.
- Tools: Length, Polylength (menu also has Perimeter), Area (menu also has
  Polygon Cutout, Ellipse Cutout), Diameter, Angle, Radius (center-out) and
  3-Point Radius (share Shift+Alt+U; the shortcut recalls the last used),
  Volume, Count, Dynamic Fill (J).
- Page Scale section: current page; "Add Scale to More Pages"; Calibrate;
  Preset vs Custom; scale shown as `A = B`; "+ Add Preset" (saved scales
  listed first, only saved ones deletable); Separate Y Scale; Precision.
  Changing the page scale updates existing measurements unless the page
  scale is protected (Studio).
- Measurement Properties (per tool): Subject, Label (shown on the markup by
  default), Depth (area: gives volume and wall area), Width/Height (to
  scale), Slope (pitch / degree / grade), unit choice for length, area and
  volume, Show Segment Values (+ caption alignment), Show Caption, Show
  Centroid. Polylength has Rise/Drop (added to the length; exclusive with
  Depth). With no tool selected, Subject/Label typed here become defaults.
- Live preview of key values in the lower-right of the drawing while placing
  a measurement on a scaled page; X hides it, an icon recalls it.

## Setting page scales (Apply Scale to Pages dialog)
- Opened from Tools > Measure > Set Scale, or by clicking the page scale
  ("Scale Not Set") on the status bar / navigation bar.
- Pages: Current (n) [default], All Pages, Selected, Custom range
  (`1-3, 5, 9`).
- Preset (common scales + saved ones on top), Custom (`A unit = B unit`,
  units may differ / mix systems), or Calibrate (pick two points; the
  measured length fills the left side, you enter the real length).
- Precision dropdown: decimal or fractional depending on the scale.
- Revu prompts for a scale before placing a measurement on an unscaled page.

## Viewports
- Regions of a sheet with their own scale (e.g. a detail drawn at a larger
  scale); units and systems may differ from the page scale.
- Measurements panel > Viewports: Add Viewport, then drag a rectangle
  (Shift = square). The Apply Scale to Viewport dialog opens: Label, plus
  the same Preset / Custom / Calibrate choices and Precision; + Add Preset.
- The list shows Name (click to rename) and Scale (pick a preset in place);
  a More Options button reopens the dialog. Delete Viewport removes the
  selected one; Clear All > from Page / from Document.
- Viewports are highlighted with name and scale while measuring; picking
  one in the list highlights it on the drawing.
- A measurement uses the scale of the viewport it is placed in.
- Revu also allows a separate Y scale per viewport (not built yet).

## Radius
- Radius (center, then a point on the circle) and 3-Point Radius (three
  points on the circle) share Shift+Alt+U, which calls the variant used last.
- Separate Y Scale (Apply Scale dialogs): X and Y scales set independently
  by any method; precision follows the X scale.

## Dynamic Fill (J)
- Works on the drawing's content layer only. Toolbar: Add Boundary
  (click points, double-click/Enter to finish) and Fill (press and hold:
  the highlight spreads until it meets lines or the button is released;
  dragging spreads it faster; encircling fills everything inside the loop).
- Create: Space, Polygon, Area, Polylength, Perimeter, Volume (default
  properties or the Tool Chest tool), then Apply.
- Clear menu: Clear All / Clear Fill / Clear Boundaries. Settings: boundary
  and fill size/colour, fill speed, edge sensitivity.
- CyanTakeoff: holes larger than ~0.5% of the room (columns, shafts) become
  cutouts on Area/Volume; small pockets (room labels) are ignored.

## View modes and Rotate View
- View > Mode: Single Page (Ctrl+4), Continuous (Ctrl+5, pages one under
  another), Side by Side (Ctrl+6, pages 1-2, 3-4... as pairs), Continuous
  Side by Side (Ctrl+7). Markups can be drawn on any page shown.
- Rotate View clockwise / counterclockwise (Ctrl+Shift+Plus / Minus) turns
  the display of all pages in 90 degree steps. It does not change the file
  (unlike Rotate Pages, which sets the page /Rotate).
- Ours: the page under the pointer is the current page (status bar,
  thumbnails); with the pointer outside the view, the page in the middle.

## Page operations (Document menu)
- Page operations can be undone and redone (Ctrl+Z / Ctrl+Y) like markup
  edits. Ours keeps the last 10 per document (each holds a copy of the file).
- Insert Pages (Ctrl+Shift+I), Insert Blank Page (Ctrl+Shift+N), Delete
  (Ctrl+Shift+D), Extract (Ctrl+Shift+X, optionally deleting), Replace
  (Ctrl+Shift+Y), Rotate Pages (Ctrl+Shift+R; current page Shift+Alt+Plus/
  Minus), Flatten (Ctrl+Shift+M), thumbnails: drag to reorder, right-click.
- CyanTakeoff writes pending changes into the PDF, applies the operation
  and reloads; undo history restarts after a page operation.
- Replace Pages keeps the old page's markups, page scale and Spaces (the
  basis of slip sheeting). Flatten keeps hyperlinks and form fields.

## Sets, Batch Link, Slip Sheet
- Sets (Alt+2): several PDFs browsed as one set of sheets. CyanTakeoff:
  the open documents, listed by page label, with a filter.
- Page labels: sheet numbers such as A-101; can be generated from the
  title block. Saved as the PDF's /PageLabels.
- Batch Link: turns sheet references in the drawings into hyperlinks to
  those sheets (same file: page destination; another file: GoToR).
- Slip Sheet: new revisions replace sheets matched by sheet number; the
  markups (and scale, Spaces) carry forward; links and bookmarks to the
  replaced page follow it.

## Tool Chest, shortcuts, profiles
- Tool Chest: tool sets (gear menu: rename, export, delete, Legend), My
  Tools first. Right-click a tool: Properties Mode (draw a new markup with
  its properties) or Drawing Mode (place a copy of the saved markup).
  Revu's .btx tool set format is not documented, so CyanTakeoff uses its own
  JSON (.cttools.json) for import/export.
- Revu > Keyboard Shortcuts: every command and tool can be reassigned;
  taking a shortcut from another command reassigns it.
- Revu > Profiles: saved workspace (panels, toolbars, Tool Chest, shortcuts).

## Document tools
- Forms: fields are filled in place; values are saved into the PDF form.
- Signature (image): a drawn or typed signature, kept for reuse, placed as
  an image markup.
- Digital signatures: sign with a digital ID (.pfx/.p12 + password) into an
  empty signature field, a box drawn on the page, or invisibly; Reason and
  Location are optional. The Signatures panel (Alt+4) lists each signature
  with its status (valid / invalid / not checkable) and whether the file
  changed after signing. Signing and later saves of a signed file are
  incremental updates, so earlier signatures stay valid. Ours does not check
  the signer against a trusted certificate list (no trust store in the
  browser), and does not add timestamps (no TSA).
- Redaction: Mark for Redaction (Shift+R, area), Mark Text for Redaction
  (Shift+K), Apply Redactions (Shift+A, after confirmation) removes the
  content underneath for good and paints the areas black. Ours edits the
  page content (src/pdf/redactContent.ts): glyphs touching a mark are
  removed (the text around them keeps its place), lines are cut and fills
  have the area subtracted, image pixels under a mark are blacked out (the
  image is re-encoded), nested drawings are redacted too, inline images and
  shadings under a mark are removed. The rest of the page stays vector and
  searchable. A page whose content cannot be parsed falls back to an image.
- OCR (Ctrl+Shift+O): makes scanned pages searchable (invisible text).
  Languages: English, French, German, Spanish, Italian, Portuguese, Dutch
  (several at once); their data is served by the app and only downloaded
  when used.

- Forms: field tools (Text Field, Check Box, Radio Button, Dropdown, List
  Box, Signature Field; Revu default shortcut X adds a signature field):
  drag the box, then name the field. Radio buttons sharing a name form one
  group. Forms Editor (Ctrl+Shift+F) renames, re-options and deletes fields.

## Compare
- Compare Documents: pick the original and revised document/page; the
  differences are clouded (subject "Compare", label Added/Removed/Changed)
  on the revised sheet, optionally removed items on the original too.
- Overlay Pages: base and overlay sheets in two colours (default red and
  blue); what is in both shows grey. Output is a new PDF.
- Alignment: pick the same two points on each sheet (Align Points) when a
  revision moved or was rescaled; the first sheet is mapped onto the second
  (move, rotate, scale) before comparing or overlaying.
- Ours compares either visually (rendered pages, works for scans) or as
  vectors (lines, curves and text from the PDF content: exact, independent
  of resolution; colour- or lineweight-only changes are not flagged).

## Measurement properties: slope, rise/drop, depth
- Slope (Pitch x/12, Degree or Grade %) adjusts lengths and areas for a
  sloped plane: sloped = plan × sqrt(1 + slope²).
- Rise/Drop (length, polylength) is added to the length; Depth on lengths
  gives wall area (length × depth). Depth and Rise/Drop are exclusive.

## Custom columns (Markups List > Columns > Manage Columns)
- Types: Checkmark, Choice (options, default), Date (format, default none/
  current/custom), Formula (expression over other columns; Measurement =
  the primary value without units; format Normal/Currency/Percentage,
  decimals, Include In Totals), Number (format, decimals, totals, min/max,
  default), Text (multiline, default).
- CyanTakeoff stores definitions in the document catalog (/CTColumns, our
  own key) and values in each markup's CTData; Revu's own storage is not
  known yet.
- Summary export: Excel (.xlsx) or CSV of the rows and columns shown.

## Legends
- A table markup: Symbol, Description and other columns (quantities,
  measurements...), updated live from markups on its source pages.
- Ad-hoc Legend: select markups > right-click > Legend > Create New Legend,
  click to place; matching markups (same type and appearance) added later
  are included. Tool set Legend: from a Tool Chest tool set.
- Properties: Title (+ show), Source Pages, columns, fonts, table colours.
- CyanTakeoff: kinds match on type, subject and colour; saved as a Stamp
  with the current table as its appearance (rewritten on every save).

## Spaces (Alt+S)
- Spaces panel: Add Space (drag a rectangle or click corners, close on the
  first point or Enter, then name it), Highlight toggle, Edit; per page
  tree. Spaces nest by containment and may not partly overlap.
- Space Properties: name, colour, opacity. Create Area Markup from a Space.
- Markups List has a Space column (the Space each markup is in).
- Dynamic Fill can create Spaces.

## Layers (Alt+Y)
- The list shows the PDF's layers (optional content groups) as a tree;
  the box left of a name shows/hides it. Right-click: Show Layer (with its
  children), Isolate (only it and its children), Show All, Markup Layer
  (new markups go on it), Add New Layer, Add Layer from Page, New Layer
  Group (a label without a box), Rename (F2), Delete, Layer Properties.
- Toolbar: Layers menu (Reset Layers to the configuration, Show Print
  Layers, Show All Layers, Show Layers on Page Only, Show Layers
  Alphabetically), Add New Layer (Before / After / Child), Add Layer from
  Page, configuration list (Default + named ones), Save Configuration /
  New Configuration / Delete Configuration.
- Delete Layer asks: Delete Layer Content on Page, Delete Layer
  Annotations; unchecked items move to the base PDF.
- Layer Properties: Title, Default State, Locked (title and state fixed,
  visibility cannot be toggled), View, Print, Export, Zoom (always, or only
  between a minimum and maximum zoom; PDF /Usage /Zoom, factors where 1 =
  100%). Layers outside their zoom range show greyed in the list.
- Export Layer to Page: a new PDF with only the selected layers and their
  children; layers whose Export is off, or that are hidden, come without
  content. Show Export Layers in the Layers menu shows just those.
- Flatten > Assign Layer: flattened markups go on that layer (a new name
  creates it); without it a markup on a layer flattens onto its layer.
- Ours, beyond Revu (Reddit request): Move / Rotate / Scale a layer's
  content after placing it (e.g. a sheet added from a page), with nudge
  buttons, about a base point (default the page centre).
- Drag a layer to reorder; drop it to the right to make it a child.
- Markups: right-click > Layer to assign or create a layer; a markup on a
  hidden layer is hidden. Stored as the annotation's /OC.
- Add Layer from Page draws another sheet on the page as a new layer, with
  Align Points when the sheets differ in position or scale.

## Curved segments
- Polygon, Polyline, Area, Perimeter, Polylength and Volume can have
  Bézier segments. While drawing, Ctrl+drag at a point pulls out its
  handlebar (with the default "Drag Rectangle" preference).
- On a selected markup: drag a handlebar end to reshape (the other side
  turns with it); Ctrl+drag a handlebar moves one side only; Ctrl+click a
  control point converts it straight <-> curve; Shift+click a line adds a
  control point, Shift+click a point removes it. Right-click: Convert
  Control Point to Curve/Straight, Convert to Arc, Add/Subtract Control
  Point.
- Measurements follow the curve.
- Ours stores curves as PDF 2.0 `/Path` (m/l/c operands) with a flattened
  `/Vertices` for older readers, and the exact handlebars in CTData. How
  Revu itself stores curves is unknown (no sample).

## Cutouts
- Polygon Cutout and Ellipse Cutout subtract from an existing Area or
  Volume; hovering the target measurement highlights it.
- Polygon cutout: drag = rectangle (Shift = square), or click points and
  close by clicking the first point, Enter, C, or double-click; Backspace
  removes the last point; Shift = 0/45/90°.
- Ellipse cutout: drag (Shift = circle).
- Several cutouts per measurement; overlapping cutouts merge; a cutout
  overlapping the edge trims the measurement instead. Cutouts share the
  measurement's style. Ctrl-drag copies a cutout.
- A cutout can be converted to its own Area/Volume (select the tool, click
  the cutout; Shift-click converts all).
- Delete: right-click a cutout line > Delete Cutout.

- Overlapping polygon cutouts fuse into one; a polygon cutout crossing the
  markup's edge trims the markup instead. Curved (ellipse) cutouts may not
  overlap other cutouts or the edge.
- With the Area or Volume tool, clicking a cutout converts it into its own
  measurement (Shift: all cutouts of that markup); the cutout stays.

## Security, Reduce File Size, XFDF
Document > Security (Ctrl+L): No Security or Password Security with a
password to open and/or a permissions password restricting printing,
changes, copying, commenting and form filling; changing it needs the
permissions password. Reduce File Size removes unneeded data and
recompresses/downsamples images. Markups can be exported to and imported
from XFDF, the standard markup exchange format. Ours: new security is
AES-256; files encrypted with RC4 or AES-128 keep their own settings when
saved; certificate security is not supported (such files open read-only).

## Header & Footer, Bates, Watermark
Header & Footer (Document menu, Batch for many files): left/centre/right
text in the header and footer, with fields such as page number, page label,
date, time, file name and Bates number; font, size, colour, margins, page
range (e.g. skip the cover), preview. Bates numbering adds prefix, suffix,
start number and digit padding (six or more digits is common). Watermarks
add large faded text across pages. Ours writes all three as real page text
tagged as pagination artifacts (so they print everywhere) and can remove
what it added; Batch across many files: not yet.

## Quantity Link (Excel)
Revu's Quantity Link is an Excel add-in: right-click a cell > Quantity Link
> Create, choose the PDF, a total (length, area, volume, count…) and
filters, which are Markups List columns (Subject, Layer, Page, Space,
custom columns). Values follow markup changes; filters are changed by hand
(Manage). Flattening markups breaks links. Ours: the links live in
CyanTakeoff (Batch > Quantity Link), totals are live in the dialog, and
Update Workbook writes them into the workbook's cells, keeping the rest of
the workbook; Excel recalculates on open.

## Sequences (Tool Chest)
A Sequence tool is a Tool Chest tool whose value goes up each time it is
placed; values can be numbers or letters. Once a sequence is started on the
PDF, each use of the tool continues it; resetting the tool starts a new
count, so several sequences can live on one PDF. Right-click a member >
Select Sequence selects them all. Revu defines it with right-click a tool >
Sequence > Define (for a grouped symbol, Ctrl+click a text box's control
point to pick the one that holds the number). Ours: numbers in the text of
text markups, in the label (drawn in the middle) of other shapes; groups
not yet.

## VisualSearch (Search panel, Alt+1 / Ctrl+F > Visual)
Get Rectangle: drag around a symbol; a preview shows what will be looked
for. Search in the current page, document, all open documents (also Sets,
folders). Sensitivity: lower accepts looser matches (scans, adjacent lines)
at the risk of false positives. Search Multiple Rotations tries 45° steps.
Filter by Color / Refine Colors limit the colours considered. Results show
a picture of each match; clicking one goes there. Checked results can get a
Count measurement (Actions > Apply Count Measurement to Checked), a
Highlight, a Hyperlink or a Mark for Redaction. Ours: no colour filter or
folder search yet; matching is on rendered ink (1.5 px per point).

## Spell check (Edit > Check Spelling, F7)
While editing text in a markup or form field, unknown words get a squiggly
underline; right-click offers suggestions and Add to Dictionary. F7 checks
markups and form fields one word at a time in context: Ignore Once, Ignore
All (this run), Add to Dictionary, Change, Change All. Markup Spelling
Mistakes checks the PDF's own text over a page range and puts a Squiggly
markup (chosen colour) under each mistake, optionally with the suggestions
in its comment. Ours: the dictionary is English (Hunspell); words added
are kept in the browser; codes like A-101 and web/email addresses are
skipped.

## Line styles and hatch patterns
A line style is one or more lines, each offset from the middle (-10..10),
made of components: dash and space (adjustable width), dot, and text. "Scale
with line thickness" makes them grow with the line width. Styles live in
sets (the Standard set is read only); sets are imported/exported (Revu
.blx; ours JSON, since .blx is undocumented). Changing a style does not
change markups already drawn. Hatch patterns fill closed markups and area/
volume measurements; the editor draws lines and small/large dots on a grid
tile; sets import/export (Revu also imports AutoCAD .pat: not yet).
Ours: the markup keeps a copy of a custom style so the file is
self-contained; hatches are drawn in the fill colour and saved as PDF
tiling patterns so any viewer shows them.

## Bookmarks (Alt+B)
Add Bookmark goes to the current view of the active page and is named after
the page label, ready to type over; it goes below the selected bookmark
(or at the end), or Add Before / After / Child. Rename by double-click, F2
or right-click; delete with Delete. Drag to reorder, drag inward to nest,
Ctrl+drag to copy. Right-click: Set to Current View, Properties (title,
colour, bold, italic; several at once). Bookmarks menu: Create Bookmarks
(page labels, or AutoMark from a page region), Audit Bookmarks (flags ones
pointing at pages no longer in the file), Export Bookmarks (CSV or PDF).
Create Bookmarks: Page Labels, or Page Region (AutoMark): Select drags a
region whose text names the bookmark (Add for more regions, e.g. number and
title), over All/Current/Custom pages. Ours keeps regions as fractions of
the page so they fit sheets of other sizes.
Ours: Export is CSV; the Action dialog (jump to another file, web link) is
not editable yet, but such actions are kept as they were.

## Rulers, crosshair, Dimmer, Previous/Next View (View menu)
Rulers (Ctrl+R) run along the top and left of the workspace: they show the
active page's bounds, the extent of the selection, the pointer position,
scale with zoom, and change units on right-click (inches, centimeters,
millimeters, points, picas). Full-Screen Crosshair replaces the cursor with
lines across the view. The Dimmer (Ctrl+F5) fades the page content so
markups stand out; its percentage is how strongly the content still shows.
Previous/Next View (Alt+Left/Right) step through the views visited (page
and zoom; we also restore the position).

## Print (File > Print, Ctrl+P)
Revu's Print dialog has a preview (red borders), printer, page range (All,
Current (n), Selected, Custom "1-3, 5, 9"), paper size (Auto follows the
PDF page) and orientation, what prints (Document & Markups, Document Only,
Markups Only), copies with Collate (1,2,3,1,2,3) and Reverse, rotation
(auto), page scaling (None, Fit to Paper, Reduce to Paper, Custom Scale,
Fit/Reduce to Margins), multiple pages per sheet, Center, Dim Page Content,
Dim Filtered Markups, Print Spaces, Print Visible Hyperlinks, Defaults.
Ours: the browser picks the printer, so the dialog prepares the sheets
(rendered at 150 or 300 dpi, capped per page for low-memory machines) and
opens the browser's print dialog. Layers print when shown and their Print
usage is on; markups on hidden layers do not print. Not yet: Selected
pages, margins options, Dim Filtered Markups, Print Spaces.

## Status bar
- Left: help for the current tool and the toggles Show Grid, Snap to
  Grid, Snap to Content, Snap to Markup (points and guidelines from nearby
  markups), Reuse Markup Tools (stays until Esc / right-click), Sync
  (split view; Document or Page mode).
- Right: page scale ("Scale Not Set"; click to set), page size, cursor
  position. F8 toggles the status bar.

## Markups List
- Columns menu to show/hide; drag headers to reorder; custom columns and
  statuses.
- Filter List adds an "All" filter row above the columns; Clear All.
- Click a header to sort, again to reverse; Subject / page sorts tie-break
  on creation date.
- Summary: CSV, XML, PDF or print, with Columns and Filter & Sort tabs.

## Preferences (Measure)
- Automatically split Count measurements by Space; Dynamic Fill settings
  (DPI, fill/boundary size, speed, colours, edge sensitivity); legacy
  persist behaviour for Subject/Label.
