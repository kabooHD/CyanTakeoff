# How Bluebeam Revu stores markups in PDF (observed)

Clean-room notes from inspecting Revu-authored PDFs
(`tests/fixtures/revu`, Revu 20). Only file contents were examined.

## Scale

- Page scale: page `/VP` array of `/Viewport` dicts, each with a standard
  `/Measure` (`/Subtype /RL`), `/BBox` and `/NM`.
- The page scale is the `/Viewport` whose `/BBox` is the whole page and that
  has no `/Name`. Revu viewports (regions with their own scale) are further
  entries with a `/Name` and the region's `/BBox`. Per ISO 32000, where
  entries overlap the last one in the array wins, so the page scale goes
  first. CyanTakeoff writes the same layout and keeps non-ruler entries
  (e.g. geospatial) untouched.
- Separate X/Y scales: ISO 32000 `/Y` number format array next to `/X`
  (CyanTakeoff writes and reads it; no Revu sample yet).
- `/Measure /R` is the ratio label, e.g. `(0.25 in = 1 ft' in")`.
- `/X[0] /C` converts PDF points to the base unit (0.05555556 ft/pt for
  1/4" = 1'-0"). Feet are written as `'`, inches as `"`.
- Feet-inch display: `/D` has two number formats, `(')` with `/C 1` and `(")`
  with `/C 12`; `/D 4` on them means rounding to 1/4".
- `/A` (area, `sf`), `/T` (angle, `°`), `/V` (volume, `cu ft`) number
  formats; `/D 100` means two decimals and `/FD true` drops trailing zeros.
- Revu also adds `/TargetUnitConversion` and an annotation-level `/DepthUnit`.

## Replies

- Replies are standard `/Text` annotations with `/IRT` pointing at the
  markup (reply type `/RT /R`, the default). CyanTakeoff shows them under
  their markup and rewrites them with it.

## Groups

- Markup groups use the same link as count groups: every member after the
  first has `/IRT` pointing at the first markup and `/RT /Group`.
- Lock is the standard annotation flag Locked (`/F` bit 128).

## Measurement annotations

| Revu tool | Subtype | /IT | Notes |
|---|---|---|---|
| Length | Line | LineDimension | `/LL`, `/LLE` leader lines, `/LE` ClosedArrow |
| Area | Polygon | PolygonDimension | `/FillOpacity` |
| Polylength | PolyLine | PolyLineDimension | |
| Perimeter | PolyLine | PolyLineDimension | open as drawn (not auto-closed); told apart by `/Subj` |
| Volume | Polygon | PolygonVolume | |
| Diameter | Circle | CircleDimension | |
| Radius | Polygon | PolygonRadius | 3 vertices: arc start (on the circle), center, arc end; full circle when end = start. The arc runs counterclockwise (PDF space) from start towards the end direction |
| Angle | PolyLine | PolyLineAngle | 3 vertices |
| Count | Polygon (per item) | PolygonCount | `/BBMeasure` instead of `/Measure`, `/NumCounts`, `/CountStyle` |

Common keys: `/Contents` = displayed value (e.g. `5'-5"`, `56.37 sf`),
`/RC` rich text of the same, `/DS` default style
(`font: Helvetica 12pt; ... color:#FF0000`), `/Label`, `/MeasurementTypes`
(bit flags), `/Cap`, `/AlignOnSegment`, `/SlopeType`, `/PitchRun`.

## Count groups

Each counted item is its own annotation. The first item carries
`/GroupNesting [(Subject) /NM1 /NM2 ...]`; the others point to it with
`/IRT <first>` and `/RT /Group` (standard PDF annotation grouping).
`/NumCounts` on every item is the group total; `/Contents` is
`Label\rTotal`.

## Other

- Spaces: page-level `/BSISpaces` array of `/Type /Space` dicts with
  `/Title`, `/Path` (array of `[x y]` arrays, PDF space), `/C` (RGB),
  `/CA` (opacity, 0.1 by default) and nested `/Kids`, each kid pointing back
  with `/Parent`. Nesting follows containment (Revu nests automatically),
  so CyanTakeoff rebuilds the tree from geometry when writing.
- Layers: markups reference optional content groups via `/OC`.
- Text style: `/DS` CSS-like string, `/RC` XHTML with
  `xfa:APIVersion="BluebeamPDFRevu:2018"`.

Digital signatures (ISO 32000 12.8): a `/FT /Sig` field whose `/V` is a
`/Type /Sig` dict with `/Filter /Adobe.PPKLite`, `/SubFilter
/adbe.pkcs7.detached`, `/ByteRange` and a hex `/Contents` holding the
DER CMS SignedData (signed attributes: content type, message digest,
signing time). Each signature is added as an incremental update; files that
contain signatures are always saved incrementally (only changed, reachable
objects appended, with a classic xref table or an xref stream matching the
previous section), so earlier revisions stay byte-for-byte intact.
Verified with pyHanko: intact, valid, modification level "form filling"
for a later signature (markups added after signing show as "other" there:
pyHanko has no rule for annotation changes yet; the signature stays valid).

CyanTakeoff reads all of the above that it supports, preserves the rest
byte-for-byte, and writes its own measurements with the same structure.
