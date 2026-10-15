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

- Pages: Current (default), All Pages, Selected (offered when pages were
  selected in Thumbnails before Set Scale, e.g. right-click on a
  multi-selection), Custom (ranges like 1-3, 5, 9).

## Measurements panel menu
Show Measurement Tools (the tool buttons in the panel), Snap Orthogonal
(measurements kept to 45° steps; Shift does it for one point), Snap to
Content, Highlight Viewports (tinted while a measurement tool is active).
Make Annotations from Measurements concerns Studio only.

## Properties panel
General (Author, Subject, Label, Comments, Lock), Appearance per tool,
Custom Columns when the list has some, a Layout section with X, Y, Width,
Height (ours: inches from the page's lower left; typing a value moves or
resizes the markup), and Add to My Tools / Set as Default (the markup's
appearance becomes the tool's default).

## Measurement display (Properties)
Captions can be moved (Shift+drag; not Radius, Diameter and Angle),
turned by dragging the orange anchor beside them (15° steps, Shift for
1°), and put back with right-click > Reset Caption Position; the offset
and angle are kept with the markup (CTData) and drawn in the saved file.
Revu's measurement properties: Show Caption (which captions show, or
none), Show Segment Values (each segment's length, aligned on, inside or
outside the line), Show Centroid, and the Length / Area / Volume unit of
that measurement; Width / Height read-only. Ours keeps them in CTData so
they round-trip; the drawing shows segment values and the centroid on
screen, the saved appearance carries the caption; /Contents is the
displayed value (in the markup's own unit when set), as Revu writes it.

- Moving a Length caption (Shift+drag) draws a leader line from the line to
  the caption; Show Caption Leader Line (Properties) hides it. Radius,
  Diameter and Angle captions cannot be moved.

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
- Create with a Tool Chest tool: the created markups take the chosen
  tool's properties (its type must match), else the defaults.
- Clear menu: Clear All / Clear Fill / Clear Boundaries. Settings ▾ (this
  session): Fill size (the cursor's radius; a bigger one crosses small
  gaps), fill colour, boundary size and colour, Momentarily hide markups.
  Edge sensitivity and fill speed on the toolbar. Defaults in
  Preferences > Measure.
- CyanTakeoff: holes larger than ~0.5% of the room (columns, shafts) become
  cutouts on Area/Volume; small pockets (room labels) are ignored.

## View modes and Rotate View
- View > Mode: Single Page (Ctrl+4), Continuous (Ctrl+5, pages one under
  another), Side by Side (Ctrl+6, pages 1-2, 3-4... as pairs), Continuous
  Side by Side (Ctrl+7). Markups can be drawn on any page shown. Show
  Cover Page in Side-by-Side keeps page 1 alone (pairs 2-3, 4-5...).
- Split view: Split Vertical (Ctrl+2) / Horizontal (Ctrl+H), Toggle Split
  (Ctrl+I, flips the direction), Switch (Ctrl+1, the other pane), Unsplit
  (Ctrl+Shift+2), Balance (Shift+F12). Synchronize Document keeps both
  panes on the same page index; Synchronize Page (the Sync toggle) shares
  zoom and scrolling.
- View toggles: Dark Mode (dark chrome), Disable Line Weights (ours: markup
  lines one screen pixel at any zoom; the drawing itself keeps its line
  weights), Always Show Reply Indicators (a bubble with the reply count on
  markups that have replies).
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
- Split Document: by Page Count (every N pages), Page Ranges ("1-3, 4":
  a file per range, named after it), Top-Level Bookmarks (a file per
  bookmark, named after it; pages before the first make their own) or
  File Size (MB; ours estimates pages per file from the average page).
  Batch > Split Documents runs it over the open files. File > Close All
  (Ctrl+Shift+W) closes every tab, asking about unsaved changes.
- CyanTakeoff writes pending changes into the PDF, applies the operation
  and reloads; undo history restarts after a page operation.
- Replace Pages keeps the old page's markups, page scale and Spaces (the
  basis of slip sheeting). Flatten keeps hyperlinks and form fields.

## Sets, Batch Link, Slip Sheet
- Sets (Alt+2): several PDFs browsed as one set of sheets. CyanTakeoff:
  the open documents, listed by page label, with a filter.
- Sets menu: Select All / Select Latest Revisions / Select Previous
  Revisions, Options (Sorting: Show = file name, page label, sheet name or
  number; Sort By = page label, file name + page label, file name + page
  index; Sort Order alphabetic/alphanumeric asc/desc; Revision Filter Auto
  (from the names), Wildcard (* any, # number, ? letter, ; separates, \
  escapes) or Off; Previous Revisions hidden / grayed / crossed out /
  shown; Current Revisions highlighted or stacked with an arrow), Stamp
  previous revisions "Superseded", Print Set, Search Set (Search panel on
  the current Set), Tags, Export Drawing Log. Ours: options kept in the
  browser; revisions are read from file names ("A-101 R2", "A-101_B",
  "Plan (2)") or page labels when sorting by label; the Superseded stamp
  is a stamp markup in the middle of each previous sheet.
- Tags (Sets panel > Tags…): values per sheet. Standard tags: Sheet
  Number, Sheet Name, Discipline, Revision (on by default), Drawing
  Number, Revision Number, Sheet Type; custom tags with a type (text,
  number, date). Click a cell and type in the field at the top; Ctrl+click
  several cells to set them at once; AutoMark (⌖) reads a tag from the
  same region of every sheet; tags can be reordered and removed (which
  clears them on every sheet). Sheet Number defaults to the page label;
  Discipline and Sheet Type derive from it (NCS letters and first digit)
  when empty. Ours: values are kept in the browser by file name and page
  (Revu keeps them in the Set file).
