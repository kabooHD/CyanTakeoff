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
- Signature: Revu signs with certificates; CyanTakeoff places an image
  signature (drawn or typed, kept for reuse).
- Redaction: Mark for Redaction (Shift+R, area), Mark Text for Redaction
  (Shift+K), Apply Redactions (Shift+A, after confirmation) removes the
  content underneath for good.
- OCR (Ctrl+Shift+O): makes scanned pages searchable (invisible text).

## Compare
- Compare Documents: pick the original and revised document/page; the
  differences are clouded (subject "Compare", label Added/Removed/Changed)
  on the revised sheet, optionally removed items on the original too.
- Overlay Pages: base and overlay sheets in two colours (default red and
  blue); what is in both shows grey. Output is a new PDF.
- Revu also offers alignment points and vector comparison; not built yet.

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
