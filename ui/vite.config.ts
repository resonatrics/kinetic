import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    assetsDir: '',
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        chunkFileNames: '[name].js',
        assetFileNames: (assetInfo) => assetInfo.names.some((name) => name.endsWith('.css'))
          ? 'styles.css'
          : '[name][extname]',
      },
    },
  },
});