- Export Drawing Log (Sets panel): pick and order the data (tags plus
  File Name, Page Label, Page Index), export as CSV or PDF, title with
  the Set name prepended and the date appended, Add to Set opens the PDF
  log as a document. Rows are sorted by Sheet Number.
- Page labels: sheet numbers such as A-101; can be generated from the
  title block. Saved as the PDF's /PageLabels.
- Batch Link: turns mentions of the search terms in the drawings into
  hyperlinks. Terms come from page labels (sheet numbers), file names, a
  page region (AutoMark) or an imported CSV, with a filter on the term
  text; options: relative paths, Highlight Links (a coloured rectangle),
  what to do where a link exists, link appearance (colour, width, style:
  a highlight markup or an outline/fill outside the Markups list); the
  summary reports links created and deleted and pages without text.
  Ours: terms from page labels or file names over this document or all
  open ones; Outline / Highlight Links (colour) / Invisible; keep or
  replace existing links; CSV report.
- Slip Sheet: new revisions go over sheets matched by page label (sheet
  number, with an Advanced Match Filter: * any text, # number, ? letter,
  ; separates), by file name + page index, by page region, or by hand.
  Options: Replace Current Pages with Revised Pages, or Insert Revised
  Pages before Current Pages (the old sheet stays, optionally stamped
  'Superseded'); Copy Markups from Current Pages to Revised Pages (with
  unflatten before / flatten after); a PDF or CSV report. Ours: label (with
  the filter) or index matching, replace or insert, copy markups (also
  scale and Spaces), Superseded stamp, CSV report; links and bookmarks to
  the old page follow the new one.

## Tool Chest, shortcuts, profiles
- Tool Chest: tool sets (gear menu: rename, export, delete, Legend), My
  Tools first. Right-click a tool: Properties Mode (draw a new markup with
  its properties) or Drawing Mode (place a copy of the saved markup),
  Duplicate, Change Colors (each colour the tool uses and what it
  becomes), Offset as (the selected markup's offset drawn as this tool's
  type), Rename, Remove. Recent Tools items: Add Item to My Tools. My
  Tools items carry hot keys 1-9 (the digit picks the tool).
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
  Languages: English, French, German, Spanish, Italian, Portuguese, Dutch,
  Polish, Turkish, Russian, Ukrainian, Greek, Arabic, Hebrew, Chinese
  (Simplified and Traditional), Japanese, Korean (several at once); their
  data is served by the app and only downloaded when used. The invisible
  text uses a glyphless Unicode font (any script searches and copies;
  right-to-left words are written in visual order).

- Forms: field tools (Text Field, Check Box, Radio Button, Dropdown, List
  Box, Signature Field; Revu default shortcut X adds a signature field):
  drag the box, then name the field. Radio buttons sharing a name form one
  group. Forms Editor (Ctrl+Shift+F) renames, re-options and deletes fields.
- Forms panel: lists the current page's fields (Show All Pages: every
  page); Forms menu: Order Tabs by Row / by Column (automatic, locks manual
  reordering) or Unspecified (drag to reorder, ours: ▲▼); the alignment
  toolbar on two or more selected fields: Align Left/Top/Right/Bottom,
  Center/Middle (to the first selected field), Align Width/Height/Size,
  Center in Document, Distribute Horizontally/Vertically (three or more);
  fields and markups cannot be aligned together. Ours: the Forms Editor
  (Ctrl+Shift+F) holds these; automatic order is written as the page /Tabs
  entry, the manual order as the widgets' order in /Annots.
- Automatically Create Form Fields (Tools > Form): the content layer is
  scanned and form-like areas become fields named from nearby text: text
  boxes, check boxes (small squares), signature fields (a "Signature"
  label), date fields, radio buttons (circles). Edit Form mode then opens
  with the new fields for review; with nothing found, Revu offers OCR.
  Ours: boxes come from stroked rectangles in the vector content, circles
  from closed curves; a label is the text left of the box on the same line,
  else just above it; check boxes take the text on their right; tall boxes
  are multiline; areas with existing fields are skipped; the status bar
  points to OCR when nothing is found.
- Form data (Tools > Form): Import Data (FDF; ours also XFDF/XML and CSV),
  Export Data as FDF, XML (XFDF fields) or CSV, Merge Data (one CSV row per
  open document), Reset (clears every field), Highlight Fields (the blue
  tint), Migrate Typewritten Text (Typewriter markups inside a text field
  become its value and are removed), Button fields with a caption.

## Flatten Markups (Document > Flatten, Ctrl+Shift+M)
- Type list: check the markup types to flatten. Scope: All Markups,
  Exclude Filtered Markups, or Currently Selected Markups (shown when a
  selection exists). Allow Markup Recovery (Unflatten), Flatten to Layer
  (Leave Markups on Existing Layer, Overlay Text with font and position),
  Show Properties in Popup, Flatten Capture Media as Attachment, page
  range, batch over files. Right-click > Flatten uses the defaults
  (recoverable). Ours: types present in the document; All, Exclude
  Filtered (offered while the Markups List is filtered) or Currently
  Selected; recovery; Assign Layer with Overlay Text (the layer name in
  Helvetica at the chosen size in a corner of each flattened markup:
  Top/Bottom Left/Right); Flatten Capture Media as Attachment (the
  Capture Summary PDF with a title, attached to the file; offered when a
  markup has photos). Not yet: property pop-ups, Leave Markups on
  Existing Layer.

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

- Vector compare also flags linework that is in the same place but in
  another colour or a line weight more than 20% different.

## Measurement properties: slope, rise/drop, depth
- Slope (Pitch x/12, Degree or Grade %) adjusts lengths and areas for a
  sloped plane: sloped = plan × sqrt(1 + slope²).
