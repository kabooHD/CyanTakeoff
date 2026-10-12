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

Still needed: files from Revu 21.x (the current release line, 21.11 as of
September 2026). Add any you can get here with the same table row.
