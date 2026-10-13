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
