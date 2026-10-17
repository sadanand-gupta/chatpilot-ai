import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // The shared contract package ships TypeScript sources, so it must be bundled.
  noExternal: ['@chatpilot/shared'],
  // Everything else stays an external runtime dependency (installed from package.json).
  banner: {
    js: "import { createRequire as __cpCreateRequire } from 'module'; const require = __cpCreateRequire(import.meta.url);",
  },
});