- Rise/Drop (length, polylength) is added to the length; Depth on lengths
  gives wall area (length × depth). Depth and Rise/Drop are exclusive.

## Custom columns (Markups List > Columns > Manage Columns)
- Choice items carry an optional Subject (the item is offered to markups
  with that Subject) and a numeric value for formulas (Assign Numeric
  Value); items can be imported from a CSV (item, subject, value); Allow
  Custom Text lets the cell take other text. Number columns have Min/Max;
  Text columns can be Multiline. Save to Profile makes the columns the
  start of every new document that has none; Delete from Profile stops
  that. Profiles also carry the status models and the profile columns.
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
- Properties: Title (text, Show Title, font size 1-144 pt, bold/italic/
  underline/strikethrough), Columns (Description, Edit Columns to add any
  Markups List or custom column, Show Column Headers, header font), Table
  (line colour, fill colour and opacity, line opacity, line width (0 hides
  the lines), Source Pages: Current page / All Pages / Custom range such as
  "1-3, 5, 9", Symbol Size 1-5000 %), Text (font, size, colour, style,
  margin, alignment left/center/right).
- Right-click a Legend: Add to Tool Chest, Copy Legend to Snapshot (a
  static Snapshot that no longer updates), Apply to All Pages (a dynamic
  copy on every page in the same position, each counting its own page).
  Copy/Paste makes a dynamic copy that counts the page it is pasted on.
  Right-click other markups: Legend › Create New Legend, Legend › <title>
  adds them to that Legend.
- CyanTakeoff: kinds match on type, subject and colour; saved as a Stamp
  with the current table as its appearance (rewritten on every save). Extra
  columns: Label, Comments, Status, Author, Layer, Pages, Color and the
  document's custom columns (numeric ones are totalled per kind, text ones
  list the distinct values).

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
  Group (a label without a box), Rename (F2), Delete, Layer Properties,
  Export Layer to Page, Flatten Markups (the Flatten dialog with Assign
  Layer preset to this layer), Unflatten Markups.
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
  buttons, about a base point (default the page centre). Markups on the
  layer move with it.
- Drag a layer to reorder; drop it to the right to make it a child.
- Markups: right-click > Layer to assign or create a layer; a markup on a
  hidden layer is hidden. Stored as the annotation's /OC.
- Add Layer from Page draws another sheet on the page as a new layer, with
  Align Points when the sheets differ in position or scale.

## Appearance extras (Properties)
- Cloud and Cloud+: Size (width of the cloud arcs, 1 = default, 2 =
  twice as big; saved as the border effect intensity /BE /I) and Invert
  (arcs bulge inward).
- Highlight: makes the fill (and hatch) transparent so the content shows
  through; ours: the Multiply blend mode (unchecking a Highlight markup's
  Highlight turns it into a Pen markup in Revu).
- Length and dimension captions: right-click > Flip Text turns the caption
  180°.
- Image: Mask Color with Mask Tolerance makes a chosen colour transparent
  (ours: the picture is rebuilt as a PNG with transparency and the
  untouched picture kept); Encoding ZIP (graphics) or JPEG (photos);
  outline colour, width and line style.
- Note: Properties > Icon picks the icon (Comment, Key, Note, Help, New
  Paragraph, Paragraph, Insert, Check, Circle, Cross, Star, arrows,
  crosshairs: the PDF text-annotation /Name), plus colour and opacity; the
  pop-up holds the text (ours: the Comments column and the hover tip).

## Blend Mode (Properties > Appearance)
- How a markup combines with the content under it: Normal, Multiply,
  Screen, Overlay, Darken, Lighten, Color Dodge, Color Burn, Hard Light,
  Soft Light, Difference, Exclusion, Hue, Saturation, Color, Luminosity
  (the PDF blend modes). Highlights multiply by default; stamps darken.
- CyanTakeoff: saved as /BM in the appearance's graphics state and read back
  from it; drawn with CSS mix-blend-mode on screen.

## Highlight (H)
- Drag over page text: the text lines are highlighted (one markup, text
  copied into the comment when the preference says so). Elsewhere a free
  highlight box. Ctrl+drag over text draws the free box anyway.
  Preferences > Markup > Enable Text Highlighting (on by default): off
  makes every drag a free highlight. Shift constrains the box; a text
  highlight cannot be moved or resized.

## Editing markups (move, resize, rotate)
- Drag a markup to move it; drag a yellow control point to resize or
  reshape. Polygons, polylines, clouds, pen strokes and arcs also have
  purple scale points at the corners of their box: dragging one scales the
  markup about the opposite corner, keeping its proportions (Shift: width
  and height on their own). Rectangles and ellipses have no purple points:
  Ctrl+drag a corner keeps their proportions.
- Rotate: drag the orange control point outside the bounding box; the
  angle shows while dragging and the shape turns in 15° steps (Shift: any
  angle). Lines (two control points) cannot rotate. Stamps also take an
  exact angle in Properties > Layout > Rotation.
- Select: drag left-to-right selects markups entirely inside the
  rectangle, right-to-left those it touches; Shift+click adds; Lasso
  (Shift+O) selects within a free-form region.
- CyanTakeoff: shapes made of points (polygons, areas, clouds, pen...) are
  turned point by point; box shapes (rectangle, ellipse, text boxes,
  stamps, images, Cloud+) keep a rotation angle (CTData) and are drawn
  with a rotated appearance stream, so other readers that regenerate
  appearances from /Rect show them unturned.

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

- Ours: a polygon cutout's edge can be curved (right-click in the hole:
  Cutout Edge: Arc Outward/Inward, Cutout Point: Curve, Straighten
  Cutout); the area subtracts the curved outline.

