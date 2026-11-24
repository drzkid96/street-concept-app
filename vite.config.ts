import { defineConfig } from 'vite';

// GitHub Pages serves the app at /street-concept-app/
export default defineConfig({
  base: '/street-concept-app/',
  build: { target: 'es2022', sourcemap: true }
});
