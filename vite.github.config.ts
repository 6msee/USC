import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  build: { outDir: 'github-dist', emptyOutDir: true },
});