## Touch and pen
Revu on tablets: pinch to zoom, two fingers to pan, the pen draws, and a
press-and-hold acts as a right-click. Ours: the same; a finger also pans in
Select when it does not touch a markup, and View > Pen Mode makes every
finger touch pan/zoom so only the pen draws (palm-friendly).

## Review Text, Create Hyperlinks from URLs
Review Text marks text for edits without changing the PDF: drag across
text and type the replacement (the text is struck through, an insertion
caret follows it, the new text is in the note), or click a spot and type
the text to insert (caret only). Ours: Tools > Review Text, or
right-click a text selection > Replace Selected Text; a Caret annotation
(PDF /Caret) grouped with the StrikeOut. Create Hyperlinks from URLs puts a
Hyperlink markup over every web address and email in the page text, over
a page range.

## Edit Text, Erase Content
Revu edits the PDF's own text in place; replacing text in a font that is
not editable can be skipped or done with another font. Ours: Tools > Edit
Text, click a line, type, Enter. The same font is kept when every new
character already appears in that run (works with subset fonts); otherwise
a standard font of the same family is used at the same position, size,
spacing and colour. Tools > Erase Content removes text, vectors and images
under a dragged rectangle (redaction without the box). Tools > Cut Content
takes the content under the rectangle to the clipboard as a snapshot and
removes it from the page; paste it (Ctrl+V) as an image markup, which is
how content is moved.

## Security, Reduce File Size, XFDF
Document > Security (Ctrl+L): No Security or Password Security with a
password to open and/or a permissions password restricting printing,
changes, copying, commenting and form filling; changing it needs the
permissions password. Reduce File Size removes unneeded data and
recompresses/downsamples images. Markups can be exported to and imported
from XFDF, the standard markup exchange format; stamps (images, snapshots,
custom stamps) travel with their artwork in <appearance>, the base64 XML
picture of the /AP dictionary Acrobat uses. Ours: new security is
AES-256; files encrypted with RC4 or AES-128 keep their own settings when
saved; certificate security is not supported (such files open read-only).

## Number Pages, Create Page Labels, Page Setup
Number Pages (Document menu or a thumbnail's right-click): a numeral style
(1 2 3, I II III, i ii iii, A B C, a b c, or None for a prefix alone), a
prefix, a start number and a page range (All, Current, Selected, Custom)
set the page labels. Create Page Labels from Bookmarks gives each page the
title of its first bookmark (page-region labels: Page Labels > Use Sheet
Numbers / AutoMark). Page Setup gives pages a new media size (paper list
or custom, portrait/landscape) with the drawing auto-scaled or at a
percentage, aligned (nine positions) and offset; content, annotations,
measurement scales and viewports follow. Not for signed files (Revu
refuses too).

## Batch menu
Revu's Batch menu runs a command over many files. Ours runs over the open
documents: Apply Stamp (a built-in or custom stamp at a corner or the
centre of every chosen page, with a margin), Rotate Pages, Crop Pages
(margins), Page Setup, Security, Reduce File Size, OCR, Print (one print
job), Header & Footer, Watermark, Bates Numbering, plus Batch Link, Slip
Sheet, Flatten, Summary and Combine. Each dialog has a Files option (This
document / All open documents) that the Batch menu presets to all.

## Color Processing, Archive as PDF/A, Repair PDF
Color Processing (Document menu) recolours the page content: Grayscale,
Black and White, Colorize (one colour, or a scale from dark to light),
Luminosity/Saturation/Hue, Modify Colors (source colour to another within
a tolerance; Revu: vector only); Process Images also recolours raster
images (ours: JPEG images); page range. Mask Images: not yet. Archive as
PDF/A exports a PDF/A-1b copy; ours adds the PDF/A identification (XMP),
an sRGB output intent and the title, and reports what a strict validator
may still object to (fonts not embedded, transparency, JavaScript), since
fonts cannot be embedded after the fact. Repair PDF cures display
problems; ours rebuilds the file structure, drops broken annotation and
content entries and closes open graphics states (Revu's AutoCAD wipeout,
striped-image and clipping fixes: not yet).

## New PDF from Template
Revu creates a PDF from a template file and manages templates. Ours keeps
templates in the browser: add a PDF file or the current document, rename,
delete; Create opens an Untitled copy.

## File menu: Create, Open
- File > Create: From File (one file, an image or a PDF, becomes a PDF),
  From Multiple Files (one PDF per file), From Scanner or Camera, Layered
  PDF, PDF Package. Open also converts supported image files. Ours: images
  (PNG, JPEG, WebP, GIF, BMP) become one page at 150 dpi; no scanner or
  package.
- Window > Hide/Show Panels puts the left, right and bottom panels away
  and brings them back (Hide Panel: Shift+F4); Auto-Hide Panel Access / Tabs and
  Always On Top are desktop-window features.

## File exports, Undo History, Crop Image, Certify
File > Export: ours exports PNG or JPEG (one file per page, resolution,
with or without markups) and plain text (reading order, pages separated);
Revu also offers TIFF/GIF/BMP, RTF/HTML and Office formats (not yet).
Publish As: Flattened (markups merged into the content), Compressed,
Uncompressed (plain PDF, revisions merged); Revert As (earlier saved
revisions) is covered by Refresh (F5) reloading the file. Edit > Undo
History lists the unsaved steps (markups, scale, pages) to undo back to
one. Markup > Crop Image: drag the part of a selected image markup to
keep. Document > Certify Document signs with a DocMDP certification (no
changes / form filling and signing / also markups), only as the first
signature; Validate Signatures re-checks them and opens the Signatures
panel.

## Header & Footer, Bates, Watermark
Header & Footer (Document menu, Batch for many files): left/centre/right
text in the header and footer, with fields such as page number, page label,
date, time, file name and Bates number; font, size, colour, margins, page
range (e.g. skip the cover), preview. Bates numbering adds prefix, suffix,
start number and digit padding (six or more digits is common). Watermarks
add large faded text across pages. Ours writes all three as real page text
tagged as pagination artifacts (so they print everywhere) and can remove
what it added; a Files option runs any of the three over all open
documents (Bates numbers continue from one file to the next).

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

## Text search (Search panel, Alt+1 / Ctrl+F)
Options: Match case, Whole words; what is searched: Pages (the page
text), Markups (subject, label, comment; a result selects the markup),
Form Fields (name and value), File Properties (Title, Author, Subject,
Keywords...). Results are listed with the page label and context; each
has a checkbox. Select All / Select None, Check Options (Hyperlink
Checked: a web address or page number; Mark for Redaction; Apply Count
Measurement to Checked: one Count per page; Highlight / Underline /
Squiggly / Strikethrough Checked) act on checked results found in the
page text; Replace Checked rewrites them; Clear empties the list. Ours:
no Recents/Folder/Set locations.

## VisualSearch (Search panel, Alt+1 / Ctrl+F > Visual)
Get Rectangle: drag around a symbol; a preview shows what will be looked
for. Search in the current page, document, all open documents (also Sets,
folders). Sensitivity: lower accepts looser matches (scans, adjacent lines)
at the risk of false positives. Search Multiple Rotations tries 45° steps.
Filter by Color / Refine Colors limit the colours considered. Results show
a picture of each match; clicking one goes there. Checked results can get a
Count measurement (Actions > Apply Count Measurement to Checked), a
Highlight, a Hyperlink or a Mark for Redaction. Ours: Filter by Color
lists the symbol's colours as swatches to switch off (matching then uses
only pixels near the colours left on); no folder search yet; matching is
on rendered ink (1.5 px per point).

