# Handoff (2026-10-14)

Work continues on branch `claude/cyantakeoff-bluebeam-alternative-ke6po9`.
Read `CLAUDE.md` first; its Status section is current.

## In progress: OCR for non-Latin scripts (last commit, WIP)
- Done: `src/pdf/glyphless.ts` (Unicode "glyphless" Type0 font so the
  invisible OCR text layer works in any script), `src/ui/ocr.ts` uses it
  (right-to-left words written in visual order), 11 more languages
  (pol, tur, rus, ukr, ell, ara, heb, chi_sim, chi_tra, jpn, kor) in
  `package.json` and `vite.config.ts`. `tests/ocrText.test.ts` passes.
- To do: run the full suite (`npm run typecheck && npm test && npm run
  build`, then the e2e with the preview server), fix anything that broke,
  then update docs: remove "OCR languages limited to Latin scripts" from
  Known gaps in `CLAUDE.md`, add a line to `docs/PLAN.md` and
  `docs/revu-behaviour.md`.

## Remaining task list
1. Session follow-ups: print selected pages and margins; bookmark Action
   dialog; .pat hatch import; VisualSearch colour filter; batch
   header/footer across files; more spell-check languages; move content;
   XFDF image appearance.
2. Then: check online for Revu features still missing and keep going.
3. Later (owner decides): Revu trial exploration, tester company list
   and outreach email, public test deploy (never deploy without the owner).
