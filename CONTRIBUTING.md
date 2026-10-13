# Contributing to CyanTakeoff

Thanks for helping. Two rules matter more than anything else:

1. **Clean-room only.** Build from public documentation, PDFs you created
   yourself, and your own code. Never use decompiled Bluebeam code, code or
   data derived from it, or Bluebeam icons, images or help text. Pull
   requests that do will be closed.
2. **Don't break files.** Any change to reading or writing PDFs needs a test,
   and must keep `npm test` and `npm run e2e` passing. Revu-authored test
   files go in `tests/fixtures/revu` with their source and licence noted.

Run `npm run typecheck && npm test && npm run build` before opening a pull
request.
