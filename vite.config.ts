import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/resilience-tabletop/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
