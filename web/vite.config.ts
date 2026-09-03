import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Canonical deploy target is GitHub Pages under /saffronspoon/app/, so that is
 * the default base baked into asset URLs.
 *
 * Hosts that serve the app from the domain root (e.g. Vercel) must build with
 * VITE_BASE=/ — the env var overrides the default without touching this file.
 */
export default defineConfig(() => ({
  base: process.env.VITE_BASE ?? '/saffronspoon/app/',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
}));