## Spell check (Edit > Check Spelling, F7)
While editing text in a markup or form field, unknown words get a squiggly
underline; right-click offers suggestions and Add to Dictionary. F7 checks
markups and form fields one word at a time in context: Ignore Once, Ignore
All (this run), Add to Dictionary, Change, Change All. Markup Spelling
Mistakes checks the PDF's own text over a page range and puts a Squiggly
markup (chosen colour) under each mistake, optionally with the suggestions
in its comment. Revu sets the language in Preferences > Spelling. Ours:
Hunspell dictionaries for English (US/UK), French, German, Spanish,
Italian, Dutch, Portuguese, Polish, Swedish and Danish, chosen in either
dialog (remembered; the browser's language to start); words added are kept
in the browser and apply in every language; codes like A-101 and web/email
addresses are skipped.

## Line styles and hatch patterns
A line style is one or more lines, each offset from the middle (-10..10),
made of components: dash and space (adjustable width), dot, and text. "Scale
with line thickness" makes them grow with the line width. Styles live in
sets (the Standard set is read only); sets are imported/exported (Revu
.blx; ours JSON, since .blx is undocumented). Changing a style does not
change markups already drawn. Hatch patterns fill closed markups and area/
volume measurements; the editor draws lines and small/large dots on a grid
tile; sets import/export, and AutoCAD .pat files import every pattern
they hold (line families with dashes become a tile sized so the spacing
repeats; inch or mm units guessed from the spacing, Hatch Scale adjusts).
Ours: the markup keeps a copy of a custom style so the file is
self-contained; hatches are drawn in the fill colour and saved as PDF
tiling patterns so any viewer shows them.

## Tool Chest extras
Tool set menu: Symbol (icons only) or Detail view, Set Scale (the active
page's scale; Drawing mode tools then keep their real size on sheets at
other scales) / Remove Scale, Rename, Export, Create Legend, Hide, Delete.
Tool Chest menu: show hidden sets, Manage Tool Sets (new, import),
Comment Persistence (No / Exclude Text Boxes / All Markups: whether a
Properties mode tool clicked with markups selected copies its comment),
Update Tool Set Item on Reuse (a style change on a markup made with a tool
goes back to the tool). Recent Tools: Maximum Recents, Clear Recents, Hide.
A size slider scales the icons. Revu applies a Properties mode tool to
the selected markups on a click; ours does it on Shift+click, so a plain
click always picks the tool.

## Bookmarks (Alt+B)
Add Bookmark goes to the current view of the active page and is named after
the page label, ready to type over; it goes below the selected bookmark
(or at the end), or Add Before / After / Child. Rename by double-click, F2
or right-click; delete with Delete. Drag to reorder, drag inward to nest,
Ctrl+drag to copy. Right-click: Set to Current View, Properties (title,
colour, bold, italic; several at once). Bookmarks menu: Save Collapse
State (the current expanded/collapsed layout becomes the file's default;
save the file to keep it), Create Bookmarks (page labels, or AutoMark from
a page region), Audit Bookmarks (flags ones pointing at pages no longer in
the file), Export Bookmarks (CSV, or a PDF listing the bookmarks of every
open file). Ours: toggling a bookmark open or closed does not change the
file by itself; Save Collapse State does (written as the outline /Count
sign).
Create Bookmarks: Page Labels, or Page Region (AutoMark): Select drags a
region whose text names the bookmark (Add for more regions, e.g. number and
title), over All/Current/Custom pages. Ours keeps regions as fractions of
the page so they fit sheets of other sizes.
Right-click > Action: jump to a page, the current view or a Place, open a
web address, or open another file at a page (saved as /URI, /GoToR or a
named /Dest). Ours: Export is CSV; unedited actions are kept as they were.

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
usage is on; markups on hidden layers do not print. Selected pages come
from the Thumbnails panel (click, Ctrl+click, Shift+click); margins (in or
mm) with Fit/Reduce to Margins and Center; page filters Even/Odd/
Landscape/Portrait/First/Last; Print Spaces draws each Space's outline and
name; several pages per sheet across-then-down or down-then-across with an
optional border. Not yet: Dim Filtered Markups, Print Visible Hyperlinks.

## Small commands (Window, Document, Markup menus)
- Properties panel with nothing selected: File Properties (title, author,
  subject, keywords; Enter or leaving the field saves), Custom Properties
  (own Info entries: add, edit, delete) and File Attachments of the
  document (Open saves the file, Add New, Delete; the File Attachment
  markups are separate).
- Document Properties (Ctrl+D): title, author, subject, keywords (editable,
  saved in the file) and file facts (creator, producer, dates, version,
  pages, page size, file size, security).
- Save All (Ctrl+F2) saves every changed file; Refresh (F5) reloads the
  file from disk (we need it opened with file access).
- Autosize Text Box (Alt+Z) fits a text box or callout box to its text.
- Callout leaders: right-click inside the box > Add Leader puts another
  leader from the clicked point to the box; each leader's tip has a
  handle; right-click a tip > Delete Leader (the last one gone, the
  callout is a text box again). A text box gets a leader the same way
  (right-click > Add Leader) and then behaves as a callout. Leaders run straight to the
  nearest side (ours: no shared knee). Lines, arrows, polylines and
  callouts have Start / End line ends (None, Open Arrow, Closed Arrow,
  Circle, Square, Diamond, Slash, Butt, Reverse arrows) and a size,
  saved as /LE; arrows and callouts default to an open arrow.
- Text properties (Text Box, Callout, Typewriter, Cloud+; Properties >
  Text): Font (Helvetica, Times, Courier: the standard PDF fonts), Font
  Size or Auto (the largest size that fits the box), Font Style (bold,
  italic, underline, strikethrough), Alignment (left/center/right and
  top/middle/bottom), Line Space (multiple of the size; 1.15 = Revu's
  default), Margin, Text Color (separate from the line colour), Shape
  (rectangle, circle, triangle, hexagon; text box and callout). Saved as
  the annotation's /DS ("font: Times 12pt; text-align:center;
  line-height:13.8pt; color:#0000FF; font-weight:bold"), /RC rich text,
  /Q and the DA font; vertical alignment, margin, Auto and the shape are
  ours (CTData). Revu's per-word formatting, superscript/subscript and
  other fonts are not supported.
- Remove Selected from Group (Ctrl+Shift+Alt+G): pick the member in the
  Markups List (a list click selects just that markup, not its group),
  then the command; a group left with one member is dissolved.
- Full Screen (F11); Presentation (Ctrl+Enter): page fitted on black, click
  / Down / PageDown next, right-click / Up / PageUp previous, Esc leaves.
- Navigation Bar (F4) shows or hides the page navigation in the status bar.
- Balance (Shift+F12) makes split panes equal; the divider can be dragged
  (double-click balances too).
- Show Context Menu (Shift+F10) opens the right-click menu of the selection.

## Select Text and snapshots
- Select Text (Shift+T): drag over the drawing's text; it is highlighted in
  blue. Ctrl+C copies it; right-click offers Copy, Highlight,
  Strikethrough, Underline, Squiggly, Mark for Redaction and Search. Select
  All Text (Ctrl+Shift+A) takes the whole page. Esc clears it.
- Snapshot (G) copies the region with its markups; Snapshot Content
  (Shift+G) copies only the drawing. Copy Page to Snapshot (Ctrl+Alt+C)
  copies the whole page with markups. All paste as an image markup and go
  on the system clipboard as PNG.

## Links panel (Alt+N) and File Access (Alt+A)
- Places are named anchors (PDF named destinations). Add Place: a name and
  a location: a page, the current view (page and zoom) or a snapshot
  rectangle (Get Rectangle). Clicking a Place jumps to it; Ctrl+click
  multi-selects. Links name the Place, so moving a Place keeps links
  working; Revu breaks links when a Place is renamed, we re-point them.
  The link icon on a Place row draws a hyperlink to it without a dialog.
- Hyperlinks section: every link with its action; click to select and
  jump, Ctrl+click for several, Edit Action changes all selected, Search
  filters. PDFs from elsewhere show their named destinations as Places.
- File Access lists recent files (kept in this browser); pinned files stay
  on top. A file opened with file access reopens and saves in place.

## New PDF, Crop, Deskew, Email, Publish
- New PDF (Ctrl+N; browsers may keep Ctrl+N, so also File menu and the
  start page): blank pages, or a PDF made from images (page size from the
  image resolution).
- Crop Pages (Shift+Alt+O): set the visible area (CropBox) by drawing a
  rectangle or trimming margins, for a page range; Remove Crop undoes it.
- Deskew (Ctrl+Alt+D): straightens tilted scans (we measure the tilt of
  the lines and rotate the page content to match; up to 10°).
- Email (Ctrl+E): sends the PDF (share sheet where available).
- Publish as Compressed (Ctrl+Shift+P): saves a compressed copy (images
  resampled, history and unused data removed).

## Flatten and Unflatten
- Flatten Markups (Ctrl+Shift+M) has "Allow markup recovery": the
  markups can later be restored with Document > Unflatten (Ctrl+Shift+U).
  Without it flattening is final. Editing the page content afterwards
  (Edit Text, Erase Content, applying redactions) blocks recovery for that
  page. We keep the recovery data in our own page keys (/CTFlattened,
  /CTFlatContent); Revu cannot unflatten our files, nor we Revu's.

## Stamps, statuses, actions, Offset, Camera, Replace
- Stamp tool: standard stamps plus custom ones (Manage Stamps). Create
  Stamp: Subject (name), Template (Blank, Text, Text with Border, Text
  with Date and Border, Text with Rounded Border), Width and Height in
  inches, Title, Subtitle with dynamic text inserted from a menu (User,
  File, FileName, Path; Date, Day, Month, Month3, MonthName, Year, Year2;
  Time, Hour, Minutes, Seconds; {Author} and {DateTime} too), border,
  opacity, colour; the dynamic text is filled in when the stamp is
  placed. Each stamp can be saved as a PDF file of its size (as Revu keeps
  stamps), and Import Stamp (PDF) turns a stamp file's first page into an
  image stamp. Image stamps from PNG/JPEG; export/import a JSON stamp file
  to share a set. Ours: no stamp editor with markup tools, no blend mode
  or rotation on the stamp definition (Layout rotation applies after
  placing).
- Status: the Review model (None, Accepted, Rejected, Cancelled,
  Completed) cannot be changed. Manage Status adds models (e.g. Valve)
  with states that can recolour the markup and put text into a text box
  grouped with it; models can be hidden; a custom default applies to new
  markups. Set Status from the list, Properties or right-click (Set
  Status > Model > State); who set it and when is kept.
- Edit Action (Ctrl+Shift+E, right-click): any markup can open a web
  address or jump to a page or Place; double-click follows it.
- Offset (O with one markup selected): Distance (in the page's scale
  units, else inches), Replace Markup, Angle Miter Limit, Offset as
  another type; the click picks the side (inside/outside for shapes).
- Sketch to Scale (Tools): Polygon, Polyline, Rectangle, Ellipse drawn by
  typing. Click the first point, then Length (Tab) Rotation (Enter) per
  side; Enter again or C closes; a rectangle/ellipse takes Length, Width,
  Rotation then Enter. Lengths are in the page's scale units (feet-inches
  accepted), rotation in degrees counter-clockwise, relative to the page or
  to the last side. Ours: a turned rectangle or ellipse becomes a polygon.
