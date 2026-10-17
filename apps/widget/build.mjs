// Builds the embeddable widget: a single dependency-free IIFE at dist/widget.js (+ dist/v1/widget.js).
//   node build.mjs           production build (minified, no sourcemaps)
//   node build.mjs --watch   rebuild on change (inline sourcemaps, not minified)
// Env (first non-empty wins):
//   API URL       WIDGET_DEFAULT_API_URL → PUBLIC_API_URL → http://localhost:8787
//   product name  WIDGET_PRODUCT_NAME    → PRODUCT_NAME   → ChatPilot AI
//   product URL   WIDGET_PRODUCT_URL     → PRODUCT_URL    → http://localhost:5173   ("Powered by" link)
import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));
const outfile = join(here, 'dist', 'widget.js');
const v1file = join(here, 'dist', 'v1', 'widget.js');
const SIZE_BUDGET = 35 * 1024;

const env = (...names) => names.map((n) => (process.env[n] || '').trim()).find(Boolean);
const apiUrl = (env('WIDGET_DEFAULT_API_URL', 'PUBLIC_API_URL') || 'http://localhost:8787').replace(/\/+$/, '');
const productName = env('WIDGET_PRODUCT_NAME', 'PRODUCT_NAME') || 'ChatPilot AI';
const productUrl = env('WIDGET_PRODUCT_URL', 'PRODUCT_URL') || 'http://localhost:5173';

const define = {
  __VERSION__: JSON.stringify(pkg.version),
  __DEFAULT_API_URL__: JSON.stringify(apiUrl),
  __PRODUCT_NAME__: JSON.stringify(productName),
  __PRODUCT_URL__: JSON.stringify(productUrl),
  'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'),
};

if (!watch && process.env.NODE_ENV === 'production') {
  for (const [k, v] of [['default API URL', apiUrl], ['product URL', productUrl]]) {
    if (/\/\/(localhost|127\.0\.0\.1)\b/.test(v)) console.warn(`[widget] ⚠ production build with ${k} ${v}. Set the env vars above.`);
  }
}

/** Minifies the CSS template literal in src/styles.ts at build time. */
const minifyCss = {
  name: 'minify-css-literal',
  setup(build) {
    build.onLoad({ filter: /[\/]src[\/]styles\.ts$/ }, async (args) => {
      let src = await readFile(args.path, 'utf8');
      const m = /export const CSS = `([\s\S]*?)`;/.exec(src);
      if (m && !watch) {
        const { code } = await esbuild.transform(m[1], { loader: 'css', minify: true });
        src = src.replace(m[0], () => `export const CSS = ${JSON.stringify(code.trim())};`);
      }
      return { contents: src, loader: 'ts' };
    });
  },
};

/** Copies to dist/v1 and reports sizes after every (re)build. */
const report = {
  name: 'report',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length) return;
      await mkdir(dirname(v1file), { recursive: true });
      await copyFile(outfile, v1file);
      const buf = await readFile(outfile);
      const gz = gzipSync(buf, { level: 9 }).length;
      const kb = (n) => (n / 1024).toFixed(1) + ' KB';
      const over = !watch && buf.length > SIZE_BUDGET;
      console.log(`[widget] dist/widget.js ${kb(buf.length)} (gzip ${kb(gz)})${over ? `  ⚠ over ${kb(SIZE_BUDGET)} budget` : ''}`);
      await writeFile(join(here, 'dist', 'build-info.json'), JSON.stringify({ version: pkg.version, bytes: buf.length, gzipBytes: gz, builtAt: new Date().toISOString() }, null, 2));
    });
  },
};

const options = {
  entryPoints: [join(here, 'src', 'index.ts')],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2018'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  banner: { js: `/*! ${JSON.parse(define.__PRODUCT_NAME__)} widget v${pkg.version} */` },
  define,
  // Plain this.x = v assignments instead of __publicField() helpers (much smaller output).
  // Members named with a trailing underscore are internal and get mangled to short names.
  mangleProps: /[a-z]_$/,
  tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
  logLevel: 'warning',
  plugins: [minifyCss, report],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[widget] watching src/ for changes…');
} else {
  await esbuild.build(options);
}
