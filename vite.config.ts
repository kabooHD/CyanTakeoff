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
  // Latin-script languages (the invisible text layer is written in WinAnsi); keep in step with OCR_LANGUAGES in src/ui/ocr.ts.
  ...Object.fromEntries(['eng', 'fra', 'deu', 'spa', 'ita', 'por', 'nld'].map((l) => [
    `ocr/lang/${l}.traineddata.gz`, `node_modules/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`,
  ])),
  // Spell check dictionary (Hunspell English, MIT/BSD), loaded on first use.
  'dict/en.aff': 'node_modules/dictionary-en/index.aff',
  'dict/en.dic': 'node_modules/dictionary-en/index.dic',
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
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