- Multiply (right-click or Edit): parallel copies of the selection up,
  down, left or right, a distance apart (scale units, else inches), as
  many as fit on the sheet; copies are independent markups.
- Hide (Edit or right-click) takes markups off the drawing (PDF Hidden
  flag) but keeps them greyed in the Markups List; Show / Show Hidden
  Markups bring them back. Cut (Ctrl+X) = Copy + Delete.
- Camera (Ctrl+Alt+I): take a photo and click to place it.
- Search > Replace Checked: replaces the checked results in the drawing's
  text (as Edit Text does).

## Thumbnails panel toolbar
Thumbnails menu: Page Setup, Cut / Copy / Paste Pages (pages move between
open documents with their markups; a paste goes after the current page),
Copy Page to Snapshot, Apply Stamp, Insert Blank Page, Insert Pages,
Extract, Replace, Delete, Rotate, Number Pages, Create Page Labels,
Re-Label (the current page's label), Set Scale, Export Pages (a PDF of
the selected pages), Email Pages, Print Pages (the Print dialog preset to
the selected pages), Repair PDF, Flatten, Markup Summary. Commands act on
the selected thumbnails (Ctrl/Shift+click), else the current page; the
same menu opens on right-click. Labels menu: Page Label, Page Scale
(double-click the scale to set it). Create Page Label button; size
slider.

