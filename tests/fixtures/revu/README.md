# Revu-authored test fixtures

Real PDFs authored in Bluebeam Revu, used as an answer key: every Revu
measurement stores the value Revu displayed in `/Contents`, and
`tests/revu-compat.test.ts` checks CyanTakeoff computes the same values.

| File | Producer / Creator | Created | Revu version |
|---|---|---|---|
| `measure.pdf` | Bluebeam PDF Library 20 / Bluebeam Revu x64 | 2021-04-21 | 20.x |
| `markup-space.pdf` | Bluebeam PDF Library 20 / Bluebeam Revu x64 | 2021-04-21 | 20.x |
| `markup-deep-spaces.pdf` | Bluebeam PDF Library 20 / Bluebeam Revu x64 | 2021-04-21 | 20.x |

The version comes from the Producer string ("Bluebeam PDF Library 20"); the
file dates are consistent with it.

Source: the test files of [pymkup](https://github.com/psolin/pymkup) by
Paul Solin, MIT licensed (see `LICENSE-pymkup.txt`).

Still needed (searched npm, PyPI and the Bluebeam help in October 2026;
no public Revu-made samples exist). Add any you can get here with a table
row:

- files from Revu 21.x (the current release line, 21.11 as of September 2026);
- a file with custom column values (Revu stores them per markup in
  `/BSIColumnData`, per pymkup; the structure is unknown to us, so we keep
  the key when a markup is edited but do not read it yet);
- an Area or Volume measurement with cutouts (storage unknown; ours goes in
  `/CTData`);
- a Tool Chest tool set exported from Revu (`.btx`), to import Revu tool sets.
