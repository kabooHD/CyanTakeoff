# Performance on low-end machines

How CyanTakeoff behaves on an old or low-memory computer, measured with
`npm run perf` (`scripts/perf.mjs`): a generated 100-sheet set (36 × 24 in
sheets, 3,000 vector strokes and 150 text runs each, 3.5 MB) opened and
browsed in Chromium with the CPU slowed 4× and the browser reporting 4 GB of
memory. Re-run it after changes that touch rendering or the store.

## Results (October 2026)

| Step | Before the pass | After |
|---|---|---|
| App ready (empty) | 0.8 s | 0.8 s |
| Open the 100-sheet set (first page drawn) | 1.5 s | 1.5–2.0 s |
| Next page (Ctrl+Right), average / worst | 177 / 202 ms | 151 / 273 ms |
| Zoom step | 98 ms | 93 ms |
| Continuous view, scroll through 20 sheets | 4.7 s | 3.5 s |
| JavaScript heap after browsing | 87 MB | 27 MB |
| Undo a page operation | — | 0.5 s |

First load on a slow connection (10 Mbit/s, 60 ms, CPU 4× slower, empty
cache), after splitting the script (below):

| Step | One 1.7 MB script | Split |
|---|---|---|
| Something on screen | 1.5 s | 0.45 s |
| App usable | 1.55 s | 1.26 s |

The JavaScript heap does not include canvases or pdf.js worker memory; the
changes below target those too.

## What changed

- **Undo history by memory, not count.** Page operations keep a copy of the
  file for Undo. Copies are now limited by a budget that follows the
  machine's memory (`src/model/device.ts`: 96 MB at 2 GB, 192 MB at 4 GB,
  384 MB at 8 GB; at most 10, the newest always kept).
- **Cold undo snapshots.** The pdf.js document of an undo snapshot is closed
  once nothing shows it (it held the parsed file in the worker); undoing to
  it opens the file copy again (about half a second on the slow machine).
- **Smaller canvases on small machines.** The page canvas and the canvases
  of other pages in continuous views are capped lower at 4 GB and 2 GB;
  printing renders at most 8 MP per page there.
- **Scrolling does less.** Scrolling re-renders the view only when the set
  of nearby pages changes, the zoom detail is redrawn once scrolling pauses,
  pages that only fly past are not rendered, pdf.js drops its parsed data
  for pages already drawn, and content-snap geometry is computed only for a
  page that stays current for a moment (this was most of the memory).
- **Split script.** The entry is a 1.6 KB shell that paints a loading
  screen with React (220 KB); the app (630 KB), pdf.js (490 KB) and
  pdf-lib (425 KB) are separate files fetched in parallel and cached
  independently across app updates (`vite.config.ts` codeSplitting groups).
- **Shortcut lookups** no longer rebuild the command table on every render.

## Not done (ideas)

- Load pdf.js and pdf-lib only when a file is opened (today they load in
  parallel right after the first paint; the empty app needs them because
  the store imports them). This needs the store's PDF calls made dynamic.
- Move content-snap geometry into a Web Worker.
- Measure on real hardware (a 4 GB Windows laptop with integrated graphics)
  with testers' drawing sets; raster-heavy (scanned) sets behave differently
  from this vector set.