## Count groups
A Count is one markup whose items are its points; the Markups List
Count column shows the total. Right-click an item: Resume Count (keep
clicking to add items; Esc ends), Delete from Group (that item), Split
Counts (that item becomes its own Count), Split All (every item), Merge
Counts (with the other selected Counts; the right-clicked one's
properties win). Appearance: Symbol (circle, square, triangle, diamond,
cross, X, check, star) and Scale; written as /CountStyle. Tool Chest:
Create Count on any tool makes a count tool with its colours and a
symbol matching its shape (ours: standard symbols only).

## Flags panel (Window > Flags)
Flags are for jumping to pages and places. Linked flags are Flag markups
(Shift+F; title and colour follow the markup, click jumps to it; the
markup's action is edited with Edit Action). Unlinked flags (Add) exist
only in the panel, default to the page's label as title, and carry one
of six actions: Jump to Page (with zoom), Jump to Place, Jump to Space,
Snapshot View (an area picked on the page), Hyperlink, Open (an open
file). Toolbar: Flag, Add, Delete, Action, Properties (title, colour,
bold/italic for unlinked flags). Flags on the active page span the
panel's full width; thumbnails show ⚑ on flagged pages. Ours: unlinked
flags are kept in the PDF catalog (/CTFlags); no drag reordering yet.

## Help > Find Tools + Commands
A search box over every menu item and tool: type part of the name, pick
with the arrow keys, Enter runs it (disabled items are greyed). Each row
shows the menu it lives in and its shortcut.

## Batch > Compare Documents / Overlay Pages
Pages of the chosen current files are paired with pages of the revised
files by File Name + Page Index (name without extension, case ignored)
or by Page Label. A Match Filter picks the part of the name/label to
compare: `*` non-numeric characters, `#` numbers, `?` a letter, `;`
separates alternatives (e.g. `?-###` finds "A-101" in "A-101 rev 2").
Unmatched pages are left out; the dialog lists the pairs. Compare clouds
the differences on each revised sheet (Visual or Vector); Overlay makes
one overlay PDF per pair. A CSV report lists the pairs with the number of
differences or the overlay file. Ours: only open files (Revu also adds
folders, manual correlation and saved .bcx batches).

## Capture, Sign & Seal, Layered Pages
- Capture (embedded markup media): a markup can carry photos, added from
  Properties > Capture, right-click > Capture > From Camera / From File,
  or by dropping an image onto the markup. They are named after the
  markup's Subject (numbered). The media is not drawn on the page: a
  camera icon at the markup's lower-right corner and the Capture column
  of the Markups List open the viewer (Previous/Next, Add from File,
  Delete, Export, Export All). Photos are shrunk to 1600 px and kept
  inside the PDF with the markup (ours: in CTData). Video and 360°
  photos are not supported.
- Batch > Sign & Seal: one digital ID signs every open document with an
  invisible signature (the seal is placed first with Batch > Apply Stamp).
  Save All writes the signed files.
- File > Create > Layered PDF: pick several PDFs; a new document whose
  page N carries page N of every file as a layer named after the file.
  File > Open Recent: the last files (File Access keeps the full list).
- Document > Insert > Layered Pages: pick a PDF; its page N becomes a
  layer named after the file on page N of the open document (as Add Layer
  from Page does, one page at a time).

## Signature trust and timestamps
- Trusted Certificates (Signatures panel): import .cer/.crt/.pem files. A
  signer is trusted when its certificate is in the list or chains up to
  one in it (each link's signature is checked; a same-name certificate
  with another key does not count). Kept in this browser.
- Sign Document can ask a Time Stamp Authority (RFC 3161 URL) for a
  timestamp token; the panel shows a timestamp's time and authority and
  whether it matches the signature. The server must accept browser
  requests (CORS). Revocation (OCSP/CRL) is not checked.

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
  Each column's filter also offers Custom…: up to two conditions on the
  column joined with AND or OR (numbers: equal / not equal / greater /
  less than; dates: before / after / on a day; text: contains / equal /
  not equal); the filter row then shows the conditions ("> 2 or ≠ 1").
  Markups the filtered list (or the search box) leaves out are dimmed on
  the page (Preferences > Markups List > Dim filtered markups, 75 %).
- Click a header to sort, again to reverse; Subject / page sorts tie-break
  on creation date.
- Shift+click a row selects the range from the row clicked last; Ctrl+click
  adds or removes one row.
- Right-click a row: Copy Cell, Properties, Edit Action, Add to My Tools,
  Set Status, Layer, Copy, Delete, Reply, Check / Clear All Checkmarks,
  Create Legend, arrange commands. Hide Markups (toolbar) takes every
  markup off the drawing and the printout until turned off. Saved Filters
  (with Filter List on): Clear All, Save Filter, apply or delete a saved
  set. Sorting by Subject, Author, Status, Layer, Space, Label, Color or
  Units groups the rows under collapsible headings. Summary menu also:
  Import Markups (XFDF) / Export Markups (XFDF) (ours: no FDF/BAX),
  Capture Summary (a PDF with every embedded photo) and Export Capture
  Media (a .zip of the photos, named after the markups). Columns also:
  Legend (the legends listing the markup), Page Index, Lock, Units, X, Y,
  X/Y Center, Document Width/Height (inches from the lower left), Width
  and Height (real-world, at the markup's scale), Wall Area (perimeter ×
  depth of an area/volume, or the area of a length/perimeter with depth),
  Rise/Drop, Sequence (hidden by default). The saved filter set in use is
  shown with a check mark, starred once its filters were changed.
- Summary (Summary ▾ > Summary…, Batch > Summary…): Columns tab (pick
  and order columns, Show empty columns), Filter & Sort tab (a filter
  per column, Sort by / Then by with direction), Output tab: Export as
  PDF, CSV, XML, Excel or Print; Title and Append date to title. CSV/XML/
  Excel: Include (markups, totals, both), column headers, ID columns (ID
  and Parent of grouped markups), measurement units, replies. PDF/Print:
  Append and hyperlink to current PDF (the report's pages are added to
  the document, each row jumping to its markup's page), Insert page break
  per field, Include totals, Thumbnail (none/small/medium, with or
  without page content), replies. The quick Excel / PDF / CSV entries
  export the list as shown.

## Preferences (Ctrl+K)
- General: User (author of new markups), Theme (Light/Dark), tab
  truncation (end or start of long names), Show recent files on startup
  (File Access panel), full-screen crosshair.
- Navigation: what the mouse wheel does in single page and in continuous
  mode (zoom or scroll; Ctrl+wheel always zooms, Shift+wheel always
  scrolls), reverse wheel, sensitivity.
- Markup: Dynamically set as default (a property changed on a markup
  becomes the tool's default), Reuse tools, Autosize text box and callout
  markups after typing, author and date on hover, Copy highlighted text
  into markup comment, snapshot resolution, Include markups in snapshots.
- Sketch: rotation input relative to the page or to the connected line;
  ellipse by width/height or by radius.
- Forms: field highlight colour and opacity, Highlight fields.
- Signature: digest algorithm (SHA-256 default, SHA-384, SHA-512).
- Document: Page Layout when opening (Single Page, Continuous, by page
  size: pages under 14 in open Continuous), Maximum Zoom; Revu also has
  Save Mode, document recovery, Remember Last Page.
- Grid & Snap: grid spacing, snap sensitivity (5-25 px), snap colour,
  Show Grid, Snap to Grid / Content / Markup (also on the status bar).
- Markups List: Zoom Fit Markups when selected (selecting a row zooms to
  the markup), Wrap Comment Text; Revu also has Exclude Filtered Markups
  on Export, rich text comments, dominant-markup value, dim percent.
- Layers: Hide Child Layers when Hiding Parent Layers, Show Layers on Page
  Only (how the panel opens).
- Spelling: Include Upper Case Words (all-caps words are skipped unless
  on), Custom Words; Revu also has auto-complete lists and dictionary
  imports.
- Not ours: language, startup mode, 3D mouse, keyboard accelerators,
  scrollbars, digital ID folders (browsers choose files per signature).

## Preferences (Measure)
- Automatically split Count measurements by Space; Dynamic Fill settings
  (DPI, fill/boundary size, speed, colours, edge sensitivity); legacy
  persist behaviour for Subject/Label.
