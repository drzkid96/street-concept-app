import { defineConfig } from 'vite';

// GitHub Pages serves the app at /street-concept-app/
export default defineConfig({
  base: process.env.APP_BASE || '/street-concept-app/',
  build: { target: 'es2022', sourcemap: true }
});
