import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/**
 * OCR assets (tesseract.js worker, LSTM cores, language data) are served from
 * the app itself under /ocr/ instead of a CDN, so self-hosted installs work
 * offline. They are only downloaded when someone runs OCR.
 */
const OCR_FILES: Record<string, string> = {
  'ocr/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'ocr/core/tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'ocr/core/tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  // OCR languages; keep in step with OCR_LANGUAGES in src/ui/ocr.ts (any script: the text layer uses a Unicode glyphless font).
  ...Object.fromEntries(['eng', 'fra', 'deu', 'spa', 'ita', 'por', 'nld', 'pol', 'tur', 'rus', 'ukr', 'ell', 'ara', 'heb', 'chi_sim', 'chi_tra', 'jpn', 'kor'].map((l) => [
    `ocr/lang/${l}.traineddata.gz`, `node_modules/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`,
  ])),
  // Spell check dictionaries (Hunspell, from wooorm/dictionaries; each with its licence), loaded on first use.
  // Keep in step with SPELL_LANGUAGES in src/ui/Spell.tsx.
  ...Object.fromEntries(['en', 'en-gb', 'fr', 'de', 'es', 'it', 'nl', 'pt', 'pl', 'sv', 'da'].flatMap((l) => [
    [`dict/${l}.aff`, `node_modules/dictionary-${l}/index.aff`], [`dict/${l}.dic`, `node_modules/dictionary-${l}/index.dic`], [`dict/${l}.license`, `node_modules/dictionary-${l}/license`],
  ])),
};

function ocrAssets(): Plugin {
  return {
    name: 'cyantakeoff-ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0].replace(/^\//, '');
        const src = OCR_FILES[path];
        if (!src) return next();
        res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(src));
      });
    },
    generateBundle() {
      for (const [fileName, src] of Object.entries(OCR_FILES)) this.emitFile({ type: 'asset', fileName, source: readFileSync(src) });
    },
  };
}

export default defineConfig({
  plugins: [react(), ocrAssets()],
  build: {
    rolldownOptions: {
      output: {
        // Big libraries in their own files: downloaded in parallel and cached across app updates.
        codeSplitting: {
          groups: [
            // Vite's module preload helper is used by the small entry: keep it out of the big chunks.
            { name: 'preload', test: /preload-helper|modulepreload-polyfill/, priority: 10 },
            { name: 'pdfjs', test: /node_modules[\\/]pdfjs-dist/ },
            { name: 'pdf-lib', test: /node_modules[\\/](pdf-lib|@pdf-lib|pako)/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
