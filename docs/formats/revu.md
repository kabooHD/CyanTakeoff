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
- `/Measure /R` is the ratio label, e.g. `(0.25 in = 1 ft' in")`.
- `/X[0] /C` converts PDF points to the base unit (0.05555556 ft/pt for
  1/4" = 1'-0"). Feet are written as `'`, inches as `"`.
- Feet-inch display: `/D` has two number formats, `(')` with `/C 1` and `(")`
  with `/C 12`; `/D 4` on them means rounding to 1/4".
- `/A` (area, `sf`), `/T` (angle, `°`), `/V` (volume, `cu ft`) number
  formats; `/D 100` means two decimals and `/FD true` drops trailing zeros.
- Revu also adds `/TargetUnitConversion` and an annotation-level `/DepthUnit`.

## Measurement annotations

| Revu tool | Subtype | /IT | Notes |
|---|---|---|---|
| Length | Line | LineDimension | `/LL`, `/LLE` leader lines, `/LE` ClosedArrow |
| Area | Polygon | PolygonDimension | `/FillOpacity` |
| Polylength | PolyLine | PolyLineDimension | |
| Perimeter | PolyLine | PolyLineDimension | open as drawn (not auto-closed); told apart by `/Subj` |
| Volume | Polygon | PolygonVolume | |
| Diameter | Circle | CircleDimension | |
| Radius | Polygon | PolygonRadius | 3 vertices |
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

- Spaces: page-level `/BSISpaces` array.
- Layers: markups reference optional content groups via `/OC`.
- Text style: `/DS` CSS-like string, `/RC` XHTML with
  `xfa:APIVersion="BluebeamPDFRevu:2018"`.

CyanTakeoff reads all of the above that it supports, preserves the rest
byte-for-byte, and writes its own measurements with the same structure.
