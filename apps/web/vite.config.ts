import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * Social crawlers need absolute og:image URLs. Replaces __APP_URL__ in index.html with
 * VITE_PUBLIC_APP_URL (falls back to root-relative URLs when it isn't set).
 */
function absoluteAppUrl(appUrl: string): Plugin {
  const base = appUrl.replace(/\/+$/, '');
  return {
    name: 'chatpilot-absolute-app-url',
    transformIndexHtml: (html) => html.replaceAll('__APP_URL__', base),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), tailwindcss(), absoluteAppUrl(env.VITE_PUBLIC_APP_URL ?? '')],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 5173 },
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            query: ['@tanstack/react-query'],
          },
        },
      },
    },
  };
});
