# Fonts — TRIAL FILES, LOCAL PREVIEW ONLY

⚠️ Canela (Commercial Type) and GT America (Grilli Type) in this folder are **trial** files.
They may NOT be deployed or used publicly.

TODO before deploy:
1. Buy desktop + web licences: https://commercialtype.com/catalog/canela and https://www.grillitype.com/licensing
2. Replace the `*-Trial.otf` files with the licensed WOFF2 files and update the `@font-face` block at the top of `public/style.css`.
3. Delete every `*-Trial.otf` from `public/fonts/`.

The trial fonts lack accents, en dash, middot, colon and other glyphs; those fall back to
Instrument Serif / Instrument Sans (`InstrumentSerif-Regular.ttf`, `InstrumentSans.ttf`, SIL Open Font License),
which stay in the stack after launch as the open-source fallback.

| File | Role | Status |
| --- | --- | --- |
| Canela-Light-Trial.otf, Canela-LightItalic-Trial.otf | display (`--font-display`) | trial, replace |
| GTAmerica-Regular-Trial.otf, GTAmerica-RegularItalic-Trial.otf, GTAmerica-Medium-Trial.otf | UI and body (`--font-sans`) | trial, replace |
| InstrumentSerif-Regular.ttf, InstrumentSans.ttf | glyph fallback | open source, keep |
